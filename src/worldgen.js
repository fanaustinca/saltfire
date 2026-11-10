// Seeded world generation: Free Port, claimable islands, AI pirate holds, resource islets, reefs.
import { WORLD_R, BUILDINGS, CLAN_NAMES } from './config.js';
import { uid } from './economy.js';

export function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const PRE = ['Gull', 'Salt', 'Brine', 'Cutlass', 'Ember', 'Widow\'s', 'Coral', 'Barnacle', 'Rum', 'Lantern', 'Mistral', 'Shell', 'Drift', 'Sable', 'Tide', 'Kestrel', 'Jade', 'Grog', 'Hook', 'Doubloon', 'Parrot', 'Skull', 'Bones', 'Cannon', 'Smuggler\'s', 'Mermaid', 'Gallows', 'Siren', 'Cinder', 'Black', 'Scurvy', 'Plank', 'Marrow', 'Corsair', 'Thunder', 'Viper'];
const SUF = ['Rock', 'Cay', 'Isle', 'Reach', 'Bay', 'Hollow', 'Key', 'Atoll', 'Point', 'Cove', 'Spit', 'Haven', 'Bluff', 'Teeth', 'Landing', 'Shoal'];
const HOLD_NAMES = ['Blackfang Hold', 'Red Tide Roost', 'Skullcrag', 'Gull\'s Gallows', 'Widow\'s Keep', 'Wraith Rock', 'Teeth of the Deep', 'Cinder Citadel', 'Bone Harbour', 'Crimson Spire', 'Jackal\'s Rest', 'Gilded Fang', 'Anchor Graveyard', 'Deadlight Bastion', 'Stormwall', 'Maw of Saltfire', 'Hangman\'s Reach', 'Sunken Crown', 'Black Lantern', 'Rook\'s Nest'];

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
  W.islands = [];
  W.bases = [];
  W.ai ||= {};
  W.ai['ai:merchant'] = { id: 'ai:merchant', name: 'Merchant Guild', inv: { gold: 20000, oak: 200, iron: 80, canvas: 120, powder: 20 } };
  // Free Port: neutral trade town, permanent safe haven
  W.islands.push({ id: 'port', kind: 'port', name: 'Free Port of Saltfire', x: 0, z: 0, r: 110, seed: 1 });
  populate(W, r, { holds: 14, wild: 170, res: 240, rocks: 320, minD: 0 });
  W.worldR = WORLD_R;
  return W;
}

/** Older, smaller worlds gain the outer seas (the Deep Reaches) on load; everything already there stays put. */
export function expandWorld(W) {
  const old = W.worldR || 6000;
  if (old >= WORLD_R) return false;
  const r = rng((W.seed || 1) * 31 + old);
  const k = (WORLD_R * WORLD_R - old * old) / (WORLD_R * WORLD_R);   // share of the new area that is new
  populate(W, r, { holds: 6, wild: Math.round(170 * k), res: Math.round(240 * k), rocks: Math.round(320 * k), minD: old - 150 });
  W.worldR = WORLD_R;
  return true;
}

