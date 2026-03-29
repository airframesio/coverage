'use client';

import { useEffect, useState } from 'react';
import type { Station, BearingSector } from '@/lib/types/coverage';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';
import { useUIStore } from '@/lib/stores/ui-store';

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

interface Props {
  station: Station;
  onClose: () => void;
}

export default function StationPopup({ station, onClose }: Props) {
  const timeWindow = useUIStore((s) => s.timeWindow);
  const [sectors, setSectors] = useState<BearingSector[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDetail() {
      try {
        const res = await fetch(`${API_URL}/api/v1/coverage/stations/${station.id}?window=${timeWindow}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setSectors(data.bearingSectors ?? null);
        }
      } catch { /* ignore */ }
    }
    fetchDetail();
    return () => { cancelled = true; };
  }, [station.id, timeWindow]);

  const color = TRANSPORT_COLORS[station.sourceType] ?? '#34d399';

  return (
    <div
      className="absolute bottom-4 left-4 z-10 w-80 rounded-2xl border shadow-2xl p-4"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-50 font-mono">
            {station.ident || `Station #${station.id}`}
          </h3>
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded mt-1 inline-block"
            style={{ color, background: `${color}20` }}
          >
            {station.sourceType.toUpperCase()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-lg leading-none p-1 -mt-1 -mr-1"
        >
          &times;
        </button>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-2">
        <StatRow label="Messages" value={station.messageCount.toLocaleString()} />
        <StatRow label="Max Range" value={station.maxDistance > 0 ? `${station.maxDistance.toFixed(0)} km` : '—'} />
        <StatRow label="Avg Level" value={station.avgLevel !== null ? `${station.avgLevel} dB` : '—'} />
        <StatRow label="With Position" value={(station.messagesWithPosition ?? 0).toLocaleString()} />
        <StatRow label="Confidence" value={station.confidence > 0 ? `${(station.confidence * 100).toFixed(0)}%` : '—'} />
        <StatRow label="Last Seen" value={formatRelativeTime(station.lastSeen)} />
      </div>

      {/* Polar coverage mini-chart */}
      {sectors && sectors.some(s => s.distance > 0) && (
        <div className="mt-3 pt-3 border-t border-zinc-800/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Directional Range
            </span>
          </div>
          <PolarChart sectors={sectors} color={color} />
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-zinc-800/50 flex justify-between">
        <span className="text-[10px] text-zinc-600 font-mono">
          {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
        </span>
        <span className="text-[10px] text-zinc-600 font-mono">
          ID: {station.id}
        </span>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-zinc-500">{label}</span>
      <span className="text-sm font-mono font-medium text-zinc-200">{value}</span>
    </div>
  );
}

/** Tiny SVG polar chart showing directional coverage */
function PolarChart({ sectors, color }: { sectors: BearingSector[]; color: string }) {
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - 8;

  const maxDist = Math.max(...sectors.map(s => s.distance), 1);

  // Build path for the coverage shape
  const points = sectors.map((s, i) => {
    const angle = (s.bearing + 5) * (Math.PI / 180) - Math.PI / 2; // center of 10° sector, rotate so 0° is up
    const r = (s.distance / maxDist) * maxR;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  });

  const pathData = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ') + ' Z';

  // Concentric guide circles
  const guides = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="flex justify-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* Guide circles */}
        {guides.map((g) => (
          <circle
            key={g}
            cx={cx} cy={cy} r={maxR * g}
            fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5}
          />
        ))}
        {/* Cross lines */}
        <line x1={cx} y1={cy - maxR} x2={cx} y2={cy + maxR} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
        <line x1={cx - maxR} y1={cy} x2={cx + maxR} y2={cy} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />

        {/* Coverage shape */}
        <path d={pathData} fill={`${color}30`} stroke={color} strokeWidth={1.5} />

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={2} fill={color} />

        {/* Cardinal labels */}
        <text x={cx} y={4} textAnchor="middle" className="fill-zinc-600 text-[8px] font-mono">N</text>
        <text x={size - 2} y={cy + 3} textAnchor="end" className="fill-zinc-600 text-[8px] font-mono">E</text>
        <text x={cx} y={size - 1} textAnchor="middle" className="fill-zinc-600 text-[8px] font-mono">S</text>
        <text x={4} y={cy + 3} textAnchor="start" className="fill-zinc-600 text-[8px] font-mono">W</text>

        {/* Max distance label */}
        <text x={cx + 3} y={cy - maxR + 10} textAnchor="start" className="fill-zinc-500 text-[7px] font-mono">
          {maxDist.toFixed(0)} km
        </text>
      </svg>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
