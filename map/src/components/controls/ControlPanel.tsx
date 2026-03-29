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
  const fullscreen = useUIStore((s) => s.fullscreen);
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen);
  const pitch3d = useUIStore((s) => s.pitch3d);
  const togglePitch3d = useUIStore((s) => s.togglePitch3d);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in search
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case 'h': setMode('hexgrid'); break;
        case 'p': setMode('polygon'); break;
        case 'f': toggleFullscreen(); break;
        case '3': togglePitch3d(); break;
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
  }, [setMode, timeWindow, setTimeWindow, selectStation, toggleFullscreen, togglePitch3d]);

  if (fullscreen) {
    // Minimal UI in fullscreen: just the logo and an exit hint
    return (
      <>
        <div className="absolute top-4 left-4 z-10">
          <div
            className="rounded-xl border px-3 py-2 flex items-center gap-2.5 opacity-40 hover:opacity-100 transition-opacity"
            style={{
              background: 'var(--panel-bg)',
              borderColor: 'var(--panel-border)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
          >
            <Image src="/airframes-logo.svg" alt="Airframes" width={100} height={16} priority />
            <span className="text-[8px] font-mono text-zinc-500">F to exit</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Logo + toolbar - top left */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
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

        {/* Toolbar buttons */}
        <div
          className="rounded-lg border flex items-center gap-0.5 p-0.5"
          style={{
            background: 'var(--panel-bg)',
            borderColor: 'var(--panel-border)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
          }}
        >
          <ToolbarButton
            label="3D"
            active={pitch3d}
            onClick={togglePitch3d}
            title="Toggle 3D pitch (3)"
          />
          <ToolbarButton
            label="⛶"
            active={false}
            onClick={toggleFullscreen}
            title="Fullscreen (F)"
          />
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

function ToolbarButton({
  label, active, onClick, title,
}: {
  label: string; active: boolean; onClick: () => void; title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`px-2 py-1 rounded-md text-[10px] font-mono font-bold transition-all ${
        active
          ? 'bg-emerald-900/50 text-emerald-400 ring-1 ring-emerald-500/30'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40'
      }`}
    >
      {label}
    </button>
  );
}
