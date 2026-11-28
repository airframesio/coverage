'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CONFIG, zoomToH3Resolution } from '@/lib/constants/map-config';
import { MAP_STYLES, LIGHT_MAP_STYLES } from '@/lib/constants/map-styles';
import { H3_CELL_WIDTH_KM, type ShadedCell } from '@/lib/constants/density';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { createHexGridLayer } from './layers/hex-grid-layer';
import { createPolygonLayer } from './layers/polygon-layer';
import { createDensityLayer, createDensityOutlineLayer } from './layers/density-layer';
import { createStationMarkersLayer } from './layers/station-markers-layer';
import ControlPanel from '@/components/controls/ControlPanel';
import ConnectionBanner from '@/components/controls/ConnectionBanner';
import ActivityTicker from '@/components/controls/ActivityTicker';
import KeyboardHelp from '@/components/controls/KeyboardHelp';
import StationPopup from '@/components/station/StationPopup';
import HexPopup from '@/components/map/HexPopup';
import PolygonPopup from '@/components/map/PolygonPopup';
import { useUrlState } from '@/lib/hooks/use-url-state';
import type { CoverageHex, CoveragePolygon, Station, StationDensity } from '@/lib/types/coverage';
import { modesParam } from '@/lib/constants/modes';

const POLL_INTERVAL = 10_000;
const STATS_INTERVAL = 5_000;
const ZOOM_DEBOUNCE = 800;

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

function DeckGLOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true }));
  overlay.setProps(props);
  return null;
}

