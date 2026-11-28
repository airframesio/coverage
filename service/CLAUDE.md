# Coverage Service

Airframes coverage aggregation service. Subscribes to NATS processed messages across all transport types (aircraft, marine, etc.), validates data, and computes H3 hex grid + per-station directional coverage.

## Commands
- `npm run dev` - Start with tsx watch
- `npm run build` - TypeScript compile
- `npm run start` - Run built JS
- `npm run typecheck` - Type check only
- `npm test` - Run unit and API smoke tests (Vitest, in `test/`)

## Architecture
- NATS subscriber for aircraft message and report subjects, and for marine AIS
- Marine events carry no `station` object: `ais_message.created` has the station
  UUID and `voyage-position.created` the vessel position, joined on the voyage id
  in src/nats/marine-correlator.ts (one reception per AIS message). `/api/v1/health`
  reports the join under `marine`.
- Flight events (`v1.aircraft.flight.*`) name no station, so they are not subscribed
- Server-side validation pipeline (coordinates, signal, range plausibility, station trust)
- In-memory sliding window aggregation at H3 resolutions 2-7
- 9 time windows: 1m, 5m, 30m, 1h, 6h, 12h, 24h, 1w, 1mo
- Memory: fine resolutions are kept only for short windows, and windows of similar
  length share one set of slices (30m reads from 1h, 6h/12h from 24h, 1w from 1mo).
  See `WINDOW_CONFIGS` / `H3_RESOLUTION_CONFIGS` in src/types/coverage.ts. A request
  for a finer grid than a window keeps is answered at the finest one it has.
- "No position" arrives as latitude 0 / longitude 0 and is treated as missing
- AIS positions south of 79° S (inland Antarctic ice, past the Ross Sea) are
  dropped as `marine_on_ice`: imported feeds pass on corrupt fixes there and an
  importer has no location to range-check them against
- Stations flagged by the main API are accepted (the flag marks the busiest
  stations); blocked stations are rejected. `/api/v1/health` reports rejections
  and discarded positions by reason, and `cellsInMemory`.
- No per-station rate limit (busy receivers are legitimate). `/api/v1/health` reports
  `outOfRange` positions by radio family (`near` = within twice the range limit,
  `far` = beyond it), and `outOfRangeStations`: the 20 stations with the most such
  discards and the furthest distance each saw (a mislocated station shows up here),
  and `outOfRangeDistanceKm`: the same discards per family by distance band
  (`upTo500` ... `upTo10000`, `over10000`)
- Imported area feeds (station idents in `AREA_FEED_STATIONS`, default `NCT`) are
  treated like satellite relays: every position is kept, with no range limit and
  no range or direction for the station
- A station whose location nobody entered only has a GeoIP guess (the provider's
  city, often hundreds of km off). Such a station is placed at the centre of the
  positions it hears (median of the recent ones) once those form one group no wider
  than the radio's range and the centre is at least twice as far from the
  registered spot as the group is wide (at least 100 km; a placed station stays
  placed until the centre is back within one width): src/compute/heard-location.ts and
  `placeByHeard` in the store. Owner-entered locations (`userLatitude` in the main
  API) are never moved. Station responses carry `locationSource` (`registered` or
  `heard`), health reports `stationsPlacedByHeard`, and the estimates are saved
  with the snapshots. Nothing is written back to the main API.
  Ships surround a coastal receiver, so an AIS station needs 30 positions (last
  200 kept). Aircraft pass in streams and a few flights on one airway put the
  centre 100 to 250 km off, so an aircraft station needs 1,000 positions taken
  at least 10 seconds apart (last 2,000 kept): `MARINE_PROFILE` and
  `AIRCRAFT_PROFILE`. A saved estimate from fewer positions than that is ignored;
  the samples themselves are not saved, so an unplaced station starts counting
  again at a restart.
