import type { CoverageEvent } from '../../types/events.js';

/**
 * Parse raw decoder output to extract position data that the aggregation
 * server's importers don't populate on the message/flight entities.
 *
 * Raw payloads have structure: { source, payload, timestamp }
 * where payload contains the decoder's native JSON.
 */

interface RawPayload {
  source?: {
    ingest?: { uuid?: string; name?: string };
    reporter?: {
      application?: { name?: string };
      ipAddress?: string;
      station?: { uuid?: string; ident?: string };
    };
  };
  payload?: any;
  timestamp?: string;
}

/**
 * Extract position from raw dumpvdl2 payload.
 * VDL2 position can be in: acars.arinc622.adsc.tags[].basic_report.{lat,lon}
 */
function extractVdl2Position(payload: any): { lat: number; lon: number } | null {
  try {
    const vdl2 = payload?.vdl2;
    if (!vdl2) return null;

    // Check ACARS ARINC-622 ADS-C reports
    const acars = vdl2?.avlc?.acars;
    const arinc = acars?.arinc622;
    if (arinc?.adsc?.tags) {
      for (const tag of arinc.adsc.tags) {
        const report = tag.basic_report || tag.flight_id_and_basic_report;
        if (report?.lat != null && report?.lon != null) {
          return { lat: report.lat, lon: report.lon };
        }
      }
    }

    // Check X.25/CLNP embedded position reports
    const xid = vdl2?.avlc?.xid;
    if (xid?.vdl_params) {
      for (const param of xid.vdl_params) {
        if (param?.ac_location?.lat != null) {
          return { lat: param.ac_location.lat, lon: param.ac_location.lon };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract position from raw dumphfdl payload.
 * HFDL positions in: hfdl.lpdu.hfnpdu.pos.{lat,lon} or nested spdu
 */
function extractHfdlPosition(payload: any): { lat: number; lon: number } | null {
  try {
    const hfdl = payload?.hfdl;
    if (!hfdl) return null;

    // Direct position in LPDU
    const pos = hfdl?.lpdu?.hfnpdu?.pos;
    if (pos?.lat != null && pos?.lon != null) {
      return { lat: pos.lat, lon: pos.lon };
    }

    // Position in ACARS content
    const acars = hfdl?.lpdu?.hfnpdu?.acars;
    const arinc = acars?.arinc622;
    if (arinc?.adsc?.tags) {
      for (const tag of arinc.adsc.tags) {
        const report = tag.basic_report || tag.flight_id_and_basic_report;
        if (report?.lat != null && report?.lon != null) {
          return { lat: report.lat, lon: report.lon };
        }
      }
    }

    // Squitter position
    const spdu = hfdl?.spdu;
    if (spdu?.pos?.lat != null && spdu?.pos?.lon != null) {
      return { lat: spdu.pos.lat, lon: spdu.pos.lon };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract signal level from raw decoder payload
 */
function extractSignalLevel(payload: any): number | null {
  const sig = payload?.vdl2?.sig_level ?? payload?.hfdl?.sig_level ?? null;
  return typeof sig === 'number' ? sig : null;
}

/**
 * Extract frequency from raw decoder payload (in Hz, convert to MHz)
 */
function extractFrequency(payload: any): number | null {
  const freq = payload?.vdl2?.freq ?? payload?.hfdl?.freq ?? null;
  if (typeof freq !== 'number') return null;
  return freq > 1_000_000 ? freq / 1_000_000 : freq; // Hz to MHz
}

/**
 * Parse raw ingest payload for position data.
 * Returns a CoverageEvent if position is found, null otherwise.
 */
export function parseRawForPosition(data: RawPayload): CoverageEvent | null {
  const payload = data.payload;
  if (!payload) return null;

  const stationUuid = data.source?.reporter?.station?.uuid ?? '';
  const stationIdent = data.source?.reporter?.station?.ident ?? '';

  // We don't have station ID from raw messages — will need to look up by UUID
  // For now, skip if no station info
  if (!stationUuid) return null;

  // Try to extract position
  let position: { lat: number; lon: number } | null = null;
  let sourceType = 'unknown';

  if (payload.vdl2) {
    position = extractVdl2Position(payload);
    sourceType = 'vdl';
  } else if (payload.hfdl) {
    position = extractHfdlPosition(payload);
    sourceType = 'hfdl';
  }

  if (!position) return null;

  return {
    stationId: 0, // Will be resolved by UUID lookup
    stationUuid,
    targetLat: position.lat,
    targetLon: position.lon,
    targetAlt: null,
    transportType: 'aircraft',
    sourceType,
    source: data.source?.reporter?.application?.name ?? sourceType,
    frequency: extractFrequency(payload),
    signalLevel: extractSignalLevel(payload),
    errorCount: null,
    timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
    hasTargetPosition: true,
  };
}
