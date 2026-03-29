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
import HexPopup from '@/components/map/HexPopup';
import PolygonPopup from '@/components/map/PolygonPopup';
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
  const setPolygonData = useCoverageStore((s) => s.setPolygonData);
  const setStations = useCoverageStore((s) => s.setStations);
  const setStats = useCoverageStore((s) => s.setStats);
  const setRefreshing = useCoverageStore((s) => s.setRefreshing);

  const [h3Resolution, setH3Resolution] = useState(() => zoomToH3Resolution(viewState.zoom));
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [selectedHex, setSelectedHex] = useState<CoverageHex | null>(null);
  const [selectedPolygon, setSelectedPolygon] = useState<CoveragePolygon | null>(null);

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
    const withPosition = stations.filter(
      (s) => s.latitude !== 0 && s.longitude !== 0 && s.messagesWithPosition > 0
    ).slice(0, 30);

    const polygons: CoveragePolygon[] = [];

    await Promise.allSettled(
      withPosition.map(async (station) => {
        try {
          const res = await fetch(
            `${API_URL}/api/v1/coverage/stations/${station.id}?window=${timeWindow}`
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
  }, [stations, timeWindow, setPolygonData]);

  const fetchStations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/stations?window=${timeWindow}`);
      if (res.ok) {
        const data = await res.json();
        setStations(data.stations ?? []);
      }
    } catch { /* retry next interval */ }
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
