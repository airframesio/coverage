'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { TIME_WINDOWS, type TimeWindowKey } from '@/lib/constants/time-windows';
import ModeToggle from './ModeToggle';
import TimeSlider from './TimeSlider';
import CoverageLegend from './CoverageLegend';
import SourceLegend from './SourceLegend';
import StatsBar from './StatsBar';
import TransportFilter from './TransportFilter';
import TopStations from './TopStations';

export default function ControlPanel() {
  const panelCollapsed = useUIStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useUIStore((s) => s.setPanelCollapsed);
  const refreshing = useCoverageStore((s) => s.refreshing);
  const initialLoading = useCoverageStore((s) => s.initialLoading);
  const setMode = useUIStore((s) => s.setMode);
  const mode = useUIStore((s) => s.mode);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const setTimeWindow = useUIStore((s) => s.setTimeWindow);
  const selectStation = useUIStore((s) => s.selectStation);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in search
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'h': setMode('hexgrid'); break;
        case 'p': setMode('polygon'); break;
        case 'Escape': selectStation(null); break;
        case '[': case ',': {
          const idx = TIME_WINDOWS.findIndex((w) => w.key === timeWindow);
          if (idx > 0) setTimeWindow(TIME_WINDOWS[idx - 1].key as TimeWindowKey);
          break;
        }
        case ']': case '.': {
          const idx = TIME_WINDOWS.findIndex((w) => w.key === timeWindow);
          if (idx < TIME_WINDOWS.length - 1) setTimeWindow(TIME_WINDOWS[idx + 1].key as TimeWindowKey);
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setMode, timeWindow, setTimeWindow, selectStation]);

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
              <SourceLegend />
            </>
          )}
        </div>

        <StatsBar />
        <TopStations />
      </div>
    </>
  );
}
