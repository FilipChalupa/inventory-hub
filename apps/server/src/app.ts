import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { healthRoutes } from './routes/health.js';
import { orgRoutes } from './routes/org.js';
import { assetRoutes } from './routes/assets.js';
import { assetTypeRoutes } from './routes/asset-types.js';
import { locationRoutes } from './routes/locations.js';
import { damageRoutes } from './routes/damages.js';
import { loanRoutes } from './routes/loans.js';

export type AppContext = {
  Variables: {
    db: Db;
    env: Env;
  };
};

export function createApp(deps: { db: Db; env: Env }) {
  const app = new Hono<AppContext>();

  app.use('*', logger());
  app.use('*', cors({ origin: deps.env.PUBLIC_APP_URL, credentials: true }));

  app.use('*', async (c, next) => {
    c.set('db', deps.db);
    c.set('env', deps.env);
    await next();
  });

  app.route('/health', healthRoutes);
  app.route('/api/org', orgRoutes);
  app.route('/api/assets', assetRoutes);
  app.route('/api/asset-types', assetTypeRoutes);
  app.route('/api/locations', locationRoutes);
  app.route('/api/damages', damageRoutes);
  app.route('/api/loans', loanRoutes);

  app.onError((err, c) => {
    console.error('Request error:', err);
    return c.json({ error: { message: err.message } }, 500);
  });

  return app;
}