function populate(W, r, { holds, wild, res, rocks, minD }) {
  const placed = [{ x: 0, z: 0, r: 120 }];
  for (const i of W.islands) placed.push({ x: i.x, z: i.z, r: i.kind === 'port' ? 120 : i.r });
  for (const b of W.bases) placed.push({ x: b.x, z: b.z, r: b.r * 2.4 });
  const free = (x, z, rad) => Math.hypot(x, z) < WORLD_R - 200 && placed.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + rad + 150);
  const put = (rad, lo = 0, hi = WORLD_R - 300) => {
    lo = Math.max(lo, minD);
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(lo * lo + r() * (hi * hi - lo * lo));
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (free(x, z, rad)) { placed.push({ x, z, r: rad }); return { x, z }; }
    }
    return null;
  };
  const next = (list, pre) => list.reduce((m, o) => (o.id.startsWith(pre) && /^\d+$/.test(o.id.slice(pre.length)) ? Math.max(m, +o.id.slice(pre.length) + 1) : m), 0);
  const used = new Set([...W.bases, ...W.islands].map((o) => o.name));
  const nameOf = () => { for (let i = 0; i < 80; i++) { const n = PRE[Math.floor(r() * PRE.length)] + ' ' + SUF[Math.floor(r() * SUF.length)]; if (!used.has(n)) { used.add(n); return n; } } return 'Nameless Isle'; };
  // AI pirate clan holds: fortified, conquerable, and they upgrade themselves over time
  let hi = next(W.bases, 'h'), ci = Object.keys(W.ai).filter((k) => k.startsWith('ai:clan:')).length;
  for (let n = 0; n < holds; n++) {
    const rad = 74 + r() * 12;
    const p = put(rad * 2.2, 1700, WORLD_R - 350);
    if (!p) continue;
    const i = hi++;
    const b = { id: 'h' + i, name: HOLD_NAMES[i % HOLD_NAMES.length] + (i >= HOLD_NAMES.length ? ' II' : ''), x: p.x, z: p.z, r: rad, owner: null, buildings: [], haven: { safe: false, fee: 0 }, paid: {}, seed: Math.floor(r() * 1e6), hold: true };
    b.owner = newClan(W, ci++, b.id);
    b.buildings.push({ id: uid('b'), type: 'keep', slot: -1, hp: BUILDINGS.keep.hp });
    b.buildings.push({ id: uid('b'), type: 'watchtower', slot: 0, hp: BUILDINGS.watchtower.hp });
    b.buildings.push({ id: uid('b'), type: 'warehouse', slot: 1, hp: BUILDINGS.warehouse.hp });
    b.buildings.push({ id: uid('b'), type: 'dock', slot: 2, hp: BUILDINGS.dock.hp });
    const far = Math.hypot(p.x, p.z) > 7000;
    const nc = 3 + (i % 3) + (far ? 2 : 0);
    for (let k = 0; k < nc; k++) b.buildings.push({ id: uid('b'), type: 'cannon', slot: dockAngleOf(b) + 0.8 + (k / nc) * 4.7, hp: BUILDINGS.cannon.hp });
    if (i % 3 === 2 || far) b.buildings.push({ id: uid('b'), type: 'fort', slot: dockAngleOf(b) + 0.4, hp: BUILDINGS.fort.hp });
    W.bases.push(b);
  }
  // wild islands: claim them by beating the squatters (harder the further out you go)
  let wi = next(W.bases, 'b');
  for (let n = 0; n < wild; n++) {
    const rad = 50 + r() * 18;
    const p = put(rad * 2.4, 430, WORLD_R - 350);
    if (!p) continue;
    const b = { id: 'b' + wi++, name: nameOf(), x: p.x, z: p.z, r: rad, owner: 'ai:wild', buildings: [], haven: { safe: false, fee: 0, allies: true, allow: [] }, paid: {}, seed: Math.floor(r() * 1e6) };
    wildGarrison(b, Math.hypot(p.x, p.z));
    W.bases.push(b);
  }
  // resource islets
  const kinds = ['oak', 'oak', 'iron', 'canvas', 'oak', 'iron', 'canvas', 'powder'];
  let ri = next(W.islands, 'r');
  for (let n = 0; n < res; n++) {
    const rs = kinds[n % kinds.length];
    const rad = 26 + r() * 18;
    const p = put(rad, 260, WORLD_R - 200);
    if (!p) continue;
    W.islands.push({ id: 'r' + ri++, kind: 'res', res: rs, name: { oak: 'Timber Islet', iron: 'Ironstone Rock', canvas: 'Hemp Isle', powder: 'Sulphur Spit' }[rs], x: p.x, z: p.z, r: rad, amt: 100, seed: Math.floor(r() * 1e6) });
  }
  // decorative rocks / reefs / sea stacks
  let ki = next(W.islands, 'k');
  for (let n = 0; n < rocks; n++) {
    const rad = 6 + r() * 12;
    const p = put(rad, 200, WORLD_R - 100);
    if (p) W.islands.push({ id: 'k' + ki++, kind: 'rock', x: p.x, z: p.z, r: rad, seed: Math.floor(r() * 1e6) });
  }
}
