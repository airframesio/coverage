import { getPool } from './database.js';
import type { CoverageStore } from '../aggregation/coverage-store.js';
import { WINDOW_CONFIGS } from '../types/coverage.js';
import { shouldMaintainResolution } from '../compute/h3-indexer.js';
import { jobStatus } from '../metrics/job-status.js';

// Only persist windows >= 1h (short windows rebuild fast from live traffic)
const PERSIST_WINDOW_NAMES = ['1h', '6h', '12h', '24h', '1w', '1mo'];
// Only persist coarse resolutions (finer ones rebuild quickly)
const PERSIST_RESOLUTIONS = [2, 3, 4];

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
const H3_SLICE = 'h3_slice';
const STATIONS_SLICE = 'stations_slice';
/** The whole-window snapshot types of older builds, replaced by the per-slice ones */
const LEGACY_TYPE: Record<string, string> = { [H3_SLICE]: 'h3', [STATIONS_SLICE]: 'stations' };
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
  /** Closed slices already saved in their final form: `type|window|resolution|startedAt` */
  private writtenSlices = new Set<string>();

  constructor(store: CoverageStore) {
    this.store = store;
  }

  /**
   * Save one window's slices (of one resolution). The current slice is
   * rewritten every time; a slice that has stopped taking data is written once
   * more after it closes and then left alone. Rows of slices that are no longer
   * in memory (aged out, or merged at a restore) are deleted, so what is saved
   * always matches memory and a restore never counts anything twice.
   */
  private async saveSlices(
    type: string, windowName: string, resolution: number,
    slices: { startedAt: number; current: boolean; data: unknown[] }[],
  ): Promise<number> {
    let saved = 0;
    const prefix = `${type}|${windowName}|${resolution}|`;
    const keep: number[] = [];
    const written = new Set<string>();
    for (const sl of slices) {
      if (sl.data.length === 0) continue;
      keep.push(sl.startedAt);
      const key = prefix + sl.startedAt;
      if (!sl.current && this.writtenSlices.has(key)) {
        written.add(key);
        continue;
      }
      await replaceSnapshot(
        `DELETE FROM coverage_snapshots
         WHERE snapshot_type = $1 AND window_name = $2 AND resolution = $3 AND slice_started_at = $4`,
        [type, windowName, resolution, sl.startedAt],
        `INSERT INTO coverage_snapshots (snapshot_type, window_name, resolution, slice_started_at, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [type, windowName, resolution, sl.startedAt, JSON.stringify(sl.data)],
      );
      if (!sl.current) written.add(key);
      saved++;
    }
    // Forget this window's other keys; they are about to be deleted
    for (const key of this.writtenSlices) if (key.startsWith(prefix)) this.writtenSlices.delete(key);
    for (const key of written) this.writtenSlices.add(key);

    const db = getPool();
    await db.query(
      `DELETE FROM coverage_snapshots
       WHERE snapshot_type = $1 AND window_name = $2 AND resolution = $3
         AND NOT (slice_started_at = ANY($4::bigint[]))`,
      [type, windowName, resolution, keep],
    );
    // The whole-window snapshot of an older build is covered from now on
    if (keep.length > 0) {
      await db.query(
        `DELETE FROM coverage_snapshots
         WHERE snapshot_type = $1 AND window_name = $2 AND resolution = $3`,
        [LEGACY_TYPE[type], windowName, resolution],
      );
    }
    return saved;
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
        // A view shares its owner's cells, and the owner's snapshot restores them
        const isView = Boolean(WINDOW_CONFIGS[windowIndex]?.viewOf);
        for (const resolution of PERSIST_RESOLUTIONS) {
          if (isView || !shouldMaintainResolution(resolution, windowIndex)) continue;
          const slices = this.store.getH3Slices(resolution, windowName)
            .map(sl => ({ startedAt: sl.startedAt, current: sl.current, data: sl.cells }));
          saved += await this.saveSlices(H3_SLICE, windowName, resolution, slices);
        }

        // Station totals per slice, keyed by station and transport type. While
        // entries of an older whole-window snapshot wait for station metadata,
        // that snapshot is the only complete copy: leave it alone until then.
        if (!this.store.hasPendingStationSnapshots()) {
          const slices = this.store.getStationSlices(windowName)
            .map(sl => ({ startedAt: sl.startedAt, current: sl.current, data: sl.entries }));
          saved += await this.saveSlices(STATIONS_SLICE, windowName, 0, slices);
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
      // Per-slice snapshots go back into the slice of their age
      const sliceResult = await db.query(
        `SELECT snapshot_type, window_name, resolution, slice_started_at, data FROM coverage_snapshots
         WHERE snapshot_type IN ($1, $2) AND slice_started_at IS NOT NULL
         ORDER BY slice_started_at ASC`,
        [H3_SLICE, STATIONS_SLICE],
      );

      let h3Loaded = 0;
      let stationsLoaded = 0;
      const sliced = new Set<string>();
      for (const row of sliceResult.rows) {
        const data = row.data;
        if (!Array.isArray(data) || data.length === 0) continue;
        const startedAtMs = Number(row.slice_started_at);
        const resolution = Number(row.resolution);
        const current = row.snapshot_type === H3_SLICE
          ? this.store.loadH3Snapshot(row.window_name, resolution, data, startedAtMs)
          : this.store.loadStationSlice(row.window_name, startedAtMs, data);
        if (current === null) continue;
        if (row.snapshot_type === H3_SLICE) h3Loaded += data.length;
        else stationsLoaded += data.length;
        sliced.add(`${row.snapshot_type}|${row.window_name}|${row.snapshot_type === H3_SLICE ? resolution : 0}`);
        // A closed slice is already saved in its final form
        if (!current) {
          this.writtenSlices.add(`${row.snapshot_type}|${row.window_name}|${row.snapshot_type === H3_SLICE ? resolution : 0}|${startedAtMs}`);
        }
      }

      // Whole-window snapshots of older builds, read once after an upgrade
      // where no per-slice snapshot exists yet. They go into the current slice.
      const h3Result = await db.query(
        `SELECT window_name, resolution, data FROM coverage_snapshots
         WHERE snapshot_type = 'h3'
         ORDER BY created_at DESC`
      );
      for (const row of h3Result.rows) {
        if (sliced.has(`${H3_SLICE}|${row.window_name}|${row.resolution}`)) continue;
        const cells = row.data;
        if (Array.isArray(cells) && cells.length > 0) {
          this.store.loadH3Snapshot(row.window_name, row.resolution, cells);
          h3Loaded += cells.length;
        }
      }

      const stationResult = await db.query(
        `SELECT window_name, data FROM coverage_snapshots
         WHERE snapshot_type = 'stations'
         ORDER BY created_at DESC`
      );
      for (const row of stationResult.rows) {
        if (sliced.has(`${STATIONS_SLICE}|${row.window_name}|0`)) continue;
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
