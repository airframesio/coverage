# Airframes Coverage

Real-time coverage visualization for the Airframes feeder network across all transport types (aircraft, marine, and more).

## Architecture

```
NATS (processed messages) → Coverage Service → REST/WS API → Coverage Map (browser)
```

- **`service/`** — Node.js/TypeScript backend that subscribes to NATS, validates data, aggregates coverage into H3 hex grids and per-station directional polygons
- **`map/`** — Next.js + Deck.gl + MapLibre frontend showing an interactive dark-themed coverage map with hex grid and polygon visualization modes

## Quick Start

```bash
# Service
cd service && npm install && npm run dev

# Map (separate terminal)
cd map && npm install && npm run dev
```

## Docker

```bash
# Build both
docker build -t airframes/coverage-service service/
docker build -t airframes/coverage-map map/

# Or use docker-compose
cd service && docker compose up
```

## Environment Variables

### Service (`service/`)
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3002` | HTTP API port |
| `NATS_URL` | `nats://localhost:4222` | NATS server |
| `NATS_JWT` | | NATS JWT auth token |
| `NATS_NKEY_SEED` | | NATS NKEY seed |
| `MAIN_API_URL` | `http://localhost:3001` | Airframes main API (station sync) |
| `DEV_AUTO_TRUST_STATIONS` | `false` | Auto-trust unknown stations (dev only) |

### Map (`map/`)
| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_COVERAGE_API_URL` | `http://localhost:3002` | Coverage service API |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:3002/ws` | Coverage service WebSocket |
| `NEXT_PUBLIC_MAP_STYLE_URL` | CartoDB Dark Matter | MapLibre tile style URL |
