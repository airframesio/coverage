import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_TIME_WINDOW } from '../constants/time-windows';
import type { TimeWindowKey } from '../constants/time-windows';

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

interface FlyToTarget {
  longitude: number;
  latitude: number;
  zoom: number;
}

interface UIState {
  mode: 'hexgrid' | 'polygon';
  timeWindow: TimeWindowKey;
  transportFilter: 'all' | 'aircraft' | 'marine';
  selectedStationId: number | null;
  panelCollapsed: boolean;
  viewState: ViewState;
  flyToTarget: FlyToTarget | null;
  searchQuery: string;
  fullscreen: boolean;
  pitch3d: boolean;

  setMode: (mode: UIState['mode']) => void;
  setTimeWindow: (tw: TimeWindowKey) => void;
  setTransportFilter: (tf: UIState['transportFilter']) => void;
  selectStation: (id: number | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setViewState: (vs: ViewState) => void;
  flyTo: (target: FlyToTarget) => void;
  clearFlyTo: () => void;
  setSearchQuery: (q: string) => void;
  toggleFullscreen: () => void;
  togglePitch3d: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mode: 'hexgrid',
      timeWindow: DEFAULT_TIME_WINDOW,
      transportFilter: 'all',
      selectedStationId: null,
      panelCollapsed: false,
      viewState: {
        longitude: -40,
        latitude: 30,
        zoom: 2.5,
        pitch: 0,
        bearing: 0,
      },
      flyToTarget: null,
      searchQuery: '',
      fullscreen: false,
      pitch3d: false,

      setMode: (mode) => set({ mode }),
      setTimeWindow: (timeWindow) => set({ timeWindow }),
      setTransportFilter: (transportFilter) => set({ transportFilter }),
      selectStation: (selectedStationId) => set({ selectedStationId }),
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      setViewState: (viewState) => set({ viewState }),
      flyTo: (flyToTarget) => set({ flyToTarget }),
      clearFlyTo: () => set({ flyToTarget: null }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
      togglePitch3d: () => set((s) => ({ pitch3d: !s.pitch3d })),
    }),
    {
      name: 'airframes-coverage-ui',
      partialize: (state) => ({
        mode: state.mode,
        timeWindow: state.timeWindow,
        transportFilter: state.transportFilter,
      }),
    }
  )
);
