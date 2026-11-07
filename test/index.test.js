import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMigrator } from '../src/index.js';

/** Minimal in-memory engine — also proves custom storage support. */
class MemoryStorage {
  #m = new Map();
  getItem(k) { return this.#m.has(k) ? this.#m.get(k) : null; }
  setItem(k, v) { this.#m.set(k, String(v)); }
  removeItem(k) { this.#m.delete(k); }
}

const seed = (storage, key, v, data) =>
  storage.setItem(key, JSON.stringify({ __v: v, data }));

const migrations = {
  1: (d) => ({ ...d, name: d.user }),             // v1 -> v2: rename field
  2: (d) => ({ ...d, theme: d.theme ?? 'dark' }), // v2 -> v3: add default
};

test('runs migrations sequentially 1 -> 2 -> 3 and persists the result', () => {
  const storage = new MemoryStorage();
  seed(storage, 'app', 1, { user: 'ada' });
  const calls = [];
  const m = createMigrator({
    key: 'app', version: 3, storage,
    migrations: {
      1: (d) => { calls.push('1->2'); return migrations[1](d); },
      2: (d) => { calls.push('2->3'); return migrations[2](d); },
    },
  });
  assert.deepEqual(m.load(), { user: 'ada', name: 'ada', theme: 'dark' });
  assert.deepEqual(calls, ['1->2', '2->3']);
  assert.equal(JSON.parse(storage.getItem('app')).__v, 3);
  assert.deepEqual(m.load(), { user: 'ada', name: 'ada', theme: 'dark' }); // no re-run
  assert.equal(calls.length, 2);
});

test('returns defaultState on first run and clones it', () => {
  const defaultState = { items: [] };
  const m = createMigrator({ key: 'app', version: 1, storage: new MemoryStorage(), defaultState });
  const a = m.load();
  a.items.push(1);
  assert.deepEqual(m.load(), { items: [] });
});

test('throws a clear error when a migration step is missing, leaving storage untouched', () => {
  const storage = new MemoryStorage();
  seed(storage, 'app', 1, { user: 'ada' });
  const before = storage.getItem('app');
  const m = createMigrator({ key: 'app', version: 3, storage, migrations: { 1: (d) => d } });
  assert.throws(() => m.load(), /missing migration 2 -> 3/);
  assert.equal(storage.getItem('app'), before);
});

test('a failing migration throws and does not write partial state', () => {
  const storage = new MemoryStorage();
  seed(storage, 'app', 1, {});
  const before = storage.getItem('app');
  const m = createMigrator({
    key: 'app', version: 2, storage,
    migrations: { 1: () => { throw new Error('boom'); } },
  });
  assert.throws(() => m.load(), /migration 1 -> 2 failed: boom/);
  assert.equal(storage.getItem('app'), before);
});

test('corrupt JSON falls back to defaultState and heals storage', () => {
  const storage = new MemoryStorage();
  storage.setItem('app', '{not json');
  const m = createMigrator({ key: 'app', version: 2, storage, defaultState: () => ({ fresh: true }) });
  assert.deepEqual(m.load(), { fresh: true });
  assert.deepEqual(JSON.parse(storage.getItem('app')), { __v: 2, data: { fresh: true } });
});

test('onCorrupt receives the error and raw value, and wins over defaultState', () => {
  const storage = new MemoryStorage();
  storage.setItem('app', 'garbage');
  let seen;
  const m = createMigrator({
    key: 'app', version: 1, storage, defaultState: { a: 1 },
    onCorrupt: (err, raw) => { seen = { err, raw }; return { recovered: true }; },
  });
  assert.deepEqual(m.load(), { recovered: true });
  assert.equal(seen.raw, 'garbage');
  assert.ok(seen.err instanceof Error);
});

test('corrupt data with no recovery strategy throws', () => {
  const storage = new MemoryStorage();
  storage.setItem('app', '{nope');
  assert.throws(() => createMigrator({ key: 'app', version: 1, storage }).load(), /could not read "app"/);
});

test('rejects data written by a newer app version', () => {
  const storage = new MemoryStorage();
  seed(storage, 'app', 5, {});
  assert.throws(() => createMigrator({ key: 'app', version: 2, storage }).load(), /newer than app version/);
});

test('legacyVersion adopts un-wrapped pre-existing data', () => {
  const storage = new MemoryStorage();
  storage.setItem('app', JSON.stringify({ user: 'grace' }));
  const m = createMigrator({ key: 'app', version: 2, storage, legacyVersion: 1, migrations: { 1: migrations[1] } });
  assert.deepEqual(m.load(), { user: 'grace', name: 'grace' });
});

test('save() and clear() round-trip through a custom engine', () => {
  const storage = new MemoryStorage();
  const m = createMigrator({ key: 'app', version: 2, storage });
  m.save({ ok: 1 });
  assert.deepEqual(m.load(), { ok: 1 });
  m.clear();
  assert.equal(storage.getItem('app'), null);
});

test('validates options and storage shape', () => {
  assert.throws(() => createMigrator({ version: 1, storage: new MemoryStorage() }), /`key`/);
  assert.throws(() => createMigrator({ key: 'a', version: 0, storage: new MemoryStorage() }), /`version`/);
  assert.throws(() => createMigrator({ key: 'a', version: 1, storage: {} }), /no usable storage/);
});
