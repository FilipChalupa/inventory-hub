import { Hono } from 'hono';
import type { AppContext } from '../app.js';

export const healthRoutes = new Hono<AppContext>().get('/', (c) => {
  return c.json({ status: 'ok', time: new Date().toISOString() });
});
