'use strict';

const DATA_KEY = 'macro-tracker-data';
const META_KEY = 'macro-tracker-meta'; // backup settings and status; never exported
const BACKUP_FILE = 'data.json';
const MACROS = [
  ['kcal', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
];

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : 0; };
const round = (key, v) => key === 'kcal' ? Math.round(v) : Math.round(v * 10) / 10;
const dateKey = (d) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// ---------- State ----------

function emptyData() {
  return { version: 1, targets: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, foods: [], entries: [], updatedAt: null };
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

let data = loadJSON(DATA_KEY, emptyData());
let meta = { repo: 'sammcentee/macro-tracker-data', token: '', sha: null, dirty: false, lastBackupAt: null, lastError: null,
  ...loadJSON(META_KEY, {}) };
let day = dateKey(new Date());
let changeSeq = 0;

function saveMeta() { localStorage.setItem(META_KEY, JSON.stringify(meta)); }

// Every change goes through here: save locally, then back up.
function commit() {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  meta.dirty = true;
  changeSeq++;
  saveMeta();
  render();
  scheduleBackup();
}

function isValidData(d) {
  return d && typeof d === 'object' && Array.isArray(d.entries) && Array.isArray(d.foods) && d.targets;
}

function replaceData(d) {
  data = { ...emptyData(), ...d };
  commit();
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
  const entries = data.entries.filter((e) => e.date === day);
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
    li.onclick = () => editEntry(e);
    list.append(li);
  }
  $('emptyDay').hidden = entries.length > 0;
  renderBackupStatus();
}

// ---------- Foods and entries ----------

function macrosFor(food, grams) {
  const out = {};
  MACROS.forEach(([k]) => { out[k] = (food[k] * grams) / 100; });
  return out;
}

function renderFoodList() {
  const q = $('foodSearch').value.trim().toLowerCase();
  const foods = data.foods
    .filter((f) => !q || f.name.toLowerCase().includes(q))
    .sort((a, b) => (b.lastUsed || '').localeCompare(a.lastUsed || '') || a.name.localeCompare(b.name));
  const list = $('foodList');
  list.replaceChildren();
  for (const f of foods) {
    const li = el('li');
    const left = el('div');
    left.append(el('div', 'name', f.name), el('div', 'sub', `per 100 g: P ${f.protein} · C ${f.carbs} · F ${f.fat}`));
    li.append(left, el('div', 'kcal', `${round('kcal', f.kcal)} kcal`));
    li.onclick = () => { $('addDialog').close(); openAmount(f, null); };
    list.append(li);
  }
  if (!foods.length) list.append(el('li', 'muted', data.foods.length ? 'No match.' : 'No saved foods yet. Tap New food or Scan.'));
}

let amountCtx = null; // { food, entry }

function openAmount(food, entry) {
  amountCtx = { food, entry };
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
  const m = macrosFor(amountCtx.food, num($('amountGrams').value));
  $('amountPreview').textContent =
    `${round('kcal', m.kcal)} kcal · P ${round('protein', m.protein)} g · C ${round('carbs', m.carbs)} g · F ${round('fat', m.fat)} g`;
}

function saveAmount() {
  const { food, entry } = amountCtx;
  const grams = num($('amountGrams').value);
  if (!grams) return;
  const values = { name: food.name, grams, foodId: food.id, ...macrosFor(food, grams) };
  if (entry) Object.assign(entry, values);
  else data.entries.push({ id: uid(), date: day, time: new Date().toISOString(), ...values });
  food.lastUsed = new Date().toISOString();
  food.lastGrams = grams;
  commit();
}

function editEntry(entry) {
  const food = entry.foodId && data.foods.find((f) => f.id === entry.foodId);
  if (food) openAmount(food, entry);
  else openQuick(entry);
}

let foodCtx = null; // { food, barcode, then }

function openFood(food, { barcode = null, prefill = null, source = '', then = null } = {}) {
  foodCtx = { food, barcode, then };
  const v = food || prefill || {};
  $('foodTitle').textContent = food ? 'Edit food' : 'New food';
  $('foodSource').textContent = source;
  $('foodSource').hidden = !source;
  $('foodName').value = v.name || '';
  $('foodKcal').value = v.kcal ?? '';
  $('foodProtein').value = v.protein ?? '';
  $('foodCarbs').value = v.carbs ?? '';
  $('foodFat').value = v.fat ?? '';
  $('foodServing').value = v.serving || '';
  $('deleteFoodBtn').hidden = !food;
  $('foodDialog').showModal();
}

function saveFood() {
  const values = {
    name: $('foodName').value.trim() || 'Unnamed food',
    kcal: num($('foodKcal').value), protein: num($('foodProtein').value),
    carbs: num($('foodCarbs').value), fat: num($('foodFat').value),
    serving: num($('foodServing').value) || null,
  };
  let food = foodCtx.food;
  if (food) Object.assign(food, values);
  else {
    food = { id: uid(), barcode: foodCtx.barcode, ...values };
    data.foods.push(food);
  }
  commit();
  if (foodCtx.then) foodCtx.then(food);
}

