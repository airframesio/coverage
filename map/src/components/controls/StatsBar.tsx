'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { sourceColor, sourceLabel } from '@/lib/constants/colors';

export default function StatsBar() {
  const stats = useCoverageStore((s) => s.stats);
  const stations = useCoverageStore((s) => s.stations);
  const hexData = useCoverageStore((s) => s.hexData);
  const lastUpdated = useCoverageStore((s) => s.lastUpdated);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const viewState = useUIStore((s) => s.viewState);
  const flyTo = useUIStore((s) => s.flyTo);

  const totalMessages = stations.reduce((sum, s) => sum + s.messageCount, 0);

  // Estimate coverage area from currently loaded hex cells.
  // Average area per cell by H3 resolution (km²):
  // res 2: ~86,745  res 3: ~12,393  res 4: ~1,770  res 5: ~253  res 6: ~36  res 7: ~5
  const coverageAreaKm2 = useMemo(() => {
    if (hexData.length === 0) return 0;
    // Detect resolution from first cell index length (res 2=15chars, 3=15, 4=15... all 15)
    // Instead use the map zoom to infer which resolution was fetched
    const zoom = viewState.zoom;
    let areaPerCell: number;
    if (zoom <= 3) areaPerCell = 86745;
    else if (zoom <= 5) areaPerCell = 12393;
    else if (zoom <= 7) areaPerCell = 1770;
    else if (zoom <= 9) areaPerCell = 253;
    else if (zoom <= 11) areaPerCell = 36;
    else areaPerCell = 5;
    return Math.round(hexData.length * areaPerCell);
  }, [hexData, viewState.zoom]);

  // Source type breakdown
  const sourceBreakdown = useMemo(() => {
    // Group by display label so aliases (ais / aiscatcher) share one entry
    const groups = new Map<string, { label: string; color: string; count: number }>();
    for (const s of stations) {
      const label = sourceLabel(s.sourceType);
      const group = groups.get(label) ?? { label, color: sourceColor(s.sourceType), count: 0 };
      group.count += 1;
      groups.set(label, group);
    }
    return [...groups.values()].sort((x, y) => y.count - x.count).slice(0, 5);
  }, [stations]);

  // Zoom to fit all stations
  const handleZoomToFit = () => {
    if (stations.length === 0) return;
    const withCoords = stations.filter(s => s.latitude !== 0 || s.longitude !== 0);
    if (withCoords.length === 0) return;

    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const s of withCoords) {
      if (s.latitude < minLat) minLat = s.latitude;
      if (s.latitude > maxLat) maxLat = s.latitude;
      if (s.longitude < minLon) minLon = s.longitude;
      if (s.longitude > maxLon) maxLon = s.longitude;
    }

    flyTo({
      longitude: (minLon + maxLon) / 2,
      latitude: (minLat + maxLat) / 2,
      zoom: 2,
    });
  };

  // Tick once a second so "updated Ns ago" keeps counting between refreshes.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const updatedAgo = lastUpdated
    ? `${Math.max(0, Math.round((now - lastUpdated.getTime()) / 1000))}s ago`
    : '—';

  return (
    <div
      className="rounded-xl border px-3 py-2.5 flex flex-col gap-2"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      {/* Main stats */}
      <div className="flex items-center justify-between">
        <Stat label="Stations" value={stations.length} />
        <Stat label="Coverage" value={formatArea(coverageAreaKm2)} />
        <Stat label="Messages" value={formatCount(totalMessages)} />
        <Stat label="msg/s" value={stats?.messagesPerSecond ?? 0} decimals={1} />
      </div>

      {/* Source type breakdown */}
      {sourceBreakdown.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-800/50 pt-2">
          {sourceBreakdown.map(({ label, color, count }) => (
            <div key={label} className="flex items-center gap-1" title={`${count} ${label} stations`}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[9px] font-mono text-zinc-500">{label}</span>
              <span className="text-[9px] font-mono text-zinc-300 tabular-nums">{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer: window, updated, NATS, zoom-to-fit */}
      <div className="flex items-center justify-between border-t border-zinc-800/50 pt-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-zinc-600">
            <span className="text-zinc-400">{timeWindow}</span>
          </span>
          <span className="text-[9px] font-mono text-zinc-700">
            {updatedAgo}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomToFit}
            className="text-[9px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Zoom to fit all stations"
          >
            fit
          </button>
          <span className="text-[9px] font-mono text-zinc-600 flex items-center gap-1">
            NATS
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                stats?.natsConnected ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  decimals = 0,
}: {
  label: string;
  value: number | string;
  decimals?: number;
}) {
  const formatted = typeof value === 'number'
    ? value.toFixed(decimals)
    : value;

  return (
    <div className="flex flex-col items-center">
      <span className="text-sm font-mono font-bold text-zinc-100 tabular-nums">
        {formatted}
      </span>
      <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatArea(km2: number): string {
  if (km2 >= 1_000_000) return `${(km2 / 1_000_000).toFixed(1)}M km²`;
  if (km2 >= 1_000) return `${(km2 / 1_000).toFixed(0)}k km²`;
  return `${km2} km²`;
}
