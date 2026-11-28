import { gridDisk } from 'h3-js';
import type { DensityCell } from '../types/coverage';

/**
 * Density spectrum, low to high. Blue through red reads on the dark and the
 * light basemaps alike; the low end is never near black or near white.
 */
export const DENSITY_COLORS: [number, number, number][] = [
  [62, 91, 216],
  [31, 165, 232],
  [25, 211, 176],
  [123, 234, 78],
  [242, 227, 58],
  [251, 154, 43],
  [232, 64, 42],
];

export const DENSITY_BANDS = DENSITY_COLORS.length;

export const DENSITY_GRADIENT = `linear-gradient(to right, ${DENSITY_COLORS.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`).join(', ')})`;

export type DensityStyle = 'bands' | 'smooth';

/** Approximate width of an H3 cell, in km, by resolution */
export const H3_CELL_WIDTH_KM: Record<number, number> = {
  2: 340, 3: 130, 4: 50, 5: 19, 6: 7,
};

/**
 * Where a count sits between 1 and the busiest cell, on a log scale (0..1).
 * Reception falls off fast with distance, so a linear scale would show the
 * busiest few cells and nothing else.
 */
export function densityPosition(count: number, maxCount: number): number {
  if (maxCount <= 1) return 1;
  return Math.min(1, Math.max(0, Math.log(Math.max(count, 1)) / Math.log(maxCount)));
}

/** The count at a position on the scale (inverse of densityPosition) */
export function densityCountAt(position: number, maxCount: number): number {
  if (maxCount <= 1) return 1;
  return Math.round(Math.exp(position * Math.log(maxCount)));
}

export function densityColor(t: number, style: DensityStyle, alpha: number): [number, number, number, number] {
  const n = DENSITY_BANDS;
  if (style === 'bands') {
    const [r, g, b] = DENSITY_COLORS[Math.min(n - 1, Math.floor(t * n))];
    return [r, g, b, alpha];
  }
  const x = t * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const a = DENSITY_COLORS[i];
  const b = DENSITY_COLORS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    alpha,
  ];
}

export interface ShadedCell extends DensityCell {
  /** Position on the color scale after smoothing, 0..1 */
  t: number;
}

/**
 * Place every cell on the scale, averaged (in log space) with the neighbors
 * that also have data, so single busy or quiet cells don't speckle the map and
 * neighboring cells form bands. Cells without data stay empty: a gap is a place
 * the station did not hear.
 */
export function shadeDensity(cells: DensityCell[], maxCount: number): ShadedCell[] {
  const logs = new Map<string, number>();
  for (const c of cells) logs.set(c.h3, Math.log(Math.max(c.msgCount, 1)));
  const maxLog = maxCount > 1 ? Math.log(maxCount) : 1;
  return cells.map((c) => {
    const own = logs.get(c.h3)!;
    let sum = own * 2;
    let weight = 2;
    for (const n of gridDisk(c.h3, 1)) {
      if (n === c.h3) continue;
      const v = logs.get(n);
      if (v === undefined) continue;
      sum += v;
      weight += 1;
    }
    return { ...c, t: Math.min(1, Math.max(0, sum / weight / maxLog)) };
  });
}
