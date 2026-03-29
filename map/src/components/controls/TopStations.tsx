'use client';

import { useCoverageStore } from '@/lib/stores/coverage-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

export default function TopStations() {
  const stations = useCoverageStore((s) => s.stations);
  const selectStation = useUIStore((s) => s.selectStation);
  const selectedStationId = useUIStore((s) => s.selectedStationId);

  if (stations.length === 0) return null;

  const top = stations.slice(0, 8);

  return (
    <div
      className="rounded-2xl border shadow-2xl p-3 flex flex-col gap-2"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Top Stations
        </span>
        <span className="text-[10px] font-mono text-zinc-600">
          {stations.length} total
        </span>
      </div>

      <div className="flex flex-col">
        {top.map((station) => {
          const isSelected = station.id === selectedStationId;
          const color = TRANSPORT_COLORS[station.sourceType] ?? '#34d399';

          return (
            <button
              key={station.id}
              onClick={() => selectStation(isSelected ? null : station.id)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors ${
                isSelected
                  ? 'bg-emerald-900/30 ring-1 ring-emerald-500/20'
                  : 'hover:bg-zinc-800/40'
              }`}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
              <span className="text-xs font-mono text-zinc-200 truncate flex-1">
                {station.ident || `#${station.id}`}
              </span>
              <span
                className="text-[9px] font-mono px-1 py-0.5 rounded"
                style={{ color, background: `${color}15` }}
              >
                {station.sourceType}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 tabular-nums w-12 text-right">
                {station.messageCount >= 1000
                  ? `${(station.messageCount / 1000).toFixed(1)}k`
                  : station.messageCount}
              </span>
              <span className="text-[10px] font-mono text-zinc-600 tabular-nums w-14 text-right">
                {station.maxDistance > 0 ? `${station.maxDistance.toFixed(0)}km` : '—'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
