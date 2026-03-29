import { getPool } from './database.js';
import type { CoverageStore } from '../aggregation/coverage-store.js';
import { WINDOW_CONFIGS, H3_RESOLUTION_CONFIGS } from '../types/coverage.js';

// Only persist windows >= 1h (short windows rebuild fast from live traffic)
const PERSIST_WINDOW_NAMES = ['1h', '6h', '12h', '24h', '1w', '1mo'];
// Only persist coarse resolutions (finer ones rebuild quickly)
const PERSIST_RESOLUTIONS = [2, 3, 4];

const SAVE_INTERVAL = 60_000; // Save every 60 seconds

/**
 * Periodically persists H3 cell data and station coverage to PostgreSQL
 * so the service can recover state after a restart.
 */
export class Persistence {
  private store: CoverageStore;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(store: CoverageStore) {
    this.store = store;
  }

  start(): void {
    this.timer = setInterval(() => this.save(), SAVE_INTERVAL);
    console.log(`[Persistence] Saving every ${SAVE_INTERVAL / 1000}s`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Save current state to PostgreSQL */
  async save(): Promise<void> {
    const db = getPool();
    let saved = 0;

    try {
      for (const windowName of PERSIST_WINDOW_NAMES) {
        for (const resolution of PERSIST_RESOLUTIONS) {
          const cells = this.store.getH3Data(resolution, windowName);
          if (cells.length === 0) continue;

          // Upsert: delete old snapshot, insert new one
          await db.query(
            `DELETE FROM coverage_snapshots
             WHERE snapshot_type = 'h3' AND window_name = $1 AND resolution = $2`,
            [windowName, resolution]
          );

          await db.query(
            `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, data)
             VALUES ('h3', $1, $2, $3)`,
            [windowName, resolution, JSON.stringify(cells)]
          );
          saved++;
        }

        // Save station coverage for this window
        const stationCoverages = this.store.getAllStationCoverage(windowName);
        if (stationCoverages.length > 0) {
          const stationData = stationCoverages.map(cov => ({
            stationId: cov.stationId,
            bearingSectors: Array.from(cov.bearingSectors),
            sectorMessageCounts: Array.from(cov.sectorMessageCounts),
            sectorAvgLevels: Array.from(cov.sectorAvgLevels),
            totalMessages: cov.totalMessages,
            messagesWithPosition: cov.messagesWithPosition,
            maxDistance: cov.maxDistance,
            avgLevel: cov.avgLevel,
            errorRate: cov.errorRate,
          }));

          await db.query(
            `DELETE FROM coverage_snapshots
             WHERE snapshot_type = 'stations' AND window_name = $1`,
            [windowName]
          );

          await db.query(
            `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, data)
             VALUES ('stations', $1, 0, $2)`,
            [windowName, JSON.stringify(stationData)]
          );
          saved++;
        }
      }

      if (saved > 0) {
        console.log(`[Persistence] Saved ${saved} snapshots`);
      }
    } catch (err) {
      console.error('[Persistence] Save failed:', err instanceof Error ? err.message : err);
    }
  }

  /** Load saved state from PostgreSQL on startup */
  async load(): Promise<void> {
    const db = getPool();

    try {
      // Load H3 cell snapshots
      const h3Result = await db.query(
        `SELECT window_name, resolution, data FROM coverage_snapshots
         WHERE snapshot_type = 'h3'
         ORDER BY created_at DESC`
      );

      let h3Loaded = 0;
      for (const row of h3Result.rows) {
        const cells = row.data;
        if (Array.isArray(cells) && cells.length > 0) {
          this.store.loadH3Snapshot(row.window_name, row.resolution, cells);
          h3Loaded += cells.length;
        }
      }

      // Load station coverage snapshots
      const stationResult = await db.query(
        `SELECT window_name, data FROM coverage_snapshots
         WHERE snapshot_type = 'stations'
         ORDER BY created_at DESC`
      );

      let stationsLoaded = 0;
      for (const row of stationResult.rows) {
        const stationData = row.data;
        if (Array.isArray(stationData) && stationData.length > 0) {
          this.store.loadStationSnapshot(row.window_name, stationData);
          stationsLoaded += stationData.length;
        }
      }

      console.log(`[Persistence] Loaded ${h3Loaded} H3 cells, ${stationsLoaded} station coverages`);
    } catch (err) {
      console.error('[Persistence] Load failed:', err instanceof Error ? err.message : err);
    }
  }
}
