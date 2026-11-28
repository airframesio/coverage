'use client';

import { useUIStore, type ViewMode } from '@/lib/stores/ui-store';

const VIEWS: { mode: ViewMode; label: string; title: string }[] = [
  { mode: 'hexgrid', label: 'Hex Grid', title: 'Hex grid of every station (H)' },
  { mode: 'polygon', label: 'Polygons', title: 'Each station\'s coverage polygon (P)' },
  { mode: 'density', label: 'Density', title: 'Where one station hears most (D)' },
];

export default function ModeToggle() {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  return (
    <div className="flex gap-1 bg-zinc-800/60 rounded-lg p-0.5" role="group" aria-label="View">
      {VIEWS.map((v) => (
        <button
          key={v.mode}
          onClick={() => setMode(v.mode)}
          title={v.title}
          aria-pressed={mode === v.mode}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-all ${
            mode === v.mode
              ? 'bg-zinc-700 text-zinc-50 shadow-sm'
              : 'text-zinc-400 hover:text-zinc-300'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
