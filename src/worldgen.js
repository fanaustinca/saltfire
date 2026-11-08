// Seeded world generation: Free Port, claimable islands, AI pirate holds, resource islets, reefs.
import { WORLD_R, BUILDINGS } from './config.js';
import { uid } from './economy.js';

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const NAMES = ['Gull Rock', 'Saltmarrow', 'Brineholt', 'Cutlass Cay', 'Ember Isle', 'Widow\'s Reach', 'Coral Teeth', 'Barnacle Bay', 'Rumhollow', 'Lantern Key', 'Mistral Atoll', 'Shellback', 'Driftwood', 'Sable Cay', 'Tidewater', 'Kestrel Isle', 'Jade Lagoon', 'Grog Island', 'Hook Point', 'Doubloon Key'];
const HOLD_NAMES = ['Blackfang Hold', 'Red Tide Roost', 'Skullcrag'];

export function generateIslands(W) {
  const r = rng(W.seed);
  const placed = [];
  const free = (x, z, rad) => Math.hypot(x, z) < WORLD_R - 200 && placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad + 160);
  const put = (rad, minD = 0, maxD = WORLD_R - 300) => {
    for (let i = 0; i < 400; i++) {
      const a = r() * Math.PI * 2, d = minD + r() * (maxD - minD);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (free(x, z, rad)) { placed.push({ x, z, r: rad }); return { x, z }; }
    }
    return null;
  };
  W.islands = [];
  W.bases = [];
  // Free Port: neutral trade town, permanent safe haven
  placed.push({ x: 0, z: 0, r: 120 });
  W.islands.push({ id: 'port', kind: 'port', name: 'Free Port of Saltfire', x: 0, z: 0, r: 110, seed: 1 });
  // claimable islands (start small)
  let ni = 0;
  for (let i = 0; i < 14; i++) {
    const rad = 52 + r() * 14;
    const p = put(rad, 420, WORLD_R - 400);
    if (!p) continue;
    W.bases.push({ id: 'b' + i, name: NAMES[ni++ % NAMES.length], x: p.x, z: p.z, r: rad, owner: null, buildings: [], haven: { safe: false, fee: 0, allies: true, allow: [] }, paid: {}, seed: Math.floor(r() * 1e6) });
  }
  // AI pirate holds: fortified, conquerable
  for (let i = 0; i < 3; i++) {
    const rad = 70 + r() * 10;
    const p = put(rad, 1100, WORLD_R - 250);
    if (!p) continue;
    const b = { id: 'h' + i, name: HOLD_NAMES[i], x: p.x, z: p.z, r: rad, owner: 'ai:pirates', buildings: [], haven: { safe: false, fee: 0 }, paid: {}, seed: Math.floor(r() * 1e6), hold: true };
    b.buildings.push({ id: uid('b'), type: 'keep', slot: -1, hp: BUILDINGS.keep.hp });
    b.buildings.push({ id: uid('b'), type: 'watchtower', slot: 0, hp: BUILDINGS.watchtower.hp });
    b.buildings.push({ id: uid('b'), type: 'warehouse', slot: 1, hp: BUILDINGS.warehouse.hp });
    b.buildings.push({ id: uid('b'), type: 'dock', slot: 2, hp: BUILDINGS.dock.hp });
    for (let k = 0; k < 4 + i * 2; k++) b.buildings.push({ id: uid('b'), type: 'cannon', slot: (k / (4 + i * 2)) * Math.PI * 2 + 0.3, hp: BUILDINGS.cannon.hp });
    if (i === 2) b.buildings.push({ id: uid('b'), type: 'fort', slot: 1.2, hp: BUILDINGS.fort.hp });
    W.bases.push(b);
  }
  // resource islets
  const kinds = ['oak', 'oak', 'iron', 'canvas', 'oak', 'iron', 'canvas', 'powder'];
  for (let i = 0; i < 22; i++) {
    const res = kinds[i % kinds.length];
    const rad = 26 + r() * 16;
    const p = put(rad, 250, WORLD_R - 200);
    if (!p) continue;
    W.islands.push({ id: 'r' + i, kind: 'res', res, name: { oak: 'Timber Islet', iron: 'Ironstone Rock', canvas: 'Hemp Isle', powder: 'Sulphur Spit' }[res], x: p.x, z: p.z, r: rad, amt: 100, seed: Math.floor(r() * 1e6) });
  }
  // decorative rocks / reefs
  for (let i = 0; i < 26; i++) {
    const rad = 6 + r() * 12;
    const p = put(rad, 200, WORLD_R - 100);
    if (p) W.islands.push({ id: 'k' + i, kind: 'rock', x: p.x, z: p.z, r: rad, seed: Math.floor(r() * 1e6) });
  }
  return W;
}
