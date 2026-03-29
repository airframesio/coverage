'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Map, NavigationControl, useControl, type MapRef } from 'react-map-gl/maplibre';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MAP_CONFIG, zoomToH3Resolution } from '@/lib/constants/map-config';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { createHexGridLayer } from './layers/hex-grid-layer';
import { createPolygonLayer } from './layers/polygon-layer';
import { createStationMarkersLayer } from './layers/station-markers-layer';
import ControlPanel from '@/components/controls/ControlPanel';
import ConnectionBanner from '@/components/controls/ConnectionBanner';
import ActivityTicker from '@/components/controls/ActivityTicker';
import StationPopup from '@/components/station/StationPopup';
import HexPopup from '@/components/map/HexPopup';
import PolygonPopup from '@/components/map/PolygonPopup';
import { useUrlState } from '@/lib/hooks/use-url-state';
import type { CoverageHex, CoveragePolygon } from '@/lib/types/coverage';

const POLL_INTERVAL = 10_000;
const STATS_INTERVAL = 5_000;
const ZOOM_DEBOUNCE = 800;

const API_URL = process.env.NEXT_PUBLIC_COVERAGE_API_URL || 'http://localhost:3002';

function DeckGLOverlay(props: any) {
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
  const setViewState = useUIStore((s) => s.setViewState);
  const selectedStationId = useUIStore((s) => s.selectedStationId);
  const selectStation = useUIStore((s) => s.selectStation);
  const flyToTarget = useUIStore((s) => s.flyToTarget);
  const clearFlyTo = useUIStore((s) => s.clearFlyTo);
  const pitch3d = useUIStore((s) => s.pitch3d);
  const fullscreen = useUIStore((s) => s.fullscreen);

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
      const res = await fetch(`${API_URL}/api/v1/coverage/h3?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHexData(data.cells ?? []);
      }
    } catch { /* retry next interval */ }
  }, [timeWindow, h3Resolution, transportFilter, setHexData, setRefreshing]);

  const fetchPolygons = useCallback(async () => {
    const MARINE_TYPES = new Set(['aiscatcher', 'ais']);

    const withPosition = stations
      .filter((s) => {
        if (s.latitude === 0 && s.longitude === 0) return false;
        if (s.messagesWithPosition <= 0) return false;
        if (transportFilter === 'aircraft' && MARINE_TYPES.has(s.sourceType)) return false;
        if (transportFilter === 'marine' && !MARINE_TYPES.has(s.sourceType)) return false;
        return true;
      })
      // Sort by messagesWithPosition so stations with most polygon data are fetched first
      .sort((a, b) => b.messagesWithPosition - a.messagesWithPosition);

    const polygons: CoveragePolygon[] = [];

    await Promise.allSettled(
      withPosition.map(async (station) => {
        try {
          const p = new URLSearchParams({ window: timeWindow });
          if (transportFilter !== 'all') p.set('transport', transportFilter);
          const res = await fetch(
            `${API_URL}/api/v1/coverage/stations/${station.id}?${p}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.polygon?.geometry?.coordinates) {
              polygons.push({
                stationId: station.id,
                ident: data.ident,
                coordinates: data.polygon.geometry.coordinates,
                confidence: data.confidence || 0.5,
                messageCount: data.messageCount,
                sourceType: data.sourceType,
              });
            }
          }
        } catch { /* skip */ }
      })
    );

    setPolygonData(polygons);
  }, [stations, timeWindow, transportFilter, setPolygonData]);

  const fetchStations = useCallback(async () => {
    try {
      const params = new URLSearchParams({ window: timeWindow });
      if (transportFilter !== 'all') params.set('transport', transportFilter);
      const res = await fetch(`${API_URL}/api/v1/stations?${params}`);
      if (res.ok) {
        const data = await res.json();
        setStations(data.stations ?? []);
      }
    } catch { /* retry next interval */ }
  }, [timeWindow, transportFilter, setStations]);

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

  // Fetch polygons when mode switches to polygon or stations update
  useEffect(() => {
    if (mode === 'polygon' && stations.length > 0) {
      fetchPolygons();
    }
  }, [mode, stations, fetchPolygons]);

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

  const getTooltip = useCallback(({ object, layer }: any) => {
    if (!object) return null;

    if (layer?.id === 'coverage-hexgrid' && object.h3) {
      const lines = [
        `${object.msgCount.toLocaleString()} messages`,
        `Confidence: ${(object.confidence * 100).toFixed(0)}%`,
        object.maxDistance > 0 ? `Max range: ${object.maxDistance.toFixed(0)} km` : null,
        `${object.stationCount} station${object.stationCount !== 1 ? 's' : ''}`,
        `Sources: ${object.sources.join(', ')}`,
      ].filter(Boolean);
      return { className: 'deck-tooltip', text: lines.join('\n') };
    }

    if (layer?.id === 'station-markers' && object.ident) {
      const lines = [
        object.ident,
        object.sourceType.toUpperCase(),
        `${object.messageCount.toLocaleString()} messages`,
        object.maxDistance > 0 ? `Range: ${object.maxDistance.toFixed(0)} km` : null,
      ].filter(Boolean);
      return { className: 'deck-tooltip', text: lines.join('\n') };
    }

    if (layer?.id === 'coverage-polygons' && object.ident) {
      return {
        className: 'deck-tooltip',
        text: `${object.ident}\n${object.messageCount.toLocaleString()} messages\nConfidence: ${(object.confidence * 100).toFixed(0)}%`,
      };
    }

    return null;
  }, []);

  const onClick = useCallback((info: any) => {
    if (info.layer?.id === 'station-markers' && info.object) {
      selectStation(info.object.id);
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

  const selectedStation = stations.find((s) => s.id === selectedStationId) ?? null;

  return (
    <div className="h-screen w-screen relative">
      <Map
        ref={mapRef}
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
    </div>
  );
}
