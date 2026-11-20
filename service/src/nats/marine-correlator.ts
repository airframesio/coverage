import { readPosition } from './parsers/aircraft.js';

/**
 * Marine events do not carry a `station` object the way aircraft events do.
 * For every AIS sentence the aggregation server publishes
 *
 *   v1.marine.ais_message.created     { source, ais_message: { marine_voyage_id, station_id (station UUID), ... } }
 *   v1.marine.voyage-position.created { source, voyage_position: { marine_voyage_id, latitude, longitude, ... } }
 *
 * in that order, the second only when the sentence held a position. The
 * receiving station is in the first and the vessel position in the second, so
 * the two are joined here on the voyage id. Each AIS message yields exactly
 * one reception.
 */
export interface MarineReception {
  stationUuid: string;
  lat: number | null;
  lon: number | null;
  source: string;
}

interface Pending {
  stationUuid: string;
  source: string;
  at: number;
}

interface LastPosition {
  lat: number;
  lon: number;
  at: number;
}

/** How long an AIS message waits for its position event */
export const PAIR_WINDOW_MS = 5_000;
/** How long a vessel's last position stands in for a message without one (static data, etc.) */
export const LAST_POSITION_TTL_MS = 120_000;
/** Upper bound on messages waiting for a position; beyond it the oldest are released early */
export const MAX_PENDING = 50_000;

export class MarineCorrelator {
  private pending = new Map<string, Pending[]>();
  private pendingCount = 0;
  private lastPosition = new Map<string, LastPosition>();
  private lastPrune = 0;

  public paired = 0;
  public fromLastPosition = 0;
  public withoutPosition = 0;

  constructor(private readonly emit: (reception: MarineReception) => void) {}

  onAisMessage(data: any, now: number = Date.now()): void {
    const message = data?.ais_message;
    const voyageId = toKey(message?.marine_voyage_id);
    const stationUuid = message?.station_id;
    if (voyageId === null || typeof stationUuid !== 'string' || stationUuid === '') return;

    const entry: Pending = { stationUuid, source: data?.source?.name ?? 'aiscatcher', at: now };
    const list = this.pending.get(voyageId);
    if (list) list.push(entry);
    else this.pending.set(voyageId, [entry]);
    this.pendingCount++;

    if (this.pendingCount > MAX_PENDING) this.flush(now, true);
  }

  onVoyagePosition(data: any, now: number = Date.now()): void {
    const row = data?.voyage_position;
    const voyageId = toKey(row?.marine_voyage_id);
    if (voyageId === null) return;
    const position = readPosition(row);
    if (!position) return;

    this.lastPosition.set(voyageId, { lat: position.lat, lon: position.lon, at: now });

    const list = this.pending.get(voyageId);
    if (!list) return;
    this.pending.delete(voyageId);
    this.pendingCount -= list.length;
    for (const entry of list) {
      this.paired++;
      this.emit({ stationUuid: entry.stationUuid, lat: position.lat, lon: position.lon, source: entry.source });
    }
  }

  /**
   * Release messages whose position event did not arrive. They take the
   * vessel's last known position when it is recent, and otherwise count as a
   * reception without a position. Call about once a second.
   */
  flush(now: number = Date.now(), force = false): void {
    for (const [voyageId, list] of this.pending) {
      let keep = 0;
      for (const entry of list) {
        if (!force && now - entry.at < PAIR_WINDOW_MS) {
          list[keep++] = entry;
          continue;
        }
        const last = this.lastPosition.get(voyageId);
        if (last && now - last.at <= LAST_POSITION_TTL_MS) {
          this.fromLastPosition++;
          this.emit({ stationUuid: entry.stationUuid, lat: last.lat, lon: last.lon, source: entry.source });
        } else {
          this.withoutPosition++;
          this.emit({ stationUuid: entry.stationUuid, lat: null, lon: null, source: entry.source });
        }
        this.pendingCount--;
      }
      if (keep === 0) this.pending.delete(voyageId);
      else list.length = keep;
    }

    if (now - this.lastPrune >= 30_000) {
      this.lastPrune = now;
      for (const [voyageId, last] of this.lastPosition) {
        if (now - last.at > LAST_POSITION_TTL_MS) this.lastPosition.delete(voyageId);
      }
    }
  }

  get pendingSize(): number {
    return this.pendingCount;
  }

  get trackedVoyages(): number {
    return this.lastPosition.size;
  }
}

function toKey(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  return null;
}
