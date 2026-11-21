import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { StationSlidingWindow } from '../src/aggregation/station-window.js';
import { responseCache } from '../src/api/response-cache.js';

const config = { name: 'test', durationMs: 3_600_000, slices: 60, sliceMs: 60_000 } as never;

describe('station coverage for the whole list', () => {
  it('matches the per-station answer, with and without a transport filter', () => {
    const window = new StationSlidingWindow(config);
    window.record(1, 3, 120, -20, true, false, 'aircraft');
    window.record(1, 9, 80, -30, true, true, 'aircraft');
    window.record(1, 4, 40, null, true, false, 'marine');
    window.record(12, 0, 10, -5, true, false, 'marine'); // id 1 is a prefix of 12
    window.record(3, -1, 0, null, false, false, 'aircraft');

    for (const filter of [undefined, 'aircraft', 'marine'] as const) {
      const all = window.allStationCoverage(filter);
      const strip = (c: object | null) => c && { ...c, lastUpdated: 0 };
      for (const id of [1, 12, 3]) {
        const one = window.getStationCoverage(id, filter);
        expect(strip(all.find(c => c.stationId === id) ?? null)).toEqual(strip(one));
      }
    }
    expect(window.getStationCoverage(1)!.totalMessages).toBe(3);
    expect(window.getStationCoverage(12)!.totalMessages).toBe(1);
    expect(window.allStationCoverage('marine').map(c => c.stationId).sort()).toEqual([1, 12]);
    window.destroy();
  });

  it('stays fast with many stations in every slice', () => {
    const window = new StationSlidingWindow(config);
    const slices = (window as unknown as { slices: Map<string, unknown>[] }).slices;
    // Fill every slice the way an hour of traffic from 2,000 stations would
    window.record(0, 1, 100, -10, true, false, 'aircraft');
    const template = slices[0].get('0:aircraft');
    for (const slice of slices) {
      for (let id = 1; id <= 2000; id++) slice.set(`${id}:aircraft`, structuredClone(template));
    }
    const start = performance.now();
    const all = window.allStationCoverage();
    const elapsed = performance.now() - start;
    expect(all.length).toBe(2001);
    expect(all.find(c => c.stationId === 7)!.totalMessages).toBe(60);
    // The old per-station scan did 2,000 x 120,000 key comparisons here (seconds)
    expect(elapsed).toBeLessThan(500);
    window.destroy();
  });
});

describe('response cache', () => {
  it('computes an answer once for everyone asking within the time limit', async () => {
    let time = 1000;
    let computed = 0;
    const app = new Hono();
    app.use('/data', responseCache(10_000, () => time));
    app.get('/data', (c) => c.json({ n: ++computed, window: c.req.query('window') }));
    app.get('/missing', (c) => c.json({ error: 'no' }, 404));

    expect(await (await app.request('/data?window=1h&transport=marine')).json()).toEqual({ n: 1, window: '1h' });
    // same question, parameters in another order
    const again = await app.request('/data?transport=marine&window=1h');
    expect(await again.json()).toEqual({ n: 1, window: '1h' });
    expect(again.headers.get('content-type')).toContain('application/json');
    // a different question is computed on its own
    expect(await (await app.request('/data?window=24h')).json()).toEqual({ n: 2, window: '24h' });
    time += 10_001;
    expect(await (await app.request('/data?window=1h&transport=marine')).json()).toEqual({ n: 3, window: '1h' });
    expect(computed).toBe(3);
  });

  it('does not keep errors', async () => {
    let calls = 0;
    const app = new Hono();
    app.use('/x', responseCache(10_000));
    app.get('/x', (c) => (++calls === 1 ? c.json({ error: 'no' }, 404) : c.json({ ok: true })));
    expect((await app.request('/x')).status).toBe(404);
    expect((await app.request('/x')).status).toBe(200);
  });
});
