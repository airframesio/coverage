/**
 * Radio modes the map can filter by. The keys are the coverage service's
 * source families (`modes=` on /coverage/h3, /coverage/polygons, /stations).
 */
export const MODES = ['acars', 'vdl', 'hfdl', 'satcom', 'ais'] as const;
export type ModeKey = typeof MODES[number];

export type TransportFilterKey = 'all' | 'aircraft' | 'marine';

/** Modes that belong to a transport filter, in display order */
export function modesForTransport(transport: TransportFilterKey): ModeKey[] {
  if (transport === 'aircraft') return MODES.filter((m) => m !== 'ais');
  if (transport === 'marine') return ['ais'];
  return [...MODES];
}

/**
 * The `modes` query value for the selected modes, or null when every mode of
 * the transport filter is selected (no filter). Nothing selected sends `none`,
 * which the service answers with nothing.
 */
export function modesParam(selected: readonly ModeKey[], transport: TransportFilterKey): string | null {
  const visible = modesForTransport(transport);
  const chosen = visible.filter((m) => selected.includes(m));
  if (chosen.length === visible.length) return null;
  return chosen.length === 0 ? 'none' : chosen.join(',');
}

export function parseModesHash(raw: string | null): ModeKey[] | null {
  if (raw === null) return null;
  return MODES.filter((m) => raw.split(',').includes(m));
}
