import { create } from 'zustand';
import type { CoverageHex, CoveragePolygon, Station, CoverageStats } from '../types/coverage';

interface CoverageState {
  hexData: CoverageHex[];
  polygonData: CoveragePolygon[];
  stations: Station[];
  stats: CoverageStats | null;
  isLoading: boolean;
  lastUpdated: Date | null;

  setHexData: (data: CoverageHex[]) => void;
  setPolygonData: (data: CoveragePolygon[]) => void;
  setStations: (stations: Station[]) => void;
  setStats: (stats: CoverageStats) => void;
  setLoading: (loading: boolean) => void;
}

export const useCoverageStore = create<CoverageState>((set) => ({
  hexData: [],
  polygonData: [],
  stations: [],
  stats: null,
  isLoading: false,
  lastUpdated: null,

  setHexData: (hexData) => set({ hexData, lastUpdated: new Date(), isLoading: false }),
  setPolygonData: (polygonData) => set({ polygonData, lastUpdated: new Date() }),
  setStations: (stations) => set({ stations }),
  setStats: (stats) => set({ stats }),
  setLoading: (isLoading) => set({ isLoading }),
}));
