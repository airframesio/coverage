'use client';

import { sourceColor, sourceLabel } from '@/lib/constants/colors';

const SOURCES = ['acars', 'vdl', 'hfdl', 'satcom', 'ais'];

export default function SourceLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {SOURCES.map((type) => (
        <div key={type} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: sourceColor(type) }} />
          <span className="text-[9px] font-mono text-zinc-500">{sourceLabel(type)}</span>
        </div>
      ))}
    </div>
  );
}
