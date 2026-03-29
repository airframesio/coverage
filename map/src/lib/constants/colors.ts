/** Coverage confidence score to RGBA color (for hex grid mode) */
export function coverageColorScale(score: number): [number, number, number, number] {
  if (score <= 0.0) return [15, 23, 42, 0];
  if (score <= 0.1) return [6, 78, 59, 120];
  if (score <= 0.3) return lerp([6, 78, 59, 120], [16, 185, 129, 160], (score - 0.1) / 0.2);
  if (score <= 0.5) return lerp([16, 185, 129, 160], [52, 211, 153, 190], (score - 0.3) / 0.2);
  if (score <= 0.7) return lerp([52, 211, 153, 190], [163, 230, 53, 200], (score - 0.5) / 0.2);
  if (score <= 0.9) return lerp([163, 230, 53, 200], [250, 204, 21, 220], (score - 0.7) / 0.2);
  return lerp([250, 204, 21, 220], [251, 146, 60, 240], Math.min((score - 0.9) / 0.1, 1));
}

function lerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round(a[3] + (b[3] - a[3]) * t),
  ];
}

/** Deterministic hue for a station (for polygon mode) */
export function stationHue(stationId: number): number {
  // Simple hash to spread hues
  let h = stationId;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return ((h & 0xffff) % 360);
}

/** HSL to RGBA */
export function hslToRgba(
  h: number, s: number, l: number, a: number,
): [number, number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const aa = s * Math.min(l, 1 - l);
  const f = (n: number) => l - aa * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
    a,
  ];
}

/** Transport type to color mapping */
export const TRANSPORT_COLORS: Record<string, string> = {
  aircraft: '#34d399',
  marine: '#fb923c',
  sonde: '#a78bfa',
  space: '#60a5fa',
};