- Hono REST API on port 3002. Answers under `/api/v1/coverage`, `/api/v1/stations`
  (10 s), `/api/v1/stats` and `/api/v1/activity` (5 s) are kept and shared between callers asking the
  same question (src/api/response-cache.ts): they are computed on the thread that
  takes in events, and every open map polls them. Health is never cached.
  Cached answers are sent br or gzip compressed (as the caller's Accept-Encoding
  allows, 1 KB and up), each compressed once per encoding on the libuv pool.
  Anything that builds a list over all stations must do it in one pass over the
  window slices (`allStationCoverage`), never one scan per station, and a
  single-station route must look up only that station (`getStationMessageCount`).
  The map's polygon view asks `/api/v1/coverage/polygons` (every station's
  polygon in one answer) every 10 s; it used to make one request per station.
  `coverage_http_requests_total` / `coverage_http_request_duration_seconds`
  (labels route, status, cache) show which requests keep the thread busy.
- A cell reported by several stations keeps each one's message count
  (`stationIds` becomes a Map; one station stays a plain number), so
  `/api/v1/coverage/stations/:id/density` can give a station's own messages per
  cell (res 5 up to 1h, 4 up to 24h, 3 beyond). It walks the window's slices for
  that station only. Messages without a position are filed in the station's own
  cell and also counted there per station (`positionless`, only on those cells),
  so density leaves exactly them out, wherever the station was when they came in.
  Snapshots save the counts as `stationMsgCounts` and `stationPositionless`;
  older ones share counts out evenly, and a slice restored without
  `stationPositionless` leaves out the cell at the station's location.
- `modes=acars,vdl,...` (families from src/compute/source-family.ts) filters
  `/coverage/h3`, `/coverage/polygons` and `/stations`. Stations and polygons go by the
  station's source type; a hex cell is kept when any source that heard it is of a
  chosen family, and keeps the totals of all its sources (cells hold one set of
  totals, not one per family). Missing or every family means no filter.
- Prometheus metrics at `GET /metrics` (root of the same port, prom-client). The
  port is public, so the route needs `MONITORING_TOKEN` as `Authorization: Bearer`
  or `X-Monitoring-Token` and answers 401 when the variable is unset. Every value
  is read at scrape time from the counters `/api/v1/health` reports
  (src/metrics/metrics.ts). Names follow the Airframes metrics contract, prefix
  `coverage_`; keep labels to small fixed sets (no station ids or idents).
- Snapshots of the 1h and longer windows go to PostgreSQL (`coverage_snapshots`,
  src/data/persistence.ts) so a restart keeps its coverage. They are saved per
  slice (`h3_slice`, `stations_slice`, with `slice_started_at`) and a restart puts
  each slice back at its age, so 6h stays 6h and old slices still expire on time.
  (Whole-window snapshots went into the newest slice: after a restart every view
  showed its owner's full history, and history never expired across restarts.)
  The current slice is rewritten every sixtieth of the window, between 1 and 15
  minutes (`snapshotInterval`); a closed slice is written once more and then left
  alone; rows of slices no longer in memory are deleted. Heard locations every
  5 minutes, everything on shutdown. `coverage_snapshot_bytes_written_total`
  counts what is written. The old `h3`/`stations` rows are read once after an
  upgrade and deleted at the first per-slice save.
- Station metadata synced from main API (authoritative coordinates)

## Key Directories
- src/nats/ - NATS subscription and message parsers
- src/validation/ - Coordinate, signal and trust validation
- src/compute/ - Distance, bearing, H3 indexing, signal analysis
- src/aggregation/ - Sliding windows and coverage store
- src/api/ - Hono HTTP routes
- src/metrics/ - Prometheus registry and job status for `/metrics`
- src/sync/ - Station metadata sync from main API

## Environment Variables
- NATS_URL - NATS server URL
- NATS_JWT / NATS_NKEY_SEED - NATS auth
- MAIN_API_URL - Main Airframes API (for station sync)
- PORT - HTTP port (default 3002)
- DATABASE_URL - PostgreSQL connection string
- AREA_FEED_STATIONS - comma-separated idents of stations that relay an area feed (default `NCT`)
- MONITORING_TOKEN - token Prometheus sends to scrape `/metrics`; unset means the route always answers 401
- MARINE_COVERAGE_ENABLED - set to `false` to leave the marine subjects unsubscribed
