/**
 * Source types arrive in several spellings. The aggregation server publishes
 * `acars`, `vdl`, `hfdl`, `aero-acars`, `aero-adsc`, `iridium-acars` and `ais`,
 * while station metadata and older feeds use decoder names such as `dumpvdl2`
 * or `jaero`. Range and signal tables are keyed by family so that every
 * spelling gets the limits of its radio link.
 */
export type SourceFamily = 'acars' | 'vdl' | 'hfdl' | 'satcom' | 'ais' | 'unknown';

const EXACT: Record<string, SourceFamily> = {
  acars: 'acars',
  acarsdec: 'acars',
  sorcerer: 'acars',
  vdl: 'vdl',
  vdl2: 'vdl',
  vdlm2dec: 'vdl',
  dumpvdl2: 'vdl',
  hfdl: 'hfdl',
  dumphfdl: 'hfdl',
  satcom: 'satcom',
  satdump: 'satcom',
  adsc: 'satcom',
  ais: 'ais',
  aiscatcher: 'ais',
};

const SATCOM_PREFIXES = ['aero', 'jaero', 'satcom', 'iridium', 'inmarsat'];

export function sourceFamily(sourceType: string | null | undefined): SourceFamily {
  if (!sourceType) return 'unknown';
  const key = sourceType.toLowerCase();
  const exact = EXACT[key];
  if (exact) return exact;
  if (SATCOM_PREFIXES.some(p => key.startsWith(p))) return 'satcom';
  if (key.startsWith('dumpvdl2') || key.startsWith('vdl')) return 'vdl';
  if (key.startsWith('dumphfdl') || key.startsWith('hfdl')) return 'hfdl';
  if (key.startsWith('acars')) return 'acars';
  if (key.startsWith('ais')) return 'ais';
  return 'unknown';
}

/** The radio families a client can pick from, in display order */
export const MODE_FAMILIES = ['acars', 'vdl', 'hfdl', 'satcom', 'ais'] as const;
export type ModeFamily = typeof MODE_FAMILIES[number];

/**
 * Parse a `modes` query value (`acars,vdl`) into a set of families.
 * Missing, empty or naming every family means no filter (undefined).
 * Unknown names are ignored; a value naming only unknown ones matches nothing.
 */
export function parseModes(raw: string | null | undefined): Set<SourceFamily> | undefined {
  if (raw === undefined || raw === null || raw.trim() === '') return undefined;
  const modes = new Set<SourceFamily>();
  for (const part of raw.split(',')) {
    const name = part.trim().toLowerCase();
    if ((MODE_FAMILIES as readonly string[]).includes(name)) modes.add(name as SourceFamily);
  }
  if (MODE_FAMILIES.every(f => modes.has(f))) return undefined;
  return modes;
}
