import { create } from 'zustand';
import type { CoverageHex, CoveragePolygon, Station, CoverageStats } from '../types/coverage';

interface CoverageState {
  hexData: CoverageHex[];
  polygonData: CoveragePolygon[];
  stations: Station[];
  stats: CoverageStats | null;
  /** True only during the very first fetch (before we have any data) */
  initialLoading: boolean;
  /** True during any background refresh */
  refreshing: boolean;
  lastUpdated: Date | null;

  setHexData: (data: CoverageHex[]) => void;
  setPolygonData: (data: CoveragePolygon[]) => void;
  setStations: (stations: Station[]) => void;
  setStats: (stats: CoverageStats) => void;
  setRefreshing: (refreshing: boolean) => void;
}

export const useCoverageStore = create<CoverageState>((set, get) => ({
  hexData: [],
  polygonData: [],
  stations: [],
  stats: null,
  initialLoading: true,
  refreshing: false,
  lastUpdated: null,

  setHexData: (hexData) => set({ hexData, lastUpdated: new Date(), initialLoading: false, refreshing: false }),
  setPolygonData: (polygonData) => set({ polygonData, lastUpdated: new Date() }),
  setStations: (stations) => set({ stations }),
  setStats: (stats) => set({ stats }),
  setRefreshing: (refreshing) => set({ refreshing }),
}));
