// Loaded with `node --import tsx --import ./tools/tune/res-register.mjs`: lets the tuner and
// its workers `import … from './levels.res'` outside Vite.
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readResource, resourceModule } from './levelres.mjs';

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !new URL(url).pathname.endsWith('.res')) return nextLoad(url, context);
    return { format: 'module', shortCircuit: true, source: resourceModule(readResource(fileURLToPath(url))) };
  },
});
