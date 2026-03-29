'use client';

import { useUIStore } from '@/lib/stores/ui-store';
import { MAP_STYLES, type MapStyleId } from '@/lib/constants/map-styles';

export default function MapStyleSwitcher() {
  const mapStyleId = useUIStore((s) => s.mapStyleId);
  const setMapStyleId = useUIStore((s) => s.setMapStyleId);

  return (
    <div className="flex gap-1">
      {MAP_STYLES.map((style) => (
        <button
          key={style.id}
          onClick={() => setMapStyleId(style.id as MapStyleId)}
          className={`flex-1 px-2 py-1 rounded-md text-[10px] font-mono font-medium transition-all ${
            mapStyleId === style.id
              ? 'bg-zinc-700 text-zinc-200 shadow-sm'
              : 'text-zinc-600 hover:text-zinc-400 bg-zinc-800/30'
          }`}
        >
          {style.label}
        </button>
      ))}
    </div>
  );
}
