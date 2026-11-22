import { getPool } from './database.js';
import type { CoverageStore } from '../aggregation/coverage-store.js';
import { WINDOW_CONFIGS } from '../types/coverage.js';
import { shouldMaintainResolution } from '../compute/h3-indexer.js';
import type { TransportType } from '../types/events.js';
import { jobStatus } from '../metrics/job-status.js';

// Only persist windows >= 1h (short windows rebuild fast from live traffic)
const PERSIST_WINDOW_NAMES = ['1h', '6h', '12h', '24h', '1w', '1mo'];
// Only persist coarse resolutions (finer ones rebuild quickly)
const PERSIST_RESOLUTIONS = [2, 3, 4];

const TRANSPORT_TYPES: TransportType[] = ['aircraft', 'marine', 'sonde', 'space'];

const SAVE_INTERVAL = 60_000; // Check every 60 seconds which snapshots are due

/**
 * How often each window's snapshot is rewritten: a sixtieth of the window,
 * between one and fifteen minutes (1h every minute, 6h every 6 minutes, 12h
 * every 12, 24h and longer every 15). Rewriting every window every minute sent
 * about 30 MB a minute to coverage-db, most of it the long windows, which a
 * minute of traffic barely changes. A restart loses at most a sixtieth of a
 * window's traffic, and shutdown still saves everything.
 */
export function snapshotInterval(windowMs: number): number {
  return Math.min(15 * 60_000, Math.max(60_000, Math.round(windowMs / 60)));
}

/** Snapshots that are due: never saved, or saved at least an interval ago */
export function dueSnapshots(
  intervals: Map<string, number>, lastSaved: Map<string, number>, now: number,
): Set<string> {
  const due = new Set<string>();
  for (const [name, interval] of intervals) {
    const last = lastSaved.get(name);
    // Small slack so a timer firing a little early does not skip a whole round
    if (last === undefined || now - last >= interval - 5_000) due.add(name);
  }
  return due;
}

const HEARD_LOCATIONS = 'heard_locations';
const SAVE_INTERVALS = new Map<string, number>([
  ...PERSIST_WINDOW_NAMES.map((name): [string, number] => [
    name, snapshotInterval(WINDOW_CONFIGS.find(w => w.name === name)!.windowMs),
  ]),
  [HEARD_LOCATIONS, 5 * 60_000],
]);

/**
 * Replace one snapshot. The delete and the insert are one transaction, so a
 * connection cut between them (a restart during a save) leaves the old snapshot
 * in place instead of none.
 */
async function replaceSnapshot(
  deleteSql: string, deleteParams: unknown[], insertSql: string, insertParams: unknown[],
): Promise<void> {
  const client = await getPool().connect();
  // A checked-out client has no error listener of its own. A dropped
  // connection emits 'error' as well as failing the query, and an unhandled
  // 'error' event would take the process down.
  let failure: Error | undefined;
  const onError = (err: Error) => { failure = err; };
  client.on('error', onError);
  try {
    await client.query('BEGIN');
    await client.query(deleteSql, deleteParams);
    await client.query(insertSql, insertParams);
    await client.query('COMMIT');
    for (const param of insertParams) if (typeof param === 'string') jobStatus.snapshotBytesWritten += param.length;
  } catch (err) {
    failure = failure ?? (err instanceof Error ? err : new Error(String(err)));
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.removeListener('error', onError);
    // Passing the error makes the pool discard the client instead of reusing it
    client.release(failure);
  }
}

/**
 * Periodically persists H3 cell data and station coverage to PostgreSQL
 * so the service can recover state after a restart.
 */
export class Persistence {
  private store: CoverageStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSaved = new Map<string, number>();
  private saving = false;

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

