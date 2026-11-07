<div align="center">

# 🧳 local-migrate

**Database-style schema migrations for `localStorage` and `sessionStorage`. Under 100 lines. Zero dependencies.**

[![npm version](https://img.shields.io/npm/v/local-migrate?style=flat)](https://www.npmjs.com/package/local-migrate)
[![size](https://img.shields.io/npm/unpacked-size/local-migrate?style=flat)](https://www.npmjs.com/package/local-migrate)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](./package.json)
[![license](https://img.shields.io/npm/l/local-migrate?style=flat)](./LICENSE)
[![tests](https://img.shields.io/github/actions/workflow/status/drip04/local-migrate/test.yml?label=tests)](https://github.com/drip04/local-migrate/actions)

*Ship new app versions without bricking the browsers that still hold your old data.*

</div>

---

## The Problem

You shipped v1 of your app. Users saved this to `localStorage`:

```json
{ "user": "ada", "prefs": "dark" }
```

Three releases later your code expects this:

```js
const { name, prefs } = JSON.parse(localStorage.getItem('app'));
prefs.theme.toUpperCase();
// 💥 TypeError: Cannot read properties of undefined (reading 'toUpperCase')
```

`prefs` used to be a string. Now it's an object. Every returning user has stale data, your app crashes on boot, and the screen goes **white**. New users and your dev machine work fine, so you never saw it coming. The only fix is asking users to open DevTools and clear their storage.

Servers have migrations. The browser doesn't, so you end up with ad-hoc `if (!data.prefs)` checks scattered around, or nothing at all.

## The Solution

`local-migrate` stores a schema version next to your data and runs your migrations in order, **v1 → v2 → v3**, the moment you load it.

**Before** — fragile, scattered, crashes on stale or corrupt data:

```js
const raw = localStorage.getItem('app');
const state = JSON.parse(raw); // throws on corrupt JSON
render(state.prefs.theme);     // throws on old shapes
```

**After** — versioned, sequential, self-healing:

```js
import { createMigrator } from 'local-migrate';

const store = createMigrator({
  key: 'app',
  version: 3,
  defaultState: { name: '', prefs: { theme: 'light' } },
  migrations: {
    1: (d) => ({ ...d, name: d.user }),                  // v1 -> v2
    2: (d) => ({ ...d, prefs: { theme: d.prefs } }),     // v2 -> v3
  },
});

const state = store.load(); // always the v3 shape, or a clean default
render(state.prefs.theme);
```

- ✅ **Sequential**: v1 data passes through `1→2` then `2→3`.
- ✅ **Atomic**: nothing is written unless every step succeeds.
- ✅ **Fail-fast**: a missing step throws `missing migration 2 -> 3` before touching your data.
- ✅ **Self-healing**: corrupt JSON triggers `onCorrupt` or `defaultState` instead of a crash.
- ✅ **Any engine**: `localStorage`, `sessionStorage`, or anything with `getItem` / `setItem`.

## Quick Start

```bash
npm install local-migrate
```

```js
import { createMigrator } from 'local-migrate';

const settings = createMigrator({
  key: 'settings',
  version: 2,
  defaultState: { theme: 'light' },
  migrations: {
    1: (old) => ({ theme: old.dark ? 'dark' : 'light' }), // v1 -> v2
  },
});

const state = settings.load();       // migrates automatically if needed
settings.save({ ...state, theme: 'dark' });
```

**No bundler?** Import it straight from a CDN as a standalone ES module:

```html
<script type="module">
  import { createMigrator } from 'https://unpkg.com/local-migrate/src/index.js';
</script>
```

**`sessionStorage` or a custom engine:**

```js
createMigrator({ key: 'draft', version: 1, storage: sessionStorage });
```

**Adopting it in an app that already has unversioned data:**

```js
createMigrator({ key: 'app', version: 2, legacyVersion: 1, migrations: { 1: upgrade } });
// existing un-wrapped JSON is treated as v1 and migrated to v2
```

## API Reference

### `createMigrator(options) → { load, save, clear }`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `key` | `string` | ✅ | Storage key that holds the versioned state. |
| `version` | `number` | ✅ | Current schema version of your app (integer ≥ 1). |
| `migrations` | `{ [from: number]: (data) => data }` | | `migrations[n]` upgrades version `n` to `n + 1`. Must return the new data. |
| `storage` | `{ getItem, setItem, removeItem? }` | | Defaults to `localStorage`. |
| `defaultState` | `any \| () => any` | | Used on first run and as the recovery value for corrupt data. Plain values are deep-cloned; factories are called each time. |
| `onCorrupt` | `(error, rawValue) => state` | | Called when stored data can't be parsed or has no valid version. Its return value becomes the new state. Takes priority over `defaultState`. |
| `legacyVersion` | `number` | | Treat existing un-wrapped JSON as this schema version. |

### `store.load()`

Reads, validates, and migrates stored state, then returns it.

| Situation | Result |
| --- | --- |
| Nothing stored | Returns `defaultState` (or `undefined`). Nothing is written. |
| Stored version equals `version` | Returns the data as is. |
| Stored version is older | Runs each migration in order, saves, and returns the result. |
| Stored version is newer | Throws `stored version N is newer than app version M`. |
| A migration step is missing | Throws `missing migration X -> Y` **before** running anything. |
| A migration throws | Throws `migration X -> Y failed: …` with the original error as `cause`. Storage is left untouched. |
| Corrupt JSON or invalid version | Calls `onCorrupt` or uses `defaultState` and rewrites storage. Throws if neither is set. |

### `store.save(state)`

Writes `state` stamped with the current `version`. Call it whenever your app state changes.

### `store.clear()`

Removes the key from storage.

### Storage format

```json
{ "__v": 3, "data": { "name": "ada", "prefs": { "theme": "dark" } } }
```

## Development

```bash
npm test   # uses the built-in node:test runner, Node 18+
```

## License

MIT
