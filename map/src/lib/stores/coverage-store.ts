import { create } from 'zustand';
import type { CoverageHex, CoveragePolygon, Station, CoverageStats } from '../types/coverage';

interface CoverageState {
  hexData: CoverageHex[];
  /** Coverage area for the loaded window, from the service. Null when the service did not report one. */
  coverageAreaKm2: number | null;
  polygonData: CoveragePolygon[];
  stations: Station[];
  stats: CoverageStats | null;
  /** True only during the very first fetch (before we have any data) */
  initialLoading: boolean;
  /** True during any background refresh */
  refreshing: boolean;
  lastUpdated: Date | null;

  setHexData: (data: CoverageHex[], coverageAreaKm2?: number | null) => void;
  setPolygonData: (data: CoveragePolygon[]) => void;
  setStations: (stations: Station[]) => void;
  setStats: (stats: CoverageStats) => void;
  setRefreshing: (refreshing: boolean) => void;
}

export const useCoverageStore = create<CoverageState>((set) => ({
  hexData: [],
  coverageAreaKm2: null,
  polygonData: [],
  stations: [],
  stats: null,
  initialLoading: true,
  refreshing: false,
  lastUpdated: null,

  setHexData: (hexData, coverageAreaKm2 = null) => set({ hexData, coverageAreaKm2, lastUpdated: new Date(), initialLoading: false, refreshing: false }),
  setPolygonData: (polygonData) => set({ polygonData, lastUpdated: new Date() }),
  setStations: (stations) => set({ stations }),
  setStats: (stats) => set({ stats }),
  setRefreshing: (refreshing) => set({ refreshing }),
}));
