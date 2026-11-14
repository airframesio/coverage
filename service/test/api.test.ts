import { afterAll, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createApiServer } from '../src/api/server.js';
import { NatsSubscriber } from '../src/nats/subscriber.js';

const store = new CoverageStore();
// Never connected: the API must still serve (empty) data without NATS.
const nats = new NatsSubscriber((event) => store.ingest(event), store.stationMap);
const app = createApiServer(store, nats);

afterAll(() => store.destroy());

describe('API', () => {
  it('reports health with NATS disconnected', async () => {
    const res = await app.request('/api/v1/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.nats).toBe('disconnected');
    expect(body.coverage.eventsProcessed).toBe(0);
  });

  it('serves stats', async () => {
    const res = await app.request('/api/v1/stats');
    expect(res.status).toBe(200);
    expect((await res.json()).natsConnected).toBe(false);
  });

  it('serves an empty H3 grid', async () => {
    const res = await app.request('/api/v1/coverage/h3?window=1h&resolution=4');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ window: '1h', resolution: 4, cellCount: 0, cells: [] });
  });

  it('rejects an invalid window and resolution', async () => {
    expect((await app.request('/api/v1/coverage/h3?window=nope')).status).toBe(400);
    expect((await app.request('/api/v1/coverage/h3?resolution=9')).status).toBe(400);
  });

  it('returns 404 for an unknown station', async () => {
    expect((await app.request('/api/v1/coverage/stations/999999')).status).toBe(404);
  });

  it('sends CORS headers', async () => {
    const res = await app.request('/api/v1/health', { headers: { Origin: 'https://coverage.airframes.io' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
