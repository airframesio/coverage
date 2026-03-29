const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_KM = 6371;

/** Haversine distance between two points in kilometers */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) *
    Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing from point 1 to point 2 in degrees (0-360) */
export function bearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const y = Math.sin(dLon) * Math.cos(lat2 * DEG_TO_RAD);
  const x =
    Math.cos(lat1 * DEG_TO_RAD) * Math.sin(lat2 * DEG_TO_RAD) -
    Math.sin(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * (180 / Math.PI);
  return (brng + 360) % 360;
}

/** Convert bearing (0-360) to sector index (0-35, each 10 degrees) */
export function bearingToSector(brng: number): number {
  return Math.floor(((brng % 360) + 360) % 360 / 10);
}

/** Compute a point at a given distance and bearing from a starting point */
export function destinationPoint(
  lat: number, lon: number,
  distanceKm: number, brng: number,
): [number, number] {
  const d = distanceKm / EARTH_RADIUS_KM;
  const br = brng * DEG_TO_RAD;
  const lat1 = lat * DEG_TO_RAD;
  const lon1 = lon * DEG_TO_RAD;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) +
    Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(lat1),
    Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
  );

  return [lat2 * (180 / Math.PI), lon2 * (180 / Math.PI)];
}
