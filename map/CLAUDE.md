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
- Three views: H3 hex grid (Helium-style), per-station coverage polygons, and
  Density (one station's messages per H3 cell from
  `/api/v1/coverage/stations/:id/density`, log-scaled on the spectrum in
  `src/lib/constants/density.ts`, Bands or Smooth, neighbors averaged; the other
  stations' polygons stay faded and clickable). With no station picked, Density
  shows every station's polygon faded with all stations' density together on
  top (`/api/v1/coverage/density`, follows the transport and mode filters);
  there polygon clicks pick nothing (an area feed's polygon covers whole
  regions), so a station is picked from its marker or the list. A polygon
  clicked in the Polygons view does not carry into Density
- "Only selected station" (`onlySelected`, S key, station card button, `only=1`
  in the URL with `station=<id>`) hides other stations' cells, polygons and
  markers in every view. The focused station is `selectedStationId`, else the
  clicked polygon's (`polygonStationId`)
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
