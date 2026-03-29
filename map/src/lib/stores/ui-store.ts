import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TimeWindowKey } from '../constants/time-windows';

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

interface UIState {
  mode: 'hexgrid' | 'polygon';
  timeWindow: TimeWindowKey;
  transportFilter: 'all' | 'aircraft' | 'marine';
  selectedStationId: number | null;
  panelCollapsed: boolean;
  viewState: ViewState;

  setMode: (mode: UIState['mode']) => void;
  setTimeWindow: (tw: TimeWindowKey) => void;
  setTransportFilter: (tf: UIState['transportFilter']) => void;
  selectStation: (id: number | null) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setViewState: (vs: ViewState) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mode: 'hexgrid',
      timeWindow: '1h',
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

      setMode: (mode) => set({ mode }),
      setTimeWindow: (timeWindow) => set({ timeWindow }),
      setTransportFilter: (transportFilter) => set({ transportFilter }),
      selectStation: (selectedStationId) => set({ selectedStationId }),
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      setViewState: (viewState) => set({ viewState }),
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
