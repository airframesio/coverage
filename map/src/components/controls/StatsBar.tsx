'use client';

import { useCoverageStore } from '@/lib/stores/coverage-store';
import { useUIStore } from '@/lib/stores/ui-store';

export default function StatsBar() {
  const stats = useCoverageStore((s) => s.stats);
  const stations = useCoverageStore((s) => s.stations);
  const hexData = useCoverageStore((s) => s.hexData);
  const timeWindow = useUIStore((s) => s.timeWindow);

  const totalMessages = stations.reduce((sum, s) => sum + s.messageCount, 0);

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
      <div className="flex items-center justify-between">
        <Stat label="Stations" value={stations.length} />
        <Stat label="H3 Cells" value={hexData.length} />
        <Stat label="Messages" value={formatCount(totalMessages)} />
        <Stat label="msg/s" value={stats?.messagesPerSecond ?? 0} decimals={1} />
      </div>
      <div className="flex items-center justify-between border-t border-zinc-800/50 pt-2">
        <span className="text-[9px] font-mono text-zinc-600">
          Window: <span className="text-zinc-400">{timeWindow}</span>
        </span>
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
