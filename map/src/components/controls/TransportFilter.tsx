'use client';

import { useUIStore } from '@/lib/stores/ui-store';

const FILTERS = [
  { key: 'all' as const, label: 'All' },
  { key: 'aircraft' as const, label: 'Aircraft' },
  { key: 'marine' as const, label: 'Marine' },
];

export default function TransportFilter() {
  const transportFilter = useUIStore((s) => s.transportFilter);
  const setTransportFilter = useUIStore((s) => s.setTransportFilter);

  return (
    <div className="flex gap-1">
      {FILTERS.map((f) => (
        <button
          key={f.key}
          onClick={() => setTransportFilter(f.key)}
          className={`flex-1 px-2 py-1 rounded-md text-xs font-medium transition-all ${
            transportFilter === f.key
              ? 'bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-500/30'
              : 'text-zinc-500 hover:text-zinc-400 bg-zinc-800/30'
          }`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
