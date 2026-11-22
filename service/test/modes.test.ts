import { afterAll, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createApiServer } from '../src/api/server.js';
import { NatsSubscriber } from '../src/nats/subscriber.js';
import { parseModes } from '../src/compute/source-family.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

function station(id: number, latitude: number, longitude: number, sourceType: string): StationMeta {
  return {
    id, uuid: `uuid-${id}`, ident: `MODE-${id}`, latitude, longitude, sourceType,
    status: 'active', flagged: false, blocked: false, trustScore: 0.5, lastSyncedAt: new Date(),
  };
}

function event(stationId: number, sourceType: string, targetLat: number, targetLon: number): CoverageEvent {
  return {
    stationId, stationUuid: `uuid-${stationId}`, targetLat, targetLon, targetAlt: null,
    transportType: 'aircraft', sourceType, source: sourceType, frequency: 131.55,
    signalLevel: -20, errorCount: 0, timestamp: new Date(), hasTargetPosition: true,
  };
}

const store = new CoverageStore();
const nats = new NatsSubscriber((e) => store.ingest(e), store.stationMap);
const app = createApiServer(store, nats);
afterAll(() => store.destroy());

// A VDL2 station near Frankfurt and an ACARS station near Madrid, far apart,
// each hearing aircraft around itself, so their cells never overlap.
store.stationMap.set(11, station(11, 50.03, 8.57, 'vdl'));
store.stationMap.set(12, station(12, 40.47, -3.56, 'acars'));
for (let b = 0; b < 360; b += 30) {
  const rad = (b * Math.PI) / 180;
  store.ingest(event(11, 'dumpvdl2', 50.03 + 1.0 * Math.cos(rad), 8.57 + 1.5 * Math.sin(rad)));
  store.ingest(event(12, 'acarsdec', 40.47 + 1.0 * Math.cos(rad), -3.56 + 1.3 * Math.sin(rad)));
}

async function h3(query: string) {
  return (await app.request(`/api/v1/coverage/h3?window=1h&resolution=3${query}`)).json();
}

describe('parseModes', () => {
  it('means no filter when missing, empty or naming every mode', () => {
    expect(parseModes(undefined)).toBeUndefined();
    expect(parseModes('')).toBeUndefined();
    expect(parseModes('acars,vdl,hfdl,satcom,ais')).toBeUndefined();
  });

  it('keeps known modes and drops unknown names', () => {
    expect([...parseModes('VDL, acars,bogus')!].sort()).toEqual(['acars', 'vdl']);
    expect(parseModes('bogus')!.size).toBe(0);
  });
});

describe('mode filter', () => {
  it('splits the hex grid by radio family', async () => {
    const all = await h3('');
    const vdl = await h3('&modes=vdl');
    const acars = await h3('&modes=acars');
    expect(vdl.cellCount).toBeGreaterThan(0);
    expect(acars.cellCount).toBeGreaterThan(0);
    expect(vdl.cellCount + acars.cellCount).toBe(all.cellCount);
    for (const cell of vdl.cells) expect(cell.sources).toEqual(['dumpvdl2']);
    expect(vdl.coverageAreaKm2).toBeLessThan(all.coverageAreaKm2);
    expect((await h3('&modes=hfdl')).cellCount).toBe(0);
  });

  it('answers every mode the same as no filter', async () => {
    expect((await h3('&modes=acars,vdl,hfdl,satcom,ais')).cells).toEqual((await h3('')).cells);
  });

  it('filters stations and polygons by the station family', async () => {
    const stations = await (await app.request('/api/v1/stations?window=1h&modes=acars')).json();
    expect(stations.stations.map((s: { id: number }) => s.id)).toEqual([12]);
    const polygons = await (await app.request('/api/v1/coverage/polygons?window=1h&modes=vdl')).json();
    expect(polygons.polygons.map((p: { stationId: number }) => p.stationId)).toEqual([11]);
  });

  it('caches each mode selection separately', async () => {
    const a = await h3('&modes=vdl');
    const b = await h3('&modes=acars');
    expect(a.cells).not.toEqual(b.cells);
  });
});