  /**
   * Save the snapshots that are due to PostgreSQL. `all` saves every one
   * (shutdown).
   */
  async save(all = false): Promise<void> {
    // A slow save must not overlap the next tick
    if (this.saving) return;
    this.saving = true;
    let saved = 0;
    const startedAt = Date.now();
    const due = all ? new Set(SAVE_INTERVALS.keys()) : dueSnapshots(SAVE_INTERVALS, this.lastSaved, startedAt);

    try {
      for (const windowName of PERSIST_WINDOW_NAMES) {
        if (!due.has(windowName)) continue;
        const windowIndex = WINDOW_CONFIGS.findIndex(w => w.name === windowName);
        for (const resolution of PERSIST_RESOLUTIONS) {
          // A view shares its owner's cells, and the owner's snapshot restores them
          if (WINDOW_CONFIGS[windowIndex]?.viewOf) continue;
          if (!shouldMaintainResolution(resolution, windowIndex)) continue;
          const cells = this.store.getH3Data(resolution, windowName);
          if (cells.length === 0) continue;

          await replaceSnapshot(
            `DELETE FROM coverage_snapshots
             WHERE snapshot_type = 'h3' AND window_name = $1 AND resolution = $2`,
            [windowName, resolution],
            `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, data)
             VALUES ('h3', $1, $2, $3)`,
            [windowName, resolution, JSON.stringify(cells)]
          );
          saved++;
        }

        // Save station coverage for this window, per transport type, so a
        // restore does not depend on station metadata being available
        const stationData: unknown[] = [];
        for (const transportType of TRANSPORT_TYPES) {
          for (const cov of this.store.getAllStationCoverage(windowName, transportType)) {
            stationData.push({
              stationId: cov.stationId,
              transportType,
              bearingSectors: Array.from(cov.bearingSectors),
              sectorMessageCounts: Array.from(cov.sectorMessageCounts),
              sectorAvgLevels: Array.from(cov.sectorAvgLevels),
              totalMessages: cov.totalMessages,
              messagesWithPosition: cov.messagesWithPosition,
              maxDistance: cov.maxDistance,
              avgLevel: cov.avgLevel,
              errorRate: cov.errorRate,
            });
          }
        }
        // While old entries wait for station metadata, the saved snapshot is
        // the only complete copy: do not replace it with a partial one
        if (stationData.length > 0 && !this.store.hasPendingStationSnapshots()) {
          await replaceSnapshot(
            `DELETE FROM coverage_snapshots
             WHERE snapshot_type = 'stations' AND window_name = $1`,
            [windowName],
            `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, data)
             VALUES ('stations', $1, 0, $2)`,
            [windowName, JSON.stringify(stationData)]
          );
          saved++;
        }
        this.lastSaved.set(windowName, startedAt);
      }

      // Where GeoIP-located stations are heard, so they are not shown in the
      // wrong place again for the first minutes after every restart
      const heard = due.has(HEARD_LOCATIONS) ? this.store.getHeardLocations() : [];
      if (due.has(HEARD_LOCATIONS)) this.lastSaved.set(HEARD_LOCATIONS, startedAt);
      if (heard.length > 0) {
        await replaceSnapshot(
          `DELETE FROM coverage_snapshots WHERE snapshot_type = 'heard_locations'`,
          [],
          `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, data)
           VALUES ('heard_locations', 'all', 0, $1)`,
          [JSON.stringify(heard)]
        );
        saved++;
      }

      jobStatus.snapshotLastSuccess = Date.now() / 1000;
      jobStatus.snapshotDurationSeconds = (Date.now() - startedAt) / 1000;

      if (saved > 0) {
        console.log(`[Persistence] Saved ${saved} snapshots`);
      }
    } catch (err) {
      console.error('[Persistence] Save failed:', err instanceof Error ? err.message : err);
    } finally {
      this.saving = false;
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

      const heardResult = await db.query(
        `SELECT data FROM coverage_snapshots
         WHERE snapshot_type = 'heard_locations'
         ORDER BY created_at DESC LIMIT 1`
      );
      const heard = heardResult.rows[0]?.data;
      if (Array.isArray(heard)) this.store.loadHeardLocations(heard);

      console.log(
        `[Persistence] Loaded ${h3Loaded} H3 cells, ${stationsLoaded} station coverages, ` +
        `${Array.isArray(heard) ? heard.length : 0} heard locations`
      );
    } catch (err) {
      console.error('[Persistence] Load failed:', err instanceof Error ? err.message : err);
    }
  }
}
