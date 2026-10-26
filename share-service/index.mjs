// Runs the share service.
//   Cloud Run:  BUCKET=<bucket> node index.mjs
//   Locally:    node share-service/index.mjs   → http://localhost:8787, files in data/shared/
// Env: PORT (default 8787), BUCKET (a Cloud Storage bucket; without it, files go in STORE_DIR),
// STORE_DIR (default data/shared), GAME_ORIGIN (where the game is), PUBLIC_ORIGIN (where this
// service answers, for the links in its pages).
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHandler } from './app.mjs';
import { bucketStore, folderStore } from './stores.mjs';

const port = Number(process.env.PORT) || 8787;
const store = process.env.BUCKET ? await bucketStore(process.env.BUCKET) : folderStore(process.env.STORE_DIR || fileURLToPath(new URL('../data/shared', import.meta.url)));
const handler = createHandler({
  store,
  gameOrigin: process.env.GAME_ORIGIN || 'https://bridgebuilder.cuplex.org',
  publicOrigin: process.env.PUBLIC_ORIGIN || `http://localhost:${port}`,
});

createServer(handler).listen(port, () => console.log(`Share service on port ${port}${process.env.BUCKET ? `, bucket ${process.env.BUCKET}` : ''}`));
