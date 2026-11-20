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
- Per-station rate limit: 900 events a minute, 6000 for marine. `/api/v1/health`
  reports `rateLimitedByTransport` and `outOfRange` by radio family (`near` = within
  twice the range limit, `far` = beyond it)
- Hono REST API on port 3002
- Station metadata synced from main API (authoritative coordinates)

## Key Directories
- src/nats/ - NATS subscription and message parsers
- src/validation/ - Coordinate, signal, trust, and rate validation
- src/compute/ - Distance, bearing, H3 indexing, signal analysis
- src/aggregation/ - Sliding windows and coverage store
- src/api/ - Hono HTTP routes
- src/sync/ - Station metadata sync from main API

## Environment Variables
- NATS_URL - NATS server URL
- NATS_JWT / NATS_NKEY_SEED - NATS auth
- MAIN_API_URL - Main Airframes API (for station sync)
- PORT - HTTP port (default 3002)
- DATABASE_URL - PostgreSQL connection string
- MARINE_COVERAGE_ENABLED - set to `false` to leave the marine subjects unsubscribed
