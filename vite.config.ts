import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JS module shared with the production server
import { createApi, openDb } from './server/api.mjs';

/** Serves the SQLite-backed /api during `vite dev` and `vite preview`. */
function sqliteApi(): Plugin {
  let api: ((req: unknown, res: unknown, next: () => void) => void) | null = null;
  const get = () => (api ??= createApi(openDb(process.env.DB_FILE || 'data/bridgebuilder.db')));
  return {
    name: 'bridgebuilder-sqlite-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => get()(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => get()(req, res, next));
    },
  };
}

export default defineConfig({
  // Relative base so the static build also works from a GitHub Pages sub-path.
  base: './',
  build: { target: 'es2022' },
  plugins: [sqliteApi()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
