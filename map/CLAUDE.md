# Coverage Map

Airframes coverage map visualization built with Next.js, Deck.gl, MapLibre GL JS.

## Commands
- `npm run dev` - Start dev server
- `npm run build` - Production build
- `npm run lint` - Lint

## Architecture
- Full-viewport dark map (CartoDB Dark Matter tiles)
- Two modes: H3 hex grid (Helium-style) and per-station coverage polygons
- Data from coverage-service backend (port 3002)
- Zustand for state management
- shadcn/ui for control panel components

## Key Directories
- src/components/map/ - Map and Deck.gl layers
- src/components/controls/ - UI controls (slider, toggle, legend)
- src/components/station/ - Station popup/detail
- src/lib/stores/ - Zustand stores
- src/lib/api/ - REST + WebSocket clients
- src/lib/constants/ - Config, colors, time windows
- src/lib/types/ - TypeScript types
