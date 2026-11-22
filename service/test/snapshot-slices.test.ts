import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

const HOUR = 3_600_000;

function station(): StationMeta {
  return {
    id: 1, uuid: 'uuid-1', ident: 'SLICE-1', latitude: 50.03, longitude: 8.57, sourceType: 'vdl',
    status: 'active', flagged: false, blocked: false, trustScore: 0.5, lastSyncedAt: new Date(),
  };
}

function event(targetLat: number, targetLon: number): CoverageEvent {
  return {
    stationId: 1, stationUuid: 'uuid-1', targetLat, targetLon, targetAlt: null,
    transportType: 'aircraft', sourceType: 'dumpvdl2', source: 'dumpvdl2', frequency: 136.975,
    signalLevel: -20, errorCount: 0, timestamp: new Date(), hasTargetPosition: true,
  };
}

/** Copy every saved slice of the long windows from one store into another */
function restore(from: CoverageStore, to: CoverageStore): void {
  for (const w of ['24h', '1mo']) {
    for (const sl of from.getH3Slices(3, w)) to.loadH3Snapshot(w, 3, sl.cells, sl.startedAt);
    for (const sl of from.getStationSlices(w)) to.loadStationSlice(w, sl.startedAt, sl.entries);
  }
}

const cellCount = (s: CoverageStore, w: string) => s.getH3Data(3, w).length;

describe('per-slice snapshots', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-22T00:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('puts each slice back at its age, so short views stay short after a restart', () => {
    const before = new CoverageStore();
    before.stationMap.set(1, station());
    before.ingest(event(50.5, 9.5));      // will be 8 hours old
    vi.advanceTimersByTime(8 * HOUR);
    before.ingest(event(49.0, 7.0));      // new
    expect(cellCount(before, '24h')).toBe(2);
    expect(cellCount(before, '6h')).toBe(1);

    const saved = before.getH3Slices(3, '24h');
    expect(saved.map(s => s.current)).toEqual([true, false]);

    const after = new CoverageStore();
    after.stationMap.set(1, station());
    restore(before, after);
    // Before this, everything restored went into the newest slice and the 6h
    // view showed the whole day
    expect(cellCount(after, '24h')).toBe(2);
    expect(cellCount(after, '6h')).toBe(1);
    expect(after.getStationCoverage(1, '24h')?.totalMessages).toBe(2);

    // The old slice still leaves the window on time
    vi.advanceTimersByTime(17 * HOUR);
    expect(cellCount(after, '24h')).toBe(1);
    before.destroy();
    after.destroy();
  });

  it('drops a saved slice that is older than its window', () => {
    const before = new CoverageStore();
    before.stationMap.set(1, station());
    before.ingest(event(50.5, 9.5));
    const saved = before.getH3Slices(3, '24h');
    vi.advanceTimersByTime(25 * HOUR); // the process was down for a day
    const after = new CoverageStore();
    for (const sl of saved) expect(after.loadH3Snapshot('24h', 3, sl.cells, sl.startedAt)).toBeNull();
    expect(cellCount(after, '24h')).toBe(0);
    before.destroy();
    after.destroy();
  });

  it('keeps the saved start time, so the next save replaces the same rows', () => {
    const before = new CoverageStore();
    before.stationMap.set(1, station());
    before.ingest(event(50.5, 9.5));
    vi.advanceTimersByTime(3 * HOUR);
    before.ingest(event(49.0, 7.0));
    const starts = before.getH3Slices(3, '24h').map(s => s.startedAt);

    vi.advanceTimersByTime(10 * 60_000); // a short restart
    const after = new CoverageStore();
    restore(before, after);
    expect(after.getH3Slices(3, '24h').map(s => s.startedAt)).toEqual(starts);
    expect(after.getStationSlices('24h').map(s => s.startedAt)).toEqual(starts);
    before.destroy();
    after.destroy();
  });
});
