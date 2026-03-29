import { ScatterplotLayer } from '@deck.gl/layers';
import type { Station } from '@/lib/types/coverage';

const SOURCE_COLORS: Record<string, [number, number, number]> = {
  acars:     [52, 211, 153],
  vdl:       [96, 165, 250],
  hfdl:      [129, 140, 248],
  satcom:    [167, 139, 250],
  aiscatcher:[251, 146, 60],
  ais:       [251, 146, 60],
};

const DEFAULT_COLOR: [number, number, number] = [200, 200, 200];
const SELECTED_COLOR: [number, number, number, number] = [99, 251, 215, 255];

/**
 * @param highlightedId - station to highlight (from direct click OR polygon selection)
 */
export function createStationMarkersLayer(
  data: Station[],
  highlightedId: number | null,
) {
  const visibleData = data.filter(
    (d) => d.latitude !== 0 || d.longitude !== 0
  );

  return new ScatterplotLayer<Station>({
    id: 'station-markers',
    data: visibleData,
    pickable: true,
    // Elevate highlighted station above polygon extrusion (800m)
    getPosition: (d) =>
      d.id === highlightedId
        ? [d.longitude, d.latitude, 1200]
        : [d.longitude, d.latitude, 0],
    getFillColor: (d) => {
      if (d.id === highlightedId) return SELECTED_COLOR;
      const rgb = SOURCE_COLORS[d.sourceType] ?? DEFAULT_COLOR;
      return [rgb[0], rgb[1], rgb[2], 200];
    },
    getRadius: (d) => {
      if (d.id === highlightedId) return 20;
      return Math.max(4, Math.log2((d.messageCount || 1) + 1) * 1.8);
    },
    radiusMinPixels: 3,
    radiusMaxPixels: 20,
    stroked: true,
    getLineColor: (d) =>
      d.id === highlightedId
        ? [99, 251, 215, 150]
        : [0, 0, 0, 100],
    getLineWidth: (d) =>
      d.id === highlightedId ? 3 : 1,
    lineWidthMinPixels: 1,
    lineWidthMaxPixels: 4,
    updateTriggers: {
      getPosition: [highlightedId],
      getFillColor: [highlightedId],
      getRadius: [highlightedId],
      getLineColor: [highlightedId],
      getLineWidth: [highlightedId],
    },
  });
}
