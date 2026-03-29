'use client';

import { useMemo } from 'react';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { useUIStore } from '@/lib/stores/ui-store';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

export default function StatsBar() {
  const stats = useCoverageStore((s) => s.stats);
  const stations = useCoverageStore((s) => s.stations);
  const hexData = useCoverageStore((s) => s.hexData);
  const lastUpdated = useCoverageStore((s) => s.lastUpdated);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const flyTo = useUIStore((s) => s.flyTo);

  const totalMessages = stations.reduce((sum, s) => sum + s.messageCount, 0);

  // Source type breakdown
  const sourceBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stations) {
      counts[s.sourceType] = (counts[s.sourceType] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
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

  const updatedAgo = lastUpdated
    ? `${Math.round((Date.now() - lastUpdated.getTime()) / 1000)}s ago`
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
        <Stat label="H3 Cells" value={hexData.length} />
        <Stat label="Messages" value={formatCount(totalMessages)} />
        <Stat label="msg/s" value={stats?.messagesPerSecond ?? 0} decimals={1} />
      </div>

      {/* Source type breakdown */}
      {sourceBreakdown.length > 0 && (
        <div className="flex items-center gap-2 border-t border-zinc-800/50 pt-2">
          {sourceBreakdown.map(([type, count]) => {
            const color = TRANSPORT_COLORS[type] ?? '#888';
            return (
              <div key={type} className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[9px] font-mono text-zinc-500">{count}</span>
              </div>
            );
          })}
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
