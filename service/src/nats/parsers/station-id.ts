/**
 * The aggregation server publishes row ids as JSON strings ("1234"), while the
 * main API returns them as numbers. Station metadata is keyed by number, so
 * normalize here or every event looks like it came from an unknown station.
 */
export function toStationId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }
  return null;
}
