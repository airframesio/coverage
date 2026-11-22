import { describe, expect, it } from 'vitest';
import { dueSnapshots, snapshotInterval } from '../src/data/persistence.js';

describe('snapshot schedule', () => {
  it('saves a window every sixtieth of its length, between 1 and 15 minutes', () => {
    expect(snapshotInterval(3_600_000)).toBe(60_000); // 1h
    expect(snapshotInterval(6 * 3_600_000)).toBe(360_000); // 6h
    expect(snapshotInterval(24 * 3_600_000)).toBe(900_000); // 24h
    expect(snapshotInterval(30 * 86_400_000)).toBe(900_000); // 1mo
    expect(snapshotInterval(60_000)).toBe(60_000);
  });

  it('picks the snapshots never saved or saved an interval ago', () => {
    const intervals = new Map([['1h', 60_000], ['24h', 900_000], ['1mo', 900_000]]);
    const last = new Map<string, number>();
    expect([...dueSnapshots(intervals, last, 0)]).toEqual(['1h', '24h', '1mo']);
    for (const name of intervals.keys()) last.set(name, 0);
    // The minute timer fires a little early: still due
    expect([...dueSnapshots(intervals, last, 59_000)]).toEqual(['1h']);
    expect([...dueSnapshots(intervals, last, 300_000)]).toEqual(['1h']);
    last.set('1h', 300_000);
    expect([...dueSnapshots(intervals, last, 900_000)].sort()).toEqual(['1h', '1mo', '24h']);
  });
});
