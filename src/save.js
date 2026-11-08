// IndexedDB persistence: the host's worlds (full world state incl. every player's empire, keyed by
// unique player IDs) and this browser's identity (player ID + name), so returning players rejoin
// with their saved empire.
const DB = 'saltfire';
const VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const st = t.objectStore(store);
    let out;
    Promise.resolve(fn(st)).then((v) => { out = v; });
    t.oncomplete = () => res(out?.result ?? out);
    t.onerror = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function kvGet(key) { const db = await open(); return req(db.transaction('kv').objectStore('kv').get(key)); }
export async function kvSet(key, val) { return tx('kv', 'readwrite', (st) => st.put(val, key)); }

/** This browser's persistent player identity. */
export async function identity() {
  let id = null;
  try { id = await kvGet('identity'); } catch { /* private mode */ }
  if (!id) {
    try { id = JSON.parse(localStorage.getItem('saltfire-identity') || 'null'); } catch { id = null; }
  }
  if (!id) {
    const rnd = crypto.getRandomValues(new Uint8Array(9));
    id = { pid: 'P' + [...rnd].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14), name: '' };
  }
  await saveIdentity(id);
  return id;
}
export async function saveIdentity(id) {
  try { localStorage.setItem('saltfire-identity', JSON.stringify(id)); } catch { /* ignore */ }
  try { await kvSet('identity', id); } catch { /* ignore */ }
}

export async function listWorlds() {
  try { const db = await open(); const all = await req(db.transaction('worlds').objectStore('worlds').getAll()); return all.map((w) => ({ id: w.id, name: w.name, saved: w.saved, code: w.code, players: Object.keys(w.W.players || {}).length })).sort((a, b) => b.saved - a.saved); }
  catch { return []; }
}
export async function loadWorld(id) { const db = await open(); return req(db.transaction('worlds').objectStore('worlds').get(id)); }
export async function saveWorld(rec) {
  rec.saved = Date.now();
  // clone: drop runtime-only fields
  const W = JSON.parse(JSON.stringify(rec.W, (k, v) => (k === 'cd' ? undefined : v)));
  return tx('worlds', 'readwrite', (st) => st.put({ ...rec, W }));
}
export async function deleteWorld(id) { return tx('worlds', 'readwrite', (st) => st.delete(id)); }
