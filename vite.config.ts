import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JS module shared with the production server
import { createApi, openDb } from './server/api.mjs';
import { readResource, resourceModule } from './tools/tune/levelres.mjs';
import { tunerConsole } from './tools/tune/console/plugin.ts';

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

/** Unpacks src/levels.res into a module, for the game, the tests and the tuner page. */
function levelResource(): Plugin {
  return {
    name: 'bridgebuilder-level-resource',
    load(id) {
      const file = id.split('?')[0];
      if (!file.endsWith('.res')) return null;
      return resourceModule(readResource(file));
    },
    // The tuner rewrites the resource after every level it finishes. That mustn't reload open
    // pages (the tuner page itself, or a game mid-play): drop the cached module so the next
    // load reads the new numbers, and send no update.
    hotUpdate({ file, modules }) {
      if (!file.endsWith('.res')) return;
      for (const m of modules) this.environment.moduleGraph.invalidateModule(m);
      return [];
    },
  };
}

export default defineConfig({
  // Relative base so the static build also works from a GitHub Pages sub-path.
  base: './',
  build: { target: 'es2022' },
  plugins: [levelResource(), sqliteApi(), tunerConsole()],
  // The level editor's quick-tune worker runs the physics, which reads src/levels.res too.
  worker: { plugins: () => [levelResource()] },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as never);
