'use client';

import { useEffect, useRef } from 'react';
import { useUIStore } from '../stores/ui-store';
import { TIME_WINDOWS, type TimeWindowKey } from '../constants/time-windows';
import { modesParam, parseModesHash } from '../constants/modes';

/**
 * Sync UI state to/from URL hash parameters.
 * Enables sharing links like: /map#mode=hexgrid&window=1h&lat=51.5&lon=-0.1&zoom=8
 * (`station=<id>` selects a station, `only=1` hides the others)
 */
export function useUrlState() {
  const mode = useUIStore((s) => s.mode);
  const timeWindow = useUIStore((s) => s.timeWindow);
  const transportFilter = useUIStore((s) => s.transportFilter);
  const modes = useUIStore((s) => s.modes);
  const viewState = useUIStore((s) => s.viewState);
  const selectedStationId = useUIStore((s) => s.selectedStationId);
  const onlySelected = useUIStore((s) => s.onlySelected);
  const selectStation = useUIStore((s) => s.selectStation);
  const setOnlySelected = useUIStore((s) => s.setOnlySelected);
  const setModes = useUIStore((s) => s.setModes);
  const setMode = useUIStore((s) => s.setMode);
  const setTimeWindow = useUIStore((s) => s.setTimeWindow);
  const setTransportFilter = useUIStore((s) => s.setTransportFilter);
  const flyTo = useUIStore((s) => s.flyTo);

  const initialized = useRef(false);

  // On mount: read from URL hash
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const hash = window.location.hash.slice(1);
    if (!hash) return;

    const params = new URLSearchParams(hash);

    const m = params.get('mode');
    if (m === 'hexgrid' || m === 'polygon' || m === 'density') setMode(m);

    const station = parseInt(params.get('station') ?? '', 10);
    if (Number.isInteger(station) && station > 0) selectStation(station);
    const only = params.get('only');
    if (only === '1' || only === '0') setOnlySelected(only === '1');

    const w = params.get('window');
    if (w && TIME_WINDOWS.some((tw) => tw.key === w)) setTimeWindow(w as TimeWindowKey);

    const t = params.get('transport');
    if (t === 'all' || t === 'aircraft' || t === 'marine') setTransportFilter(t);
    // After the transport filter, which resets the modes when it is All
    const m2 = parseModesHash(params.get('modes'));
    if (m2) setModes(m2);

    const lat = params.get('lat');
    const lon = params.get('lon');
    const zoom = params.get('zoom');
    if (lat && lon) {
      flyTo({
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        zoom: zoom ? parseFloat(zoom) : 6,
      });
    }
  }, [setMode, setTimeWindow, setTransportFilter, setModes, flyTo, selectStation, setOnlySelected]);

  // Debounced write to URL hash
  const writeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(writeTimer.current);
    writeTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      params.set('mode', mode);
      params.set('window', timeWindow);
      if (transportFilter !== 'all') params.set('transport', transportFilter);
      const modesValue = modesParam(modes, transportFilter);
      if (modesValue) params.set('modes', modesValue);
      if (selectedStationId !== null) {
        params.set('station', String(selectedStationId));
        if (onlySelected) params.set('only', '1');
      }
      params.set('lat', viewState.latitude.toFixed(2));
      params.set('lon', viewState.longitude.toFixed(2));
      params.set('zoom', viewState.zoom.toFixed(1));

      const newHash = params.toString();
      if (window.location.hash.slice(1) !== newHash) {
        history.replaceState(null, '', `#${newHash}`);
      }
    }, 1000);
  }, [mode, timeWindow, transportFilter, modes, viewState, selectedStationId, onlySelected]);
}
