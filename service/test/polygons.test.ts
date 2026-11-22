import { afterAll, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createApiServer } from '../src/api/server.js';
import { NatsSubscriber } from '../src/nats/subscriber.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

function station(id: number, latitude: number, longitude: number, sourceType = 'vdl'): StationMeta {
  return {
    id, uuid: `uuid-${id}`, ident: `TEST-${id}`, latitude, longitude, sourceType,
    status: 'active', flagged: false, blocked: false, trustScore: 0.5, lastSyncedAt: new Date(),
  };
}

function event(stationId: number, targetLat: number, targetLon: number): CoverageEvent {
  return {
    stationId, stationUuid: `uuid-${stationId}`, targetLat, targetLon, targetAlt: null,
    transportType: 'aircraft', sourceType: 'dumpvdl2', source: 'dumpvdl2', frequency: 136.975,
    signalLevel: -20, errorCount: 0, timestamp: new Date(), hasTargetPosition: true,
  };
}

const store = new CoverageStore();
const nats = new NatsSubscriber((e) => store.ingest(e), store.stationMap);
const app = createApiServer(store, nats);
afterAll(() => store.destroy());

// Frankfurt hears aircraft all around it; Paris hears one; Madrid hears nothing
store.stationMap.set(1, station(1, 50.03, 8.57));
store.stationMap.set(2, station(2, 49.0, 2.55));
store.stationMap.set(3, station(3, 40.47, -3.56));
for (let b = 0; b < 360; b += 15) {
  const rad = (b * Math.PI) / 180;
  store.ingest(event(1, 50.03 + 1.5 * Math.cos(rad), 8.57 + 2.3 * Math.sin(rad)));
}
store.ingest(event(2, 50.0, 2.55));

describe('GET /api/v1/coverage/polygons', () => {
  it('returns the same polygon as the per-station route, for every station with traffic', async () => {
    const res = await app.request('/api/v1/coverage/polygons?window=1h');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.window).toBe('1h');
    expect(body.polygons.map((p: { stationId: number }) => p.stationId)).toEqual([1, 2]);
    expect(body.count).toBe(2);

    for (const p of body.polygons) {
      const one = await (await app.request(`/api/v1/coverage/stations/${p.stationId}?window=1h`)).json();
      expect(p.coordinates).toEqual(one.polygon.geometry.coordinates);
      expect(p.ident).toBe(one.ident);
      expect(p.messageCount).toBe(one.messageCount);
      expect(p.sourceType).toBe(one.sourceType);
    }
  });

  it('leaves out stations of the other transport type', async () => {
    const body = await (await app.request('/api/v1/coverage/polygons?window=1h&transport=marine')).json();
    expect(body.count).toBe(0);
  });

  it('rejects an unknown window', async () => {
    expect((await app.request('/api/v1/coverage/polygons?window=nope')).status).toBe(400);
  });
});
