import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { coverageColorScale } from '@/lib/constants/colors';
import type { CoverageHex } from '@/lib/types/coverage';

export function createHexGridLayer(data: CoverageHex[]) {
  return new H3HexagonLayer<CoverageHex>({
    id: 'coverage-hexgrid',
    data,
    pickable: true,
    filled: true,
    extruded: false,
    stroked: true,
    getHexagon: (d) => d.h3,
    getFillColor: (d) => coverageColorScale(d.confidence),
    getLineColor: [255, 255, 255, 30],
    lineWidthMinPixels: 0.5,
    opacity: 0.85,
    // No transitions — data refreshes every 10s and transitions cause flicker
  });
}
