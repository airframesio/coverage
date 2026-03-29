import { config } from '../config.js';
import type { StationMeta } from '../types/events.js';

/**
 * Periodically syncs station metadata from the main API.
 * Optionally enriches stations with coordinates from a production API
 * (for local dev where GeoIP data is missing due to relayed/private IPs).
 */
export class StationSync {
  private timer: ReturnType<typeof setInterval> | null = null;
  private stationMap: Map<number, StationMeta>;
  /** Production stations indexed by ident for coordinate enrichment */
  private enrichMap: Map<string, { latitude: number; longitude: number }> | null = null;

  constructor(stationMap: Map<number, StationMeta>) {
    this.stationMap = stationMap;
  }

  async start(): Promise<void> {
    // If enrich URL is configured, fetch production station coordinates first
    if (config.stationEnrichUrl) {
      await this.fetchEnrichData();
    }
    await this.sync();
    this.timer = setInterval(() => this.sync(), config.stationSyncInterval);
    console.log(`[StationSync] Started, syncing every ${config.stationSyncInterval / 1000}s`);
  }

  /** Fetch production station data for coordinate enrichment (by ident matching) */
  private async fetchEnrichData(): Promise<void> {
    try {
      const response = await fetch(`${config.stationEnrichUrl}/stations`);
      if (!response.ok) {
        console.error(`[StationSync] Enrich fetch failed: ${response.status}`);
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        console.error(`[StationSync] Enrich: expected JSON, got ${contentType}`);
        return;
      }

      const stations = await response.json() as any[];
      this.enrichMap = new Map();
      let count = 0;

      for (const s of stations) {
        const ident = s.ident;
        if (!ident) continue;

        const lat = parseFloat(s.latitude) || parseFloat(s.fuzzedLatitude) || 0;
        const lon = parseFloat(s.longitude) || parseFloat(s.fuzzedLongitude) || 0;

        if (lat !== 0 || lon !== 0) {
          this.enrichMap.set(ident, { latitude: lat, longitude: lon });
          count++;
        }
      }

      console.log(`[StationSync] Loaded ${count} station coordinates from enrich source`);
    } catch (err) {
      console.error('[StationSync] Enrich fetch failed:', err instanceof Error ? err.message : err);
    }
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
      let enriched = 0;

      for (const s of stations) {
        if (!s.id) continue;

        let lat = parseFloat(s.latitude) || parseFloat(s.fuzzedLatitude) || 0;
        let lon = parseFloat(s.longitude) || parseFloat(s.fuzzedLongitude) || 0;

        // Enrich: if local station has no coordinates, look up by ident in production data
        if ((lat === 0 && lon === 0) && this.enrichMap && s.ident) {
          const enriched_coords = this.enrichMap.get(s.ident);
          if (enriched_coords) {
            lat = enriched_coords.latitude;
            lon = enriched_coords.longitude;
            enriched++;
          }
        }

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
          trustScore: 0.5,
          lastSyncedAt: now,
        });
        updated++;
      }

      const withCoords = [...this.stationMap.values()].filter(
        s => s.latitude !== 0 || s.longitude !== 0
      ).length;

      console.log(
        `[StationSync] Synced ${updated} stations` +
        (enriched > 0 ? `, enriched ${enriched} with production coords` : '') +
        ` (${withCoords} have coordinates)`
      );
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
