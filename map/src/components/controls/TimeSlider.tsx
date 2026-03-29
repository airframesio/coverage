'use client';

import { useUIStore } from '@/lib/stores/ui-store';
import { TIME_WINDOWS, type TimeWindowKey } from '@/lib/constants/time-windows';

export default function TimeSlider() {
  const timeWindow = useUIStore((s) => s.timeWindow);
  const setTimeWindow = useUIStore((s) => s.setTimeWindow);

  const currentIndex = TIME_WINDOWS.findIndex((w) => w.key === timeWindow);
  const maxIndex = TIME_WINDOWS.length - 1;

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
        Time Window
      </label>

      <div className="px-1">
        <input
          type="range"
          min={0}
          max={maxIndex}
          step={1}
          value={currentIndex >= 0 ? currentIndex : 2}
          onChange={(e) => {
            const idx = parseInt(e.target.value, 10);
            setTimeWindow(TIME_WINDOWS[idx].key as TimeWindowKey);
          }}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer
            bg-zinc-700 accent-emerald-400
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-400
            [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(52,211,153,0.4)]
            [&::-webkit-slider-thumb]:cursor-pointer"
        />

        {/* Labels positioned to match slider stops */}
        <div className="relative h-4 mt-1">
          {TIME_WINDOWS.map((w, i) => {
            const pct = (i / maxIndex) * 100;
            return (
              <button
                key={w.key}
                onClick={() => setTimeWindow(w.key as TimeWindowKey)}
                className={`absolute text-[10px] font-mono transition-colors -translate-x-1/2 ${
                  w.key === timeWindow
                    ? 'text-zinc-50 font-bold'
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
                style={{ left: `${pct}%` }}
              >
                {w.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
