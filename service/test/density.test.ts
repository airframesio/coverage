import { afterAll, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createApiServer } from '../src/api/server.js';
import { NatsSubscriber } from '../src/nats/subscriber.js';
import {
  createEmptyCell, mergeIntoCell, mergeCellStations, setCellStations, cellStationCount, cellStationIds,
} from '../src/aggregation/sliding-window.js';
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

describe('per-station counts in shared cells', () => {
  const add = (cell: ReturnType<typeof createEmptyCell>, sid: number, n: number) => {
    for (let i = 0; i < n; i++) mergeIntoCell(cell, 10, -20, 0, 'vdl', sid, 'aircraft');
  };

  it('keeps each station\'s messages once a second station reports the cell', () => {
    const cell = createEmptyCell();
    add(cell, 1, 5);
    expect(cell.stationIds).toBe(1);
    expect(cellStationCount(cell, 1)).toBe(5);
    add(cell, 2, 3);
    add(cell, 1, 1);
    expect(cellStationCount(cell, 1)).toBe(6);
    expect(cellStationCount(cell, 2)).toBe(3);
    expect(cellStationCount(cell, 3)).toBe(0);
    expect(cellStationIds(cell)).toEqual([1, 2]);
  });

  it('adds up slices whatever stations each holds', () => {
    const a = createEmptyCell();
    add(a, 3, 4);
    const b = createEmptyCell();
    add(b, 1, 2);
    add(b, 2, 5);
    const before = a.messageCount;
    a.messageCount += b.messageCount;
    mergeCellStations(a, before, b);
    expect(cellStationCount(a, 3)).toBe(4);
    expect(cellStationCount(a, 1)).toBe(2);
    expect(cellStationCount(a, 2)).toBe(5);

    const c = createEmptyCell();
    add(c, 7, 2);
    const d = createEmptyCell();
    add(d, 7, 3);
    c.messageCount += d.messageCount;
    mergeCellStations(c, 2, d);
    expect(c.stationIds).toBe(7);
    expect(cellStationCount(c, 7)).toBe(5);
  });

  it('restores saved counts, or shares the messages out evenly without them', () => {
    const cell = createEmptyCell();
    cell.messageCount = 10;
    setCellStations(cell, [4, 5], [7, 3]);
    expect(cellStationCount(cell, 4)).toBe(7);
    expect(cellStationCount(cell, 5)).toBe(3);
    const old = createEmptyCell();
    old.messageCount = 10;
    setCellStations(old, [4, 5]);
    expect(cellStationCount(old, 4)).toBe(5);
  });
});

