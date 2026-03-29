import { PolygonLayer } from '@deck.gl/layers';
import { stationHue, hslToRgba } from '@/lib/constants/colors';
import type { CoveragePolygon } from '@/lib/types/coverage';

export function createPolygonLayer(data: CoveragePolygon[]) {
  return new PolygonLayer<CoveragePolygon>({
    id: 'coverage-polygons',
    data,
    pickable: true,
    stroked: true,
    filled: true,
    getPolygon: (d) => d.coordinates[0],
    getFillColor: (d) => {
      const hue = stationHue(d.stationId);
      // Ensure fill is always visible: min alpha 40, max 120
      const alpha = Math.max(40, Math.min(120, Math.floor(d.confidence * 120 + 30)));
      return hslToRgba(hue, 65, 50, alpha);
    },
    getLineColor: (d) => {
      const hue = stationHue(d.stationId);
      return hslToRgba(hue, 75, 60, 220);
    },
    getLineWidth: 2,
    lineWidthMinPixels: 1.5,
    lineWidthMaxPixels: 4,
    transitions: {
      getFillColor: { duration: 500 },
    },
    updateTriggers: {
      getFillColor: [data],
      getLineColor: [data],
    },
  });
}
