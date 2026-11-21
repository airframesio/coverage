import { haversineDistance } from './distance.js';

/** Where a station appears to be, judged from the positions it hears */
export interface HeardLocation {
  latitude: number;
  longitude: number;
  /** 90% of the sampled positions lie within this distance of the centre */
  spreadKm: number;
  samples: number;
}

/** How much a station must be heard before it is placed */
export interface HeardProfile {
  /** Positions kept: recent ones, so a moved antenna is followed */
  capacity: number;
  /** Fewer positions than this say nothing reliable */
  minSamples: number;
  /** Recompute the centre every this many new positions */
  recomputeEvery: number;
  /** Take at most one position per this many ms, so the samples span real time */
  minIntervalMs: number;
}

/**
 * Vessels sit all around a coastal receiver and barely move, so a couple of
 * hundred positions settle its place within minutes.
 */
export const MARINE_PROFILE: HeardProfile = { capacity: 200, minSamples: 30, recomputeEvery: 25, minIntervalMs: 0 };

/**
 * Aircraft pass through in streams. A quiet night with a handful of flights on
 * one airway puts the centre 100 to 250 km from the antenna, so an aircraft
 * station needs 1,000 positions taken at least 10 seconds apart: close to three
 * hours of steady traffic at the very least, a day for a quiet station.
 */
export const AIRCRAFT_PROFILE: HeardProfile = { capacity: 2000, minSamples: 1000, recomputeEvery: 100, minIntervalMs: 10_000 };

interface Samples {
  /** lat, lon pairs in a ring */
  points: Float64Array;
  count: number;
  next: number;
  sinceCompute: number;
  lastAt: number;
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Estimates a receiver's location as the centre of the positions it hears.
 *
 * A station without an owner-entered location only has the GeoIP guess for its
 * internet address, which is the provider's city and can be hundreds of
 * kilometres from the antenna. What a VHF receiver hears, though, lies in a
 * tight group around it. The centre is the median latitude and longitude (so a
 * few bogus positions do not move it), and the spread tells a single antenna
 * from a relay of a wide area.
 */
export class HeardLocationEstimator {
  private samples = new Map<number, Samples>();
  private estimates = new Map<number, HeardLocation>();

  /** Add a heard position. Returns true when the station's estimate was recomputed. */
  add(stationId: number, latitude: number, longitude: number, profile: HeardProfile = MARINE_PROFILE,
    now: number = Date.now()): boolean {
    let s = this.samples.get(stationId);
    if (!s || s.points.length !== profile.capacity * 2) {
      s = { points: new Float64Array(profile.capacity * 2), count: 0, next: 0, sinceCompute: 0, lastAt: -Infinity };
      this.samples.set(stationId, s);
    }
    // `now` is the arrival time, not the message's own timestamp: messages
    // arrive out of order and a bad timestamp must not defeat the spacing.
    if (Math.abs(now - s.lastAt) < profile.minIntervalMs) return false;
    s.lastAt = now;
    s.points[s.next * 2] = latitude;
    s.points[s.next * 2 + 1] = longitude;
    s.next = (s.next + 1) % profile.capacity;
    if (s.count < profile.capacity) s.count++;
    s.sinceCompute++;

    if (s.count < profile.minSamples) return false;
    const current = this.estimates.get(stationId);
    const fresh = current !== undefined && current.samples >= profile.minSamples;
    if (s.sinceCompute < profile.recomputeEvery && fresh) return false;
    s.sinceCompute = 0;
    this.estimates.set(stationId, this.compute(s));
    return true;
  }

  private compute(s: Samples): HeardLocation {
    const lats: number[] = [];
    const lons: number[] = [];
    // Longitudes are taken relative to the first sample so a cluster across the
    // antimeridian does not average out to the other side of the world.
    const ref = s.points[1];
    for (let i = 0; i < s.count; i++) {
      lats.push(s.points[i * 2]);
      lons.push(((s.points[i * 2 + 1] - ref + 540) % 360) - 180);
    }
    const latitude = median(lats.slice());
    const longitude = ((median(lons.slice()) + ref + 540) % 360) - 180;

    const distances: number[] = [];
    for (let i = 0; i < s.count; i++) {
      distances.push(haversineDistance(latitude, longitude, s.points[i * 2], s.points[i * 2 + 1]));
    }
    distances.sort((a, b) => a - b);
    const spreadKm = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.9))];

    return { latitude, longitude, spreadKm, samples: s.count };
  }

  get(stationId: number): HeardLocation | undefined {
    return this.estimates.get(stationId);
  }

  /** Restore an estimate saved before a restart */
  restore(stationId: number, location: HeardLocation): void {
    this.estimates.set(stationId, location);
  }

  entries(): IterableIterator<[number, HeardLocation]> {
    return this.estimates.entries();
  }
}
