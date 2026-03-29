'use client';

import { useUIStore } from '@/lib/stores/ui-store';

export default function ModeToggle() {
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);

  return (
    <div className="flex gap-1 bg-zinc-800/60 rounded-lg p-0.5">
      <button
        onClick={() => setMode('hexgrid')}
        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
          mode === 'hexgrid'
            ? 'bg-zinc-700 text-zinc-50 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-300'
        }`}
      >
        Hex Grid
      </button>
      <button
        onClick={() => setMode('polygon')}
        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
          mode === 'polygon'
            ? 'bg-zinc-700 text-zinc-50 shadow-sm'
            : 'text-zinc-400 hover:text-zinc-300'
        }`}
      >
        Polygons
      </button>
    </div>
  );
}
