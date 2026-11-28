import { PolygonLayer } from '@deck.gl/layers';
import { stationHue, hslToRgba } from '@/lib/constants/colors';
import type { CoveragePolygon } from '@/lib/types/coverage';

/**
 * @param faded - draw the polygons as quiet context (Density view, where they
 *   sit around the focused station's density and can be clicked to switch)
 */
export function createPolygonLayer(
  data: CoveragePolygon[],
  selectedStationId: number | null = null,
  faded = false,
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
      !faded && d.stationId === selectedStationId ? 800 : 0,
    getFillColor: (d) => {
      const hue = stationHue(d.stationId);
      if (faded) return hslToRgba(hue, 40, 50, 16);
      if (d.stationId === selectedStationId) {
        return hslToRgba(hue, 80, 60, 160);
      }
      return hslToRgba(hue, 65, 50, 70);
    },
    getLineColor: (d) => {
      const hue = stationHue(d.stationId);
      if (faded) return hslToRgba(hue, 45, 60, 110);
      if (d.stationId === selectedStationId) {
        return hslToRgba(hue, 90, 75, 255);
      }
      return hslToRgba(hue, 75, 60, 220);
    },
    getLineWidth: (d) =>
      !faded && d.stationId === selectedStationId ? 4 : faded ? 1 : 2,
    lineWidthMinPixels: faded ? 1 : 1.5,
    lineWidthMaxPixels: 6,
    elevationScale: 1,
    // Only transition elevation on selection change — no transitions on data refresh
    transitions: {
      getElevation: { duration: 400 },
    },
    updateTriggers: {
      getFillColor: [selectedStationId, faded],
      getLineColor: [selectedStationId, faded],
      getElevation: [selectedStationId, faded],
      getLineWidth: [selectedStationId, faded],
    },
  });
}
