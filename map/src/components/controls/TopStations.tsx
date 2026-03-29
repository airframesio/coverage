'use client';

import { useState, useMemo } from 'react';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

export default function TopStations() {
  const stations = useCoverageStore((s) => s.stations);
  const selectStation = useUIStore((s) => s.selectStation);
  const selectedStationId = useUIStore((s) => s.selectedStationId);
  const flyTo = useUIStore((s) => s.flyTo);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search) return stations.slice(0, 10);
    const q = search.toLowerCase();
    return stations
      .filter((s) =>
        s.ident.toLowerCase().includes(q) ||
        s.sourceType.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [stations, search]);

  if (stations.length === 0) return null;

  const handleClick = (station: typeof stations[0]) => {
    const isSelected = station.id === selectedStationId;
    if (isSelected) {
      selectStation(null);
    } else {
      selectStation(station.id);
      if (station.latitude !== 0 && station.longitude !== 0) {
        flyTo({ longitude: station.longitude, latitude: station.latitude, zoom: 8 });
      }
    }
  };

  return (
    <div
      className="rounded-2xl border shadow-2xl p-3 flex flex-col gap-2 max-h-[320px]"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Stations
        </span>
        <span className="text-[10px] font-mono text-zinc-600">
          {stations.length} active
        </span>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by ident or type..."
        className="w-full px-2 py-1 rounded-md bg-zinc-800/50 border border-zinc-700/50
          text-xs font-mono text-zinc-200 placeholder:text-zinc-600
          focus:outline-none focus:ring-1 focus:ring-emerald-500/30 focus:border-emerald-500/30"
      />

      <div className="flex flex-col overflow-y-auto">
        {filtered.map((station) => {
          const isSelected = station.id === selectedStationId;
          const color = TRANSPORT_COLORS[station.sourceType] ?? '#34d399';

          return (
            <button
              key={station.id}
              onClick={() => handleClick(station)}
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
            </button>
          );
        })}
        {filtered.length === 0 && search && (
          <p className="text-xs text-zinc-600 text-center py-2">No match</p>
        )}
      </div>
    </div>
  );
}
