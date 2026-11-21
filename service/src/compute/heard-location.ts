import { haversineDistance } from './distance.js';

/** Where a station appears to be, judged from the positions it hears */
export interface HeardLocation {
  latitude: number;
  longitude: number;
  /** 90% of the sampled positions lie within this distance of the centre */
  spreadKm: number;
  samples: number;
}

/** Positions kept per station: recent ones, so a moved antenna is followed */
const SAMPLE_CAPACITY = 200;
/** Fewer positions than this say nothing reliable */
const MIN_SAMPLES = 30;
/** Recompute the centre every this many new positions */
const RECOMPUTE_EVERY = 25;

interface Samples {
  /** lat, lon pairs in a ring */
  points: Float64Array;
  count: number;
  next: number;
  sinceCompute: number;
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
  add(stationId: number, latitude: number, longitude: number): boolean {
    let s = this.samples.get(stationId);
    if (!s) {
      s = { points: new Float64Array(SAMPLE_CAPACITY * 2), count: 0, next: 0, sinceCompute: 0 };
      this.samples.set(stationId, s);
    }
    s.points[s.next * 2] = latitude;
    s.points[s.next * 2 + 1] = longitude;
    s.next = (s.next + 1) % SAMPLE_CAPACITY;
    if (s.count < SAMPLE_CAPACITY) s.count++;
    s.sinceCompute++;

    if (s.count < MIN_SAMPLES) return false;
    if (s.sinceCompute < RECOMPUTE_EVERY && this.estimates.has(stationId)) return false;
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
