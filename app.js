'use strict';

const DATA_KEY = 'macro-tracker-data';
const META_KEY = 'macro-tracker-meta'; // sync settings and status for this device only
const SYNC_FILE = 'data.json';
const MACROS = [
  ['kcal', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
];
const EPOCH = '1970-01-01T00:00:00.000Z';

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => new Date().toISOString();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const round = (key, v) => key === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10;
const dateKey = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const live = (list) => list.filter((r) => !r.deleted);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- State ----------
// Every food and entry has an id and an updatedAt time. A deleted record stays as a
// tombstone ({ id, deleted, updatedAt }) so that the deletion syncs to other devices.

function isValidData(d) {
  return d && typeof d === 'object' && Array.isArray(d.entries) && Array.isArray(d.foods) && d.targets;
}

// Bring any saved data (including the first version, without updatedAt) to the current shape.
function normalize(d) {
  const t0 = d.updatedAt || EPOCH;
  const fix = (list) => (list || []).map((r) => ({ ...r, updatedAt: r.updatedAt || t0 })).sort(byId);
  return {
    version: 2,
    targets: { kcal: 0, protein: 0, carbs: 0, fat: 0, ...d.targets },
    targetsUpdatedAt: d.targetsUpdatedAt || t0,
    foods: fix(d.foods),
    entries: fix(d.entries),
    presets: fix(d.presets),
  };
}

// Combine two copies record by record; the most recent change to each record wins.
function merge(a, b) {
  if (!b) return a;
  const mergeList = (x, y) => {
    const map = new Map();
    for (const r of [...x, ...y]) {
      const cur = map.get(r.id);
      if (!cur || r.updatedAt > cur.updatedAt) map.set(r.id, r);
    }
    return [...map.values()].sort(byId);
  };
  const bNewer = b.targetsUpdatedAt > a.targetsUpdatedAt;
  return {
    version: 2,
    targets: bNewer ? b.targets : a.targets,
    targetsUpdatedAt: bNewer ? b.targetsUpdatedAt : a.targetsUpdatedAt,
    foods: mergeList(a.foods, b.foods),
    entries: mergeList(a.entries, b.entries),
    presets: mergeList(a.presets, b.presets),
  };
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

let data = normalize(loadJSON(DATA_KEY, {}));
let meta = { repo: 'sammcentee/macro-tracker-data', token: '', dirty: false, lastSyncAt: null, lastError: null,
  ...loadJSON(META_KEY, {}) };
let day = dateKey(new Date());
let changeSeq = 0;

function saveMeta() { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
function saveLocal() { localStorage.setItem(DATA_KEY, JSON.stringify(data)); }

// Every change goes through here: save locally, then sync.
function commit() {
  saveLocal();
  meta.dirty = true;
  changeSeq++;
  saveMeta();
  render();
  scheduleSync();
}

const findFood = (id) => data.foods.find((f) => f.id === id && !f.deleted);
const findEntry = (id) => data.entries.find((e) => e.id === id && !e.deleted);

function remove(list, id) {
  const i = list.findIndex((r) => r.id === id);
  if (i >= 0) list[i] = { id, deleted: true, updatedAt: now() };
}

// ---------- Rendering ----------

function dayLabel(key) {
  const today = dateKey(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (key === today) return 'Today';
  if (key === dateKey(y)) return 'Yesterday';
  return new Date(key + 'T12:00').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
}

function shiftDay(n) {
  const d = new Date(day + 'T12:00');
  d.setDate(d.getDate() + n);
  day = dateKey(d);
  render();
}

function render() {
  $('dayLabel').textContent = dayLabel(day);
  const entries = live(data.entries).filter((e) => e.date === day).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  entries.forEach((e) => MACROS.forEach(([k]) => { totals[k] += e[k]; }));

  const box = $('totals');
  box.replaceChildren();
  for (const [k, label, unit] of MACROS) {
    const target = data.targets[k];
    const bar = el('div', 'bar');
    const top = el('div', 'top');
    top.append(el('b', '', `${label} ${round(k, totals[k])}${target ? ' / ' + target : ''} ${unit}`));
    if (target) {
      const left = round(k, target - totals[k]);
      top.append(el('span', 'left', left >= 0 ? `${left} left` : `${-left} over`));
      if (left < 0) bar.classList.add('over');
    }
    const track = el('div', 'track');
    const fill = el('div', 'fill');
    fill.style.width = target ? Math.min(100, (totals[k] / target) * 100) + '%' : '0';
    fill.style.background = `var(--${k})`;
    track.append(fill);
    bar.append(top, track);
    box.append(bar);
  }
  if (!Object.values(data.targets).some(Boolean)) box.append(el('p', 'muted', 'Set your daily targets in Settings (⚙).'));

  const list = $('entries');
  list.replaceChildren();
  for (const e of entries) {
    const li = el('li');
    const left = el('div');
    left.append(el('div', 'name', e.name), el('div', 'sub',
      `${e.grams ? e.grams + ' g · ' : ''}P ${round('protein', e.protein)} · C ${round('carbs', e.carbs)} · F ${round('fat', e.fat)}`));
    li.append(left, el('div', 'kcal', `${round('kcal', e.kcal)} kcal`));
    li.onclick = () => editEntry(e.id);
    list.append(li);
  }
  $('emptyDay').hidden = entries.length > 0;
  renderPresets();
  renderSyncStatus();
}

// ---------- Foods and entries ----------

function macrosFor(food, grams) {
  const out = {};
  MACROS.forEach(([k]) => { out[k] = (food[k] * grams) / 100; });
  return out;
}

function renderFoodList() {
  const q = $('foodSearch').value.trim().toLowerCase();
  const foods = live(data.foods)
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '') || a.name.localeCompare(b.name));
  const list = $('foodList');
  list.replaceChildren();
  for (const f of foods) {
    const li = el('li');
    const left = el('div');
    left.append(el('div', 'name', f.name), el('div', 'sub', `per 100 g: P ${f.protein} · C ${f.carbs} · F ${f.fat}`));
    li.append(left, el('div', 'kcal', `${round('kcal', f.kcal)} kcal`));
    li.onclick = () => { $('addDialog').close(); openAmount(f.id, null); };
    list.append(li);
  }
  if (!foods.length) list.append(el('li', 'muted', live(data.foods).length ? 'No match.' : 'No saved foods yet. Tap New food or Scan.'));
}

// Dialogs keep ids, not objects, because a sync can replace the data while a dialog is open.
let amountCtx = null; // { foodId, entryId }

function openAmount(foodId, entryId) {
  const food = findFood(foodId);
  const entry = entryId && findEntry(entryId);
  amountCtx = { foodId, entryId };
  $('amountTitle').textContent = food.name;
  $('amountGrams').value = entry ? entry.grams : (food.lastGrams || food.serving || 100);
  const sb = $('servingButtons');
  sb.replaceChildren();
  if (food.serving) {
    for (const n of [1, 2]) {
      const b = el('button', '', `${n} serving${n > 1 ? 's' : ''} (${n * food.serving} g)`);
      b.type = 'button';
      b.onclick = () => { $('amountGrams').value = n * food.serving; updateAmountPreview(); };
      sb.append(b);
    }
  }
  $('amountOk').textContent = entry ? 'Save' : 'Add';
  $('deleteEntryBtn').hidden = !entry;
  updateAmountPreview();
  $('amountDialog').showModal();
}

function updateAmountPreview() {
  const food = findFood(amountCtx.foodId);
  if (!food) return;
  const m = macrosFor(food, num($('amountGrams').value));
  $('amountPreview').textContent =
    `${round('kcal', m.kcal)} kcal · P ${round('protein', m.protein)} g · C ${round('carbs', m.carbs)} g · F ${round('fat', m.fat)} g`;
}

function saveAmount() {
  const food = findFood(amountCtx.foodId);
  const grams = num($('amountGrams').value);
  if (!food || !grams) return;
  const values = { name: food.name, grams, foodId: food.id, ...macrosFor(food, grams), updatedAt: now() };
  const entry = amountCtx.entryId && findEntry(amountCtx.entryId);
  if (entry) Object.assign(entry, values);
  else data.entries.push({ id: uid(), date: day, time: now(), ...values });
  Object.assign(food, { lastUsed: now(), lastGrams: grams, updatedAt: now() });
  commit();
}

function editEntry(id) {
  const entry = findEntry(id);
  if (!entry) return;
  if (entry.foodId && findFood(entry.foodId)) openAmount(entry.foodId, id);
  else openQuick(id);
}

let foodCtx = null; // { foodId, barcode, then }

function openFood(foodId, { barcode = null, prefill = null, source = '', then = null } = {}) {
  foodCtx = { foodId, barcode, then };
  const v = (foodId && findFood(foodId)) || prefill || {};
  $('foodTitle').textContent = foodId ? 'Edit food' : 'New food';
  $('foodSource').textContent = source;
  $('foodSource').hidden = !source;
  $('foodName').value = v.name || '';
  $('foodKcal').value = v.kcal ?? '';
  $('foodProtein').value = v.protein ?? '';
  $('foodCarbs').value = v.carbs ?? '';
  $('foodFat').value = v.fat ?? '';
  $('foodServing').value = v.serving || '';
  $('deleteFoodBtn').hidden = !foodId;
  $('foodDialog').showModal();
}

function saveFood() {
  const values = {
    name: $('foodName').value.trim() || 'Unnamed food',
    kcal: num($('foodKcal').value), protein: num($('foodProtein').value),
    carbs: num($('foodCarbs').value), fat: num($('foodFat').value),
    serving: num($('foodServing').value) || null,
    updatedAt: now(),
  };
  let food = foodCtx.foodId && findFood(foodCtx.foodId);
  if (food) Object.assign(food, values);
  else {
    food = { id: uid(), barcode: foodCtx.barcode, ...values };
    data.foods.push(food);
  }
  commit();
  if (foodCtx.then) foodCtx.then(food.id);
}

let quickId = null;

function openQuick(id) {
  const entry = id && findEntry(id);
  quickId = entry ? id : null;
  $('quickTitle').textContent = entry ? 'Edit entry' : 'Quick add';
  $('quickName').value = entry ? entry.name : '';
  $('quickKcal').value = entry ? round('kcal', entry.kcal) : '';
  $('quickProtein').value = entry ? round('protein', entry.protein) : 0;
  $('quickCarbs').value = entry ? round('carbs', entry.carbs) : 0;
  $('quickFat').value = entry ? round('fat', entry.fat) : 0;
  $('deleteQuickBtn').hidden = !entry;
  $('quickDialog').showModal();
}

function saveQuick() {
  const values = {
    name: $('quickName').value.trim() || 'Quick add', grams: null, foodId: null,
    kcal: num($('quickKcal').value), protein: num($('quickProtein').value),
    carbs: num($('quickCarbs').value), fat: num($('quickFat').value),
    updatedAt: now(),
  };
  const entry = quickId && findEntry(quickId);
  if (entry) Object.assign(entry, values);
  else data.entries.push({ id: uid(), date: day, time: now(), ...values });
  commit();
}

function deleteEntry(id) {
  remove(data.entries, id);
  commit();
}

// ---------- Presets ----------
// A preset is a fixed set of totals with a name. One tap logs it as one entry.

const macroLine = (m) =>
  `${round('kcal', m.kcal)} kcal · P ${round('protein', m.protein)} · C ${round('carbs', m.carbs)} · F ${round('fat', m.fat)}`;

function addPreset(name, m, detail = '') {
  name = (name || '').trim();
  if (!name) return;
  data.presets.push({ id: uid(), name, detail, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, updatedAt: now() });
  commit();
  showToast(`Saved preset ${name}`);
}

function renderPresets() {
  const box = $('presetChips');
  box.replaceChildren();
  const presets = live(data.presets);
  for (const p of presets) {
    const b = el('button');
    b.append(el('span', '', p.name), el('span', 'sub', `${round('kcal', p.kcal)}`));
    b.onclick = () => logPreset(p.id);
    box.append(b);
  }
  if (!presets.length) box.append(el('p', 'muted', 'Use "Save preset" on any entry, then log it here with one tap.'));
}

function logPreset(id) {
  const p = data.presets.find((r) => r.id === id && !r.deleted);
  if (!p) return;
  const entryId = uid();
  data.entries.push({ id: entryId, date: day, time: now(), name: p.name, grams: null, foodId: null,
    kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, updatedAt: now() });
  commit();
  showToast(`Added ${p.name}`, () => deleteEntry(entryId));
}

let toastTimer = null;
let toastUndo = null;

function showToast(text, undo = null) {
  $('toastText').textContent = text;
  $('toastUndo').hidden = !undo;
  toastUndo = undo;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function openPresets() {
  const list = $('presetList');
  list.replaceChildren();
  for (const p of live(data.presets)) {
    const li = el('li');
    const left = el('div');
    left.append(el('div', 'name', p.name), el('div', 'sub', p.detail || macroLine(p)));
    const btns = el('div', 'btns');
    const rename = el('button', '', 'Rename');
    rename.type = 'button';
    rename.onclick = () => {
      const name = prompt('Preset name', p.name);
      if (!name || !name.trim()) return;
      Object.assign(p, { name: name.trim(), updatedAt: now() });
      commit();
      openPresets();
    };
    const del = el('button', 'danger', 'Delete');
    del.type = 'button';
    del.onclick = () => {
      if (!confirm(`Delete preset ${p.name}?`)) return;
      remove(data.presets, p.id);
      commit();
      openPresets();
    };
    btns.append(rename, del);
    li.append(left, btns);
    list.append(li);
  }
  if (!live(data.presets).length) list.append(el('li', 'muted', 'No presets yet.'));

  const meals = $('mealEntryList');
  meals.replaceChildren();
  const entries = live(data.entries).filter((e) => e.date === day);
  for (const e of entries) {
    const li = el('li');
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.value = e.id;
    label.append(box, el('span', '', `${e.name}${e.grams ? ' ' + e.grams + ' g' : ''} · ${round('kcal', e.kcal)} kcal`));
    li.append(label);
    meals.append(li);
  }
  if (!entries.length) meals.append(el('li', 'muted', 'Nothing logged on this day.'));
  $('mealName').value = '';
  if (!$('presetsDialog').open) $('presetsDialog').showModal();
}

function saveMealPreset() {
  const ids = [...$('mealEntryList').querySelectorAll('input:checked')].map((b) => b.value);
  const items = ids.map(findEntry).filter(Boolean);
  if (!items.length) { alert('Tick at least one entry.'); return; }
  const name = $('mealName').value.trim() || items.map((e) => e.name).join(' + ');
  const m = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  items.forEach((e) => MACROS.forEach(([k]) => { m[k] += e[k]; }));
  addPreset(name, m, items.map((e) => `${e.name}${e.grams ? ' ' + e.grams + ' g' : ''}`).join(' + '));
  openPresets();
}

// ---------- History export ----------

function csvCell(v) {
  const t = v == null ? '' : String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

async function exportCsv() {
  const rows = [['date', 'time', 'name', 'grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g']];
  const entries = live(data.entries).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  for (const e of entries) {
    const time = e.time ? new Date(e.time).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' }) : '';
    rows.push([e.date, time, e.name, e.grams ?? '', round('kcal', e.kcal), round('protein', e.protein),
      round('carbs', e.carbs), round('fat', e.fat)]);
  }
  const name = `macros-history-${dateKey(new Date())}.csv`;
  const file = new File(['\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
    return;
  }
  const a = el('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// ---------- Barcode scanning ----------

let reader = null;

async function openScan() {
  $('scanMsg').textContent = 'Point the camera at the barcode.';
  $('manualBarcode').value = '';
  $('scanDialog').showModal();
  try {
    reader = new ZXing.BrowserMultiFormatReader();
    await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, $('scanVideo'), (result) => {
      if (result) handleBarcode(result.getText());
    });
  } catch (err) {
    $('scanMsg').textContent = `Camera not available (${err.name || err.message}). Type the barcode instead.`;
  }
}

function stopScan() {
  if (reader) { reader.reset(); reader = null; }
}

async function handleBarcode(code) {
  code = code.trim();
  if (!code) return;
  stopScan();
  const known = live(data.foods).find((f) => f.barcode === code);
  if (known) { $('scanDialog').close(); openAmount(known.id, null); return; }

  $('scanMsg').textContent = `Looking up ${code}…`;
  let prefill = null;
  let source = `Barcode ${code} is not in Open Food Facts. Enter the values from the label.`;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json` +
      '?fields=product_name,brands,nutriments,serving_quantity');
    const json = await res.json();
    const p = json.product;
    if (json.status === 1 && p) {
      const n = p.nutriments || {};
      const kcal = n['energy-kcal_100g'] ?? (n['energy-kj_100g'] != null ? n['energy-kj_100g'] / 4.184 : undefined);
      prefill = {
        name: p.product_name || (p.brands && p.brands.split(',')[0].trim()) || `Barcode ${code}`,
        kcal: kcal != null ? round('kcal', kcal) : '',
        protein: n.proteins_100g ?? '', carbs: n.carbohydrates_100g ?? '', fat: n.fat_100g ?? '',
        serving: num(p.serving_quantity) || null,
      };
      source = 'From Open Food Facts. Check the values against the label before you save.';
    }
  } catch {
    source = 'Could not reach Open Food Facts. Enter the values from the label.';
  }
  $('scanDialog').close();
  openFood(null, { barcode: code, prefill, source, then: (id) => openAmount(id, null) });
}

// ---------- Sync through GitHub ----------
// One data.json in a private repository. Each sync reads it, merges it with this device,
// and writes it back only if something changed. Git keeps every earlier version.

let syncTimer = null;
let syncRunning = false;
let syncAgain = false;

const syncConfigured = () => Boolean(meta.repo && meta.token);

function scheduleSync(delay = 1500) {
  if (!syncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, delay);
}

function gh(path, opts = {}) {
  return fetch(`https://api.github.com/repos/${meta.repo}${path}`, {
    cache: 'no-store',
    ...opts,
    headers: { Authorization: `Bearer ${meta.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}) },
  });
}

async function ghError(res) {
  let msg = '';
  try { msg = (await res.json()).message; } catch { /* no body */ }
  if (res.status === 401) return 'token is invalid or expired';
  if (res.status === 403 || res.status === 404) return `no access to ${meta.repo} (check the token's repository and Contents permission)`;
  return `GitHub error ${res.status}${msg ? ': ' + msg : ''}`;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function readRemote() {
  const res = await gh(`/contents/${SYNC_FILE}`);
  if (res.status === 404) {
    // 404 means "no file yet" only if the repository itself is reachable.
    const repo = await gh('');
    if (repo.ok) return { remote: null, sha: null };
    throw new Error(await ghError(repo));
  }
  if (!res.ok) throw new Error(await ghError(res));
  const file = await res.json();
  let b64 = file.content;
  if (file.encoding !== 'base64' || !b64) { // files over 1 MB come without content
    const blob = await gh(`/git/blobs/${file.sha}`);
    if (!blob.ok) throw new Error(await ghError(blob));
    b64 = (await blob.json()).content;
  }
  const parsed = JSON.parse(fromBase64(b64));
  if (!isValidData(parsed)) throw new Error('the file in GitHub is not valid, so it was not changed');
  return { remote: normalize(parsed), sha: file.sha };
}

async function sync() {
  if (!syncConfigured()) return;
  if (syncRunning) { syncAgain = true; return; }
  syncRunning = true;
  const seq = changeSeq;
  renderSyncStatus('Syncing…');
  try {
    for (let attempt = 0; ; attempt++) {
      const { remote, sha } = await readRemote();
      const merged = merge(data, remote);
      const text = JSON.stringify(merged);
      if (text !== JSON.stringify(data)) { data = merged; saveLocal(); render(); }
      if (remote && text === JSON.stringify(remote)) break;
      const res = await gh(`/contents/${SYNC_FILE}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Log update ${now()}`, content: toBase64(JSON.stringify(merged, null, 1)),
          ...(sha ? { sha } : {}) }),
      });
      if (res.ok) break;
      // Another device wrote first: read again and merge.
      if ((res.status === 409 || res.status === 422) && attempt < 3) continue;
      throw new Error(await ghError(res));
    }
    meta.lastSyncAt = now();
    meta.lastError = null;
    if (seq === changeSeq) meta.dirty = false;
  } catch (err) {
    meta.lastError = err.message || String(err);
  } finally {
    syncRunning = false;
    saveMeta();
    renderSyncStatus();
    if (syncAgain || (meta.dirty && !meta.lastError)) { syncAgain = false; scheduleSync(); }
  }
}

function renderSyncStatus(text) {
  const s = $('syncStatus');
  s.className = 'status';
  if (text) { s.textContent = text; return; }
  if (!syncConfigured()) { s.textContent = 'Sync is not set up. Tap to set it up.'; s.classList.add('bad'); return; }
  if (meta.lastError) { s.textContent = `Sync failed: ${meta.lastError}. Tap to retry.`; s.classList.add('bad'); return; }
  if (meta.dirty) { s.textContent = 'Waiting to sync…'; return; }
  if (meta.lastSyncAt) {
    const t = new Date(meta.lastSyncAt);
    const today = dateKey(t) === dateKey(new Date());
    s.textContent = `Synced ${today ? 'at' : 'on'} ` + (today
      ? t.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
      : t.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }));
    s.classList.add('ok');
    return;
  }
  s.textContent = 'Sync is set up.';
}

// ---------- Settings ----------

function openSettings() {
  $('tKcal').value = data.targets.kcal || '';
  $('tProtein').value = data.targets.protein || '';
  $('tCarbs').value = data.targets.carbs || '';
  $('tFat').value = data.targets.fat || '';
  $('ghRepo').value = meta.repo;
  $('ghToken').value = meta.token;
  $('settingsMsg').textContent = '';
  $('settingsDialog').showModal();
}

function applySyncSettings() {
  const repo = $('ghRepo').value.trim();
  const token = $('ghToken').value.trim();
  if (repo !== meta.repo || token !== meta.token) {
    meta.repo = repo;
    meta.token = token;
    meta.lastError = null;
    saveMeta();
  }
}

function saveSettings() {
  applySyncSettings();
  const t = { kcal: num($('tKcal').value), protein: num($('tProtein').value), carbs: num($('tCarbs').value), fat: num($('tFat').value) };
  if (JSON.stringify(t) !== JSON.stringify(data.targets)) { data.targets = t; data.targetsUpdatedAt = now(); commit(); }
  else render();
  scheduleSync(0);
}

// ---------- Wiring ----------

function onSubmit(dialogId, fn) {
  $(dialogId).addEventListener('close', () => { if ($(dialogId).returnValue === 'ok') fn(); });
}

$('prevDay').onclick = () => shiftDay(-1);
$('nextDay').onclick = () => shiftDay(1);
$('openSettings').onclick = openSettings;
$('addBtn').onclick = () => { $('foodSearch').value = ''; renderFoodList(); $('addDialog').showModal(); };
$('scanBtn').onclick = openScan;
$('foodSearch').oninput = renderFoodList;
$('newFoodBtn').onclick = () => { $('addDialog').close(); openFood(null, { then: (id) => openAmount(id, null) }); };
$('quickAddBtn').onclick = () => { $('addDialog').close(); openQuick(null); };
$('amountGrams').oninput = updateAmountPreview;
$('editFoodBtn').onclick = () => {
  const { foodId, entryId } = amountCtx;
  $('amountDialog').close();
  openFood(foodId, { then: (id) => openAmount(id, entryId) });
};
$('deleteEntryBtn').onclick = () => { const id = amountCtx.entryId; $('amountDialog').close(); deleteEntry(id); };
$('deleteQuickBtn').onclick = () => { const id = quickId; $('quickDialog').close(); deleteEntry(id); };
$('deleteFoodBtn').onclick = () => {
  const food = findFood(foodCtx.foodId);
  if (!food || !confirm(`Delete ${food.name} from saved foods? Logged entries stay.`)) return;
  remove(data.foods, food.id);
  $('foodDialog').close();
  commit();
};
$('managePresetsBtn').onclick = openPresets;
$('saveMealBtn').onclick = saveMealPreset;
$('toastUndo').onclick = () => { if (toastUndo) toastUndo(); toastUndo = null; $('toast').hidden = true; };
$('amountPresetBtn').onclick = () => {
  const food = findFood(amountCtx.foodId);
  const grams = num($('amountGrams').value);
  if (!food || !grams) return;
  addPreset(prompt('Preset name', `${food.name} ${grams} g`), macrosFor(food, grams), `${food.name} ${grams} g`);
};
$('quickPresetBtn').onclick = () => {
  const m = { kcal: num($('quickKcal').value), protein: num($('quickProtein').value),
    carbs: num($('quickCarbs').value), fat: num($('quickFat').value) };
  addPreset(prompt('Preset name', $('quickName').value.trim() || 'Quick add'), m);
};
$('csvBtn').onclick = exportCsv;
$('manualBarcodeBtn').onclick = () => handleBarcode($('manualBarcode').value);
$('scanDialog').addEventListener('close', stopScan);
$('syncStatus').onclick = () => {
  if (!syncConfigured()) openSettings();
  else { meta.lastError = null; saveMeta(); scheduleSync(0); }
};
$('syncNowBtn').onclick = async () => {
  applySyncSettings();
  meta.lastError = null;
  await sync();
  $('settingsMsg').textContent = meta.lastError ? `Sync failed: ${meta.lastError}` : 'Synced.';
};

// Reset returnValue on open so a backdrop/escape close does not reuse an old "ok".
for (const d of document.querySelectorAll('dialog')) {
  const open = d.showModal.bind(d);
  d.showModal = () => { d.returnValue = ''; open(); };
}
onSubmit('amountDialog', saveAmount);
onSubmit('foodDialog', saveFood);
onSubmit('quickDialog', saveQuick);
onSubmit('settingsDialog', saveSettings);

// Pull changes from other devices when the app opens, comes back to the front, comes back
// online, and every minute while it is open.
window.addEventListener('online', () => scheduleSync(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { day = dateKey(new Date()); render(); scheduleSync(0); }
});
setInterval(() => { if (document.visibilityState === 'visible') scheduleSync(0); }, 60000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
scheduleSync(0);
