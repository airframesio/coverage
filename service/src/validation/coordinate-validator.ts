/** Validate that coordinates are within valid geographic bounds */
export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lon: number): boolean {
  return Number.isFinite(lon) && lon >= -180 && lon <= 180;
}

export function isValidCoordinate(lat: number, lon: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lon);
}

/** Check for "Null Island" (0, 0) - common default/error value */
export function isNullIsland(lat: number, lon: number): boolean {
  return Math.abs(lat) < 0.1 && Math.abs(lon) < 0.1;
}

/** Full coordinate validation: bounds + null island */
export function validateCoordinate(
  lat: number,
  lon: number,
): { valid: boolean; reason?: string } {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { valid: false, reason: 'non-finite coordinate' };
  }
  if (!isValidLatitude(lat)) {
    return { valid: false, reason: `latitude out of bounds: ${lat}` };
  }
  if (!isValidLongitude(lon)) {
    return { valid: false, reason: `longitude out of bounds: ${lon}` };
  }
  if (isNullIsland(lat, lon)) {
    return { valid: false, reason: 'null island (0,0)' };
  }
  return { valid: true };
}
