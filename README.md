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
| `NEXT_PUBLIC_MAP_STYLE_URL` | CartoDB Dark Matter | MapLibre style URL for the default (Dark) basemap |

## Deployment

### Map on Cloudflare Pages

The map is fully client-rendered, so it ships to Cloudflare Pages as a static export. The Pages
project is connected to this repository through Cloudflare's Git integration (same as the globe),
so pushes to `main` publish production and pull requests get preview deployments. No GitHub
secrets or deploy workflow are involved.

Pages project build settings:

| Setting | Value |
|---------|-------|
| Root directory | `map` |
| Build command | `npm run build:static` |
| Build output directory | `out` |
| Environment variable `NODE_VERSION` | `24` |
| Environment variable `NEXT_PUBLIC_COVERAGE_API_URL` | `https://coverage-api.airframes.io` |
| Environment variable `NEXT_PUBLIC_WS_URL` | `wss://coverage-api.airframes.io/ws` |

`coverage-api.airframes.io` is the production coverage service. It serves the API under
`/api/` and is published through the API load balancer in `airframesio/stack`
(`prod/api/compose.yml`). The staging cluster serves the same paths at
`staging-coverage.airframes.io`. The service has no WebSocket endpoint yet (`/ws` returns
404) and the map does not open one, so `NEXT_PUBLIC_WS_URL` is reserved for later use.

`NEXT_PUBLIC_MAP_STYLE_URL` is optional. Without the API variables the build falls back to
`http://localhost:3002`, so set them for both Production and Preview.

To build the same output locally: `cd map && npm run build:static` (writes `map/out`).

### Docker

`npm run build` still produces the Next.js standalone server used by `map/Dockerfile`,
and CI publishes `ghcr.io/airframesio/coverage-map` and `ghcr.io/airframesio/coverage-service` from `main`.
