import { afterAll, describe, expect, it } from 'vitest';
import { CoverageStore } from '../src/aggregation/coverage-store.js';
import type { CoverageEvent, StationMeta } from '../src/types/events.js';

const store = new CoverageStore();
afterAll(() => store.destroy());

// An AIS importer: an area feed with no meaningful location of its own
store.stationMap.set(7, {
  id: 7, uuid: 'uuid-7', ident: 'AISSTREAM', latitude: 0, longitude: 0, sourceType: 'ais',
  status: 'active', flagged: false, blocked: false, trustScore: 0.5, lastSyncedAt: new Date(),
} as StationMeta);

function ais(targetLat: number, targetLon: number): CoverageEvent {
  return {
    stationId: 7, stationUuid: 'uuid-7', targetLat, targetLon, targetAlt: null,
    transportType: 'marine', sourceType: 'ais', source: 'ais', frequency: null,
    signalLevel: null, errorCount: null, timestamp: new Date(), hasTargetPosition: true,
  };
}

describe('AIS positions on the Antarctic ice', () => {
  it('drops positions on inland ice and keeps the Antarctic coast and the Ross Sea', () => {
    store.ingest(ais(-85.3, 40));      // polar plateau: corrupt fix
    store.ingest(ais(-64.8, -64.0));   // Palmer Station, Antarctic Peninsula
    store.ingest(ais(-77.85, 166.6));  // McMurdo Sound
    expect(store.positionsDiscarded.marine_on_ice).toBe(1);
    const cells = store.getH3Data(3, '1h', { transportType: 'marine' });
    expect(cells.length).toBe(2);
  });
});
