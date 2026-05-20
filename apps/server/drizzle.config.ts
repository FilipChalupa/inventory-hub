import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL?.replace(/^file:/, '') ?? './data/app.db',
  },
  strict: true,
  verbose: true,
});
