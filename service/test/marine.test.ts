import { describe, it, expect } from 'vitest';
import {
  MarineCorrelator,
  PAIR_WINDOW_MS,
  LAST_POSITION_TTL_MS,
  type MarineReception,
} from '../src/nats/marine-correlator.js';

// Shapes as published by the aggregation server (ids are JSON strings).
const ais = (voyage: string, station: string) => ({
  source: { name: 'aiscatcher' },
  ais_message: { id: '1', marine_vessel_id: '9', marine_voyage_id: voyage, station_id: station, nmea_content: '!AIVDM' },
});
const position = (voyage: string, latitude: number, longitude: number) => ({
  source: { name: 'aiscatcher' },
  voyage_position: { id: '2', marine_voyage_id: voyage, latitude, longitude },
});

function setup() {
  const out: MarineReception[] = [];
  return { out, c: new MarineCorrelator((r) => out.push(r)) };
}

describe('MarineCorrelator', () => {
  it('joins an AIS message to the position that follows it', () => {
    const { out, c } = setup();
    c.onAisMessage(ais('77', 'uuid-a'), 1000);
    expect(out).toHaveLength(0);
    c.onVoyagePosition(position('77', 54.3, 10.1), 1001);
    expect(out).toEqual([{ stationUuid: 'uuid-a', lat: 54.3, lon: 10.1, source: 'aiscatcher' }]);
    expect(c.pendingSize).toBe(0);
    expect(c.paired).toBe(1);
  });

  it('gives every station that heard the vessel one reception', () => {
    const { out, c } = setup();
    c.onAisMessage(ais('77', 'uuid-a'), 1000);
    c.onAisMessage(ais('77', 'uuid-b'), 1000);
    c.onVoyagePosition(position('77', 54.3, 10.1), 1001);
    c.onVoyagePosition(position('77', 54.3, 10.1), 1002);
    expect(out.map((r) => r.stationUuid)).toEqual(['uuid-a', 'uuid-b']);
  });

  it('does not mix voyages', () => {
    const { out, c } = setup();
    c.onAisMessage(ais('77', 'uuid-a'), 1000);
    c.onVoyagePosition(position('78', 1.5, 2.5), 1001);
    expect(out).toHaveLength(0);
    expect(c.pendingSize).toBe(1);
  });

  it('uses the last known position for a message without one', () => {
    const { out, c } = setup();
    c.onVoyagePosition(position('77', 54.3, 10.1), 1000);
    c.onAisMessage(ais('77', 'uuid-a'), 2000);
    c.flush(2000 + PAIR_WINDOW_MS - 1);
    expect(out).toHaveLength(0);
    c.flush(2000 + PAIR_WINDOW_MS);
    expect(out).toEqual([{ stationUuid: 'uuid-a', lat: 54.3, lon: 10.1, source: 'aiscatcher' }]);
    expect(c.fromLastPosition).toBe(1);
  });

  it('counts a reception without position when nothing recent is known', () => {
    const { out, c } = setup();
    c.onVoyagePosition(position('77', 54.3, 10.1), 1000);
    const later = 1000 + LAST_POSITION_TTL_MS + 1;
    c.onAisMessage(ais('77', 'uuid-a'), later);
    c.flush(later + PAIR_WINDOW_MS);
    expect(out).toEqual([{ stationUuid: 'uuid-a', lat: null, lon: null, source: 'aiscatcher' }]);
    expect(c.withoutPosition).toBe(1);
  });

  it('ignores unusable payloads and positions', () => {
    const { out, c } = setup();
    c.onAisMessage({ ais_message: { marine_voyage_id: '77' } }, 1000);
    c.onAisMessage({}, 1000);
    c.onAisMessage(ais('77', 'uuid-a'), 1000);
    c.onVoyagePosition(position('77', 0, 0), 1001);
    c.onVoyagePosition(position('77', 91, 181), 1001); // AIS "not available"
    expect(out).toHaveLength(0);
    expect(c.pendingSize).toBe(1);
  });

  it('forgets old vessel positions', () => {
    const { c } = setup();
    c.onVoyagePosition(position('77', 54.3, 10.1), 1000);
    expect(c.trackedVoyages).toBe(1);
    c.flush(1000 + LAST_POSITION_TTL_MS + 30_001);
    expect(c.trackedVoyages).toBe(0);
  });
});
