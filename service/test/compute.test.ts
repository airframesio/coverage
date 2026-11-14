import { describe, expect, it } from 'vitest';
import { bearing, bearingToSector, destinationPoint, haversineDistance } from '../src/compute/distance.js';
import { indexPoint, indexPointAtResolution } from '../src/compute/h3-indexer.js';
import { validateCoordinate } from '../src/validation/coordinate-validator.js';

describe('distance', () => {
  it('computes haversine distance between SFO and JFK', () => {
    const km = haversineDistance(37.6213, -122.379, 40.6413, -73.7781);
    expect(km).toBeGreaterThan(4140);
    expect(km).toBeLessThan(4170);
  });

  it('computes cardinal bearings and sectors', () => {
    expect(bearing(0, 0, 1, 0)).toBeCloseTo(0, 5);
    expect(bearing(0, 0, 0, 1)).toBeCloseTo(90, 5);
    expect(bearingToSector(0)).toBe(0);
    expect(bearingToSector(359.9)).toBe(35);
    expect(bearingToSector(-10)).toBe(35);
  });

  it('round-trips a destination point', () => {
    const [lat, lon] = destinationPoint(47.45, -122.31, 250, 135);
    expect(haversineDistance(47.45, -122.31, lat, lon)).toBeCloseTo(250, 3);
    expect(bearing(47.45, -122.31, lat, lon)).toBeCloseTo(135, 3);
  });
});

describe('h3 indexing', () => {
  it('indexes a point at every configured resolution', () => {
    const cells = indexPoint(51.47, -0.4543);
    expect(cells.size).toBeGreaterThan(0);
    for (const [resolution, cell] of cells) {
      expect(cell).toBe(indexPointAtResolution(51.47, -0.4543, resolution));
    }
  });
});

describe('coordinate validation', () => {
  it('accepts real coordinates and rejects bad ones', () => {
    expect(validateCoordinate(37.6, -122.4).valid).toBe(true);
    expect(validateCoordinate(91, 0).valid).toBe(false);
    expect(validateCoordinate(0, 181).valid).toBe(false);
    expect(validateCoordinate(Number.NaN, 0).valid).toBe(false);
    expect(validateCoordinate(0.01, 0.01).reason).toContain('null island');
  });
});
