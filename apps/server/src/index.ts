import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb } from './db/client.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, sqlite } = createDb(env.DATABASE_URL);

const app = createApp({ db, env });

const server = serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`Server běží na http://localhost:${info.port}`);
  },
);

const shutdown = () => {
  console.log('Vypínám…');
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
