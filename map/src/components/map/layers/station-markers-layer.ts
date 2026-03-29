import { ScatterplotLayer } from '@deck.gl/layers';
import type { Station } from '@/lib/types/coverage';

/** Source type to RGBA color for station dots */
const SOURCE_COLORS: Record<string, [number, number, number]> = {
  acars:     [52, 211, 153],    // emerald
  vdl:       [96, 165, 250],    // blue
  hfdl:      [129, 140, 248],   // indigo
  satcom:    [167, 139, 250],   // purple
  aiscatcher:[251, 146, 60],    // orange
  ais:       [251, 146, 60],    // orange
};

const DEFAULT_COLOR: [number, number, number] = [200, 200, 200];
const SELECTED_COLOR: [number, number, number, number] = [99, 251, 215, 255];

export function createStationMarkersLayer(
  data: Station[],
  selectedId: number | null,
) {
  // Filter out stations without coordinates
  const visibleData = data.filter(
    (d) => d.latitude !== 0 || d.longitude !== 0
  );

  return new ScatterplotLayer<Station>({
    id: 'station-markers',
    data: visibleData,
    pickable: true,
    getPosition: (d) => [d.longitude, d.latitude],
    getFillColor: (d) => {
      if (d.id === selectedId) return SELECTED_COLOR;
      const rgb = SOURCE_COLORS[d.sourceType] ?? DEFAULT_COLOR;
      return [rgb[0], rgb[1], rgb[2], 200];
    },
    getRadius: (d) => Math.max(4, Math.log2((d.messageCount || 1) + 1) * 1.8),
    radiusMinPixels: 3,
    radiusMaxPixels: 12,
    stroked: true,
    getLineColor: (d) =>
      d.id === selectedId
        ? [99, 251, 215, 100]
        : [0, 0, 0, 100],
    lineWidthMinPixels: 1,
    transitions: {
      getRadius: { duration: 300 },
      getFillColor: { duration: 200 },
    },
    updateTriggers: {
      getFillColor: [selectedId, data],
    },
  });
}
