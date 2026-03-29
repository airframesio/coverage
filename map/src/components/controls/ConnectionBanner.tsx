'use client';

import { useCoverageStore } from '@/lib/stores/coverage-store';

export default function ConnectionBanner() {
  const stats = useCoverageStore((s) => s.stats);
  const stations = useCoverageStore((s) => s.stations);
  const initialLoading = useCoverageStore((s) => s.initialLoading);

  // Show banner if NATS is disconnected or we have no data after initial load
  if (initialLoading) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="rounded-lg bg-zinc-900/80 backdrop-blur-xl border border-zinc-800/50 px-4 py-2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono text-zinc-400">Connecting to coverage service...</span>
        </div>
      </div>
    );
  }

  if (stats && !stats.natsConnected) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="rounded-lg bg-red-950/80 backdrop-blur-xl border border-red-900/50 px-4 py-2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-400" />
          <span className="text-xs font-mono text-red-300">NATS disconnected — data may be stale</span>
        </div>
      </div>
    );
  }

  if (stations.length === 0 && !initialLoading) {
    return (
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
        <div className="rounded-lg bg-amber-950/80 backdrop-blur-xl border border-amber-900/50 px-4 py-2 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-xs font-mono text-amber-300">No station data — waiting for messages</span>
        </div>
      </div>
    );
  }

  return null;
}
