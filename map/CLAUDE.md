# Coverage Map

Airframes coverage map visualization built with Next.js, Deck.gl, MapLibre GL JS.

## Commands
- `npm run dev` - Start dev server
- `npm run build` - Production build (standalone server, used by Docker)
- `npm run build:static` - Static export to `out/` (used by Cloudflare Pages)
- `npm run typecheck` - TypeScript check
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
- src/lib/constants/ - Config, colors, time windows
- src/lib/types/ - TypeScript types

## Notes
- maplibre-gl stays on 5.x: deck.gl 9.4's MapboxOverlay reads `map.transform`, which maplibre-gl 6 removed.
- Source-type colors live in `src/lib/constants/colors.ts` (`sourceColor`); do not add per-component palettes.
- Mode checkboxes (`ModeFilter`, `src/lib/constants/modes.ts`) send `modes=` only when some mode of the transport filter is unchecked; choosing All checks every mode again. They double as the marker color legend.
