import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { createApiServer } from '../src/api/server.js';
import { NatsSubscriber } from '../src/nats/subscriber.js';
import { jobStatus } from '../src/metrics/job-status.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

const TOKEN = 'test-monitoring-token';

const store = new CoverageStore();
const nats = new NatsSubscriber((event) => store.ingest(event), store.stationMap);
const app = createApiServer(store, nats);

function station(id: number, overrides: Partial<StationMeta> = {}): StationMeta {
  return {
    id, uuid: `uuid-${id}`, ident: `TEST-${id}`, latitude: 47.45, longitude: -122.31,
    sourceType: 'vdl', status: 'active', flagged: false, blocked: false,
    trustScore: 0.5, lastSyncedAt: new Date(), ...overrides,
  };
}

function event(stationId: number, overrides: Partial<CoverageEvent> = {}): CoverageEvent {
  return {
    stationId, stationUuid: `uuid-${stationId}`,
    targetLat: 47.6, targetLon: -122.3, targetAlt: null,
    transportType: 'aircraft', sourceType: 'vdl', source: 'dumpvdl2',
    frequency: null, signalLevel: null, errorCount: null,
    timestamp: new Date(), hasTargetPosition: true, ...overrides,
  };
}

async function scrape(): Promise<string> {
  process.env.MONITORING_TOKEN = TOKEN;
  const res = await app.request('/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
  return res.text();
}

/** Value of one sample line, matched on its exact name and label set */
function sample(text: string, series: string): number | undefined {
  const line = text.split('\n').find(l => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

afterEach(() => { delete process.env.MONITORING_TOKEN; });
afterAll(() => store.destroy());

describe('GET /metrics access', () => {
  it('fails closed when MONITORING_TOKEN is not configured', async () => {
    const res = await app.request('/metrics', { headers: { Authorization: 'Bearer anything' } });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('coverage_');
  });

  it('rejects a missing or wrong token', async () => {
    process.env.MONITORING_TOKEN = TOKEN;
    expect((await app.request('/metrics')).status).toBe(401);
    expect((await app.request('/metrics', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await app.request('/metrics', { headers: { 'X-Monitoring-Token': `${TOKEN}x` } })).status).toBe(401);
    // The token must be sent as a header, not in the URL
    expect((await app.request(`/metrics?token=${TOKEN}`)).status).toBe(401);
  });

  it('accepts the token as a bearer token or X-Monitoring-Token', async () => {
    process.env.MONITORING_TOKEN = TOKEN;
    const bearer = await app.request('/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(bearer.status).toBe(200);
    expect(bearer.headers.get('content-type')).toContain('text/plain; version=0.0.4');
    const header = await app.request('/metrics', { headers: { 'X-Monitoring-Token': TOKEN } });
    expect(header.status).toBe(200);
  });

  it('leaves the public API open', async () => {
    expect((await app.request('/api/v1/health')).status).toBe(200);
  });
});

describe('GET /metrics content', () => {
  it('mirrors the health counters', async () => {
    store.stationMap.set(1, station(1));
    store.stationMap.set(2, station(2, { blocked: true }));
    store.ingest(event(1));
    store.ingest(event(1));
    store.ingest(event(1, { sourceType: 'hfdl', hasTargetPosition: false, targetLat: null, targetLon: null }));
    store.ingest(event(2)); // blocked
    store.ingest(event(999)); // unknown station
    nats.messagesReceived = 7;
    nats.messagesParsed = 5;
    nats.parseErrors = 1;
    nats.marine.paired = 4;
    nats.marineUnknownStation = 2;

    const text = await scrape();
    const health = await (await app.request('/api/v1/health')).json();

    expect(sample(text, 'coverage_events_processed_total{source="vdl"}')).toBe(2);
    expect(sample(text, 'coverage_events_processed_total{source="hfdl"}')).toBe(1);
    expect(health.coverage.eventsProcessed).toBe(3);
    expect(sample(text, 'coverage_events_rejected_total{reason="station_blocked"}')).toBe(1);
    expect(sample(text, 'coverage_events_rejected_total{reason="unknown_station"}')).toBe(1);
    expect(sample(text, 'coverage_events_with_position_total')).toBe(health.coverage.eventsWithPosition);
    expect(sample(text, 'coverage_events_without_position_total')).toBe(1);
    expect(sample(text, 'coverage_stations_tracked')).toBe(health.coverage.stationsTracked);
    expect(sample(text, 'coverage_cells_in_memory')).toBe(health.coverage.cellsInMemory);
    expect(sample(text, 'coverage_active_cells{resolution="4"}')).toBe(health.coverage.activeCells[4]);

    expect(sample(text, 'coverage_nats_connected')).toBe(0);
    expect(sample(text, 'coverage_nats_messages_received_total')).toBe(7);
    expect(sample(text, 'coverage_nats_messages_parsed_total')).toBe(5);
    expect(sample(text, 'coverage_nats_parse_errors_total')).toBe(1);
    expect(sample(text, 'coverage_marine_events_total{outcome="paired"}')).toBe(4);
    expect(sample(text, 'coverage_marine_events_total{outcome="unknown_station"}')).toBe(2);
    expect(sample(text, 'coverage_marine_pending')).toBe(0);
  });

  it('counts out-of-range positions by radio family', async () => {
    // Tokyo is far beyond VDL range from Seattle
    store.ingest(event(1, { targetLat: 35.68, targetLon: 139.69 }));
    const text = await scrape();
    expect(sample(text, 'coverage_positions_discarded_total{reason="out_of_range"}')).toBe(1);
    expect(sample(text, 'coverage_positions_out_of_range_total{source="vdl",band="far"}')).toBe(1);
  });

  it('does not double count across scrapes', async () => {
    const first = sample(await scrape(), 'coverage_events_processed_total{source="vdl"}');
    const second = sample(await scrape(), 'coverage_events_processed_total{source="vdl"}');
    expect(second).toBe(first);
  });

  it('reports job timestamps, build info and process metrics', async () => {
    let text = await scrape();
    expect(sample(text, 'coverage_station_sync_last_success_timestamp_seconds')).toBe(0);

    jobStatus.stationSyncLastSuccess = 1_795_000_000;
    jobStatus.snapshotLastSuccess = 1_795_000_060;
    jobStatus.snapshotDurationSeconds = 0.25;
    text = await scrape();
    expect(sample(text, 'coverage_station_sync_last_success_timestamp_seconds')).toBe(1_795_000_000);
    expect(sample(text, 'coverage_snapshot_last_success_timestamp_seconds')).toBe(1_795_000_060);
    expect(sample(text, 'coverage_snapshot_duration_seconds')).toBe(0.25);

    expect(text).toMatch(/^coverage_build_info\{version="\d+\.\d+\.\d+",commit="unknown"\} 1$/m);
    expect(text).toMatch(/^process_resident_memory_bytes \d+/m);
    expect(text).toMatch(/^process_cpu_seconds_total /m);
    expect(text).toMatch(/^process_start_time_seconds \d+/m);
  });

  it('exposes no per-station labels', async () => {
    const text = await scrape();
    expect(text).not.toMatch(/station_id|ident=|uuid/);
  });
});

describe('request metrics', () => {
  it('counts requests by route and cache outcome', async () => {
    await app.request('/api/v1/stats');
    await app.request('/api/v1/stats');
    await app.request('/api/v1/coverage/stations/12345');
    await app.request('/api/v1/coverage/stations/12345/density');
    const text = await scrape();
    expect(sample(text, 'coverage_http_requests_total{route="stats",status="2xx",cache="miss"}')).toBeGreaterThanOrEqual(1);
    expect(sample(text, 'coverage_http_requests_total{route="stats",status="2xx",cache="hit"}')).toBeGreaterThanOrEqual(1);
    expect(sample(text, 'coverage_http_requests_total{route="coverage_station",status="4xx",cache="miss"}')).toBe(1);
    expect(text).toMatch(/coverage_http_requests_total\{route="coverage_station_density",status="[245]xx",cache="[a-z]+"\} 1/);
    expect(text).toContain('coverage_http_request_duration_seconds_bucket{le="0.5",route="stats",cache="hit"}');
  });
});
