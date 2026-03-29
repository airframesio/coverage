const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

/** Generate a circle polygon as an array of [lon, lat] pairs */
export function generateCircle(
  centerLat: number,
  centerLon: number,
  radiusKm: number,
  segments: number = 36,
): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    const lat1 = centerLat * DEG_TO_RAD;
    const lon1 = centerLon * DEG_TO_RAD;
    const d = radiusKm / EARTH_RADIUS_KM;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(angle),
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(angle) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

    coords.push([lon2 * (180 / Math.PI), lat2 * (180 / Math.PI)]);
  }
  return coords;
}

/** Default expected reception radius by source type (km) */
export function defaultRadiusForSourceType(sourceType: string): number {
  switch (sourceType) {
    case 'acars': return 300;
    case 'vdl':   return 250;
    case 'hfdl':  return 1500;
    case 'satcom': return 500;
    case 'aiscatcher':
    case 'ais':   return 40;
    default:      return 200;
  }
}
