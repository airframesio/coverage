'use client';

const SOURCES = [
  { type: 'acars', label: 'ACARS', color: '#34d399' },
  { type: 'vdl', label: 'VDL2', color: '#60a5fa' },
  { type: 'hfdl', label: 'HFDL', color: '#818cf8' },
  { type: 'satcom', label: 'SATCOM', color: '#a78bfa' },
  { type: 'ais', label: 'AIS', color: '#fb923c' },
];

export default function SourceLegend() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {SOURCES.map((s) => (
        <div key={s.type} className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
          <span className="text-[9px] font-mono text-zinc-500">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
