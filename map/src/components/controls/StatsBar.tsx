'use client';

import { useCoverageStore } from '@/lib/stores/coverage-store';

export default function StatsBar() {
  const stats = useCoverageStore((s) => s.stats);
  const stations = useCoverageStore((s) => s.stations);

  return (
    <div
      className="rounded-xl border px-3 py-2 flex items-center justify-between gap-3"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <Stat label="Stations" value={stations.length} />
      <Stat label="msg/s" value={stats?.messagesPerSecond ?? 0} decimals={1} />
      <Stat
        label="NATS"
        value={stats?.natsConnected ? 'OK' : '—'}
        color={stats?.natsConnected ? 'text-emerald-400' : 'text-zinc-600'}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  decimals = 0,
  color,
}: {
  label: string;
  value: number | string;
  decimals?: number;
  color?: string;
}) {
  const formatted = typeof value === 'number'
    ? value.toFixed(decimals)
    : value;

  return (
    <div className="flex flex-col items-center">
      <span className={`text-sm font-mono font-bold ${color ?? 'text-zinc-100'}`}>
        {formatted}
      </span>
      <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}
