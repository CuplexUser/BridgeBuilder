/** `npm run tune:unpack`: writes readable JSON and a report from src/levels.res into tools/tune/results. */
import { RESULTS_DIR, writeReadable } from './exports';
import { readResource, RESOURCE_FILE } from './levelres.mjs';

writeReadable(readResource());
console.log(`Unpacked ${RESOURCE_FILE} into ${RESULTS_DIR}`);
