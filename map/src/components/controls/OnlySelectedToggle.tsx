'use client';

import { useUIStore } from '@/lib/stores/ui-store';

/**
 * "Only this station": hides every other station's cells, polygons and
 * markers. Remembered between visits; it takes effect whenever a station is
 * selected.
 */
export default function OnlySelectedToggle({ hasStation, compact = false }: { hasStation: boolean; compact?: boolean }) {
  const onlySelected = useUIStore((s) => s.onlySelected);
  const toggleOnlySelected = useUIStore((s) => s.toggleOnlySelected);

  if (compact) {
    return (
      <button
        onClick={toggleOnlySelected}
        aria-pressed={onlySelected}
        title="Show only this station (S)"
        className={`w-full mt-3 px-2 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
          onlySelected
            ? 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-500/30'
            : 'bg-zinc-800/60 text-zinc-300 hover:text-zinc-100'
        }`}
      >
        {onlySelected ? 'Showing only this station · Show all' : 'Show only this station'}
      </button>
    );
  }

  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
      <span className="flex flex-col">
        <span className="text-xs text-zinc-300">Only selected station</span>
        <span className="text-[10px] text-zinc-500">
          {hasStation ? 'Hide all other stations' : 'Select a station to use this'}
        </span>
      </span>
      <button
        role="switch"
        aria-checked={onlySelected}
        aria-label="Only selected station"
        title="Only selected station (S)"
        onClick={toggleOnlySelected}
        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
          onlySelected ? 'bg-emerald-500' : 'bg-zinc-700'
        } ${hasStation ? '' : 'opacity-60'}`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            onlySelected ? 'translate-x-[18px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
