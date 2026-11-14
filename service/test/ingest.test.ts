import { afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

function station(id: number, latitude: number, longitude: number): StationMeta {
  return {
    id,
    uuid: `uuid-${id}`,
    ident: `TEST-${id}`,
    latitude,
    longitude,
    sourceType: 'vdl',
    status: 'active',
    flagged: false,
    blocked: false,
    trustScore: 0.5,
    lastSyncedAt: new Date(),
  };
}

function event(stationId: number, targetLat: number | null, targetLon: number | null): CoverageEvent {
  return {
    stationId,
    stationUuid: `uuid-${stationId}`,
    targetLat,
    targetLon,
    targetAlt: null,
    transportType: 'aircraft',
    sourceType: 'dumpvdl2',
    source: 'dumpvdl2',
    frequency: 136.975,
    signalLevel: -20,
    errorCount: 0,
    timestamp: new Date(),
    hasTargetPosition: targetLat !== null && targetLon !== null,
  };
}

let store: CoverageStore;
afterEach(() => store.destroy());

describe('ingest', () => {
  it('indexes a target position for a station with no known location', () => {
    store = new CoverageStore();
    store.stationMap.set(1, station(1, 0, 0));

    // Frankfurt. Measured from (0,0) this is ~5,600 km, far beyond VDL2 range.
    store.ingest(event(1, 50.03, 8.57));

    expect(store.eventsRejected).toBe(0);
    expect(store.eventsProcessed).toBe(1);
    expect(store.eventsWithPosition).toBe(1);

    const counts = store.getStationMessageCounts('1h').get(1);
    expect(counts?.messageCount).toBe(1);
    expect(counts?.maxDistance).toBe(0);
  });

  it('still rejects an implausible range when the station location is known', () => {
    store = new CoverageStore();
    store.stationMap.set(2, station(2, 50.03, 8.57));

    // New York is not reachable on VDL2 from Frankfurt.
    store.ingest(event(2, 40.64, -73.78));

    expect(store.eventsRejected).toBe(1);
    expect(store.eventsProcessed).toBe(0);
  });

  it('records range for a located station and a nearby target', () => {
    store = new CoverageStore();
    store.stationMap.set(3, station(3, 50.03, 8.57));

    store.ingest(event(3, 50.9, 9.5));

    expect(store.eventsProcessed).toBe(1);
    const counts = store.getStationMessageCounts('1h').get(3);
    expect(counts?.maxDistance).toBeGreaterThan(50);
  });
});
