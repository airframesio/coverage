'use client';

import { cellToLatLng, getResolution, cellArea, gridDisk } from 'h3-js';
import type { CoverageHex } from '@/lib/types/coverage';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

interface Props {
  hex: CoverageHex;
  onClose: () => void;
}

export default function HexPopup({ hex, onClose }: Props) {
  const [lat, lon] = cellToLatLng(hex.h3);
  const resolution = getResolution(hex.h3);
  const areaKm2 = cellArea(hex.h3, 'km2');
  const confidencePct = (hex.confidence * 100).toFixed(0);

  // Color for the confidence bar
  const confColor =
    hex.confidence >= 0.7 ? '#34d399' :
    hex.confidence >= 0.4 ? '#fbbf24' :
    '#f87171';

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
          <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
            H3 Cell Details
          </h3>
          <span className="text-[10px] font-mono text-zinc-500 mt-0.5 block">
            {hex.h3}
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
          <span className="text-sm font-mono font-bold" style={{ color: confColor }}>
            {confidencePct}%
          </span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${confidencePct}%`,
              background: confColor,
            }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 mb-3">
        <StatRow label="Messages" value={hex.msgCount.toLocaleString()} />
        <StatRow label="Max Range" value={hex.maxDistance > 0 ? `${hex.maxDistance.toFixed(0)} km` : '—'} />
        <StatRow label="Avg Level" value={hex.avgLevel !== null ? `${hex.avgLevel} dB` : '—'} />
        <StatRow label="Stations" value={String(hex.stationCount)} />
        <StatRow label="Error Rate" value={`${(hex.errorRate * 100).toFixed(1)}%`} />
        <StatRow label="Resolution" value={`H3 res ${resolution}`} />
      </div>

      {/* Sources */}
      <div className="mb-3">
        <span className="text-[10px] text-zinc-500 block mb-1">Sources</span>
        <div className="flex flex-wrap gap-1">
          {hex.sources.map((src) => (
            <span
              key={src}
              className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded"
              style={{
                color: TRANSPORT_COLORS[src] ?? '#34d399',
                background: `${TRANSPORT_COLORS[src] ?? '#34d399'}15`,
              }}
            >
              {src}
            </span>
          ))}
        </div>
      </div>

      {/* Transport types */}
      {hex.transportTypes.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] text-zinc-500 block mb-1">Transport Types</span>
          <div className="flex flex-wrap gap-1">
            {hex.transportTypes.map((tt) => (
              <span
                key={tt}
                className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded bg-zinc-800/60 text-zinc-300"
              >
                {tt}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer: location + area */}
      <div className="pt-2 border-t border-zinc-800/50 flex justify-between">
        <span className="text-[10px] text-zinc-600 font-mono">
          {lat.toFixed(3)}, {lon.toFixed(3)}
        </span>
        <span className="text-[10px] text-zinc-600 font-mono">
          ~{areaKm2 >= 1000 ? `${(areaKm2 / 1000).toFixed(0)}k` : areaKm2.toFixed(0)} km²
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
