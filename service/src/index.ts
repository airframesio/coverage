import { serve } from '@hono/node-server';
import { CoverageStore } from './aggregation/coverage-store.js';
import { NatsSubscriber } from './nats/subscriber.js';
import { StationSync } from './sync/station-sync.js';
import { createApiServer } from './api/server.js';
import { config } from './config.js';

async function main() {
  console.log('=== Airframes Coverage Service ===');
  console.log(`Port: ${config.port}`);
  console.log(`NATS: ${config.natsUrl}`);
  console.log(`Main API: ${config.mainApiUrl}`);

  // 1. Initialize coverage store
  const store = new CoverageStore();

  // 2. Start station metadata sync (must be before NATS so trust checks work)
  const stationSync = new StationSync(store.stationMap);
  await stationSync.start();

  // 3. Connect to NATS and start ingesting
  const nats = new NatsSubscriber((event) => store.ingest(event));
  try {
    await nats.connect();
  } catch (err) {
    console.error('[NATS] Failed to connect:', err instanceof Error ? err.message : err);
    console.log('[NATS] Will continue without NATS — API will serve empty data');
  }

  // 4. Start HTTP API
  const app = createApiServer(store, nats);

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`[API] Server listening on http://localhost:${info.port}`);
    console.log(`[API] Health: http://localhost:${info.port}/api/v1/health`);
    console.log(`[API] H3 data: http://localhost:${info.port}/api/v1/coverage/h3?window=1h&resolution=3`);
    console.log(`[API] Stations: http://localhost:${info.port}/api/v1/stations?window=1h`);
  });

  // 5. Periodic stats logging
  setInterval(() => {
    const stats = store.getStats();
    console.log(
      `[Stats] processed=${stats.eventsProcessed} rejected=${stats.eventsRejected} ` +
      `withPos=${stats.eventsWithPosition} noPos=${stats.eventsWithoutPosition} ` +
      `stations=${stats.stationsTracked} ` +
      `nats: recv=${nats.messagesReceived} parsed=${nats.messagesParsed} errors=${nats.parseErrors}`
    );
  }, 30_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down...');
    stationSync.stop();
    await nats.disconnect();
    store.destroy();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
