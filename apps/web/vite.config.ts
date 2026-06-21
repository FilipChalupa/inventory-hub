import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_API_PROXY ?? 'http://localhost:3001';

// `test` is Vitest's config; typed loosely here so we don't depend on the
// vitest/config type augmentation (tsconfig.node restricts `types` to node).
const config: UserConfig & { test: Record<string, unknown> } = {
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
      '/auth': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    // DOM environment for component tests; pure lib tests run fine here too.
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
};

export default defineConfig(config);
