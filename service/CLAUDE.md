# Coverage Service

Airframes coverage aggregation service. Subscribes to NATS processed messages across all transport types (aircraft, marine, etc.), validates data, and computes H3 hex grid + per-station directional coverage.

## Commands
- `npm run dev` - Start with tsx watch
- `npm run build` - TypeScript compile
- `npm run start` - Run built JS
- `npm run typecheck` - Type check only

## Architecture
- NATS subscriber for all processed message subjects (aircraft, marine, reports, flights)
- Server-side validation pipeline (coordinates, signal, range plausibility, station trust)
- In-memory sliding window aggregation at H3 resolutions 2-7
- 8 time windows: 5m, 30m, 1h, 6h, 12h, 24h, 1w, 1mo
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
