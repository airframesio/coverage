import { PolygonLayer } from '@deck.gl/layers';
import { stationHue, hslToRgba } from '@/lib/constants/colors';
import type { CoveragePolygon } from '@/lib/types/coverage';

export function createPolygonLayer(
  data: CoveragePolygon[],
  selectedStationId: number | null = null,
) {
  return new PolygonLayer<CoveragePolygon>({
    id: 'coverage-polygons',
    data,
    pickable: true,
    stroked: true,
    filled: true,
    extruded: true,
    wireframe: true,
    getPolygon: (d) => d.coordinates[0],
    getElevation: (d) =>
      d.stationId === selectedStationId ? 800 : 0,
    getFillColor: (d) => {
      const hue = stationHue(d.stationId);
      if (d.stationId === selectedStationId) {
        return hslToRgba(hue, 80, 60, 160);
      }
      return hslToRgba(hue, 65, 50, 70);
    },
    getLineColor: (d) => {
      const hue = stationHue(d.stationId);
      if (d.stationId === selectedStationId) {
        return hslToRgba(hue, 90, 75, 255);
      }
      return hslToRgba(hue, 75, 60, 220);
    },
    getLineWidth: (d) =>
      d.stationId === selectedStationId ? 4 : 2,
    lineWidthMinPixels: 1.5,
    lineWidthMaxPixels: 6,
    elevationScale: 1,
    // Only transition elevation on selection change — no transitions on data refresh
    transitions: {
      getElevation: { duration: 400 },
    },
    updateTriggers: {
      getFillColor: [selectedStationId],
      getLineColor: [selectedStationId],
      getElevation: [selectedStationId],
      getLineWidth: [selectedStationId],
    },
  });
}
