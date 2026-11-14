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

The map is fully client-rendered, so it ships to Cloudflare Pages as a static export:

```bash
cd map
npm run build:static   # writes map/out
npx wrangler pages deploy out --project-name=airframes-coverage
```

`.github/workflows/deploy-map.yml` does this automatically: pushes to `main` publish production,
pull requests publish a preview. It needs two repository secrets:

| Secret | Description |
|--------|-------------|
| `CLOUDFLARE_API_TOKEN` | API token with **Account → Cloudflare Pages → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

Optional repository variables: `CLOUDFLARE_PAGES_PROJECT` (default `airframes-coverage`),
`NEXT_PUBLIC_COVERAGE_API_URL`, `NEXT_PUBLIC_WS_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`.
The workflow skips the deploy step (with a warning) until the secrets exist.

### Docker

`npm run build` still produces the Next.js standalone server used by `map/Dockerfile`,
and CI publishes `ghcr.io/airframesio/coverage-map` and `ghcr.io/airframesio/coverage-service` from `main`.
