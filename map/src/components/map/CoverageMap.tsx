'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Deck } from '@deck.gl/core';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { MAP_CONFIG, zoomToH3Resolution } from '@/lib/constants/map-config';
import { useUIStore } from '@/lib/stores/ui-store';
import { useCoverageStore } from '@/lib/stores/coverage-store';
import { createHexGridLayer } from './layers/hex-grid-layer';
import { createPolygonLayer } from './layers/polygon-layer';
import { createStationMarkersLayer } from './layers/station-markers-layer';
import ControlPanel from '@/components/controls/ControlPanel';
import StationPopup from '@/components/station/StationPopup';

export default function CoverageMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

  const mode = useUIStore((s) => s.mode);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const transportFilter = useUIStore((s) => s.transportFilter);
  const viewState = useUIStore((s) => s.viewState);
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

  // Initialize MapLibre + Deck.gl overlay
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_CONFIG.style,
      center: [MAP_CONFIG.initialViewState.longitude, MAP_CONFIG.initialViewState.latitude],
      zoom: MAP_CONFIG.initialViewState.zoom,
      pitch: MAP_CONFIG.initialViewState.pitch,
      bearing: MAP_CONFIG.initialViewState.bearing,
      minZoom: MAP_CONFIG.minZoom,
      maxZoom: MAP_CONFIG.maxZoom,
      attributionControl: false,
    });

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });

    map.addControl(overlay as any);
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    map.on('moveend', () => {
      const center = map.getCenter();
      setViewState({
        longitude: center.lng,
        latitude: center.lat,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      });
    });

    mapRef.current = map;
    overlayRef.current = overlay;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [setViewState]);

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

  // Update overlay layers when they change
  useEffect(() => {
    if (overlayRef.current) {
      overlayRef.current.setProps({
        layers,
        onClick: (info: any) => {
          if (info.layer?.id === 'station-markers' && info.object) {
            selectStation(info.object.id);
          } else {
            selectStation(null);
          }
        },
        getTooltip: ({ object }: any) => {
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
        },
      });
    }
  }, [layers, selectStation]);

  // Fetch coverage data when timeWindow, mode, or transport changes
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

  return (
    <div className="h-screen w-screen relative">
      <div ref={mapContainerRef} className="absolute inset-0" />

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
