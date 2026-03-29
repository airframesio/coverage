'use client';

import { useEffect, useState } from 'react';
import type { CoveragePolygon, BearingSector } from '@/lib/types/coverage';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';
import { useUIStore } from '@/lib/stores/ui-store';

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

interface Props {
  polygon: CoveragePolygon;
  onClose: () => void;
}

interface StationDetail {
  messageCount: number;
  messagesWithPosition: number;
  maxDistance: number;
  avgLevel: number | null;
  errorRate: number;
  bearingSectors: BearingSector[];
}

export default function PolygonPopup({ polygon, onClose }: Props) {
  const timeWindow = useUIStore((s) => s.timeWindow);
  const [detail, setDetail] = useState<StationDetail | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDetail() {
      try {
        const res = await fetch(
          `${API_URL}/api/v1/coverage/stations/${polygon.stationId}?window=${timeWindow}`
        );
        if (res.ok && !cancelled) {
          setDetail(await res.json());
        }
      } catch { /* ignore */ }
    }
    fetchDetail();
    return () => { cancelled = true; };
  }, [polygon.stationId, timeWindow]);

  const color = TRANSPORT_COLORS[polygon.sourceType] ?? '#34d399';
  const confidencePct = (polygon.confidence * 100).toFixed(0);

  // Compute polygon area approximation from vertex count
  const vertexCount = polygon.coordinates[0]?.length ?? 0;

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
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-50 font-mono">
            {polygon.ident || `Station #${polygon.stationId}`}
          </h3>
          <span
            className="text-xs font-medium px-1.5 py-0.5 rounded mt-1 inline-block"
            style={{ color, background: `${color}20` }}
          >
            {polygon.sourceType.toUpperCase()} Coverage
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-lg leading-none p-1 -mt-1 -mr-1"
        >
          &times;
        </button>
      </div>

      {/* Confidence bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-zinc-500">Coverage Confidence</span>
          <span className="text-sm font-mono font-bold" style={{ color }}>
            {confidencePct}%
          </span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.max(5, Number(confidencePct))}%`, background: color }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-3">
        <StatRow label="Messages" value={polygon.messageCount.toLocaleString()} />
        <StatRow
          label="Max Range"
          value={detail?.maxDistance ? `${detail.maxDistance.toFixed(0)} km` : '—'}
        />
        <StatRow
          label="Avg Level"
          value={detail?.avgLevel != null ? `${detail.avgLevel} dB` : '—'}
        />
        <StatRow
          label="With Position"
          value={detail?.messagesWithPosition?.toLocaleString() ?? '—'}
        />
        <StatRow
          label="Error Rate"
          value={detail ? `${(detail.errorRate * 100).toFixed(1)}%` : '—'}
        />
        <StatRow label="Vertices" value={String(vertexCount)} />
      </div>

      {/* Bearing sector summary */}
      {detail?.bearingSectors && (
        <div className="mb-3">
          <span className="text-[10px] text-zinc-500 block mb-1">Active Bearing Sectors</span>
          <div className="flex flex-wrap gap-1">
            {detail.bearingSectors
              .filter((s) => s.distance > 0)
              .map((s) => (
                <span
                  key={s.bearing}
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-300"
                >
                  {s.bearing}° → {s.distance.toFixed(0)}km
                </span>
              ))}
            {detail.bearingSectors.every((s) => s.distance === 0) && (
              <span className="text-[9px] text-zinc-600">No directional data yet</span>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="pt-2 border-t border-zinc-800/50 flex justify-between">
        <span className="text-[10px] text-zinc-600 font-mono">
          Station #{polygon.stationId}
        </span>
        <span className="text-[10px] text-zinc-600 font-mono">
          Window: {timeWindow}
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
