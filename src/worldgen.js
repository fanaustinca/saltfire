// Seeded world generation: Free Port, claimable islands, AI pirate holds, resource islets, reefs.
import { WORLD_R, BUILDINGS, CLAN_NAMES } from './config.js';
import { uid } from './economy.js';

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const PRE = ['Gull', 'Salt', 'Brine', 'Cutlass', 'Ember', 'Widow\'s', 'Coral', 'Barnacle', 'Rum', 'Lantern', 'Mistral', 'Shell', 'Drift', 'Sable', 'Tide', 'Kestrel', 'Jade', 'Grog', 'Hook', 'Doubloon', 'Parrot', 'Skull', 'Bones', 'Cannon', 'Smuggler\'s', 'Mermaid', 'Gallows', 'Siren', 'Cinder', 'Black', 'Scurvy', 'Plank', 'Marrow', 'Corsair', 'Thunder', 'Viper'];
const SUF = ['Rock', 'Cay', 'Isle', 'Reach', 'Bay', 'Hollow', 'Key', 'Atoll', 'Point', 'Cove', 'Spit', 'Haven', 'Bluff', 'Teeth', 'Landing', 'Shoal'];
const HOLD_NAMES = ['Blackfang Hold', 'Red Tide Roost', 'Skullcrag', 'Gull\'s Gallows', 'Widow\'s Keep', 'Wraith Rock', 'Teeth of the Deep', 'Cinder Citadel', 'Bone Harbour', 'Crimson Spire'];

/** Wild (squatter) garrison: stronger the further from the Free Port. */
export function wildGarrison(b, d) {
  b.lvl = Math.max(1, Math.round(1 + d / 550));
  b.buildings = [{ id: uid('b'), type: 'camp', slot: -1, hp: Math.round(BUILDINGS.camp.hp * (0.7 + d / 2500)) }];
  const guns = Math.min(5, Math.floor(d / 1200));
  for (let k = 0; k < guns; k++) b.buildings.push({ id: uid('b'), type: 'cannon', slot: dockAngleOf(b) + 0.9 + (k / Math.max(1, guns)) * 4.4, hp: BUILDINGS.cannon.hp });
  if (d > 2800) b.buildings.push({ id: uid('b'), type: 'watchtower', slot: 0, hp: BUILDINGS.watchtower.hp });
  if (d > 4700) b.buildings.push({ id: uid('b'), type: 'fort', slot: dockAngleOf(b) + Math.PI, hp: BUILDINGS.fort.hp });
}
const dockAngleOf = (b) => ((b.seed || 0) % 628) / 100;

export function newClan(W, i, baseId) {
  const id = 'ai:clan:' + i;
  W.ai[id] = { id, name: CLAN_NAMES[i % CLAN_NAMES.length], clan: true, inv: { gold: 1500, oak: 120, iron: 60, canvas: 40, powder: 10 }, level: 1, plan: 0, base: baseId, raidT: 300 + i * 70, color: (i * 47) % 360, fleet: [] };
  return id;
}

export function generateIslands(W) {
  const r = rng(W.seed);
  const placed = [];
  const free = (x, z, rad) => Math.hypot(x, z) < WORLD_R - 200 && placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad + 150);
  const put = (rad, minD = 0, maxD = WORLD_R - 300) => {
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(minD * minD + r() * (maxD * maxD - minD * minD));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (free(x, z, rad)) { placed.push({ x, z, r: rad }); return { x, z }; }
    }
    return null;
  };
  W.islands = [];
  W.bases = [];
  W.ai ||= {};
  W.ai['ai:merchant'] = { id: 'ai:merchant', name: 'Merchant Guild', inv: { gold: 20000, oak: 200, iron: 80, canvas: 120, powder: 20 } };
  // Free Port: neutral trade town, permanent safe haven
  placed.push({ x: 0, z: 0, r: 120 });
  W.islands.push({ id: 'port', kind: 'port', name: 'Free Port of Saltfire', x: 0, z: 0, r: 110, seed: 1 });
  // AI pirate clan holds: fortified, conquerable, and they upgrade themselves over time
  const used = new Set();
  const nameOf = () => { for (let i = 0; i < 50; i++) { const n = PRE[Math.floor(r() * PRE.length)] + ' ' + SUF[Math.floor(r() * SUF.length)]; if (!used.has(n)) { used.add(n); return n; } } return 'Nameless Isle'; };
  for (let i = 0; i < 8; i++) {
    const rad = 74 + r() * 12;
    const p = put(rad, 1700, WORLD_R - 350);
    if (!p) continue;
    const b = { id: 'h' + i, name: HOLD_NAMES[i], x: p.x, z: p.z, r: rad, owner: null, buildings: [], haven: { safe: false, fee: 0 }, paid: {}, seed: Math.floor(r() * 1e6), hold: true };
    b.owner = newClan(W, i, b.id);
    b.buildings.push({ id: uid('b'), type: 'keep', slot: -1, hp: BUILDINGS.keep.hp });
    b.buildings.push({ id: uid('b'), type: 'watchtower', slot: 0, hp: BUILDINGS.watchtower.hp });
    b.buildings.push({ id: uid('b'), type: 'warehouse', slot: 1, hp: BUILDINGS.warehouse.hp });
    b.buildings.push({ id: uid('b'), type: 'dock', slot: 2, hp: BUILDINGS.dock.hp });
    const nc = 3 + (i % 3);
    for (let k = 0; k < nc; k++) b.buildings.push({ id: uid('b'), type: 'cannon', slot: dockAngleOf(b) + 0.8 + (k / nc) * 4.7, hp: BUILDINGS.cannon.hp });
    if (i % 3 === 2) b.buildings.push({ id: uid('b'), type: 'fort', slot: dockAngleOf(b) + 0.4, hp: BUILDINGS.fort.hp });
    W.bases.push(b);
  }
  // wild islands: claim them by beating the squatters (harder the further out you go)
  for (let i = 0; i < 64; i++) {
    const rad = 50 + r() * 18;
    const p = put(rad, 430, WORLD_R - 350);
    if (!p) continue;
    const b = { id: 'b' + i, name: nameOf(), x: p.x, z: p.z, r: rad, owner: 'ai:wild', buildings: [], haven: { safe: false, fee: 0, allies: true, allow: [] }, paid: {}, seed: Math.floor(r() * 1e6) };
    wildGarrison(b, Math.hypot(p.x, p.z));
    W.bases.push(b);
  }
  // resource islets
  const kinds = ['oak', 'oak', 'iron', 'canvas', 'oak', 'iron', 'canvas', 'powder'];
  for (let i = 0; i < 90; i++) {
    const res = kinds[i % kinds.length];
    const rad = 26 + r() * 18;
    const p = put(rad, 260, WORLD_R - 200);
    if (!p) continue;
    W.islands.push({ id: 'r' + i, kind: 'res', res, name: { oak: 'Timber Islet', iron: 'Ironstone Rock', canvas: 'Hemp Isle', powder: 'Sulphur Spit' }[res], x: p.x, z: p.z, r: rad, amt: 100, seed: Math.floor(r() * 1e6) });
  }
  // decorative rocks / reefs / sea stacks
  for (let i = 0; i < 120; i++) {
    const rad = 6 + r() * 12;
    const p = put(rad, 200, WORLD_R - 100);
    if (p) W.islands.push({ id: 'k' + i, kind: 'rock', x: p.x, z: p.z, r: rad, seed: Math.floor(r() * 1e6) });
  }
  return W;
}