describe('GET /api/v1/coverage/stations/:id/density', () => {
  const store = new CoverageStore();
  const nats = new NatsSubscriber((e) => store.ingest(e), store.stationMap);
  const app = createApiServer(store, nats);
  afterAll(() => store.destroy());

  store.stationMap.set(1, station(1, 50.03, 8.57));
  store.stationMap.set(2, station(2, 49.0, 2.55));
  // Station 1 hears a busy spot (20) and a quiet one (2); station 2 shares the busy spot
  for (let i = 0; i < 20; i++) store.ingest(event(1, 50.5, 9.0));
  for (let i = 0; i < 2; i++) store.ingest(event(1, 51.0, 10.0));
  for (let i = 0; i < 6; i++) store.ingest(event(2, 50.5, 9.0));
  // Messages without a position land in the station's own cell
  for (let i = 0; i < 9; i++) store.ingest(event(1, null, null));

  it('gives the station\'s own messages per cell, not the cell total', async () => {
    const res = await app.request('/api/v1/coverage/stations/1/density?window=1h');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resolution).toBe(5);
    const busy = latLngToCell(50.5, 9.0, 5);
    const quiet = latLngToCell(51.0, 10.0, 5);
    const byCell = new Map(body.cells.map((c: { h3: string }) => [c.h3, c]));
    expect(byCell.get(busy)).toEqual({ h3: busy, msgCount: 20, stationCount: 2 });
    expect(byCell.get(quiet)).toEqual({ h3: quiet, msgCount: 2, stationCount: 1 });
    // The station's own cell held only messages without a position
    expect(byCell.has(latLngToCell(50.03, 8.57, 5))).toBe(false);
    expect(body.maxCount).toBe(20);
    expect(body.totalMessages).toBe(22);

    const other = await (await app.request('/api/v1/coverage/stations/2/density?window=1h')).json();
    expect(other.cells).toEqual([{ h3: busy, msgCount: 6, stationCount: 2 }]);
  });

  it('uses a coarser grid for long windows', async () => {
    const body = await (await app.request('/api/v1/coverage/stations/1/density?window=24h')).json();
    expect(body.resolution).toBe(4);
    expect(body.totalMessages).toBe(22);
    expect((await (await app.request('/api/v1/coverage/stations/1/density?window=1mo')).json()).resolution).toBe(3);
  });

  it('saves each station\'s count in snapshots and restores it', () => {
    const slices = store.getH3Slices(5, '1h');
    const busy = latLngToCell(50.5, 9.0, 5);
    const saved = slices[0].cells.find((c) => c.h3 === busy)!;
    expect(saved.stationIds).toEqual([1, 2]);
    expect(saved.stationMsgCounts).toEqual([20, 6]);
    const quiet = slices[0].cells.find((c) => c.h3 === latLngToCell(51.0, 10.0, 5))!;
    expect(quiet.stationMsgCounts).toBeUndefined();

    const restored = new CoverageStore();
    restored.stationMap.set(1, station(1, 50.03, 8.57));
    restored.loadH3Snapshot('1h', 5, slices[0].cells, slices[0].startedAt);
    const cells = restored.getStationDensity(2, 5, '1h');
    restored.destroy();
    expect(cells).toEqual([{ h3: busy, msgCount: 6, stationCount: 2 }]);
  });

  it('goes by the station\'s own transport type', async () => {
    const marine = await (await app.request('/api/v1/coverage/stations/1/density?window=1h&transport=marine')).json();
    expect(marine.cells).toEqual([]);
    const aircraft = await (await app.request('/api/v1/coverage/stations/1/density?window=1h&transport=aircraft')).json();
    expect(aircraft.totalMessages).toBe(22);
  });

  it('keeps positioned messages in the station\'s own cell, also after the station moves', () => {
    const s = new CoverageStore();
    s.stationMap.set(7, station(7, 50.03, 8.57));
    const home = latLngToCell(50.03, 8.57, 5);
    for (let i = 0; i < 50; i++) s.ingest(event(7, null, null));
    for (let i = 0; i < 3; i++) s.ingest(event(7, 50.03, 8.57));
    // Moved (as placeByHeard does): new positionless messages land in the new cell
    s.stationMap.get(7)!.latitude = 52.0;
    s.stationMap.get(7)!.longitude = 13.0;
    for (let i = 0; i < 40; i++) s.ingest(event(7, null, null));
    for (let i = 0; i < 4; i++) s.ingest(event(7, 52.0, 13.0));
    const cells = s.getStationDensity(7, 5, '1h');
    s.destroy();
    expect(new Map(cells.map(c => [c.h3, c.msgCount]))).toEqual(new Map([
      [home, 3], [latLngToCell(52.0, 13.0, 5), 4],
    ]));
  });

  it('saves positionless counts in snapshots; older snapshots leave the own cell out', () => {
    const s = new CoverageStore();
    s.stationMap.set(8, station(8, 50.03, 8.57));
    const home = latLngToCell(50.03, 8.57, 5);
    for (let i = 0; i < 30; i++) s.ingest(event(8, null, null));
    for (let i = 0; i < 2; i++) s.ingest(event(8, 50.03, 8.57));
    for (let i = 0; i < 5; i++) s.ingest(event(8, 50.5, 9.0));
    const [slice] = s.getH3Slices(5, '1h');
    s.destroy();
    const saved = slice.cells.find(c => c.h3 === home)!;
    expect(saved.stationPositionless).toEqual([30]);

    const restore = (cells: typeof slice.cells) => {
      const r = new CoverageStore();
      r.stationMap.set(8, station(8, 50.03, 8.57));
      r.loadH3Snapshot('1h', 5, cells, slice.startedAt);
      const out = new Map(r.getStationDensity(8, 5, '1h').map(c => [c.h3, c.msgCount]));
      r.destroy();
      return out;
    };
    expect(restore(slice.cells).get(home)).toBe(2);
    const legacy = slice.cells.map(({ stationPositionless: _, ...c }) => c);
    const old = restore(legacy);
    expect(old.has(home)).toBe(false);
    expect(old.get(latLngToCell(50.5, 9.0, 5))).toBe(5);
  });

  it('rejects bad input', async () => {
    expect((await app.request('/api/v1/coverage/stations/x/density')).status).toBe(400);
    expect((await app.request('/api/v1/coverage/stations/1/density?window=nope')).status).toBe(400);
    expect((await app.request('/api/v1/coverage/stations/99/density')).status).toBe(404);
  });
});
