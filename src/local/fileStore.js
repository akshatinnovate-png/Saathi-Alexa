import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sealStore, openStore, isSealedStore, sealStoreWith, openStoreWith } from '../security/keys.js';

export function createFileStore({ file, seed = () => ({}), persist = true, key = null, keyring = null } = {}) {
  const encrypted = Boolean(key || keyring);
  const seal = (json) => (keyring ? sealStoreWith(keyring, json) : sealStore(key, json));
  const open = (text) => (keyring ? openStoreWith(keyring, text) : openStore(key, text));
  let data = null;
  let writing = Promise.resolve();

  async function load() {
    if (data) return data;
    if (persist) {
      try {
        const text = await readFile(file, 'utf8');
        if (isSealedStore(text)) {
          if (!encrypted) throw new Error('the file is encrypted and no key was given');
          data = JSON.parse(await open(text));
        } else {
          data = JSON.parse(text);
          if (encrypted) await save();
        }
        return data;
      } catch (err) {
        if (err.code !== 'ENOENT') throw new Error(`Saathi could not read its data file ${file}: ${err.message}. Nothing was changed; fix or restore the file and start again.`);
      }
    }
    data = seed();
    await save();
    return data;
  }

  function save() {
    if (!persist) return Promise.resolve();
    const json = JSON.stringify(data, null, encrypted ? 0 : 2);
    writing = writing.then(async () => {
      const snapshot = encrypted ? await seal(json) : json;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
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
    async remove(collection, id) {
      const db = await load();
      const before = (db[collection] ?? []).length;
      db[collection] = (db[collection] ?? []).filter((x) => x.id !== id);
      if (db[collection].length !== before) await save();
      return db[collection].length !== before;
    },
    async reset() {
      data = seed();
      await save();
    },
  };
}
