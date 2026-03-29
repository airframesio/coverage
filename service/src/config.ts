export const config = {
  port: parseInt(process.env.PORT || '3002', 10),

  // NATS
  natsUrl: process.env.NATS_URL || 'nats://localhost:4222',
  natsJwt: process.env.NATS_JWT || '',
  natsNkeySeed: process.env.NATS_NKEY_SEED || '',

  // PostgreSQL (own database, separate from main API)
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/airframes_coverage',

  // Main API (for station metadata sync)
  mainApiUrl: process.env.MAIN_API_URL || 'http://localhost:3001',

  // Station sync interval (ms)
  stationSyncInterval: 60_000,

  // Dev mode: when station sync fails, auto-trust stations from NATS payload
  // This is ONLY for local development — NEVER enable in production
  devAutoTrustStations: process.env.DEV_AUTO_TRUST_STATIONS === 'true',

  // WebSocket push intervals (ms)
  wsCoverageInterval: 5_000,
  wsStationInterval: 30_000,
  wsStatsInterval: 10_000,
} as const;
