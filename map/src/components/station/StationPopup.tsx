'use client';

import type { Station } from '@/lib/types/coverage';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

interface Props {
  station: Station;
  onClose: () => void;
}

export default function StationPopup({ station, onClose }: Props) {
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
            style={{
              color: TRANSPORT_COLORS[station.sourceType] ?? '#34d399',
              background: `${TRANSPORT_COLORS[station.sourceType] ?? '#34d399'}20`,
            }}
          >
            {station.sourceType.toUpperCase()}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-sm leading-none p-1"
        >
          &times;
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatRow label="Messages" value={station.messageCount.toLocaleString()} />
        <StatRow label="With Position" value={(station.messagesWithPosition ?? 0).toLocaleString()} />
        <StatRow label="Max Range" value={`${station.maxDistance.toFixed(0)} km`} />
        <StatRow label="Avg Level" value={station.avgLevel !== null ? `${station.avgLevel} dB` : '—'} />
        <StatRow label="Confidence" value={`${(station.confidence * 100).toFixed(0)}%`} />
        <StatRow label="Last Seen" value={formatRelativeTime(station.lastSeen)} />
      </div>

      <div className="mt-3 pt-2 border-t border-zinc-800/50">
        <p className="text-[10px] text-zinc-600 font-mono">
          {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
        </p>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm font-mono font-medium text-zinc-200">{value}</span>
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
