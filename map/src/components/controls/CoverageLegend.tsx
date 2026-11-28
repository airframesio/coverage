'use client';

import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { modesParam } from '@/lib/constants/modes';
import {
  DENSITY_BANDS, DENSITY_COLORS, DENSITY_GRADIENT, H3_CELL_WIDTH_KM, densityCountAt, type DensityStyle,
} from '@/lib/constants/density';

const HEX_GRADIENT_STOPS = [
  { label: '0%', color: 'rgb(6, 78, 59)' },
  { label: '30%', color: 'rgb(16, 185, 129)' },
  { label: '50%', color: 'rgb(52, 211, 153)' },
  { label: '70%', color: 'rgb(163, 230, 53)' },
  { label: '90%', color: 'rgb(250, 204, 21)' },
  { label: '100%', color: 'rgb(251, 146, 60)' },
];

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function DensityLegend({ hasStation }: { hasStation: boolean }) {
  const densityData = useCoverageStore((s) => s.densityData);
  const densityStyle = useUIStore((s) => s.densityStyle);
  const setDensityStyle = useUIStore((s) => s.setDensityStyle);
  const timeWindow = useUIStore((s) => s.timeWindow);

  const focusStationId = useUIStore((s) => s.selectedStationId ?? s.polygonStationId);
  const allDensityData = useCoverageStore((s) => s.allDensityData);
  const transportFilter = useUIStore((s) => s.transportFilter);
  const selectedModes = useUIStore((s) => s.modes);
  const allKey = `${timeWindow}|${transportFilter}|${modesParam(selectedModes, transportFilter) ?? ''}`;
  const stationData = hasStation && densityData && densityData.window === timeWindow && densityData.stationId === focusStationId
    ? densityData
    : null;
  const allData = !hasStation && allDensityData && allDensityData.key === allKey && allDensityData.cells.length > 0
    ? allDensityData
    : null;
  const data = stationData ?? allData;
  const max = data?.maxCount ?? 0;
  const width = data ? H3_CELL_WIDTH_KM[data.resolution] : undefined;
  const bandStops = Array.from({ length: DENSITY_BANDS }, (_, i) => {
    const [r, g, b] = DENSITY_COLORS[i];
    const from = (i / DENSITY_BANDS) * 100;
    const to = ((i + 1) / DENSITY_BANDS) * 100;
    return `rgb(${r}, ${g}, ${b}) ${from}%, rgb(${r}, ${g}, ${b}) ${to}%`;
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
          Reception Density
        </span>
        <div className="flex gap-0.5 bg-zinc-800/60 rounded-md p-0.5" role="group" aria-label="Density style">
          {(['bands', 'smooth'] as DensityStyle[]).map((style) => (
            <button
              key={style}
              onClick={() => setDensityStyle(style)}
              aria-pressed={densityStyle === style}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-all ${
                densityStyle === style ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {style === 'bands' ? 'Bands' : 'Smooth'}
            </button>
          ))}
        </div>
      </div>
      <div
        className="h-2.5 rounded-full"
        style={{
          background: densityStyle === 'bands'
            ? `linear-gradient(to right, ${bandStops.join(', ')})`
            : DENSITY_GRADIENT,
        }}
      />
      <div className="flex justify-between">
        <span className="text-[10px] font-mono text-zinc-500">{data ? '1' : 'Fewer'}</span>
        {data && max > 10 && (
          <span className="text-[10px] font-mono text-zinc-500">{compact(densityCountAt(0.5, max))}</span>
        )}
        <span className="text-[10px] font-mono text-zinc-500">{data ? compact(max) : 'More'}</span>
      </div>
      {hasStation ? (
        <p className="text-xs text-zinc-500">
          Messages {stationData ? <>from <span className="font-mono text-zinc-400">{stationData.ident}</span></> : 'from the station'} per
          {width ? ` ${width} km` : ''} cell, log scale. Empty inside the outline means nothing was heard there.
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Messages from all stations per{width ? ` ${width} km` : ''} cell, log scale. Select a station
          (its marker or a row in the list) to see only where it hears.
        </p>
      )}
    </div>
  );
}

export default function CoverageLegend({ hasStation = false }: { hasStation?: boolean }) {
  const mode = useUIStore((s) => s.mode);

  if (mode === 'density') return <DensityLegend hasStation={hasStation} />;

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
