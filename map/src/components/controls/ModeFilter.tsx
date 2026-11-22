'use client';

import { useUIStore } from '@/lib/stores/ui-store';
import { sourceColor, sourceLabel } from '@/lib/constants/colors';
import { modesForTransport } from '@/lib/constants/modes';

/**
 * Checkboxes for the radio modes of the current transport filter. They are
 * also the legend for the station marker colors. Choosing All in the
 * transport filter checks every mode again.
 */
export default function ModeFilter() {
  const transportFilter = useUIStore((s) => s.transportFilter);
  const modes = useUIStore((s) => s.modes);
  const toggleMode = useUIStore((s) => s.toggleMode);
  const visible = modesForTransport(transportFilter);

  return (
    <fieldset className="flex flex-wrap gap-x-3 gap-y-1.5">
      <legend className="sr-only">Modes shown</legend>
      {visible.map((mode) => {
        const checked = modes.includes(mode);
        const color = sourceColor(mode);
        return (
          <label
            key={mode}
            className={`flex items-center gap-1.5 cursor-pointer select-none text-[10px] font-mono transition-colors ${
              checked ? 'text-zinc-300' : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggleMode(mode)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className="w-3 h-3 rounded-[3px] flex items-center justify-center peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-zinc-300"
              style={{
                background: checked ? color : 'transparent',
                boxShadow: `inset 0 0 0 1px ${color}`,
              }}
            >
              {checked && (
                <svg viewBox="0 0 12 12" className="w-2.5 h-2.5" fill="none" stroke="#09090b" strokeWidth="2">
                  <path d="M2.5 6.2 5 8.5 9.5 3.5" />
                </svg>
              )}
            </span>
            {sourceLabel(mode)}
          </label>
        );
      })}
    </fieldset>
  );
}
