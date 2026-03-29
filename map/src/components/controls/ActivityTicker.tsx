'use client';

import { useEffect, useState } from 'react';
import { TRANSPORT_COLORS } from '@/lib/constants/colors';

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

interface SourceActivity {
  source: string;
  messages: number;
  stations: number;
}

export default function ActivityTicker() {
  const [activity, setActivity] = useState<{
    sources: SourceActivity[];
    totalMessages: number;
  } | null>(null);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch(`${API_URL}/api/v1/activity`);
        if (res.ok) setActivity(await res.json());
      } catch { /* ignore */ }
    }
    fetchActivity();
    const interval = setInterval(fetchActivity, 5_000);
    return () => clearInterval(interval);
  }, []);

  if (!activity || activity.sources.length === 0) return null;

  return (
    <div
      className="absolute bottom-4 left-4 z-10 rounded-xl border px-3 py-2 max-w-xs"
      style={{
        background: 'var(--panel-bg)',
        borderColor: 'var(--panel-border)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
          Live Activity
        </span>
        <span className="text-[9px] font-mono text-zinc-600">last 1m</span>
        <div
          className="w-1.5 h-1.5 rounded-full bg-emerald-400"
          style={{ animation: 'pulse-dot 1.5s ease-in-out infinite' }}
        />
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {activity.sources.slice(0, 6).map((s) => {
          const color = TRANSPORT_COLORS[s.source] ?? '#888';
          return (
            <div key={s.source} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
              <span className="text-[10px] font-mono text-zinc-400">
                {s.source}
              </span>
              <span className="text-[10px] font-mono font-bold text-zinc-200 tabular-nums">
                {s.messages >= 1000 ? `${(s.messages / 1000).toFixed(1)}k` : s.messages}
              </span>
              <span className="text-[9px] font-mono text-zinc-600">
                ({s.stations})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
