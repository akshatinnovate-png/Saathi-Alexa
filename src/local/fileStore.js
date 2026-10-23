import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { seedData, SEED_VERSION } from '../domain/seed.js';

export function createFileStore({ file, seed = () => seedData(), persist = true } = {}) {
  let data = null;
  let writing = Promise.resolve();

  async function load() {
    if (data) return data;
    if (persist) {
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'));
        if (saved.meta?.[0]?.version === SEED_VERSION) {
          data = saved;
          return data;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    data = seed();
    await save();
    return data;
  }

  function save() {
    if (!persist) return Promise.resolve();
    const snapshot = JSON.stringify(data, null, 2);
    writing = writing.then(async () => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, snapshot);
      await rename(`${file}.tmp`, file);
    });
    return writing;
  }

  return {
    kind: 'file',
    async list(collection) {
      const db = await load();
      return structuredClone(db[collection] ?? []);
    },
    async get(collection, id) {
      const db = await load();
      const item = (db[collection] ?? []).find((x) => x.id === id);
      return item ? structuredClone(item) : null;
    },
    async put(collection, item) {
      const db = await load();
      db[collection] ??= [];
      const i = db[collection].findIndex((x) => x.id === item.id);
      if (i >= 0) db[collection][i] = structuredClone(item);
      else db[collection].push(structuredClone(item));
      await save();
      return item;
    },
    async update(collection, id, patch) {
      const db = await load();
      const item = (db[collection] ?? []).find((x) => x.id === id);
      if (!item) return null;
      Object.assign(item, patch);
      await save();
      return structuredClone(item);
    },
    async reset() {
      data = seed();
      await save();
    },
  };
}
