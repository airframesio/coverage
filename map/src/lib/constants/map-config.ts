export const MAP_CONFIG = {
  style: process.env.NEXT_PUBLIC_MAP_STYLE_URL || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  initialViewState: {
    longitude: -40,
    latitude: 30,
    zoom: 2.5,
    pitch: 0,
    bearing: 0,
  },
  minZoom: 1,
  maxZoom: 18,
} as const;

/** Map zoom level to H3 resolution for adaptive hex grid */
export function zoomToH3Resolution(zoom: number): number {
  if (zoom <= 3) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 7) return 4;
  if (zoom <= 9) return 5;
  if (zoom <= 11) return 6;
  return 7;
}
