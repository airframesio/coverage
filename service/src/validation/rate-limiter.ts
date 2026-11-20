/** Per-station rate limiter to detect and throttle anomalous message volumes */

interface StationRate {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60_000; // 1 minute window
// The busiest aircraft receivers send about 400 messages a minute.
export const MAX_PER_MINUTE = 900;
// AIS is far chattier: every vessel in range reports every few seconds, so a
// receiver near a busy port sends thousands of messages a minute.
export const MAX_PER_MINUTE_MARINE = 6000;

export class RateLimiter {
  private stations = new Map<number, StationRate>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up stale entries every 5 minutes
    this.cleanupTimer = setInterval(() => this.cleanup(), 300_000);
  }

  /** Returns true if the event should be allowed, false if rate-limited */
  check(stationId: number, maxPerMinute: number = MAX_PER_MINUTE): boolean {
    const now = Date.now();
    const rate = this.stations.get(stationId);

    if (!rate || now - rate.windowStart > WINDOW_MS) {
      this.stations.set(stationId, { count: 1, windowStart: now });
      return true;
    }

    rate.count++;
    return rate.count <= maxPerMinute;
  }

  /** Get current rate for a station (messages in current window) */
  getRate(stationId: number): number {
    const rate = this.stations.get(stationId);
    if (!rate || Date.now() - rate.windowStart > WINDOW_MS) return 0;
    return rate.count;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, rate] of this.stations) {
      if (now - rate.windowStart > WINDOW_MS * 2) {
        this.stations.delete(id);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
  }
}
