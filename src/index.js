/**
 * local-migrate — schema versioning + sequential migrations for Web Storage.
 * Zero dependencies. Works with localStorage, sessionStorage, or any object
 * exposing getItem(key) / setItem(key, value).
 *
 * Stored shape: JSON `{ "__v": <schema version>, "data": <your state> }`
 */

const fail = (msg, cause) =>
  new Error(`local-migrate: ${msg}`, cause ? { cause } : undefined);
const clone = (v) => (v !== null && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

/**
 * @param {object}   opts
 * @param {string}   opts.key              Storage key that holds the versioned state.
 * @param {number}   opts.version          Current schema version of your app (integer >= 1).
 * @param {Object<number,Function>} [opts.migrations]  `{ [fromVersion]: (data) => newData }`.
 *                                         `migrations[1]` upgrades v1 -> v2, and so on.
 * @param {object}   [opts.storage]        Defaults to `localStorage`.
 * @param {*}        [opts.defaultState]   Value (or factory) used for first run and corruption recovery.
 * @param {Function} [opts.onCorrupt]      `(error, rawValue) => state` — takes priority over defaultState.
 * @param {number}   [opts.legacyVersion]  Treat un-wrapped legacy JSON as this schema version.
 * @returns {{ load: () => *, save: (state: *) => void, clear: () => void }}
 */
export function createMigrator({
  key, version, migrations = {}, storage, defaultState, onCorrupt, legacyVersion,
} = {}) {
  if (typeof key !== 'string' || !key) throw fail('`key` must be a non-empty string');
  if (!Number.isInteger(version) || version < 1) throw fail('`version` must be an integer >= 1');

  let store = storage;
  if (!store) {
    try { store = globalThis.localStorage; } catch { /* blocked, e.g. sandboxed iframe */ }
  }
  if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
    throw fail('no usable storage; pass `storage` with getItem() and setItem()');
  }

  const initial = () =>
    typeof defaultState === 'function' ? defaultState() : clone(defaultState);

  const save = (state) =>
    store.setItem(key, JSON.stringify({ __v: version, data: state }));

  // Corruption never crashes the app when a recovery strategy is provided.
  const recover = (err, raw) => {
    if (typeof onCorrupt !== 'function' && defaultState === undefined) throw err;
    const state = typeof onCorrupt === 'function' ? onCorrupt(err, raw) : initial();
    save(state);
    return state;
  };

  function load() {
    let raw, from, data;
    try {
      raw = store.getItem(key);
      if (raw === null || raw === undefined) return initial(); // first run
      const parsed = JSON.parse(raw);
      const wrapped = parsed !== null && typeof parsed === 'object' && '__v' in parsed;
      from = wrapped ? parsed.__v : legacyVersion;
      data = wrapped ? parsed.data : parsed;
      if (!Number.isInteger(from) || from < 0) throw new Error('missing or invalid schema version');
    } catch (err) {
      return recover(fail(`could not read "${key}": ${err.message}`, err), raw);
    }

    if (from > version) {
      throw fail(`stored version ${from} is newer than app version ${version} (downgrade?)`);
    }
    // Validate the whole chain up front so a gap never leaves half-migrated state.
    for (let v = from; v < version; v++) {
      if (typeof migrations[v] !== 'function') {
        throw fail(`missing migration ${v} -> ${v + 1} (stored v${from}, app v${version})`);
      }
    }
    if (from === version) return data;

    for (let v = from; v < version; v++) {
      try { data = migrations[v](data); } catch (err) {
        throw fail(`migration ${v} -> ${v + 1} failed: ${err.message}`, err);
      }
    }
    save(data); // written only after every step succeeded
    return data;
  }

  return { load, save, clear: () => store.removeItem?.(key) };
}
