'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { PickingInfo } from '@deck.gl/core';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CONFIG, zoomToH3Resolution } from '@/lib/constants/map-config';
import { MAP_STYLES } from '@/lib/constants/map-styles';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { createHexGridLayer } from './layers/hex-grid-layer';
import { createPolygonLayer } from './layers/polygon-layer';
import { createStationMarkersLayer } from './layers/station-markers-layer';
import ControlPanel from '@/components/controls/ControlPanel';
import ConnectionBanner from '@/components/controls/ConnectionBanner';
import ActivityTicker from '@/components/controls/ActivityTicker';
import KeyboardHelp from '@/components/controls/KeyboardHelp';
import StationPopup from '@/components/station/StationPopup';
import HexPopup from '@/components/map/HexPopup';
import PolygonPopup from '@/components/map/PolygonPopup';
import { useUrlState } from '@/lib/hooks/use-url-state';
import type { CoverageHex, CoveragePolygon, Station } from '@/lib/types/coverage';
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

  const mapStyleUrl = MAP_STYLES.find((s) => s.id === mapStyleId)?.url ?? MAP_STYLES[0].url;

  const hexData = useCoverageStore((s) => s.hexData);
  const polygonData = useCoverageStore((s) => s.polygonData);
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

  // Fetch polygons when the view switches to polygons or the window/filter changes
  useEffect(() => {
    if (mode === 'polygon') fetchPolygons();
  }, [mode, fetchPolygons]);

  // Periodic silent refresh
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCoverage(true);
      fetchStations();
      if (mode === 'polygon') fetchPolygons();
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCoverage, fetchStations, fetchPolygons, mode]);

  // Stats on faster interval
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, STATS_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── Deck.gl layers ──

  const selectedPolygonStationId = selectedPolygon?.stationId ?? null;
  // Highlight the station marker for either direct station click or polygon click
  const highlightedStationId = selectedStationId ?? selectedPolygonStationId;

  const layers = useMemo(() => {
    const result = [];
    if (mode === 'hexgrid') {
      result.push(createHexGridLayer(hexData));
    } else {
      result.push(createPolygonLayer(polygonData, selectedPolygonStationId));
    }
    result.push(createStationMarkersLayer(stations, highlightedStationId));
    return result;
  }, [mode, hexData, polygonData, stations, highlightedStationId, selectedPolygonStationId]);

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
  }, [selectStation]);

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
