import { afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { parseAircraftMessage, parseAircraftFlight } from '../src/nats/parsers/aircraft.js';
import { toStationId } from '../src/nats/parsers/station-id.js';
import type { StationMeta } from '../src/types/events.js';

describe('toStationId', () => {
  it('accepts numbers and digit strings', () => {
    expect(toStationId(1234)).toBe(1234);
    expect(toStationId('1234')).toBe(1234);
  });

  it('rejects anything that is not a positive integer id', () => {
    for (const bad of [0, -1, 1.5, '', '0', '12a', ' 12', '1e3', null, undefined, {}, NaN]) {
      expect(toStationId(bad)).toBeNull();
    }
  });
});

describe('aircraft parsers with production payloads', () => {
  // The aggregation server serializes ids as strings.
  const payload = {
    source: { name: 'dumpvdl2' },
    station: { id: '1234', uuid: 'uuid-1234', ident: 'TEST-1234' },
    message: { id: '987654321', latitude: 48.5, longitude: 11.2, altitude: 36000, timestamp: new Date().toISOString() },
    flight: { id: '555', latitude: 48.6, longitude: 11.3, altitude: 36000 },
  };

  it('normalizes a string station id to a number', () => {
    expect(parseAircraftMessage(payload)?.stationId).toBe(1234);
    expect(parseAircraftFlight(payload)?.stationId).toBe(1234);
  });

  it('drops events with no usable station id', () => {
    expect(parseAircraftMessage({ ...payload, station: { ...payload.station, id: 'abc' } })).toBeNull();
    expect(parseAircraftMessage({ ...payload, station: { uuid: 'uuid-1234' } })).toBeNull();
  });

  describe('ingest', () => {
    let store: CoverageStore;
    afterEach(() => store.destroy());

    it('accepts an event whose station id arrived as a string', () => {
      const meta: StationMeta = {
        id: 1234, uuid: 'uuid-1234', ident: 'TEST-1234', latitude: 48.0, longitude: 11.0,
        sourceType: 'vdl', status: 'active', flagged: false, blocked: false, trustScore: 0.5,
        lastSyncedAt: new Date(),
      };
      store = new CoverageStore();
      store.stationMap.set(1234, meta);
      store.ingest(parseAircraftMessage(payload)!);
      expect(store.eventsProcessed).toBe(1);
      expect(store.eventsRejected).toBe(0);
    });
  });
});
