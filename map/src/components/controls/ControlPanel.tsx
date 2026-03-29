'use client';

import Image from 'next/image';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import ModeToggle from './ModeToggle';
import TimeSlider from './TimeSlider';
import CoverageLegend from './CoverageLegend';
import StatsBar from './StatsBar';
import TransportFilter from './TransportFilter';
import TopStations from './TopStations';

export default function ControlPanel() {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useUIStore((s) => s.setPanelCollapsed);
  const refreshing = useCoverageStore((s) => s.refreshing);
  const initialLoading = useCoverageStore((s) => s.initialLoading);

  return (
    <>
      {/* Logo - top left */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3">
        <div
          className="rounded-xl border px-3 py-2 flex items-center gap-2.5"
          style={{
            background: 'var(--panel-bg)',
            borderColor: 'var(--panel-border)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
        >
          <Image src="/airframes-logo.svg" alt="Airframes" width={120} height={19} className="flex-shrink-0" priority />
          <span className="text-[9px] font-mono font-bold text-emerald-400 uppercase tracking-widest leading-none self-center mt-[3px]">
            Coverage
          </span>
        </div>
      </div>

      {/* Controls - top right */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-3 w-80">
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
              <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">Controls</span>
              {(refreshing || initialLoading) && (
                <div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  style={{
                    animation: 'pulse-dot 1.5s ease-in-out infinite',
                  }}
                />
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

        <StatsBar />
        <TopStations />
      </div>
    </>
  );
}
