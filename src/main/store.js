// Tiny JSON stores in userData. `createStore` is also handed to modules so each
// feature (songseek, queueup, ...) keeps its own file.
import fs from 'node:fs';
import path from 'node:path';

export function createStore(dir, name, defaults = {}) {
  const file = path.join(dir, `${name}.json`);
  let data = structuredClone(defaults);
  let exists = false;
  try {
    Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8')));
    exists = true;
  } catch {
    /* first run */
  }
  let timer = null;
  const write = () => {
    clearTimeout(timer);
    timer = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (e) {
      console.error(`[store:${name}] save failed`, e);
    }
  };
  const store = {
    file,
    existed: exists,
    get data() {
      return data;
    },
    get: (k) => data[k],
    set(k, v) {
      data[k] = v;
      store.save();
    },
    merge(patch) {
      Object.assign(data, patch);
      store.save();
    },
    replace(next) {
      data = next;
      store.save();
    },
    all: () => ({ ...data }),
    save() {
      if (!timer) timer = setTimeout(write, 250);
    },
    flush: write,
  };
  return store;
}
