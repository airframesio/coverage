import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createEmptyCell, mergeIntoCell, addCellPositionless, renameCellStations, cellStationCount } from '../src/aggregation/sliding-window.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

function station(id: number, latitude: number, longitude: number): StationMeta {
  return {
    id, uuid: `uuid-${id}`, ident: `TEST-${id}`, latitude, longitude, sourceType: 'vdl',
    status: 'active', flagged: false, blocked: false, trustScore: 0.5, lastSyncedAt: new Date(),
  };
}

function event(stationId: number, targetLat: number | null, targetLon: number | null): CoverageEvent {
  return {
    stationId, stationUuid: `uuid-${stationId}`, targetLat, targetLon, targetAlt: null,
    transportType: 'aircraft', sourceType: 'dumpvdl2', source: 'dumpvdl2', frequency: 136.975,
    signalLevel: -20, errorCount: 0, timestamp: new Date(), hasTargetPosition: targetLat !== null,
  };
}

const busy = latLngToCell(41.8, -92.0, 5);
const other = latLngToCell(41.5, -93.5, 5);

/** Old stations 11 and 12 heard some cells; 20 is the station they became */
function seeded(): CoverageStore {
  const s = new CoverageStore();
  for (const id of [11, 12, 20]) s.stationMap.set(id, station(id, 41.53, -93.66));
  for (let i = 0; i < 6; i++) s.ingest(event(11, 41.8, -92.0));
  for (let i = 0; i < 4; i++) s.ingest(event(12, 41.8, -92.0));
  for (let i = 0; i < 3; i++) s.ingest(event(12, 41.5, -93.5));
  for (let i = 0; i < 5; i++) s.ingest(event(11, null, null));
  s.ingest(event(20, 41.8, -92.0));
  return s;
}

const density = (s: CoverageStore, id: number) =>
  new Map(s.getStationDensity(id, 5, '1h').map(c => [c.h3, c.msgCount]));

describe('station merges', () => {
  it('moves counts between station ids in a cell', () => {
    const single = createEmptyCell();
    mergeIntoCell(single, 1, 2, 0, 'vdl', 5, 'aircraft');
    expect(renameCellStations(single, new Map([[5, 9]]))).toBe(true);
    expect(single.stationIds).toBe(9);

    const shared = createEmptyCell();
    for (let i = 0; i < 3; i++) mergeIntoCell(shared, 1, 2, 0, 'vdl', 5, 'aircraft');
    for (let i = 0; i < 2; i++) mergeIntoCell(shared, 1, 2, 0, 'vdl', 9, 'aircraft');
    addCellPositionless(shared, 5, 3);
    renameCellStations(shared, new Map([[5, 9]]));
    expect(shared.stationIds).toBe(9);
    expect(cellStationCount(shared, 9)).toBe(5);
    expect(shared.positionless?.get(9)).toBe(3);
    expect(shared.positionless?.has(5)).toBe(false);
    expect(renameCellStations(shared, new Map([[7, 8]]))).toBe(false);
  });

  it('folds merged stations into the station they became', () => {
    const s = seeded();
    expect(s.setStationMerges([{ sourceId: 11, targetId: 20 }, { sourceId: 12, targetId: 20 }])).toBe(2);
    expect(density(s, 20)).toEqual(new Map([[busy, 11], [other, 3]]));
    expect(s.getStationDensity(11, 5, '1h')).toEqual([]);
    expect(s.getStationMessageCount(20, '1h')?.messageCount).toBe(19);
    expect(s.getStationMessageCount(11, '1h')).toBeNull();
    // Unchanged merges are not walked again
    expect(s.setStationMerges([{ sourceId: 11, targetId: 20 }, { sourceId: 12, targetId: 20 }])).toBe(0);
    // Later messages from an old id count for the new station
    s.ingest(event(11, 41.5, -93.5));
    expect(density(s, 20).get(other)).toBe(4);
    s.destroy();
  });

  it('follows chains, also when the last step comes later', () => {
    const s = seeded();
    s.setStationMerges([{ sourceId: 11, targetId: 12 }]);
    expect(density(s, 12).get(busy)).toBe(10);
    s.setStationMerges([{ sourceId: 11, targetId: 12 }, { sourceId: 12, targetId: 20 }]);
    expect(density(s, 20)).toEqual(new Map([[busy, 11], [other, 3]]));
    s.ingest(event(11, 41.5, -93.5));
    expect(density(s, 20).get(other)).toBe(4);
    // A loop is ignored
    expect(s.setStationMerges([{ sourceId: 1, targetId: 2 }, { sourceId: 2, targetId: 1 }])).toBe(0);
    s.destroy();
  });

  it('maps snapshots saved under old ids as they load', () => {
    const s = seeded();
    const h3 = s.getH3Slices(5, '1h');
    const stations = s.getStationSlices('1h');
    s.destroy();

    const r = new CoverageStore();
    r.stationMap.set(20, station(20, 41.53, -93.66));
    r.setStationMerges([{ sourceId: 11, targetId: 20 }, { sourceId: 12, targetId: 20 }]);
    for (const slice of h3) r.loadH3Snapshot('1h', 5, slice.cells, slice.startedAt);
    for (const slice of stations) r.loadStationSlice('1h', slice.startedAt, slice.entries);
    expect(density(r, 20)).toEqual(new Map([[busy, 11], [other, 3]]));
    expect(r.getStationMessageCount(20, '1h')?.messageCount).toBe(19);
    r.destroy();
  });
});