let quickEntry = null;

function openQuick(entry) {
  quickEntry = entry;
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
  };
  if (quickEntry) Object.assign(quickEntry, values);
  else data.entries.push({ id: uid(), date: day, time: new Date().toISOString(), ...values });
  commit();
}

function deleteEntry(entry) {
  data.entries = data.entries.filter((e) => e !== entry);
  commit();
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
  const known = data.foods.find((f) => f.barcode === code);
  if (known) { $('scanDialog').close(); openAmount(known, null); return; }

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
  openFood(null, { barcode: code, prefill, source, then: (food) => openAmount(food, null) });
}

// ---------- Backup to GitHub ----------

let backupTimer = null;
let backupRunning = false;

const backupConfigured = () => Boolean(meta.repo && meta.token);

function scheduleBackup(delay = 1500) {
  if (!backupConfigured()) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(backup, delay);
}

async function ghFetch(opts = {}, accept = 'application/vnd.github+json') {
  return fetch(`https://api.github.com/repos/${meta.repo}/contents/${BACKUP_FILE}`, {
    cache: 'no-store',
    ...opts,
    headers: { Authorization: `Bearer ${meta.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28',
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

async function remoteSha() {
  const res = await ghFetch();
  if (res.status === 404) {
    // 404 means a missing file only if the repository itself is reachable.
    const repo = await fetch(`https://api.github.com/repos/${meta.repo}`, {
      cache: 'no-store', headers: { Authorization: `Bearer ${meta.token}` } });
    if (repo.ok) return null;
    throw new Error(await ghError(repo));
  }
  if (!res.ok) throw new Error(await ghError(res));
  return (await res.json()).sha;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function backup() {
  if (!backupConfigured() || !meta.dirty) return;
  if (backupRunning) { scheduleBackup(); return; }
  backupRunning = true;
  const seq = changeSeq;
  renderBackupStatus('Backing up…');
  try {
    if (!meta.sha) {
      // First backup from this device: do not silently overwrite an existing backup.
      const sha = await remoteSha();
      if (sha && !confirm('A backup already exists in GitHub. Overwrite it with the data on this phone?\n\n' +
          'Tap Cancel, then use Settings → Restore from backup if you want the GitHub copy.')) {
        throw new Error('stopped so the existing backup is not overwritten');
      }
      meta.sha = sha;
    }
    const put = (sha) => ghFetch({
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Log update ${new Date().toISOString()}`, content: toBase64(JSON.stringify(data, null, 1)),
        ...(sha ? { sha } : {}) }),
    });
    let res = await put(meta.sha);
    if (res.status === 409 || res.status === 422) res = await put(await remoteSha()); // stale sha: refresh once
    if (!res.ok) throw new Error(await ghError(res));
    meta.sha = (await res.json()).content.sha;
    meta.lastBackupAt = new Date().toISOString();
    meta.lastError = null;
    if (seq === changeSeq) meta.dirty = false;
  } catch (err) {
    meta.lastError = err.message || String(err);
  } finally {
    backupRunning = false;
    saveMeta();
    renderBackupStatus();
    if (meta.dirty && !meta.lastError) scheduleBackup();
  }
}

async function restore() {
  if (!backupConfigured()) { $('settingsMsg').textContent = 'Enter the repository and token first.'; return; }
  $('settingsMsg').textContent = 'Downloading backup…';
  try {
    const res = await ghFetch({}, 'application/vnd.github.raw+json');
    if (res.status === 404) throw new Error('no backup found');
    if (!res.ok) throw new Error(await ghError(res));
    const remote = JSON.parse(await res.text());
    if (!isValidData(remote)) throw new Error('the backup file is not valid');
    if (!confirm(`Replace the data on this phone with the backup from ${remote.updatedAt || 'GitHub'}?\n` +
        `(${remote.entries.length} entries, ${remote.foods.length} foods)`)) { $('settingsMsg').textContent = ''; return; }
    meta.sha = await remoteSha();
    data = { ...emptyData(), ...remote };
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
    meta.dirty = false;
    meta.lastError = null;
    meta.lastBackupAt = new Date().toISOString();
    saveMeta();
    $('settingsMsg').textContent = 'Restored.';
    render();
  } catch (err) {
    $('settingsMsg').textContent = `Restore failed: ${err.message}`;
  }
}

function renderBackupStatus(text) {
  const s = $('backupStatus');
  s.className = 'status';
  if (text) { s.textContent = text; return; }
  if (!backupConfigured()) { s.textContent = 'Backup is not set up. Tap to set it up.'; s.classList.add('bad'); return; }
  if (meta.lastError) { s.textContent = `Backup failed: ${meta.lastError}. Tap to retry.`; s.classList.add('bad'); return; }
  if (meta.dirty) { s.textContent = 'Waiting to back up…'; return; }
  if (meta.lastBackupAt) {
    const t = new Date(meta.lastBackupAt);
    s.textContent = `Backed up ${dateKey(t) === dateKey(new Date()) ? 'at' : 'on'} ` +
      (dateKey(t) === dateKey(new Date()) ? t.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })
        : t.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' }));
    s.classList.add('ok');
    return;
  }
  s.textContent = 'Backup is set up. It runs after your next change.';
}

// ---------- File export and import ----------

async function exportFile() {
  const name = `macros-${dateKey(new Date())}.json`;
  const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* user cancelled */ }
    return;
  }
  const a = el('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importFile(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!isValidData(d)) throw new Error('not a Macros backup file');
    if (!confirm(`Replace the data on this phone with this file?\n(${d.entries.length} entries, ${d.foods.length} foods)`)) return;
    replaceData(d);
    $('settingsMsg').textContent = 'Imported.';
  } catch (err) {
    $('settingsMsg').textContent = `Import failed: ${err.message}`;
  }
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

function applyBackupSettings() {
  const repo = $('ghRepo').value.trim();
  const token = $('ghToken').value.trim();
  if (repo !== meta.repo || token !== meta.token) {
    if (repo !== meta.repo) meta.sha = null;
    meta.repo = repo;
    meta.token = token;
    meta.lastError = null;
    saveMeta();
  }
}

function saveSettings() {
  applyBackupSettings();
  const t = { kcal: num($('tKcal').value), protein: num($('tProtein').value), carbs: num($('tCarbs').value), fat: num($('tFat').value) };
  if (JSON.stringify(t) !== JSON.stringify(data.targets)) { data.targets = t; commit(); }
  else render();
  scheduleBackup(0);
}

// ---------- Wiring ----------

function onSubmit(dialogId, fn) {
  $(dialogId).addEventListener('close', () => { if ($(dialogId).returnValue === 'ok') fn(); });
}

$('prevDay').onclick = () => shiftDay(-1);
$('nextDay').onclick = () => shiftDay(1);
$('openSettings').onclick = openSettings;
$('addBtn').onclick = () => { $('foodSearch').value = ''; renderFoodList(); $('addDialog').returnValue = ''; $('addDialog').showModal(); };
$('scanBtn').onclick = openScan;
$('foodSearch').oninput = renderFoodList;
$('newFoodBtn').onclick = () => { $('addDialog').close(); openFood(null, { then: (food) => openAmount(food, null) }); };
$('quickAddBtn').onclick = () => { $('addDialog').close(); openQuick(null); };
$('amountGrams').oninput = updateAmountPreview;
$('editFoodBtn').onclick = () => {
  const ctx = amountCtx;
  $('amountDialog').close();
  openFood(ctx.food, { then: (food) => openAmount(food, ctx.entry) });
};
$('deleteEntryBtn').onclick = () => { const e = amountCtx.entry; $('amountDialog').close(); deleteEntry(e); };
$('deleteQuickBtn').onclick = () => { const e = quickEntry; $('quickDialog').close(); deleteEntry(e); };
$('deleteFoodBtn').onclick = () => {
  if (!confirm(`Delete ${foodCtx.food.name} from saved foods? Logged entries stay.`)) return;
  data.foods = data.foods.filter((f) => f !== foodCtx.food);
  $('foodDialog').close();
  commit();
};
$('manualBarcodeBtn').onclick = () => handleBarcode($('manualBarcode').value);
$('scanDialog').addEventListener('close', stopScan);
$('backupStatus').onclick = () => {
  if (!backupConfigured()) openSettings();
  else { meta.lastError = null; meta.dirty = true; saveMeta(); scheduleBackup(0); }
};
$('backupNowBtn').onclick = async () => {
  applyBackupSettings();
  meta.dirty = true;
  meta.lastError = null;
  await backup();
  $('settingsMsg').textContent = meta.lastError ? `Backup failed: ${meta.lastError}` : 'Backed up.';
};
$('restoreBtn').onclick = () => { applyBackupSettings(); restore(); };
$('exportBtn').onclick = exportFile;
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; };

// Reset returnValue on open so a backdrop/escape close does not reuse an old "ok".
for (const d of document.querySelectorAll('dialog')) {
  const open = d.showModal.bind(d);
  d.showModal = () => { d.returnValue = ''; open(); };
}
onSubmit('amountDialog', saveAmount);
onSubmit('foodDialog', saveFood);
onSubmit('quickDialog', saveQuick);
onSubmit('settingsDialog', saveSettings);

// Retry a pending backup when the phone comes back online or the app is reopened.
window.addEventListener('online', () => scheduleBackup(0));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { day = dateKey(new Date()); render(); scheduleBackup(0); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
render();
scheduleBackup(0);
