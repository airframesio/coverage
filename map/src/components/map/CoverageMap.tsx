'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

import type { MapLayerMouseEvent } from 'react-map-gl/maplibre';

/** Hook that creates a Deck.gl overlay as a MapLibre control */
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
  const setLoading = useCoverageStore((s) => s.setLoading);

  const apiUrl = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

  // Build Deck.gl layers
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

  const onMove = useCallback((evt: { viewState: typeof viewState }) => {
    setLocalViewState(evt.viewState);
  }, []);

  const onMoveEnd = useCallback((evt: { viewState: typeof viewState }) => {
    setViewState(evt.viewState);
  }, [setViewState]);

  // Fetch coverage data when timeWindow or transport changes
  useEffect(() => {
    const resolution = zoomToH3Resolution(viewState.zoom);

    async function fetchData() {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          window: timeWindow,
          resolution: String(resolution),
          transport: transportFilter,
        });
        const res = await fetch(`${apiUrl}/api/v1/coverage/h3?${params}`);
        if (res.ok) {
          const data = await res.json();
          setHexData(data.cells ?? []);
        }
      } catch (err) {
        console.error('Failed to fetch coverage data:', err);
      }
    }

    fetchData();
  }, [timeWindow, transportFilter, apiUrl, setHexData, setLoading, viewState.zoom]);

  // Fetch stations
  useEffect(() => {
    async function fetchStations() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/stations?window=${timeWindow}`);
        if (res.ok) {
          const data = await res.json();
          setStations(data.stations ?? []);
        }
      } catch (err) {
        console.error('Failed to fetch stations:', err);
      }
    }
    fetchStations();
  }, [timeWindow, apiUrl, setStations]);

  // Fetch stats periodically
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`${apiUrl}/api/v1/stats`);
        if (res.ok) setStats(await res.json());
      } catch { /* ignore */ }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 10_000);
    return () => clearInterval(interval);
  }, [apiUrl, setStats]);

  const selectedStation = stations.find((s) => s.id === selectedStationId) ?? null;

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
