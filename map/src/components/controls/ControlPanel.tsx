'use client';

import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import ModeToggle from './ModeToggle';
import TimeSlider from './TimeSlider';
import CoverageLegend from './CoverageLegend';
import StatsBar from './StatsBar';
import TransportFilter from './TransportFilter';

export default function ControlPanel() {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useUIStore((s) => s.setPanelCollapsed);
  const isLoading = useCoverageStore((s) => s.isLoading);

  return (
    <div className="absolute top-4 right-4 z-10 flex flex-col gap-3 w-80">
      {/* Main control panel */}
      <div
        className="rounded-2xl border shadow-2xl p-4 flex flex-col gap-4"
        style={{
          background: 'var(--panel-bg)',
          borderColor: 'var(--panel-border)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-zinc-50">Airframes Coverage</h1>
            {isLoading && (
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>
          <button
            onClick={() => setPanelCollapsed(!panelCollapsed)}
            className="text-zinc-500 hover:text-zinc-300 text-xs font-mono transition-colors"
          >
            {panelCollapsed ? 'expand' : 'collapse'}
          </button>
        </div>

        {!panelCollapsed && (
          <>
            <ModeToggle />
            <TransportFilter />
            <TimeSlider />
            <CoverageLegend />
          </>
        )}
      </div>

      {/* Stats bar (always visible) */}
      <StatsBar />
    </div>
  );
}
