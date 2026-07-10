import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AppContext } from '../app.js';

export const healthRoutes = new Hono<AppContext>().get('/', (c) => {
  const db = c.get('db');
  // Lightweight liveness probe: confirm the DB actually answers. Returns 503
  // (not 200) when it doesn't, so an orchestrator can restart / stop routing.
  try {
    db.get(sql`select 1`);
  } catch (err) {
    console.error('health check DB error:', err);
    return c.json({ status: 'error', time: new Date().toISOString() }, 503);
  }
  return c.json({ status: 'ok', time: new Date().toISOString() });
});
