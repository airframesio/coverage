'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, useControl } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CONFIG, zoomToH3Resolution } from '@/lib/constants/map-config';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { createHexGridLayer } from './layers/hex-grid-layer';
import { createPolygonLayer } from './layers/polygon-layer';
import { createStationMarkersLayer } from './layers/station-markers-layer';
import ControlPanel from '@/components/controls/ControlPanel';
import StationPopup from '@/components/station/StationPopup';

const POLL_INTERVAL = 10_000;   // Refresh data every 10s
const STATS_INTERVAL = 5_000;   // Refresh stats every 5s
const ZOOM_DEBOUNCE = 800;      // Wait 800ms after zoom stops before re-fetching

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

function DeckGLOverlay(props: any) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: true }));
  overlay.setProps(props);
  return null;
}

export default function CoverageMap() {
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
  const setViewState = useUIStore((s) => s.setViewState);
  const selectedStationId = useUIStore((s) => s.selectedStationId);
  const selectStation = useUIStore((s) => s.selectStation);

  const hexData = useCoverageStore((s) => s.hexData);
  const polygonData = useCoverageStore((s) => s.polygonData);
  const stations = useCoverageStore((s) => s.stations);
  const setHexData = useCoverageStore((s) => s.setHexData);
  const setStations = useCoverageStore((s) => s.setStations);
  const setStats = useCoverageStore((s) => s.setStats);
  const setRefreshing = useCoverageStore((s) => s.setRefreshing);

  // Track the current H3 resolution (debounced from zoom changes)
  const [h3Resolution, setH3Resolution] = useState(() => zoomToH3Resolution(viewState.zoom));
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce zoom → H3 resolution changes
  const onMove = useCallback((evt: { viewState: typeof viewState }) => {
    setLocalViewState(evt.viewState);
  }, []);

  const onMoveEnd = useCallback((evt: { viewState: typeof viewState }) => {
    setViewState(evt.viewState);
    // Debounce the H3 resolution change to avoid rapid re-fetches during zoom
    clearTimeout(zoomDebounceRef.current);
    zoomDebounceRef.current = setTimeout(() => {
      setH3Resolution(zoomToH3Resolution(evt.viewState.zoom));
    }, ZOOM_DEBOUNCE);
  }, [setViewState]);

  // ── Data fetching: silent background refresh, no flicker ──

  const fetchCoverage = useCallback(async (silent: boolean) => {
    if (!silent) setRefreshing(true);
    try {
      const params = new URLSearchParams({
        window: timeWindow,
        resolution: String(h3Resolution),
        transport: transportFilter,
      });
      const res = await fetch(`${API_URL}/api/v1/coverage/h3?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHexData(data.cells ?? []);
      }
    } catch { /* silently retry on next interval */ }
  }, [timeWindow, h3Resolution, transportFilter, setHexData, setRefreshing]);

  const fetchStations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/stations?window=${timeWindow}`);
      if (res.ok) {
        const data = await res.json();
        setStations(data.stations ?? []);
      }
    } catch { /* retry on next interval */ }
  }, [timeWindow, setStations]);

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

  // Periodic silent refresh for coverage + stations
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCoverage(true);
      fetchStations();
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchCoverage, fetchStations]);

  // Stats on a faster interval
  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, STATS_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── Deck.gl layers ──

  const layers = useMemo(() => {
    const result = [];
    if (mode === 'hexgrid') {
      result.push(createHexGridLayer(hexData));
    } else {
      result.push(createPolygonLayer(polygonData));
    }
    result.push(createStationMarkersLayer(stations, selectedStationId));
    return result;
  }, [mode, hexData, polygonData, stations, selectedStationId]);

  const getTooltip = useCallback(({ object }: any) => {
    if (!object) return null;
    if (object.h3) {
      return {
        text: `Messages: ${object.msgCount}\nConfidence: ${(object.confidence * 100).toFixed(0)}%\nMax Range: ${object.maxDistance.toFixed(0)} km`,
      };
    }
    if (object.ident) {
      return { text: `${object.ident} (${object.sourceType})\n${object.messageCount} messages` };
    }
    return null;
  }, []);

  const onClick = useCallback((info: any) => {
    if (info.layer?.id === 'station-markers' && info.object) {
      selectStation(info.object.id);
    } else {
      selectStation(null);
    }
  }, [selectStation]);

  const selectedStation = stations.find((s) => s.id === selectedStationId) ?? null;

  return (
    <div className="h-screen w-screen relative">
      <Map
        {...viewState}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        mapStyle={MAP_CONFIG.style}
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

      {selectedStation && (
        <StationPopup
          station={selectedStation}
          onClose={() => selectStation(null)}
        />
      )}
    </div>
  );
}
