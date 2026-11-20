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
- Stations flagged by the main API are accepted (the flag marks the busiest
  stations); blocked stations are rejected. `/api/v1/health` reports rejections
  and discarded positions by reason, and `cellsInMemory`.
- No per-station rate limit (busy receivers are legitimate). `/api/v1/health` reports
  `outOfRange` positions by radio family (`near` = within twice the range limit,
  `far` = beyond it)
- Imported area feeds (station idents in `AREA_FEED_STATIONS`, default `NCT`) are
  treated like satellite relays: every position is kept, with no range limit and
  no range or direction for the station
- Hono REST API on port 3002
- Prometheus metrics at `GET /metrics` (root of the same port, prom-client). The
  port is public, so the route needs `MONITORING_TOKEN` as `Authorization: Bearer`
  or `X-Monitoring-Token` and answers 401 when the variable is unset. Every value
  is read at scrape time from the counters `/api/v1/health` reports
  (src/metrics/metrics.ts). Names follow the Airframes metrics contract, prefix
  `coverage_`; keep labels to small fixed sets (no station ids or idents).
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
