import { afterEach, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import { parseAircraftMessage, parseAircraftMessageCreated, parseAircraftFlight, readPosition } from '../src/nats/parsers/aircraft.js';
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

  it('treats latitude 0 / longitude 0 as no position and falls back to the flight', () => {
    const zeroed = { ...payload, message: { ...payload.message, latitude: 0, longitude: 0 } };
    const event = parseAircraftMessage(zeroed)!;
    expect(event.hasTargetPosition).toBe(true);
    expect(event.targetLat).toBe(48.6);
    expect(event.targetLon).toBe(11.3);

    const none = parseAircraftMessage({ ...zeroed, flight: { id: '555', latitude: 0, longitude: 0 } })!;
    expect(none.hasTargetPosition).toBe(false);
    expect(none.targetLat).toBeNull();
    expect(parseAircraftFlight({ ...zeroed, flight: { id: '555', latitude: 0, longitude: 0 } })).toBeNull();
  });

  it('reads positions defensively', () => {
    expect(readPosition({ latitude: '48.5', longitude: '11.2' })).toEqual({ lat: 48.5, lon: 11.2, alt: null });
    expect(readPosition({ latitude: 0, longitude: 11.2 })).toEqual({ lat: 0, lon: 11.2, alt: null });
    // Only exact 0/0 means "no position"; a real position near the origin is kept
    expect(readPosition({ latitude: 0.05, longitude: 0.05 })).toEqual({ lat: 0.05, lon: 0.05, alt: null });
    for (const bad of [null, undefined, {}, { latitude: 91, longitude: 0 }, { latitude: 'x', longitude: 1 }, { latitude: 0, longitude: 0 }]) {
      expect(readPosition(bad as never)).toBeNull();
    }
  });

  it('counts a message once when it also has a station report', () => {
    const withReport = { ...payload, messageReport: { id: '42' } };
    expect(parseAircraftMessageCreated(withReport)).toBeNull();
    expect(parseAircraftMessage(withReport)).not.toBeNull();
    expect(parseAircraftMessageCreated(payload)).not.toBeNull();
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
