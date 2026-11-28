import { describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
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

function event(stationId: number, targetLat: number | null, targetLon: number | null): CoverageEvent {
  return {
    stationId, stationUuid: `uuid-${stationId}`, targetLat, targetLon, targetAlt: null,
    transportType: 'aircraft', sourceType: 'dumpvdl2', source: 'dumpvdl2', frequency: 136.975,
    signalLevel: -20, errorCount: 0, timestamp: new Date(), hasTargetPosition: targetLat !== null,
  };
}

describe('density of all stations', () => {
  it('adds up every station\'s positioned messages per cell, leaving positionless ones out', async () => {
    const store = new CoverageStore();
    store.stationMap.set(1, station(1, 50.03, 8.57));
    store.stationMap.set(2, station(2, 50.9, 9.5));
    const busy = latLngToCell(50.5, 9.0, 5);
    for (let i = 0; i < 4; i++) store.ingest(event(1, 50.5, 9.0));
    for (let i = 0; i < 3; i++) store.ingest(event(2, 50.5, 9.0));
    for (let i = 0; i < 2; i++) store.ingest(event(1, 50.03, 8.57));
    for (let i = 0; i < 40; i++) store.ingest(event(1, null, null));
    for (let i = 0; i < 25; i++) store.ingest(event(2, null, null));

    const app = createApiServer(store, new NatsSubscriber(store));
    const body = await (await app.request('/api/v1/coverage/density?window=1h')).json();
    store.destroy();
    expect(body.resolution).toBe(5);
    const byCell = new Map(body.cells.map((c: { h3: string }) => [c.h3, c]));
    expect(byCell.get(busy)).toEqual({ h3: busy, msgCount: 7, stationCount: 2 });
    // Station 1's own cell keeps only its 2 positioned messages; station 2's has none
    expect(byCell.get(latLngToCell(50.03, 8.57, 5))).toMatchObject({ msgCount: 2 });
    expect(byCell.has(latLngToCell(50.9, 9.5, 5))).toBe(false);
    expect(body.maxCount).toBe(7);
    expect(body.totalMessages).toBe(9);
  });

  it('filters by transport and rejects bad input', async () => {
    const store = new CoverageStore();
    store.stationMap.set(1, station(1, 50.03, 8.57));
    store.ingest(event(1, 50.5, 9.0));
    const app = createApiServer(store, new NatsSubscriber(store));
    const marine = await (await app.request('/api/v1/coverage/density?window=1h&transport=marine')).json();
    expect(marine.cells).toEqual([]);
    expect((await app.request('/api/v1/coverage/density?window=2y')).status).toBe(400);
    expect((await app.request('/api/v1/coverage/density?resolution=9')).status).toBe(400);
    store.destroy();
  });
});
