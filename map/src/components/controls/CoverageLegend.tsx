'use client';

import { useUIStore } from '@/lib/stores/ui-store';

const HEX_GRADIENT_STOPS = [
  { label: '0%', color: 'rgb(6, 78, 59)' },
  { label: '30%', color: 'rgb(16, 185, 129)' },
  { label: '50%', color: 'rgb(52, 211, 153)' },
  { label: '70%', color: 'rgb(163, 230, 53)' },
  { label: '90%', color: 'rgb(250, 204, 21)' },
  { label: '100%', color: 'rgb(251, 146, 60)' },
];

export default function CoverageLegend() {
  const mode = useUIStore((s) => s.mode);

  if (mode === 'polygon') {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Legend
        </span>
        <p className="text-xs text-zinc-500">
          Each station has a unique color. Brighter overlaps = more coverage.
          Opacity reflects confidence.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
        Coverage Confidence
      </span>
      <div
        className="h-2.5 rounded-full"
        style={{
          background: `linear-gradient(to right, ${HEX_GRADIENT_STOPS.map((s) => s.color).join(', ')})`,
        }}
      />
      <div className="flex justify-between">
        <span className="text-[10px] font-mono text-zinc-600">Low</span>
        <span className="text-[10px] font-mono text-zinc-600">High</span>
      </div>
    </div>
  );
}
