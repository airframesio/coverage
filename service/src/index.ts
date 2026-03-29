import { serve } from '@hono/node-server';
import { CoverageStore } from './aggregation/coverage-store.js';
import { NatsSubscriber } from './nats/subscriber.js';
import { StationSync } from './sync/station-sync.js';
import { createApiServer } from './api/server.js';
import { migrate, closePool } from './data/database.js';
import { Persistence } from './data/persistence.js';
import { config } from './config.js';

async function main() {
  console.log('=== Airframes Coverage Service ===');
  console.log(`Port: ${config.port}`);
  console.log(`NATS: ${config.natsUrl}`);
  console.log(`Main API: ${config.mainApiUrl}`);
  console.log(`Database: ${config.databaseUrl}`);

  // 1. Initialize coverage store
  const store = new CoverageStore();

  // 2. Initialize database and load persisted data
  let persistence: Persistence | null = null;
  try {
    await migrate();
    persistence = new Persistence(store);
    await persistence.load();
    persistence.start();
  } catch (err) {
    console.error('[DB] Database not available:', err instanceof Error ? err.message : err);
    console.log('[DB] Continuing without persistence — data will be in-memory only');
  }

  // 3. Start station metadata sync (must be before NATS so trust checks work)
  const stationSync = new StationSync(store.stationMap);
  await stationSync.start();

  // 4. Connect to NATS and start ingesting
  const nats = new NatsSubscriber((event) => store.ingest(event), store.stationMap);
  try {
    await nats.connect();
  } catch (err) {
    console.error('[NATS] Failed to connect:', err instanceof Error ? err.message : err);
    console.log('[NATS] Will continue without NATS — API will serve empty data');
  }

  // 5. Start HTTP API
  const app = createApiServer(store, nats);

  serve({
    fetch: app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`[API] Server listening on http://localhost:${info.port}`);
    console.log(`[API] Health: http://localhost:${info.port}/api/v1/health`);
  });

  // 6. Periodic stats logging + UUID index refresh
  setInterval(() => {
    nats.refreshUuidIndex();
    const stats = store.getStats();
    console.log(
      `[Stats] processed=${stats.eventsProcessed} rejected=${stats.eventsRejected} ` +
      `withPos=${stats.eventsWithPosition} noPos=${stats.eventsWithoutPosition} ` +
      `stations=${stats.stationsTracked} rawPositions=${nats.rawPositionsFound} ` +
      `nats: recv=${nats.messagesReceived} parsed=${nats.messagesParsed} errors=${nats.parseErrors}`
    );
  }, 30_000);

  // Graceful shutdown: save final snapshot before exit
  const shutdown = async () => {
    console.log('\nShutting down...');
    stationSync.stop();
    if (persistence) {
      persistence.stop();
      await persistence.save(); // Final save
      console.log('[Persistence] Final snapshot saved');
    }
    await nats.disconnect();
    store.destroy();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
