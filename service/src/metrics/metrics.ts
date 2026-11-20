import { readFileSync } from 'node:fs';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';
import type { CoverageStore } from '../aggregation/coverage-store.js';
import type { NatsSubscriber } from '../nats/subscriber.js';
import { jobStatus } from './job-status.js';

/**
 * Prometheus metrics for GET /metrics. Names follow the Airframes metrics
 * contract (prefix `coverage_`). Nothing is counted twice: every value is read
 * at scrape time from the counters `/api/v1/health` already reports, so the
 * two can never disagree and the ingest hot path does no extra work.
 *
 * Labels are small fixed sets only (radio family, rejection reason, outcome).
 * No station ids or idents.
 */
export function createMetricsRegistry(store: CoverageStore, nats: NatsSubscriber): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // getStats() walks the hour window to count active cells, and several
  // collectors read it, so each scrape computes it once.
  let scrapeStats: ReturnType<CoverageStore['getStats']> | null = null;
  const stats = () => (scrapeStats ??= store.getStats());
  const collectAll = registry.metrics.bind(registry);
  registry.metrics = () => {
    scrapeStats = null;
    return collectAll();
  };

  const gauge = (name: string, help: string, read: () => number) =>
    new Gauge({ name, help, registers: [registry], collect() { this.set(read()); } });

  const counter = (name: string, help: string, read: () => number) =>
    new Counter({ name, help, registers: [registry], collect() { this.reset(); this.inc(read()); } });

  /** A counter with one label, mirrored from a `{ labelValue: count }` record */
  const labelledCounter = (name: string, help: string, label: string, read: () => Record<string, number>) =>
    new Counter({
      name, help, labelNames: [label], registers: [registry],
      collect() {
        this.reset();
        for (const [value, count] of Object.entries(read())) this.inc({ [label]: value }, count);
      },
    });

  new Gauge({
    name: 'coverage_build_info',
    help: 'Build of the running coverage service (value is always 1)',
    labelNames: ['version', 'commit'],
    registers: [registry],
  }).set({ version: readVersion(), commit: process.env.GIT_SHA || 'unknown' }, 1);

  // NATS
  gauge('coverage_nats_connected', '1 when the NATS connection is open', () => (nats.isConnected() ? 1 : 0));
  counter('coverage_nats_messages_received_total', 'Messages received on the processed and marine subjects', () => nats.messagesReceived);
  counter('coverage_nats_messages_parsed_total', 'Messages turned into a coverage event', () => nats.messagesParsed);
  counter('coverage_nats_parse_errors_total', 'Messages that could not be parsed', () => nats.parseErrors);
  counter('coverage_nats_raw_positions_found_total', 'Positions recovered from raw decoder output', () => nats.rawPositionsFound);

  // Events
  labelledCounter('coverage_events_processed_total', 'Events accepted into coverage, by radio family', 'source', () => stats().processedBySource);
  labelledCounter('coverage_events_rejected_total', 'Events rejected, by reason', 'reason', () => stats().rejections);
  counter('coverage_events_with_position_total', 'Accepted events with a usable target position', () => store.eventsWithPosition);
  counter('coverage_events_without_position_total', 'Accepted events without a usable target position', () => store.eventsWithoutPosition);
  labelledCounter('coverage_positions_discarded_total', 'Events kept whose target position was discarded, by reason', 'reason', () => stats().positionsDiscarded);
  new Counter({
    name: 'coverage_positions_out_of_range_total',
    help: 'Positions discarded as out of range, by radio family (near = within twice the range limit, far = beyond it)',
    labelNames: ['source', 'band'],
    registers: [registry],
    collect() {
      this.reset();
      for (const [source, { near, far }] of Object.entries(stats().outOfRange)) {
        this.inc({ source, band: 'near' }, near);
        this.inc({ source, band: 'far' }, far);
      }
    },
  });

  // Store size
  gauge('coverage_stations_tracked', 'Stations heard in the last hour', () => stats().stationsTracked);
  new Gauge({
    name: 'coverage_active_cells',
    help: 'H3 cells with traffic in the last hour, by H3 resolution',
    labelNames: ['resolution'],
    registers: [registry],
    collect() {
      this.reset();
      for (const [resolution, cells] of Object.entries(stats().activeCells)) {
        this.set({ resolution }, cells);
      }
    },
  });
  gauge('coverage_cells_in_memory', 'H3 cells held in memory across all windows and resolutions', () => store.getCellsInMemory());

  // Marine (AIS) join
  new Counter({
    name: 'coverage_marine_events_total',
    help: 'AIS receptions by how their position was resolved',
    labelNames: ['outcome'],
    registers: [registry],
    collect() {
      this.reset();
      this.inc({ outcome: 'paired' }, nats.marine.paired);
      this.inc({ outcome: 'from_last_position' }, nats.marine.fromLastPosition);
      this.inc({ outcome: 'without_position' }, nats.marine.withoutPosition);
      this.inc({ outcome: 'unknown_station' }, nats.marineUnknownStation);
    },
  });
  gauge('coverage_marine_pending', 'AIS messages waiting for their position event', () => nats.marine.pendingSize);
  gauge('coverage_marine_tracked_voyages', 'Voyages with a recent last position', () => nats.marine.trackedVoyages);

  // Periodic jobs
  gauge('coverage_station_sync_last_success_timestamp_seconds', 'Unix time of the last successful station sync from the main API (0 = none yet)', () => jobStatus.stationSyncLastSuccess);
  gauge('coverage_snapshot_last_success_timestamp_seconds', 'Unix time of the last successful snapshot save to PostgreSQL (0 = none yet)', () => jobStatus.snapshotLastSuccess);
  gauge('coverage_snapshot_duration_seconds', 'How long the last successful snapshot save took', () => jobStatus.snapshotDurationSeconds);

  return registry;
}

function readVersion(): string {
  try {
    // src/metrics and dist/metrics are both two levels below package.json
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
