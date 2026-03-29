import { ScatterplotLayer } from '@deck.gl/layers';
import type { Station } from '@/lib/types/coverage';

export function createStationMarkersLayer(
  data: Station[],
  selectedId: number | null,
) {
  return new ScatterplotLayer<Station>({
    id: 'station-markers',
    data,
    pickable: true,
    getPosition: (d) => [d.longitude, d.latitude],
    getFillColor: (d) =>
      d.id === selectedId
        ? [99, 251, 215, 255]
        : [255, 255, 255, 200],
    getRadius: (d) => Math.max(4, Math.log2((d.messageCount || 1) + 1) * 2),
    radiusMinPixels: 3,
    radiusMaxPixels: 14,
    stroked: true,
    getLineColor: [0, 0, 0, 120],
    lineWidthMinPixels: 1,
    transitions: {
      getRadius: { duration: 300 },
      getFillColor: { duration: 200 },
    },
    updateTriggers: {
      getFillColor: [selectedId],
    },
  });
}
