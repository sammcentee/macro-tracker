// Checks for the pure functions in app.js (merge, validation, stamps, CSV cells) and the sw.js fetch handler.
// Run: node tests/unit.mjs .
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const dir = process.argv[2] || '.';
const src = fs.readFileSync(`${dir}/app.js`, 'utf8');
const slice = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
const code = slice('const MACROS', 'const $ =') + slice('const byId', 'function el(') +
  slice('// Times are compared', 'function loadJSON') + slice('function csvCell', 'async function exportCsv') +
  ';({ isValidData, stamp, isNewer, normalize, merge, csvCell })';
const f = vm.runInNewContext(code, { Date, JSON, Math, Number, Set, Map, Array, String, Object });
const plain = (x) => JSON.parse(JSON.stringify(x)); // values from the vm context have other prototypes
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok', name); };

const rec = (id, t, extra = {}) => ({ id, name: id, kcal: 1, protein: 0, carbs: 0, fat: 0, date: '2026-11-01', updatedAt: t, ...extra });
const doc = (entries, foods = [], presets = []) => f.normalize({ targets: {}, entries, foods, presets });
const { merge } = f;

ok('equal times converge in both merge orders', () => {
  const A = doc([rec('e1', '2026-11-01T10:00:00.000Z', { kcal: 100 })]);
  const B = doc([rec('e1', '2026-11-01T10:00:00.000Z', { kcal: 200 })]);
  assert.deepEqual(plain(merge(A, B)), plain(merge(B, A)));
});
ok('equal target times converge', () => {
  const A = { ...doc([]), targets: { kcal: 2000, protein: 0, carbs: 0, fat: 0 }, targetsUpdatedAt: '2026-11-01T10:00:00.000Z' };
  const B = { ...doc([]), targets: { kcal: 2500, protein: 0, carbs: 0, fat: 0 }, targetsUpdatedAt: '2026-11-01T10:00:00.000Z' };
  assert.equal(merge(A, B).targets.kcal, merge(B, A).targets.kcal);
});
ok('stamp is later than a version from a fast clock', () => {
  const future = '2030-01-01T00:00:00.000Z';
  assert.ok(f.stamp(future) > future);
  assert.ok(f.stamp(null) <= new Date(Date.now() + 1000).toISOString());
});
ok('newer tombstone wins, older tombstone loses', () => {
  const liveDoc = doc([rec('e1', '2026-11-01T10:00:00.000Z')]);
  assert.equal(merge(liveDoc, doc([{ id: 'e1', deleted: true, updatedAt: '2026-11-01T11:00:00.000Z' }])).entries[0].deleted, true);
  assert.equal(merge(liveDoc, doc([{ id: 'e1', deleted: true, updatedAt: '2026-11-01T09:00:00.000Z' }])).entries[0].deleted, undefined);
});
ok('entries from both sides are kept', () => {
  const m = merge(doc([rec('a', '2026-11-01T10:00:00.000Z')]), doc([rec('b', '2026-11-01T10:00:00.000Z')]));
  assert.deepEqual(plain(m.entries.map((e) => e.id)), ['a', 'b']);
});
ok('validation: ids, names, macros, dates', () => {
  const t = '2026-11-01T10:00:00.000Z';
  assert.equal(f.isValidData({ targets: {}, entries: [rec('e1', t)], foods: [rec('f1', t)], presets: [] }), true);
  assert.equal(f.isValidData({ targets: {}, entries: [rec('e1', t), { id: 'x', deleted: true, updatedAt: t }], foods: [] }), true);
  assert.equal(f.isValidData({ targets: {}, entries: [{ ...rec('e1', t), id: undefined }, { ...rec('e2', t), id: undefined }], foods: [] }), false);
  assert.equal(f.isValidData({ targets: {}, entries: [rec('e1', t), rec('e1', t)], foods: [] }), false);
  assert.equal(f.isValidData({ targets: {}, entries: [], foods: [{ ...rec('f1', t), name: undefined }] }), false);
  assert.equal(f.isValidData({ targets: {}, entries: [{ ...rec('e1', t), kcal: 'x' }], foods: [] }), false);
  assert.equal(f.isValidData({ targets: {}, entries: [{ ...rec('e1', t), date: undefined }], foods: [] }), false);
  assert.equal(f.isValidData({ entries: [], foods: [] }), false);
  assert.equal(f.isValidData({ targets: {}, entries: {}, foods: [] }), false);
});
ok('validation: times must be toISOString format; null and missing are allowed', () => {
  const base = { targets: {}, foods: [], entries: [rec('e1', '2026-11-01T10:00:00.000Z')] };
  assert.equal(f.isValidData(base), true);
  assert.equal(f.isValidData({ ...base, entries: [rec('e1', 'zzz')] }), false);
  assert.equal(f.isValidData({ ...base, entries: [rec('e1', '2026-11-01')] }), false);
  assert.equal(f.isValidData({ ...base, entries: [{ id: 'x', deleted: true, updatedAt: 'zzz' }] }), false);
  assert.equal(f.isValidData({ ...base, targetsUpdatedAt: 'later' }), false);
  assert.equal(f.isValidData({ ...base, entries: [rec('e1', undefined)] }), true);
  assert.equal(f.isValidData({ ...base, updatedAt: null }), true); // version 1 empty data had updatedAt: null
});
ok('validation: required lists and numeric targets', () => {
  assert.equal(f.isValidData({ targets: {} }), false);
  assert.equal(f.isValidData({ targets: {}, foods: [] }), false);
  assert.equal(f.isValidData({ targets: { kcal: 'lots' }, foods: [], entries: [] }), false);
  assert.equal(f.isValidData({ targets: { kcal: 2500 }, foods: [], entries: [] }), true);
});
ok('version 1 data (no presets, no updatedAt) is valid and normalizes', () => {
  const v1 = { version: 1, targets: { kcal: 2600 }, foods: [{ id: 'f1', name: 'Eggs', kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5 }],
    entries: [{ id: 'e1', date: '2026-11-01', name: 'Eggs', kcal: 1, protein: 1, carbs: 1, fat: 1 }], updatedAt: '2026-11-01T10:00:00.000Z' };
  assert.equal(f.isValidData(v1), true);
  const nv = f.normalize(v1);
  assert.equal(nv.entries[0].updatedAt, '2026-11-01T10:00:00.000Z');
  assert.equal(nv.presets.length, 0);
});
ok('data written by release 7d98513 is valid', () => {
  const prev = { version: 2, targets: { kcal: 2600, protein: 190, carbs: 280, fat: 75 }, targetsUpdatedAt: '2026-11-01T14:05:00.000Z',
    foods: [{ id: 'f1', barcode: '5449000000996', name: 'Coca-Cola Original', kcal: 42, protein: 0, carbs: 10.6, fat: 0, serving: 330,
      updatedAt: '2026-11-01T14:05:00.000Z', lastUsed: '2026-11-01T14:06:00.000Z', lastGrams: 330 }],
    entries: [{ id: 'e1', date: '2026-11-01', time: '2026-11-01T14:06:00.000Z', name: 'Coca-Cola Original', grams: 330, foodId: 'f1',
      kcal: 138.6, protein: 0, carbs: 34.98, fat: 0, updatedAt: '2026-11-01T14:06:00.000Z' },
      { id: 'e2', deleted: true, updatedAt: '2026-11-01T14:07:00.000Z' }],
    presets: [{ id: 'p1', name: 'Coke', detail: '', kcal: 138.6, protein: 0, carbs: 34.98, fat: 0, updatedAt: '2026-11-01T14:08:00.000Z' }] };
  assert.equal(f.isValidData(prev), true);
});
ok('CSV cells: formulas, quotes, commas, CR, LF', () => {
  assert.equal(f.csvCell('=1+1'), "'=1+1");
  assert.equal(f.csvCell('+cmd'), "'+cmd");
  assert.equal(f.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(f.csvCell('\n=1+1'), '"\'\n=1+1"');
  assert.equal(f.csvCell('a,b'), '"a,b"');
  assert.equal(f.csvCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(f.csvCell('First\rSecond'), '"First\rSecond"');
  assert.equal(f.csvCell('First\nSecond'), '"First\nSecond"');
  assert.equal(f.csvCell('Crème fraîche'), 'Crème fraîche');
  assert.equal(f.csvCell(215), '215');
  assert.equal(f.csvCell(null), '');
});

// sw.js: an HTTP error must not replace a working cached file; only own caches are deleted.
const handlers = {};
const store = new Map([['macros-v1', new Map([['https://x/app.js', 'GOOD']])], ['other-app', new Map()], ['macros-v0', new Map()]]);
const caches = {
  open: async (k) => { if (!store.has(k)) store.set(k, new Map()); const m = store.get(k); return { put: async (r, v) => m.set(r.url, v.body), addAll: async () => {} }; },
  match: async (r) => { for (const m of store.values()) if (m.has(r.url)) return { body: m.get(r.url) }; return undefined; },
  keys: async () => [...store.keys()], delete: async (k) => store.delete(k),
};
let next;
const sw = { addEventListener: (t, h) => { handlers[t] = h; }, skipWaiting: () => {}, clients: { claim: async () => {} } };
vm.runInNewContext(fs.readFileSync(`${dir}/sw.js`, 'utf8'), { self: sw, caches, fetch: async () => next(), location: { origin: 'https://x' }, URL, Promise });
const run = async (resp) => { next = resp; let p; handlers.fetch({ request: { url: 'https://x/app.js', method: 'GET' }, respondWith: (x) => { p = x; } }); return p; };
const tick = () => new Promise((r) => setTimeout(r, 10));
const r1 = await run(() => ({ ok: false, status: 503, body: 'ERR', clone() { return this; } }));
ok('HTTP 503 returns the cached copy', () => assert.equal(r1.body, 'GOOD'));
await tick();
ok('HTTP 503 does not overwrite the cache', () => assert.equal(store.get('macros-v1').get('https://x/app.js'), 'GOOD'));
const r2 = await run(() => { throw new Error('offline'); });
ok('offline returns the cached copy', () => assert.equal(r2.body, 'GOOD'));
const r3 = await run(() => ({ ok: true, status: 200, body: 'NEW', clone() { return this; } }));
await tick();
ok('HTTP 200 updates the cache', () => { assert.equal(r3.body, 'NEW'); assert.equal(store.get('macros-v1').get('https://x/app.js'), 'NEW'); });
let done; handlers.activate({ waitUntil: (p) => { done = p; } }); await done;
ok('activate deletes only old macros- caches', () => assert.deepEqual([...store.keys()].sort(), ['macros-v1', 'other-app']));
console.log(`${n} checks passed`);
