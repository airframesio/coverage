import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { coverageRoutes } from './routes/coverage.js';
import { stationRoutes } from './routes/stations.js';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { createMetricsRegistry } from '../metrics/metrics.js';
import type { CoverageStore } from '../aggregation/coverage-store.js';
import type { NatsSubscriber } from '../nats/subscriber.js';

export type AppContext = {
  Variables: {
    store: CoverageStore;
    nats: NatsSubscriber;
  };
};

export function createApiServer(store: CoverageStore, nats: NatsSubscriber): Hono<AppContext> {
  const app = new Hono<AppContext>();

  // CORS for frontend
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }));

  // Inject dependencies
  app.use('*', async (c, next) => {
    c.set('store', store);
    c.set('nats', nats);
    await next();
  });

  // Mount routes
  app.route('/api/v1/coverage', coverageRoutes);
  app.route('/api/v1/stations', stationRoutes);
  app.route('/api/v1', healthRoutes);

  // Prometheus scrape endpoint at the root, gated by MONITORING_TOKEN
  app.route('/', metricsRoutes(createMetricsRegistry(store, nats)));

  return app;
}
