// Where the share service keeps bridges and pictures: a Cloud Storage bucket when deployed, a
// folder when run locally, memory in tests. Each one stores a key once and never overwrites it.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export function memoryStore() {
  const files = new Map();
  return {
    async get(key) {
      return files.get(key) ?? null;
    },
    async create(key, data) {
      if (files.has(key)) return false;
      files.set(key, Buffer.from(data));
      return true;
    },
  };
}

export function folderStore(dir) {
  return {
    async get(key) {
      try {
        return await readFile(join(dir, key));
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async create(key, data) {
      await mkdir(dirname(join(dir, key)), { recursive: true });
      try {
        await writeFile(join(dir, key), data, { flag: 'wx' });
        return true;
      } catch (e) {
        if (e.code === 'EEXIST') return false;
        throw e;
      }
    },
  };
}

/** A bucket the service's account may read and create objects in. Creating is conditional on the object not existing yet. */
export async function bucketStore(name) {
  const { Storage } = await import('@google-cloud/storage');
  const bucket = new Storage().bucket(name);
  return {
    async get(key) {
      try {
        const [data] = await bucket.file(key).download();
        return data;
      } catch (e) {
        if (e.code === 404) return null;
        throw e;
      }
    },
    async create(key, data, type) {
      try {
        await bucket.file(key).save(data, { contentType: type, resumable: false, preconditionOpts: { ifGenerationMatch: 0 } });
        return true;
      } catch (e) {
        if (e.code === 412) return false;
        throw e;
      }
    },
  };
}
