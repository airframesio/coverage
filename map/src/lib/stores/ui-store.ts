import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_TIME_WINDOW, TIME_WINDOWS } from '../constants/time-windows';
import type { TimeWindowKey } from '../constants/time-windows';
import type { MapStyleId } from '../constants/map-styles';
import type { DensityStyle } from '../constants/density';
import { MODES, type ModeKey } from '../constants/modes';

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

export type ViewMode = 'hexgrid' | 'polygon' | 'density';

interface UIState {
  mode: ViewMode;
  timeWindow: TimeWindowKey;
  transportFilter: 'all' | 'aircraft' | 'marine';
  /** Radio modes shown; every mode by default */
  modes: ModeKey[];
  selectedStationId: number | null;
  /** Station of the polygon clicked on the map (its card is open), if any */
  polygonStationId: number | null;
  /** Show only the selected station and hide the others (all views) */
  onlySelected: boolean;
  /** Density view: colored bands, or one smooth gradient */
  densityStyle: DensityStyle;
  panelCollapsed: boolean;
  viewState: ViewState;
  flyToTarget: FlyToTarget | null;
  searchQuery: string;
  fullscreen: boolean;
  pitch3d: boolean;
  mapStyleId: MapStyleId;
  helpOpen: boolean;

  setMode: (mode: UIState['mode']) => void;
  setTimeWindow: (tw: TimeWindowKey) => void;
  setTransportFilter: (tf: UIState['transportFilter']) => void;
  setModes: (modes: ModeKey[]) => void;
  toggleMode: (mode: ModeKey) => void;
  selectStation: (id: number | null) => void;
  setPolygonStationId: (id: number | null) => void;
  setOnlySelected: (on: boolean) => void;
  toggleOnlySelected: () => void;
  setDensityStyle: (style: DensityStyle) => void;
  setPanelCollapsed: (collapsed: boolean) => void;
  setViewState: (vs: ViewState) => void;
  flyTo: (target: FlyToTarget) => void;
  clearFlyTo: () => void;
  setSearchQuery: (q: string) => void;
  toggleFullscreen: () => void;
  togglePitch3d: () => void;
  setMapStyleId: (id: MapStyleId) => void;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      mode: 'hexgrid',
      timeWindow: DEFAULT_TIME_WINDOW,
      transportFilter: 'all',
      modes: [...MODES],
      selectedStationId: null,
      polygonStationId: null,
      onlySelected: false,
      densityStyle: 'bands' as DensityStyle,
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
      mapStyleId: 'dark-matter' as MapStyleId,
      helpOpen: false,

      setMode: (mode) => set({ mode }),
      setTimeWindow: (timeWindow) => set({ timeWindow }),
      // Choosing All shows every mode again
      setTransportFilter: (transportFilter) => set(
        transportFilter === 'all' ? { transportFilter, modes: [...MODES] } : { transportFilter },
      ),
      setModes: (modes) => set({ modes }),
      toggleMode: (mode) => set((s) => ({
        modes: s.modes.includes(mode)
          ? s.modes.filter((m) => m !== mode)
          : MODES.filter((m) => m === mode || s.modes.includes(m)),
      })),
      selectStation: (selectedStationId) => set({ selectedStationId }),
      setPolygonStationId: (polygonStationId) => set({ polygonStationId }),
      setOnlySelected: (onlySelected) => set({ onlySelected }),
      toggleOnlySelected: () => set((s) => ({ onlySelected: !s.onlySelected })),
      setDensityStyle: (densityStyle) => set({ densityStyle }),
      setPanelCollapsed: (panelCollapsed) => set({ panelCollapsed }),
      setViewState: (viewState) => set({ viewState }),
      flyTo: (flyToTarget) => set({ flyToTarget }),
      clearFlyTo: () => set({ flyToTarget: null }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      toggleFullscreen: () => set((s) => ({ fullscreen: !s.fullscreen })),
      togglePitch3d: () => set((s) => ({ pitch3d: !s.pitch3d })),
      setMapStyleId: (mapStyleId) => set({ mapStyleId }),
      setHelpOpen: (helpOpen) => set({ helpOpen }),
      toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
    }),
    {
      name: 'airframes-coverage-ui',
      partialize: (state) => ({
        mode: state.mode,
        timeWindow: state.timeWindow,
        transportFilter: state.transportFilter,
        modes: state.modes,
        mapStyleId: state.mapStyleId,
        onlySelected: state.onlySelected,
        densityStyle: state.densityStyle,
      }),
      // A saved window may use a key that no longer exists (the one-month
      // window was once saved as '1M'). Map it across, or fall back to the default.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<UIState>;
        const savedKey: string | undefined = saved.timeWindow;
        const key = savedKey === '1M' ? '1mo' : savedKey;
        const timeWindow = TIME_WINDOWS.find((w) => w.key === key)?.key ?? current.timeWindow;
        const modes = Array.isArray(saved.modes)
          ? MODES.filter((m) => saved.modes!.includes(m))
          : current.modes;
        return { ...current, ...saved, timeWindow, modes };
      },
    }
  )
);
