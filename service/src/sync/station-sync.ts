import { config } from '../config.js';
import type { StationMeta } from '../types/events.js';

/**
 * Periodically syncs station metadata from the main API.
 * We use THESE coordinates for coverage calculations — never NATS payload coordinates.
 */
export class StationSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stationMap: Map<number, StationMeta>;

  constructor(stationMap: Map<number, StationMeta>) {
    this.stationMap = stationMap;
  }

  async start(): Promise<void> {
    await this.sync();
    this.timer = setInterval(() => this.sync(), config.stationSyncInterval);
    console.log(`[StationSync] Started, syncing every ${config.stationSyncInterval / 1000}s`);
  }

  async sync(): Promise<void> {
    try {
      const response = await fetch(`${config.mainApiUrl}/stations`);
      if (!response.ok) {
        console.error(`[StationSync] Failed to fetch stations: ${response.status}`);
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        console.error(`[StationSync] Expected JSON, got ${contentType}`);
        return;
      }

      const stations = await response.json() as any[];
      const now = new Date();
      let updated = 0;

      for (const s of stations) {
        if (!s.id) continue;

        const lat = parseFloat(s.latitude) || parseFloat(s.fuzzedLatitude) || 0;
        const lon = parseFloat(s.longitude) || parseFloat(s.fuzzedLongitude) || 0;

        this.stationMap.set(s.id, {
          id: s.id,
          uuid: s.uuid ?? '',
          ident: s.ident ?? '',
          latitude: lat,
          longitude: lon,
          sourceType: s.sourceType ?? '',
          status: s.status ?? 'unknown',
          flagged: s.flagged ?? false,
          blocked: s.blocked ?? false,
          trustScore: 0.5, // default trust
          lastSyncedAt: now,
        });
        updated++;
      }

      console.log(`[StationSync] Synced ${updated} stations`);
    } catch (err) {
      console.error('[StationSync] Sync failed:', err instanceof Error ? err.message : err);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
