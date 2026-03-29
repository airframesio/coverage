'use client';

import { useState, useEffect } from 'react';

const SHORTCUTS = [
  { key: 'H', desc: 'Hex grid mode' },
  { key: 'P', desc: 'Polygon mode' },
  { key: 'F', desc: 'Fullscreen' },
  { key: '3', desc: '3D pitch toggle' },
  { key: '[ ,', desc: 'Shorter time window' },
  { key: '] .', desc: 'Longer time window' },
  { key: 'Esc', desc: 'Deselect' },
  { key: '?', desc: 'This help' },
];

export default function KeyboardHelp() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === '?') setShow((s) => !s);
      if (e.key === 'Escape' && show) setShow(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [show]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="rounded-2xl border shadow-2xl p-6 w-80"
        style={{
          background: 'var(--panel-bg)',
          borderColor: 'var(--panel-border)',
          backdropFilter: 'blur(24px)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShow(false)}
            className="text-zinc-500 hover:text-zinc-300 text-lg"
          >
            &times;
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {SHORTCUTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between">
              <span className="text-xs text-zinc-400">{s.desc}</span>
              <kbd className="text-[10px] font-mono bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-600 mt-4 text-center">
          Press <kbd className="font-mono bg-zinc-800 px-1 rounded">?</kbd> to close
        </p>
      </div>
    </div>
  );
}
