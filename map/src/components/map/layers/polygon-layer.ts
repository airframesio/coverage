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
      const alpha = Math.floor(d.confidence * 80);
      return hslToRgba(hue, 70, 55, alpha);
    },
    getLineColor: (d) => {
      const hue = stationHue(d.stationId);
      return hslToRgba(hue, 80, 65, 200);
    },
    getLineWidth: 2,
    lineWidthMinPixels: 1,
    lineWidthMaxPixels: 3,
    transitions: {
      getFillColor: { duration: 500 },
    },
    updateTriggers: {
      getFillColor: [data],
      getLineColor: [data],
    },
  });
}