export default function CoverageMap() {
  useUrlState();

  const [viewState, setLocalViewState] = useState({
    longitude: MAP_CONFIG.initialViewState.longitude as number,
    latitude: MAP_CONFIG.initialViewState.latitude as number,
    zoom: MAP_CONFIG.initialViewState.zoom as number,
    pitch: MAP_CONFIG.initialViewState.pitch as number,
    bearing: MAP_CONFIG.initialViewState.bearing as number,
  });

  const mode = useUIStore((s) => s.mode);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const transportFilter = useUIStore((s) => s.transportFilter);
  const selectedModes = useUIStore((s) => s.modes);
  const modes = modesParam(selectedModes, transportFilter);
  const setViewState = useUIStore((s) => s.setViewState);
  const selectedStationId = useUIStore((s) => s.selectedStationId);
  const selectStation = useUIStore((s) => s.selectStation);
  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const clearFlyTo = useUIStore((s) => s.clearFlyTo);
  const pitch3d = useUIStore((s) => s.pitch3d);
  const fullscreen = useUIStore((s) => s.fullscreen);
  const mapStyleId = useUIStore((s) => s.mapStyleId);
  const onlySelected = useUIStore((s) => s.onlySelected);
  const densityStyle = useUIStore((s) => s.densityStyle);
  const lightBasemap = LIGHT_MAP_STYLES.has(mapStyleId);

  const mapStyleUrl = MAP_STYLES.find((s) => s.id === mapStyleId)?.url ?? MAP_STYLES[0].url;

  const hexData = useCoverageStore((s) => s.hexData);
  const polygonData = useCoverageStore((s) => s.polygonData);
  const densityData = useCoverageStore((s) => s.densityData);
  const setDensityData = useCoverageStore((s) => s.setDensityData);
  const stations = useCoverageStore((s) => s.stations);
  const setHexData = useCoverageStore((s) => s.setHexData);
  const setPolygonData = useCoverageStore((s) => s.setPolygonData);
  const setStations = useCoverageStore((s) => s.setStations);
  const setStats = useCoverageStore((s) => s.setStats);
  const setRefreshing = useCoverageStore((s) => s.setRefreshing);

  const [h3Resolution, setH3Resolution] = useState(() => zoomToH3Resolution(viewState.zoom));
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedHex, setSelectedHex] = useState<CoverageHex | null>(null);
  const [selectedPolygon, setSelectedPolygon] = useState<CoveragePolygon | null>(null);
  const mapRef = useRef<MapRef>(null);

  // The station the views focus on: picked from the list or a marker, or by
  // clicking its polygon
  const focusStationId = selectedStationId ?? selectedPolygon?.stationId ?? null;
  const setPolygonStationId = useUIStore((s) => s.setPolygonStationId);
  useEffect(() => {
    setPolygonStationId(selectedPolygon?.stationId ?? null);
  }, [selectedPolygon, setPolygonStationId]);

  // Handle flyTo requests from UI (e.g. clicking station in top stations list)
  useEffect(() => {
    if (flyToTarget && mapRef.current) {
      mapRef.current.flyTo({
        center: [flyToTarget.longitude, flyToTarget.latitude],
        zoom: flyToTarget.zoom,
        duration: 1500,
      });
      clearFlyTo();
    }
  }, [flyToTarget, clearFlyTo]);

  // Handle 3D pitch toggle
  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.easeTo({
        pitch: pitch3d ? 50 : 0,
        duration: 800,
      });
    }
  }, [pitch3d]);

  // A shared link asks to fly before the map exists; do it once the map loads
  const onLoad = useCallback(() => {
    const target = useUIStore.getState().flyToTarget;
    if (!target || !mapRef.current) return;
    mapRef.current.jumpTo({ center: [target.longitude, target.latitude], zoom: target.zoom });
    clearFlyTo();
  }, [clearFlyTo]);

  const onMove = useCallback((evt: { viewState: typeof viewState }) => {
    setLocalViewState(evt.viewState);
  }, []);

  const onMoveEnd = useCallback((evt: { viewState: typeof viewState }) => {
    setViewState(evt.viewState);
    clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(() => {
      setH3Resolution(zoomToH3Resolution(evt.viewState.zoom));
    }, ZOOM_DEBOUNCE);
  }, [setViewState]);

  // ── Data fetching ──

  const fetchCoverage = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true);
    try {
      const params = new URLSearchParams({
        window: timeWindow,
        resolution: String(h3Resolution),
        transport: transportFilter,
      });
      if (modes) params.set('modes', modes);
      const res = await fetch(`${API_URL}/api/v1/coverage/h3?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHexData(
          data.cells ?? [],
          typeof data.coverageAreaKm2 === 'number' ? data.coverageAreaKm2 : null,
        );
      }
    } catch { /* retry next interval */ }
  }, [timeWindow, h3Resolution, transportFilter, modes, setHexData, setRefreshing]);

  // One request for every station's polygon (the service builds them in one pass)
  const fetchPolygons = useCallback(async () => {
    try {
      const params = new URLSearchParams({ window: timeWindow });
      if (transportFilter !== 'all') params.set('transport', transportFilter);
      if (modes) params.set('modes', modes);
      const res = await fetch(`${API_URL}/api/v1/coverage/polygons?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const polygons: CoveragePolygon[] = (data.polygons ?? []).map((p: CoveragePolygon) => ({
        stationId: p.stationId,
        ident: p.ident,
        coordinates: p.coordinates,
        confidence: p.confidence || 0.5,
        messageCount: p.messageCount,
        sourceType: p.sourceType,
      }));
      setPolygonData(polygons);
    } catch { /* retry next interval */ }
  }, [timeWindow, transportFilter, modes, setPolygonData]);

  const fetchStations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ window: timeWindow });
      if (transportFilter !== 'all') params.set('transport', transportFilter);
      if (modes) params.set('modes', modes);
      const res = await fetch(`${API_URL}/api/v1/stations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setStations(data.stations ?? []);
      }
    } catch { /* retry next interval */ }
  }, [timeWindow, transportFilter, modes, setStations]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/stats`);
      if (res.ok) setStats(await res.json());
    } catch { /* ignore */ }
  }, [setStats]);

  // Initial fetch + re-fetch when params change
  useEffect(() => {
    fetchCoverage(false);
    fetchStations();
  }, [fetchCoverage, fetchStations]);

  // One station's reception density, for the Density view
  const fetchDensity = useCallback(async () => {
    if (focusStationId === null) return;
    try {
      const params = new URLSearchParams({ window: timeWindow });
      if (transportFilter !== 'all') params.set('transport', transportFilter);
      const res = await fetch(`${API_URL}/api/v1/coverage/stations/${focusStationId}/density?${params}`);
      if (res.status === 404) {
        setDensityData(null);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setDensityData({ ...(data as StationDensity), window: timeWindow });
    } catch { /* retry next interval */ }
  }, [focusStationId, timeWindow, transportFilter, setDensityData]);

  // Polygons are shown in the Polygons view and around the density
  const wantsPolygons = mode !== 'hexgrid';
  const wantsDensity = mode === 'density' && focusStationId !== null;

  // Fetch polygons when the view switches to polygons or the window/filter changes
  useEffect(() => {
    if (wantsPolygons) fetchPolygons();
  }, [wantsPolygons, fetchPolygons]);

  useEffect(() => {
    if (wantsDensity) fetchDensity();
  }, [wantsDensity, fetchDensity]);

  // Periodic silent refresh
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCoverage(true);
      fetchStations();
      if (wantsPolygons) fetchPolygons();
      if (wantsDensity) fetchDensity();
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCoverage, fetchStations, fetchPolygons, fetchDensity, wantsPolygons, wantsDensity]);

  // Stats on faster interval
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, STATS_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── Deck.gl layers ──

  // "Only selected station" applies once there is a station to show
  const solo = onlySelected && focusStationId !== null;

  const layers = useMemo(() => {
    const result = [];
    if (mode === 'hexgrid') {
      result.push(createHexGridLayer(
        solo ? hexData.filter((c) => c.stationIds?.includes(focusStationId!)) : hexData,
      ));
    } else if (mode === 'polygon' || focusStationId === null) {
      result.push(createPolygonLayer(
        solo ? polygonData.filter((p) => p.stationId === focusStationId) : polygonData,
        focusStationId,
      ));
    } else {
      // Density: the other stations stay as quiet, clickable context
      if (!solo) {
        result.push(createPolygonLayer(
          polygonData.filter((p) => p.stationId !== focusStationId), null, true,
        ));
      }
      if (densityData && densityData.stationId === focusStationId && densityData.window === timeWindow) {
        result.push(createDensityLayer(densityData, densityStyle, lightBasemap));
      }
      const outline = polygonData.find((p) => p.stationId === focusStationId);
      if (outline) result.push(createDensityOutlineLayer(outline, lightBasemap));
    }
    result.push(createStationMarkersLayer(
      solo ? stations.filter((s) => s.id === focusStationId) : stations,
      focusStationId,
    ));
    return result;
  }, [mode, hexData, polygonData, densityData, densityStyle, lightBasemap, stations, focusStationId, solo, timeWindow]);

  const getTooltip = useCallback(({ object, layer }: PickingInfo) => {
    if (!object) return null;

    if (layer?.id === 'coverage-hexgrid') {
      const hex = object as CoverageHex;
      const lines = [
        `${hex.msgCount.toLocaleString()} messages`,
        `Confidence: ${(hex.confidence * 100).toFixed(0)}%`,
        hex.maxDistance > 0 ? `Max range: ${hex.maxDistance.toFixed(0)} km` : null,
        `${hex.stationCount} station${hex.stationCount !== 1 ? 's' : ''}`,
        `Sources: ${hex.sources.join(', ')}`,
      ].filter(Boolean);
      return { className: 'deck-tooltip', text: lines.join('\n') };
    }

    if (layer?.id === 'station-markers') {
      const station = object as Station;
      const lines = [
        station.ident || `#${station.id}`,
        station.sourceType.toUpperCase(),
        `${station.messageCount.toLocaleString()} messages`,
        station.maxDistance > 0 ? `Range: ${station.maxDistance.toFixed(0)} km` : null,
      ].filter(Boolean);
      return { className: 'deck-tooltip', text: lines.join('\n') };
    }

    if (layer?.id === 'coverage-density') {
      const cell = object as ShadedCell;
      const others = cell.stationCount - 1;
      const width = H3_CELL_WIDTH_KM[useCoverageStore.getState().densityData?.resolution ?? 4];
      const lines = [
        `${cell.msgCount.toLocaleString()} message${cell.msgCount !== 1 ? 's' : ''} here`,
        width ? `Cell about ${width} km wide` : null,
        others > 0 ? `Also heard by ${others} other station${others !== 1 ? 's' : ''}` : 'Only this station hears here',
      ].filter(Boolean);
      return { className: 'deck-tooltip', text: lines.join('\n') };
    }

    if (layer?.id === 'coverage-polygons') {
      const polygon = object as CoveragePolygon;
      return {
        className: 'deck-tooltip',
        text: `${polygon.ident}\n${polygon.messageCount.toLocaleString()} messages\nConfidence: ${(polygon.confidence * 100).toFixed(0)}%`,
      };
    }

    return null;
  }, []);

  const onClick = useCallback((info: PickingInfo) => {
    // Showing one station: clicks on the map keep it (close its card or press
    // Esc to pick another)
    if (onlySelected && focusStationId !== null && info.layer?.id !== 'station-markers') return;
    // A density cell belongs to the focused station; its tooltip says the rest
    if (info.layer?.id === 'coverage-density') return;
    if (info.layer?.id === 'station-markers' && info.object) {
      selectStation((info.object as Station).id);
      setSelectedHex(null);
      setSelectedPolygon(null);
    } else if (info.layer?.id === 'coverage-hexgrid' && info.object) {
      setSelectedHex(info.object as CoverageHex);
      setSelectedPolygon(null);
      selectStation(null);
    } else if (info.layer?.id === 'coverage-polygons' && info.object) {
      setSelectedPolygon(info.object as CoveragePolygon);
      setSelectedHex(null);
      selectStation(null);
    } else {
      selectStation(null);
      setSelectedHex(null);
      setSelectedPolygon(null);
    }
  }, [selectStation, onlySelected, focusStationId]);

  // Escape closes whichever detail popup is open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelectedHex(null);
      setSelectedPolygon(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const selectedStation = stations.find((s) => s.id === selectedStationId) ?? null;

  return (
    <div className="h-screen w-screen relative">
      <Map
        ref={mapRef}
        {...viewState}
        onLoad={onLoad}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        mapStyle={mapStyleUrl}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        minZoom={MAP_CONFIG.minZoom}
        maxZoom={MAP_CONFIG.maxZoom}
      >
        <DeckGLOverlay
          layers={layers}
          getTooltip={getTooltip}
          onClick={onClick}
        />
        <NavigationControl position="bottom-right" />
      </Map>

      <ControlPanel />
      <ConnectionBanner />
      {!fullscreen && <ActivityTicker />}

      {selectedStation && (
        <StationPopup
          station={selectedStation}
          onClose={() => selectStation(null)}
        />
      )}

      {selectedHex && !selectedStation && (
        <HexPopup
          hex={selectedHex}
          onClose={() => setSelectedHex(null)}
        />
      )}

      {selectedPolygon && !selectedStation && !selectedHex && (
        <PolygonPopup
          polygon={selectedPolygon}
          onClose={() => setSelectedPolygon(null)}
        />
      )}

      <KeyboardHelp />
    </div>
  );
}
