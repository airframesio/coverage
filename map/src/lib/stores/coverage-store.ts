import { create } from 'zustand';
import type { CoverageHex, CoveragePolygon, Station, CoverageStats, StationDensity, AllDensity } from '../types/coverage';

interface CoverageState {
  hexData: CoverageHex[];
  /** Coverage area for the loaded window, from the service. Null when the service did not report one. */
  coverageAreaKm2: number | null;
  polygonData: CoveragePolygon[];
  /** The focused station's density (Density view), null until loaded */
  densityData: StationDensity | null;
  /** Every station's density together (Density view, no station), null until loaded */
  allDensityData: AllDensity | null;
  stations: Station[];
  stats: CoverageStats | null;
  /** True only during the very first fetch (before we have any data) */
  initialLoading: boolean;
  /** True during any background refresh */
  refreshing: boolean;
  lastUpdated: Date | null;

  setHexData: (data: CoverageHex[], coverageAreaKm2?: number | null) => void;
  setPolygonData: (data: CoveragePolygon[]) => void;
  setDensityData: (data: StationDensity | null) => void;
  setAllDensityData: (data: AllDensity | null) => void;
  setStations: (stations: Station[]) => void;
  setStats: (stats: CoverageStats) => void;
  setRefreshing: (refreshing: boolean) => void;
}

export const useCoverageStore = create<CoverageState>((set) => ({
  hexData: [],
  coverageAreaKm2: null,
  polygonData: [],
  densityData: null,
  allDensityData: null,
  stations: [],
  stats: null,
  initialLoading: true,
  refreshing: false,
  lastUpdated: null,

  setHexData: (hexData, coverageAreaKm2 = null) => set({ hexData, coverageAreaKm2, lastUpdated: new Date(), initialLoading: false, refreshing: false }),
  setPolygonData: (polygonData) => set({ polygonData, lastUpdated: new Date() }),
  setDensityData: (densityData) => set({ densityData }),
  setAllDensityData: (allDensityData) => set({ allDensityData }),
  setStations: (stations) => set({ stations }),
  setStats: (stats) => set({ stats }),
  setRefreshing: (refreshing) => set({ refreshing }),
}));
