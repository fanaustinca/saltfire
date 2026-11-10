// World simulation. On the host (authority) it runs everything: ship physics for AI, gunnery and
// damage, loot, AI spawning (lots of weak ships + some strong level-matched ones), AI-vs-AI fights,
// player fleets on missions, bases + defences, conquest (by players *and* pirate clans), clans that
// trade on the market and fortify their holds, world events, production. On clients it only
// advances visual cannonballs and effects; ship state arrives in snapshots.
import {
  AI_TOP_TIER, TIERS, tierById, tierIndex, AMMO, GRAVITY, MUZZLE, SECTOR_HALF, CHASE_HALF, MIN_RANGE, BUILDINGS,
  HAVEN_R, WORLD_R, MAX_LEVEL, UPGRADES, CLAN_PLAN, claimFee,
} from './config.js';
import {
  shipStats, shipSpec, crewEff, flagship, addXp, hostile, shielded, havenAccess, sinkLoot, gain, produce,
  npcRestock, newProfile, uid, clamp, aiFaction, fleetCap, build as buildOn, canAfford, bestAsk, bestBid,
  instantBuy, placeOrder, NPC_PRICES,
} from './economy.js';
import { gunLayout } from './layout.js';
import { buildingPos, harborPoint, baseRadius, baseShape, dockAngle, assignRoom } from './basegeo.js';
import { heightAt } from './waves.js';
import { islandShape } from './islandshape.js';
import { newClan } from './worldgen.js';

export const SAIL_STEPS = [0, 0.34, 0.67, 1];
export const SAIL_NAMES = ['Anchored', 'Battle Sails', 'Half Sail', 'Full Sail'];
const TAU = Math.PI * 2;
export const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const BALL_DMG = 30;
const LAND_CELL = 250;
export const DOCK_SPEED = 10;
const isCore = (bd) => bd.type === 'keep' || bd.type === 'camp';
const NONE = [];

/** Ballistic low-angle solution: elevation to hit horizontal distance d with height difference h. */
export function solveElev(d, h, v = MUZZLE) {
  const g = GRAVITY, v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
  if (disc < 0) return null;
  return Math.atan((v2 - Math.sqrt(disc)) / (g * d));
}
/** Which firing arc a world point falls in, relative to ship (x,z,yaw). */
export function arcOf(s, px, pz) {
  const dx = px - s.x, dz = pz - s.z;
  const lx = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw);
  const lz = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw);
  const a = Math.atan2(lx, lz); // 0 = dead ahead, +pi/2 = port (L)
  const d = Math.hypot(dx, dz);
  const cands = [];
  cands.push({ side: 'L', off: Math.abs(wrapA(a - Math.PI / 2)), half: SECTOR_HALF });
  cands.push({ side: 'R', off: Math.abs(wrapA(a + Math.PI / 2)), half: SECTOR_HALF });
  cands.push({ side: 'bow', off: Math.abs(wrapA(a)), half: CHASE_HALF });
  cands.push({ side: 'stern', off: Math.abs(wrapA(a - Math.PI)), half: CHASE_HALF });
  cands.sort((p, q) => p.off / p.half - q.off / q.half);
  const best = cands.find((c) => (c.side === 'bow' ? s.stats.bow : c.side === 'stern' ? s.stats.stern : 1) > 0) || cands[0];
  return { side: best.side, inSector: best.off <= best.half, dist: d, ang: a };
}
export function localToWorld(s, lx, ly, lz) {
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  return [s.x + lx * c + lz * sn, ly, s.z - lx * sn + lz * c];
}

/** Upgrade ranks for an AI captain of level `lvl` (spread like a player would spend points). */
export function aiUpgrades(lvl) {
  const f = Math.min(1, Math.max(0, lvl - 1) / 210);
  const u = {};
  for (const [k, U] of Object.entries(UPGRADES)) u[k] = Math.round(U.max * f);
  u.bow = lvl > 8 ? Math.max(1, u.bow) : u.bow; u.stern = lvl > 14 ? Math.max(1, u.stern) : u.stern;
  u.fleet = 0;
  return u;
}

/** Bring older saves up to date (clans, guild, wild islands). */
export function migrateWorld(W) {
  W.ai ||= {};
  W.ai['ai:merchant'] ||= { id: 'ai:merchant', name: 'Merchant Guild', inv: { gold: 20000, oak: 200, iron: 80, canvas: 120, powder: 20 } };
  let ci = Object.keys(W.ai).filter((k) => k.startsWith('ai:clan:')).length;
  for (const b of W.bases) if (b.owner === 'ai:pirates') b.owner = newClan(W, ci++, b.id);
  for (const p of Object.values(W.players)) for (const s of p.fleet || []) s.out = false;
  assignRoom(W);
}

export class Sim {
  constructor(W, { authority = true, rand = Math.random } = {}) {
    this.W = W;
    this.authority = authority;
    this.rand = rand;
    if (authority) migrateWorld(W);
    this.clock = () => Date.now(); // wall clock for daily rewards (tests override it)
    this.ships = new Map();
    this.balls = [];
    this.crates = [];
    this.kraken = null;
    this.fx = [];          // render/network effects
    this.msgs = [];        // { to: pid|null, text, kind }
    this.prompts = [];     // { to, kind, ... } (fee prompts)
    this.dirty = { meta: true, prof: new Set() };
    this.evT = 240;        // seconds to the first world event
    this.spawnT = 0;
    this.restockT = 0;
    this.clanT = 0;
    this.econT = 5;
    this.time = 0;
    this.capture = new Map(); // baseId -> { owner, t }
    this.damagers = new Map(); // targetId -> Map(owner -> dmg)
    this.aiDensity = 16;
  }

  // ------------------------------------------------------------------ ships
  addShip(o) {
    const stats = shipStats(o.spec, o.upg || {});
    const s = {
      id: o.id || uid('a'), owner: o.owner, pid: o.pid || null, kind: o.pid ? 'player' : 'ai', role: o.role || 'player',
      name: o.name || o.spec.name, spec: o.spec, upg: o.upg || {}, stats, guns: gunLayout(stats),
      x: o.x || 0, z: o.z || 0, yaw: o.yaw || 0, spd: 0, sail: o.sail ?? 0.67, sailNow: 0, rud: 0,
      hull: stats.hull, sails: stats.sails, crew: stats.crew,
      reload: { L: 0, R: 0, bow: 0, stern: 0 }, ammo: 'ball', fire: 0, sink: 0, level: o.level || 1,
      ai: o.ai || null, tag: o.tag || null, docked: null, harvest: false, recoil: 0, hitT: -1e9, look: o.look || null,
    };
    if (o.spec.hp != null) s.hull = Math.max(1, Math.min(stats.hull, o.spec.hp));
    this.ships.set(s.id, s);
    this.dirty.meta = true;
    return s;
  }
  /** Recompute stats after upgrades / flagship changes, keeping damage fractions. */
  refreshShip(s) {
    const fh = s.hull / s.stats.hull, fs = s.sails / s.stats.sails, fc = s.crew / s.stats.crew;
    const owner = this.W.players[s.pid || s.owner];
    if (owner && (s.pid || s.role === 'fleet')) s.upg = { ...owner.upg };
    s.stats = shipStats(s.spec, s.upg);
    s.guns = gunLayout(s.stats);
    s.hull = s.stats.hull * fh; s.sails = s.stats.sails * fs; s.crew = Math.round(s.stats.crew * fc);
    s.rev = (s.rev || 0) + 1;
    this.dirty.meta = true;
  }
  removeShip(id) { this.ships.delete(id); this.dirty.meta = true; }

  /** (Re)spawn a player's flagship at their home harbour or the Free Port. */
  spawnPlayer(pid) {
    const p = this.W.players[pid];
    const spec = flagship(p);
    const home = this.homeOf(pid);
    let x, z, yaw;
    const T = tierById(spec.tier);
    if (home) { const h = harborPoint(home, T.len); x = h.x; z = h.z; yaw = h.yaw; }
    else { const a = this.rand() * TAU; x = Math.cos(a) * 200; z = Math.sin(a) * 200; yaw = Math.atan2(Math.cos(a), Math.sin(a)); }
    const old = this.ships.get('p:' + pid);
    if (old) this.ships.delete(old.id);
    const s = this.addShip({ id: 'p:' + pid, pid, owner: pid, spec, upg: p.upg, x, z, yaw, level: p.level, name: spec.name, sail: 0 });
    // keep who steers it (the host's own ship is stepped locally) and bump the life counter so
    // clients snap to the new spawn point instead of staying frozen where they sank
    if (old) { s.local = old.local; s.life = (old.life || 0) + 1; }
    spec.hp = null;
    s.look = { hullColor: spec.hullColor, trimColor: spec.trimColor, sailColor: spec.sailColor, emblem: spec.emblem, flag: p.color, trail: p.trail || null };
    return s;
  }
  homeOf(pid) {
    const bs = this.W.bases.filter((b) => b.owner === pid);
    return bs.find((b) => b.id === this.W.players[pid]?.home) || bs[0] || null;
  }

  /** Ship physics, shared by local player control and AI. */
  stepShip(s, dt) {
    if (s.sink > 0) { s.sink += dt; s.spd *= 0.97; return; }
    if (s.docked) { s.spd = 0; s.sailNow += (0 - s.sailNow) * Math.min(1, dt * 2); return; }
    const st = s.stats;
    s.sailNow += (s.sail - s.sailNow) * Math.min(1, dt * 1.1);
    const sailF = 0.35 + 0.65 * (s.sails / st.sails);
    const eff = crewEff(s.crew, st.crew);
    const target = st.speed * s.sailNow * sailF * (0.85 + 0.15 * eff);
    const acc = target > s.spd ? 0.2 + 0.25 * s.sailNow : 0.45;
    s.spd += (target - s.spd) * Math.min(1, dt * acc);
    const way = 0.3 + 0.7 * Math.min(1, s.spd / (st.speed * 0.3));
    s.yaw = wrapA(s.yaw + s.rud * st.turn * eff * way * dt);
    s.x += Math.sin(s.yaw) * s.spd * dt;
    s.z += Math.cos(s.yaw) * s.spd * dt;
    s.recoil *= Math.exp(-dt * 2.5);
    if (s.fire > 0) { s.fire -= dt; if (this.authority) this.hurt(s, 5 * dt, 0, 0, null, true); }
    for (const k in s.reload) if (s.reload[k] > 0) s.reload[k] -= dt;
    this.collideIslands(s);
    const r = Math.hypot(s.x, s.z);
    if (r > WORLD_R) { s.x *= WORLD_R / r; s.z *= WORLD_R / r; s.spd *= 0.9; }
  }
  collideIslands(s) {
    const pts = [[0, 0], [0, s.stats.len * 0.38], [0, -s.stats.len * 0.38]];
    for (const [lx, lz] of pts) {
      const [wx, , wz] = localToWorld(s, lx, 0, lz);
      for (const isl of this.landNear(wx, wz)) {
        const dx = wx - isl.x, dz = wz - isl.z, d = Math.hypot(dx, dz);
        if (d > isl.r + s.stats.beam) continue;
        const R = (isl.S ? isl.S.edge(Math.atan2(dz, dx)) * 0.95 : isl.r * 0.92) + s.stats.beam * 0.35;
        if (d < R && d > 0.01) {
          const push = R - d;
          s.x += (dx / d) * push; s.z += (dz / d) * push;
          s.spd *= 0.9;
          if (this.authority && s.spd > 8 && this.rand() < 0.05) this.hurt(s, 4, 0, 0, null);
        }
      }
    }
  }
  /** Circles (and shaped coves) that ships can't sail through, bucketed in a grid. */
  landmasses() {
    if (this._land && this.time - this._landT < 2 && this._landT <= this.time) return this._land;
    const L = [];
    for (const i of this.W.islands) {
      if (i.kind === 'res' || i.kind === 'port') L.push({ x: i.x, z: i.z, r: i.r * 1.16, S: islandShape({ seed: i.seed || 7, R: i.r, bayA: null, kind: i.kind }), isl: i });
      else L.push({ x: i.x, z: i.z, r: i.r });
    }
    for (const b of this.W.bases) {
      const S = baseShape(b);
      L.push({ x: b.x, z: b.z, r: S.R * 1.16, S, base: b });
      for (const bd of b.buildings) if (bd.type === 'fort') { const p = buildingPos(b, bd); L.push({ x: p.x, z: p.z, r: 14 }); }
    }
    this._land = L; this._landT = this.time;
    const G = new Map();
    for (const l of L) {
      const reach = l.r + 30;
      for (let gx = Math.floor((l.x - reach) / LAND_CELL); gx <= Math.floor((l.x + reach) / LAND_CELL); gx++)
        for (let gz = Math.floor((l.z - reach) / LAND_CELL); gz <= Math.floor((l.z + reach) / LAND_CELL); gz++) {
          const k = gx * 65536 + gz; let a = G.get(k); if (!a) G.set(k, (a = [])); a.push(l);
        }
    }
    this._grid = G;
    return L;
  }
  landNear(x, z) { this.landmasses(); return this._grid.get(Math.floor(x / LAND_CELL) * 65536 + Math.floor(z / LAND_CELL)) || NONE; }
  /** Terrain height at (x,z), or null over open water. */
  groundAt(x, z) {
    for (const l of this.landNear(x, z)) {
      const dx = x - l.x, dz = z - l.z, d = Math.hypot(dx, dz);
      if (d > l.r) continue;
      if (l.S) { const a = Math.atan2(dz, dx); if (d < l.S.edge(a)) return l.S.hAt(d, a); }
      else if (d < l.r * 0.9) return 3 + (1 - d / l.r) * 10;
    }
    return null;
  }
  /** Does a point hit land? */
  landHit(x, y, z) { const g = this.groundAt(x, z); return g != null && y < g + 0.4; }
  /** Height of whatever is at (x,z): land or the wave surface. */
  surfaceAt(x, z) { const g = this.groundAt(x, z); const w = heightAt(x, z, this.time); return g == null ? w : Math.max(w, g); }
  collideShips(s, others) {
    const rs = s.stats.beam * 0.6;
    for (const o of others) {
      if (o === s || o.sink > 0) continue;
      const dx = s.x - o.x, dz = s.z - o.z;
      const reach = (s.stats.len + o.stats.len) * 0.5;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      for (const a of [-0.33, 0, 0.33]) for (const b of [-0.33, 0, 0.33]) {
        const [ax, , az] = localToWorld(s, 0, 0, a * s.stats.len);
        const [bx, , bz] = localToWorld(o, 0, 0, b * o.stats.len);
        const ddx = ax - bx, ddz = az - bz, d = Math.hypot(ddx, ddz), R = rs + o.stats.beam * 0.6;
        if (d < R && d > 0.01) { const push = (R - d) * 0.5; s.x += (ddx / d) * push; s.z += (ddz / d) * push; s.spd *= 0.985; }
      }
    }
  }

  // ------------------------------------------------------------------ gunnery
  /** Is combat blocked at this point by a safe haven? */
  inHaven(x, z) {
    if (Math.hypot(x, z) < HAVEN_R) return true; // Free Port
    for (const b of this.W.bases) if (b.owner && b.haven?.safe && !b.owner.startsWith('ai:') && Math.hypot(x - b.x, z - b.z) < HAVEN_R * 0.75) return true;
    return false;
  }
  /** Validate + create the balls of a broadside. Returns {balls, err}. Deterministic given `rand`. */
  planBroadside(s, side, ax, az, ammo = 'ball', rand = this.rand) {
    if (s.sink > 0 || s.docked) return { err: 'Cannot fire now' };
    if (s.reload[side] > 0) return { err: 'Reloading' };
    if (this.inHaven(s.x, s.z) || this.inHaven(ax, az)) return { err: 'No fighting inside a safe haven' };
    const arc = arcOf(s, ax, az);
    if (arc.side !== side || !arc.inSector) return { err: 'Target outside the firing arc' };
    const guns = s.guns.filter((g) => g.side === side);
    if (!guns.length) return { err: 'No cannons on that side' };
    const A = AMMO[ammo] || AMMO.ball;
    const range = s.stats.range * (A.speed * A.speed);
    const d = Math.min(arc.dist, range);
    const eff = crewEff(s.crew, s.stats.crew);
    const balls = [];
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const dirx = (ax - s.x) / (arc.dist || 1), dirz = (az - s.z) / (arc.dist || 1);
    const tx = s.x + dirx * d, tz = s.z + dirz * d;
    const heave = s.heave || 0;
    const v = (s.stats.muzzle || MUZZLE) * A.speed;
    const dmg = BALL_DMG * (s.stats.dmg || 1);
    const inDeck = {};
    guns.forEach((g) => {
      const [mx, my0, mz] = localToWorld(s, g.x, g.y, g.z);
      // decks fire in quick succession (0.2 s apart), each deck as a fast ripple
      const k = (inDeck[g.deck || 0] = (inDeck[g.deck || 0] ?? -1) + 1), nd = guns.length / Math.max(1, new Set(guns.map((x) => x.deck || 0)).size);
      const delay = (g.deck || 0) * 0.2 + Math.min(0.18, (k / Math.max(1, nd)) * 0.18) + rand() * 0.03;
      const my = my0 + heave;
      // broadside guns fire parallel: shift the aim point by the gun's offset along the hull
      const along = side === 'L' || side === 'R' ? g.z : g.x;
      const ox = side === 'L' || side === 'R' ? fx * along : Math.cos(s.yaw) * along;
      const oz = side === 'L' || side === 'R' ? fz * along : -Math.sin(s.yaw) * along;
      const spread = (0.012 + 0.03 * (1 - eff)) * (s.stats.spread ?? 1) * d;
      const px = tx + ox + (rand() - 0.5) * 2 * spread, pz = tz + oz + (rand() - 0.5) * 2 * spread;
      const hd = Math.max(MIN_RANGE * 0.5, Math.hypot(px - mx, pz - mz));
      const el = solveElev(hd, this.surfaceAt(px, pz) + 1.6 - my, v) ?? 0.26;
      const hx = (px - mx) / hd, hz = (pz - mz) / hd;
      balls.push({ x: mx, y: my, z: mz, vx: hx * v * Math.cos(el), vy: v * Math.sin(el), vz: hz * v * Math.cos(el), ammo, delay, dmg, gl: [g.x, g.y, g.z], yaw0: s.yaw });
    });
    return { balls };
  }
  /** Fire: consumes ammo + starts reload. `balls` may come from a client (trusted) or be planned here. */
  fire(s, side, ax, az, ammo = 'ball', given = null) {
    const p = s.pid ? this.W.players[s.pid] : null;
    if (ammo !== 'ball' && p && (p.inv[ammo] || 0) <= 0) ammo = 'ball';
    const plan = given ? { balls: given } : this.planBroadside(s, side, ax, az, ammo);
    if (plan.err) return plan;
    if (ammo !== 'ball' && p) { p.inv[ammo] = Math.max(0, p.inv[ammo] - plan.balls.length); this.dirty.prof.add(p.id); }
    const eff = crewEff(s.crew, s.stats.crew);
    s.reload[side] = s.stats.reload / eff;
    s.recoil += (side === 'L' ? 1 : side === 'R' ? -1 : 0) * Math.min(1, plan.balls.length * 0.08);
    for (const b of plan.balls) this.spawnBall(s, b);
    this.fx.push({ t: 'fire', ship: s.id, side, n: plan.balls.length, balls: plan.balls.map((b) => [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.delay || 0, ...(b.gl ? [...b.gl, b.yaw0] : [])]), ammo });
    return plan;
  }
  spawnBall(s, b) {
    const dmg = Math.min(BALL_DMG * 2, b.dmg || BALL_DMG);
    this.balls.push({ ...b, shooter: s ? s.id : b.shooter, owner: s ? s.owner : b.owner, level: s ? s.level : (b.level || 1), t: -(b.delay || 0), dmg, vis: !this.authority });
  }

  /** A delayed gun fires from where its ship is NOW (not where the order was given). */
  releaseBall(b) {
    const sh = this.ships.get(b.shooter);
    if (!sh || sh.sink > 0) return;
    const [mx, my, mz] = localToWorld(sh, b.gl[0], b.gl[1], b.gl[2]);
    b.x = mx; b.y = my + (sh.heave || 0); b.z = mz;
    const d = sh.yaw - (b.yaw0 ?? sh.yaw), c = Math.cos(d), sn = Math.sin(d), vx = b.vx;
    b.vx = vx * c + b.vz * sn; b.vz = -vx * sn + b.vz * c;
  }
  stepBalls(dt) {
    const keep = [];
    for (const b of this.balls) {
      const was = b.t;
      b.t += dt;
      if (b.t < 0) { keep.push(b); continue; }
      if (was < 0 && b.gl) this.releaseBall(b);
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.t > 12) continue;
      let hit = false;
      for (const s of this.ships.values()) {
        if (s.id === b.shooter || s.sink > 0) continue;
        const dx = b.x - s.x, dz = b.z - s.z;
        if (dx * dx + dz * dz > s.stats.len * s.stats.len) continue;
        const lx = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw);
        const lz = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw);
        const hl = s.stats.len / 2, hb = (s.stats.beam / 2) * (1 - 0.55 * Math.pow(Math.abs(lz) / hl, 3));
        const hullTop = s.stats.depth * 0.9 + 1.2, by = b.y - (s.heave || 0);
        const inHull = Math.abs(lz) < hl && Math.abs(lx) < hb && by < hullTop && by > -2.5;
        const inRig = !inHull && Math.abs(lz) < hl * 0.75 && Math.abs(lx) < s.stats.beam * 0.9 && by >= hullTop && by < s.stats.len * 0.9;
        if (inHull || inRig) {
          hit = true;
          if (this.authority) this.ballHitShip(b, s, inRig);
          this.fx.push({ t: 'hit', x: b.x, y: b.y, z: b.z, rig: inRig, ammo: b.ammo, ship: s.id, lx: Math.round(lx * 10) / 10, ly: Math.round(by * 10) / 10, lz: Math.round(lz * 10) / 10 });
          break;
        }
      }
      if (hit) continue;
      if (this.kraken && this.kraken.hp > 0 && this.hitKraken(b)) continue;
      if (b.y < 50 && this.hitBuilding(b)) continue;
      if (b.y < 60 && this.landHit(b.x, b.y, b.z)) { this.fx.push({ t: 'dirt', x: b.x, y: b.y, z: b.z }); if (this.authority) this.splashBuildings(b); continue; }
      if (b.vy < 0 && b.y < heightAt(b.x, b.z, this.time) - (b.t < 1.2 ? 0.9 : 0.1)) { this.fx.push({ t: 'splash', x: b.x, z: b.z, ammo: b.ammo }); continue; }
      keep.push(b);
    }
    this.balls = keep;
  }
  ballHitShip(b, s, rig) {
    if (s.docked) return;
    if (this.inHaven(s.x, s.z)) return;
    if (!hostile(this.W, b.owner, s.owner)) return;
    const A = AMMO[b.ammo] || AMMO.ball;
    const lvl = 0.85 + 0.03 * Math.min(60, b.level || 1);
    const base = b.dmg * lvl * (s.stats.armor ?? 1);
    const hullD = base * A.hull * (rig ? 0.2 : 1);
    const sailD = base * A.sail * (rig ? 1.6 : 0.6);
    const crewD = A.crew * (1.5 + this.rand() * 2) * (rig ? 0.6 : 1);
    this.hurt(s, hullD, sailD, crewD, b.owner);
    if (A.fire && this.rand() < 0.35) s.fire = Math.max(s.fire, 6);
    const shooter = this.ships.get(b.shooter);
    const p = shooter && this.W.players[shooter.owner];
    if (p) { addXp(p, 2); this.dirty.prof.add(p.id); }
  }
  hurt(s, hull, sail, crew, by, quiet = false) {
    if (s.sink > 0) return;
    if (s.stats.invincible) { if (!quiet) s.hitT = this.time; return; } // unused by stock tiers (dev god mode patches hurt instead)
    s.hull -= hull; s.sails = Math.max(0, s.sails - sail); s.crew = Math.max(0, s.crew - crew);
    if (!quiet) s.hitT = this.time;
    if (by) { if (!this.damagers.has(s.id)) this.damagers.set(s.id, new Map()); const m = this.damagers.get(s.id); m.set(by, (m.get(by) || 0) + hull + sail * 0.5); s.lastBy = by; }
    if (s.hull <= 0) this.sinkShip(s);
  }
  sinkShip(s) {
    s.hull = 0; s.sink = 0.001; s.fire = 0;
    this.fx.push({ t: 'sink', ship: s.id, x: s.x, z: s.z });
    const ti = tierIndex(s.spec.tier);
    const loot = sinkLoot(s.spec.tier, this.rand);
    if (s.role === 'merchant') { loot.gold *= 2; loot.canvas *= 2; loot.oak *= 2; }
    if (s.tag === 'treasure') { loot.gold *= 8; loot.powder += 20; }
    if (s.pid) { // players drop a share of their cargo
      const p = this.W.players[s.pid];
      for (const k of ['oak', 'iron', 'canvas', 'powder']) { const q = Math.floor((p.inv[k] || 0) * 0.2); p.inv[k] -= q; loot[k] = q; }
      loot.gold = Math.floor(p.inv.gold * 0.1); p.inv.gold -= loot.gold;
      this.dirty.prof.add(p.id);
      this.msgs.push({ to: s.pid, text: 'Your ship went down! Respawning at your harbour…', kind: 'bad' });
    }
    if (s.role === 'fleet') {
      const p = this.W.players[s.owner];
      const sp = p?.fleet.find((x) => x.uid === s.spec.uid);
      if (sp) { sp.out = false; sp.wrecked = true; sp.hp = 0; }
      if (p) { this.msgs.push({ to: p.id, text: `Your ${s.name} was sunk! Her wreck was towed home — repair her in any harbour (Fleet).`, kind: 'bad' }); this.dirty.prof.add(p.id); }
      loot.gold = Math.round(loot.gold * 0.3);
    }
    // a clan that sinks a ship pockets part of the gold
    const killer = s.lastBy && this.W.ai?.[s.lastBy];
    if (killer?.clan) { killer.inv.gold += Math.round(loot.gold * 0.6); loot.gold = Math.round(loot.gold * 0.4); }
    this.crates.push({ id: uid('c'), x: s.x, z: s.z, loot, t: 0, big: s.tag === 'treasure' || ti >= 4 });
    const dm = this.damagers.get(s.id);
    if (dm) {
      let tot = 0; for (const v of dm.values()) tot += v;
      for (const [owner, v] of dm) {
        const p = this.W.players[owner];
        if (!p || owner === s.owner) continue;
        const xp = (45 * (ti + 1) * (1 + s.level / 8)) * (s.tag === 'treasure' ? 5 : 1) * (0.3 + 0.7 * v / tot);
        const lv = addXp(p, xp);
        if (owner === s.lastBy) p.kills = (p.kills || 0) + 1;
        this.dirty.prof.add(owner);
        this.msgs.push({ to: owner, text: `Sank the ${s.name}! +${Math.round(xp)} XP`, kind: 'good' });
        if (lv) this.msgs.push({ to: owner, text: `Level up! You are now level ${p.level} — spend upgrade points in port.`, kind: 'level' });
      }
      this.damagers.delete(s.id);
    }
    if (s.tag === 'treasure') this.msgs.push({ to: null, text: 'The Treasure Flagship has been sunk! Its gold floats free…', kind: 'event' });
  }

  // ------------------------------------------------------------------ buildings / bases
  hitBuilding(b) {
    for (const base of this.W.bases) {
      const R = baseRadius(base);
      if (Math.abs(b.x - base.x) > R * 1.2 + 70 || Math.abs(b.z - base.z) > R * 1.2 + 70) continue;
      for (const bd of base.buildings) {
        const p = buildingPos(base, bd);
        if (Math.hypot(b.x - p.x, b.z - p.z) < p.rad && b.y < p.y + p.h && b.y > p.y - 3) {
          this.fx.push({ t: 'stone', x: b.x, y: b.y, z: b.z });
          if (this.authority) this.damageBuilding(base, bd, b, 1);
          return true;
        }
      }
    }
    return false;
  }
  /** Shells that slam into the hillside still shake nearby buildings. */
  splashBuildings(b) {
    for (const base of this.W.bases) {
      const R = baseRadius(base);
      if (Math.abs(b.x - base.x) > R * 1.2 + 30 || Math.abs(b.z - base.z) > R * 1.2 + 30) continue;
      let best = null, bd = 18;
      for (const x of base.buildings) { if (x.hp <= 0) continue; const p = buildingPos(base, x); const d = Math.hypot(b.x - p.x, b.z - p.z) - p.rad; if (d < bd) { bd = d; best = x; } }
      if (best) this.damageBuilding(base, best, b, 0.55);
      return;
    }
  }
  damageBuilding(base, bd, b, mul) {
    if (!base.owner || !hostile(this.W, b.owner, base.owner)) return;
    if (shielded(this.W, base.owner)) { this.fx.push({ t: 'shield', x: b.x, y: b.y, z: b.z }); return; }
    if (base.haven?.safe && this.inHaven(b.x, b.z) && !this.isTrespasser(b.owner, base)) return;
    const A = AMMO[b.ammo] || AMMO.ball;
    const was = bd.hp;
    bd.hp = Math.max(0, bd.hp - b.dmg * (0.6 + A.hull * 0.6) * mul);
    base.hitT = this.time;
    this.dirty.meta = true;
    if (bd.hp <= 0 && was > 0) { const p = buildingPos(base, bd); this.fx.push({ t: 'collapse', x: p.x, y: p.y, z: p.z, base: base.id, bd: bd.id }); }
    const p2 = this.W.players[b.owner];
    if (p2) { addXp(p2, 1); this.dirty.prof.add(p2.id); }
  }
  isTrespasser(owner, base) { const s = this.ships.get('p:' + owner); return !!(s && s.trespass && s.trespass[base.id]); }

  stepBases(dt) {
    const W = this.W;
    for (const base of W.bases) {
      if (!base.owner) continue;
      const shield = shielded(W, base.owner);
      const fac = aiFaction(base.owner);
      // AI holds + squatters slowly rebuild when left alone
      if (fac && this.time - (base.hitT ?? -1e9) > 60) for (const bd of base.buildings) bd.hp = Math.min(this.maxHp(base, bd), bd.hp + BUILDINGS[bd.type].hp * 0.004 * dt);
      for (const bd of base.buildings) {
        const B = BUILDINGS[bd.type];
        let gun = B.gun || (bd.type === 'keep' ? { range: 220, dmg: 34, reload: 3.5 } : null);
        if (!gun || bd.hp <= 0 || shield) continue;
        bd.cd = (bd.cd || 0) - dt;
        if (bd.cd > 0) continue;
        if (fac === 'wild') { const k = 0.35 + (base.lvl || 1) * 0.1; gun = { range: gun.range * 0.85, dmg: gun.dmg * k, reload: gun.reload * 1.2 }; }
        else if (fac === 'clan') { const lv = W.ai[base.owner]?.level || 1; gun = { range: gun.range, dmg: gun.dmg * (0.9 + lv * 0.08), reload: gun.reload }; }
        const p = buildingPos(base, bd);
        const tgt = this.nearestTarget(p.x, p.z, gun.range, (s) => this.baseHostileTo(base, s));
        if (!tgt) { bd.cd = 0.5 + this.rand() * 0.3; continue; }
        bd.cd = gun.reload * (0.85 + this.rand() * 0.3);
        const shots = bd.type === 'fort' ? 2 : 1;
        for (let k = 0; k < shots; k++) {
          const from = { x: p.x + (this.rand() - 0.5) * 6, y: p.y + p.h * 0.6, z: p.z + (this.rand() - 0.5) * 6 };
          const ball = this.aimBall(from, tgt, 0.03, 'ball');
          if (!ball) continue;
          ball.dmg = gun.dmg; ball.delay = k * 0.25;
          this.balls.push({ ...ball, shooter: 'base:' + base.id, owner: base.owner, level: 10, t: -ball.delay });
          this.fx.push({ t: 'fire', ship: null, side: 'base', n: 1, balls: [[ball.x, ball.y, ball.z, ball.vx, ball.vy, ball.vz, ball.delay]], ammo: 'ball' });
        }
      }
      this.stepCapture(base, dt, shield);
      // entry fees for visitors
      if (base.haven && base.haven.fee > 0 && !fac) {
        for (const s of this.ships.values()) {
          if (!s.pid || s.pid === base.owner || s.sink > 0) continue;
          const d = Math.hypot(s.x - base.x, s.z - base.z);
          const acc = havenAccess(W, base, s.pid);
          const paid = (base.paid?.[s.pid] || 0) > W.time;
          s.trespass ||= {};
          if (d < HAVEN_R * 0.75 && acc.fee > 0 && !paid) {
            s.feeT ||= {};
            s.feeT[base.id] = (s.feeT[base.id] || 0) + dt;
            if (s.feeT[base.id] <= dt * 1.01) this.prompts.push({ to: s.pid, kind: 'fee', base: base.id, fee: acc.fee, name: base.name, owner: W.players[base.owner]?.name });
            if (s.feeT[base.id] > 20 && !s.trespass[base.id]) { s.trespass[base.id] = true; this.msgs.push({ to: s.pid, text: `You are trespassing at ${base.name}! Its guns will fire.`, kind: 'bad' }); }
          } else if (d > HAVEN_R) { if (s.feeT) s.feeT[base.id] = 0; s.trespass[base.id] = false; }
        }
      }
    }
  }
  maxHp(base, bd) { return bd.type === 'camp' ? Math.round(BUILDINGS.camp.hp * (0.7 + Math.hypot(base.x, base.z) / 2500)) : BUILDINGS[bd.type].hp; }
  /** Conquest: core building destroyed + a hostile captain (or fleet / clan ship) holding position. */
  stepCapture(base, dt, shield) {
    const W = this.W;
    const core = base.buildings.find(isCore);
    const c = this.capture.get(base.id);
    if (!core || core.hp > 0 || shield) { if (c) this.capture.delete(base.id); return; }
    const R = baseRadius(base);
    let cap = null;
    for (const s of this.ships.values()) {
      if (s.sink > 0 || s.docked || s.role === 'merchant' || s.role === 'navy') continue;
      if (!(W.players[s.owner] || aiFaction(s.owner) === 'clan')) continue;
      if (!hostile(W, s.owner, base.owner)) continue;
      if (Math.hypot(s.x - base.x, s.z - base.z) > R + 100) continue;
      if (!cap || (s.pid && !cap.pid)) cap = s;
    }
    const defenders = [...this.ships.values()].some((s) => s.sink === 0 && s.owner === base.owner && Math.hypot(s.x - base.x, s.z - base.z) < R + 220);
    if (!cap || defenders) {
      if (c) this.capture.delete(base.id);
      if (cap && defenders && W.players[cap.owner] && !(base._defMsgT > this.time)) { base._defMsgT = this.time + 15; this.msgs.push({ to: cap.owner, text: `Defenders are still guarding ${base.name} — sink them to capture it.`, kind: 'bad' }); }
      return;
    }
    const owner = cap.owner;
    if (!c || c.owner !== owner) {
      this.capture.set(base.id, { owner, pid: owner, t: 0 });
      if (W.players[owner]) this.msgs.push({ to: owner, text: `Capturing ${base.name}… hold position!`, kind: 'event' });
      return;
    }
    // squatter islands cost a colony charter (grows with every island you hold)
    const p = W.players[owner];
    if (p && aiFaction(base.owner) === 'wild') {
      const fee = claimFee(W.bases.filter((b) => b.owner === owner).length);
      if (p.inv.gold < fee) {
        c.t = Math.min(c.t + dt, 11.5);
        if (!(base._feeMsgT > this.time)) { base._feeMsgT = this.time + 12; this.msgs.push({ to: owner, text: `You need ${fee} gold for a colony charter to claim ${base.name}.`, kind: 'bad' }); }
        return;
      }
    }
    c.t += dt;
    if (c.t >= 12) this.conquer(base, owner);
  }
  baseHostileTo(base, s) {
    if (s.sink > 0 || s.docked) return false;
    const fac = aiFaction(base.owner);
    if (fac === 'wild') return !!this.W.players[s.owner];
    if (fac) return hostile(this.W, base.owner, s.owner) && s.role !== 'merchant';
    if (s.role === 'merchant') return false;
    if (s.trespass?.[base.id]) return true;
    if (base.haven?.safe) return false;
    if (s.pid && havenAccess(this.W, base, s.pid).fee === 0 && !hostile(this.W, base.owner, s.owner)) return false;
    return hostile(this.W, base.owner, s.owner);
  }
  conquer(base, owner) {
    const W = this.W, prev = base.owner;
    const prevFac = aiFaction(prev);
    const lvl = base.lvl || 1;
    base.owner = owner;
    base.haven = { safe: false, fee: 0, allies: true, allow: [] };
    base.paid = {};
    if (prevFac === 'wild') {
      // the squatters' stockade becomes your keep; their guns are now yours
      base.buildings = base.buildings.filter((b) => b.type !== 'camp' && b.type !== 'watchtower');
      for (const b of base.buildings) b.hp = Math.round(BUILDINGS[b.type].hp * 0.5);
      base.buildings.unshift({ id: uid('b'), type: 'keep', slot: -1, hp: Math.round(BUILDINGS.keep.hp * 0.3) });
    } else {
      const keep = base.buildings.find(isCore);
      if (keep) { keep.type = 'keep'; keep.hp = Math.round(BUILDINGS.keep.hp * 0.3); }
    }
    delete base.lvl;
    this.capture.delete(base.id);
    this.dirty.meta = true;
    const was = prevFac === 'wild' ? 'the squatters' : W.ai?.[prev]?.name || W.players[prev]?.name || 'someone';
    const p = W.players[owner];
    if (p) {
      if (prevFac === 'wild') p.inv.gold -= claimFee(W.bases.filter((b) => b.owner === owner).length - 1);
      const plunder = 1 + (p.upg.plunder || 0) * UPGRADES.plunder.per;
      const loot = { gold: Math.round((prevFac === 'wild' ? 150 : 800 + base.buildings.length * 150) * plunder), oak: 60, iron: 30 };
      gain(p.inv, loot);
      addXp(p, prevFac === 'wild' ? 250 + lvl * 40 : 600 + base.buildings.length * 60);
      if (!p.home || !W.bases.some((b) => b.id === p.home && b.owner === owner)) p.home = base.id;
      this.dirty.prof.add(owner);
      this.msgs.push({ to: null, text: prevFac === 'wild' ? `${p.name} drove out the squatters and claimed ${base.name}!` : `${p.name} conquered ${base.name} from ${was}!`, kind: 'event' });
      W.log.push({ at: Date.now(), text: `${p.name} ${prevFac === 'wild' ? 'claimed' : 'conquered'} ${base.name}` });
    } else if (W.ai?.[owner]) {
      const clan = W.ai[owner];
      if (!clan.base || !W.bases.some((b) => b.id === clan.base && b.owner === owner)) clan.base = base.id;
      this.msgs.push({ to: null, text: `${clan.name} seized ${base.name} from ${was}!`, kind: prevFac === 'wild' ? 'info' : 'event' });
      W.log.push({ at: Date.now(), text: `${clan.name} seized ${base.name}` });
    }
    if (W.players[prev]) this.msgs.push({ to: prev, text: `You lost ${base.name}!`, kind: 'bad' });
    if (prevFac === 'clan' && !W.bases.some((b) => b.owner === prev)) {
      const clan = W.ai[prev]; clan.base = null; clan.rebirthT = 900;
      this.msgs.push({ to: null, text: `${clan.name} has been broken — their last fortress has fallen!`, kind: 'event' });
      if (p) { addXp(p, 1500); gain(p.inv, { gold: Math.round(clan.inv.gold * 0.5) }); clan.inv.gold = Math.round(clan.inv.gold * 0.5); }
      for (const s of this.ships.values()) if (s.owner === prev && s.sink === 0 && s.ai) s.ai.home = null;
    }
  }
  claim(pid, baseId, free = false) {
    const b = this.W.bases.find((x) => x.id === baseId);
    if (!b || (b.owner && !(free && b.owner === 'ai:wild'))) return 'Island already claimed';
    const p = this.W.players[pid];
    if (!free) { const fee = claimFee(this.W.bases.filter((x) => x.owner === pid).length); if (p.inv.gold < fee) return `A colony charter costs ${fee} gold`; p.inv.gold -= fee; }
    b.owner = pid;
    delete b.lvl;
    b.buildings = [{ id: uid('b'), type: 'keep', slot: -1, hp: BUILDINGS.keep.hp }];
    if (!p.home) p.home = b.id;
    this.dirty.meta = true; this.dirty.prof.add(pid);
    this.msgs.push({ to: null, text: `${p.name} claimed ${b.name}.`, kind: 'info' });
    return null;
  }

  // ------------------------------------------------------------------ targeting helpers
  nearestTarget(x, z, range, pred) {
    let best = null, bd = range;
    for (const s of this.ships.values()) {
      const dx = s.x - x, dz = s.z - z;
      if (Math.abs(dx) > bd || Math.abs(dz) > bd) continue;
      const d = Math.hypot(dx, dz);
      if (d < bd && pred(s)) { bd = d; best = s; }
    }
    return best;
  }
  /** Ball from a fixed point to a moving ship with lead. */
  aimBall(from, tgt, spreadK, ammo) {
    const v = MUZZLE * (AMMO[ammo]?.speed || 1);
    let tx = tgt.x, tz = tgt.z;
    const vx = Math.sin(tgt.yaw) * tgt.spd, vz = Math.cos(tgt.yaw) * tgt.spd;
    for (let i = 0; i < 2; i++) { const d = Math.hypot(tx - from.x, tz - from.z); const ft = d / (v * 0.97); tx = tgt.x + vx * ft; tz = tgt.z + vz * ft; }
    const d = Math.hypot(tx - from.x, tz - from.z);
    tx += (this.rand() - 0.5) * 2 * spreadK * d; tz += (this.rand() - 0.5) * 2 * spreadK * d;
    const hd = Math.hypot(tx - from.x, tz - from.z);
    const el = solveElev(hd, (tgt.heave || 0) + 1.6 - from.y, v);
    if (el == null) return null;
    const hx = (tx - from.x) / hd, hz = (tz - from.z) / hd;
    return { x: from.x, y: from.y, z: from.z, vx: hx * v * Math.cos(el), vy: v * Math.sin(el), vz: hz * v * Math.cos(el), ammo };
  }

  // ------------------------------------------------------------------ AI
  /** Would AI ship `s` pick a fight with `o`? Weak ships leave much stronger ones alone. */
  aiWants(s, o) {
    if (o === s || o.sink > 0 || o.docked) return false;
    if (!hostile(this.W, s.owner, o.owner) || this.inHaven(o.x, o.z)) return false;
    if (o.pid && shielded(this.W, o.owner)) return false;
    if (s.role === 'navy' && o.role === 'merchant') return false;
    if (s.role === 'fleet' && o.role === 'merchant' && !s.ai.plunder) return false;
    const gap = tierIndex(o.spec.tier) - tierIndex(s.spec.tier);
    if (!s.ai.bold && gap > 1 && s.hull > o.hull * 0.6) return false;
    return true;
  }
  stepAI(s, dt) {
    const ai = s.ai;
    ai.think = (ai.think || 0) - dt;
    if (ai.think <= 0) {
      ai.think = 0.4 + this.rand() * 0.3;
      if (s.role === 'merchant') this.thinkMerchant(s);
      else if (s.role === 'fleet') this.thinkFleet(s);
      else this.thinkHunter(s);
      if (!this.ships.has(s.id)) return;
      // island avoidance probe
      const look = 50 + s.spd * 5 + s.stats.len * 0.5;
      const px = s.x + Math.sin(s.yaw) * look, pz = s.z + Math.cos(s.yaw) * look;
      for (const isl of this.landNear(px, pz)) {
        const dx = px - isl.x, dz = pz - isl.z, d = Math.hypot(dx, dz);
        const edge = isl.S ? isl.S.edge(Math.atan2(dz, dx)) : isl.r;
        if (d < edge + 30 + s.stats.beam) {
          const away = Math.atan2(s.x - isl.x, s.z - isl.z);
          const left = wrapA(away + Math.PI / 2 - s.yaw), right = wrapA(away - Math.PI / 2 - s.yaw);
          ai.want = s.yaw + (Math.abs(left) < Math.abs(right) ? left : right);
          ai.avoid = 1.2;
        }
      }
    }
    if (ai.avoid > 0) ai.avoid -= dt;
    s.rud = clamp(wrapA((ai.want ?? s.yaw) - s.yaw) * 2.2, -1, 1);
    // fire
    if (ai.target || ai.bpos) {
      const t = ai.target ? this.ships.get(ai.target) : null;
      if (ai.target && (!t || t.sink > 0)) { ai.target = null; return; }
      const tx = t ? t.x : ai.bpos.x, tz = t ? t.z : ai.bpos.z;
      for (const side of ['L', 'R', 'bow', 'stern']) {
        if (s.reload[side] > 0) continue;
        if ((side === 'bow' && !s.stats.bow) || (side === 'stern' && !s.stats.stern)) continue;
        let ax = tx, az = tz;
        if (t) { const ft = Math.hypot(tx - s.x, tz - s.z) / (s.stats.muzzle || MUZZLE); ax += Math.sin(t.yaw) * t.spd * ft * 1.05; az += Math.cos(t.yaw) * t.spd * ft * 1.05; }
        const arc = arcOf(s, ax, az);
        if (arc.side !== side || !arc.inSector || arc.dist > s.stats.range * 0.95) continue;
        if (this.rand() > (ai.trigger ?? 0.5)) { s.reload[side] = 0.6; continue; }
        const ammo = this.aiAmmo(s, t);
        const plan = this.planBroadside(s, side, ax, az, ammo, () => 0.5 + (this.rand() - 0.5) * (1.4 - (ai.skill || 0.5)));
        if (!plan.err) this.fire(s, side, ax, az, ammo, plan.balls);
      }
    }
  }
  thinkMerchant(s) {
    const ai = s.ai;
    const threat = this.nearestTarget(s.x, s.z, 380, (o) => o.sink === 0 && o.role !== 'merchant' && o.role !== 'navy' && hostile(this.W, o.owner, s.owner));
    ai.target = null;
    if (threat) { ai.want = Math.atan2(s.x - threat.x, s.z - threat.z); s.sail = 1; return; }
    // trade run: sail for the Free Port (or a captain's dock) and sell the cargo to the Merchant Guild
    if (!ai.dest) { const docks = this.W.bases.filter((b) => b.owner && !aiFaction(b.owner) && b.buildings.some((x) => x.type === 'dock')); const pick = this.rand() < 0.65 || !docks.length ? { x: 0, z: 0, id: 'port' } : docks[Math.floor(this.rand() * docks.length)]; ai.dest = { x: pick.x, z: pick.z, id: pick.id }; }
    const d = Math.hypot(ai.dest.x - s.x, ai.dest.z - s.z);
    if (d < (ai.dest.id === 'port' ? 300 : 220)) { this.deliverCargo(s); return; }
    if (!(ai.avoid > 0)) ai.want = Math.atan2(ai.dest.x - s.x, ai.dest.z - s.z);
    s.sail = 0.67;
  }
  deliverCargo(s) {
    const g = this.W.ai['ai:merchant'];
    if (g) gain(g.inv, { oak: 25 + tierIndex(s.spec.tier) * 10, canvas: 18, iron: 10, powder: 3, gold: 200 });
    this.removeShip(s.id);
  }
  thinkHunter(s) {
    const ai = s.ai;
    // badly hurt ships run for it
    if (s.hull < s.stats.hull * 0.22 && !ai.bold && s.tag !== 'treasure') {
      const th = this.nearestTarget(s.x, s.z, 500, (o) => o.sink === 0 && hostile(this.W, s.owner, o.owner) && o.role !== 'merchant');
      if (th) { ai.target = null; ai.bpos = null; ai.want = Math.atan2(s.x - th.x, s.z - th.z); s.sail = 1; return; }
    }
    const tgt = this.nearestTarget(s.x, s.z, ai.raid ? 380 : (ai.aggro || 700), (o) => this.aiWants(s, o));
    ai.target = tgt ? tgt.id : null;
    if (tgt) { ai.bpos = null; this.engage(s, tgt.x, tgt.z); return; }
    if (ai.raid && this.bombard(s, ai.raid)) return;
    if (ai.raid) { ai.raid = null; if (s.tag === 'raider') s.tag = null; }
    ai.bpos = null;
    if (s.tag === 'escort' && ai.leader && this.ships.get(ai.leader)) { const l = this.ships.get(ai.leader); ai.want = Math.atan2(l.x + Math.sin(l.yaw + ai.slot) * 40 - s.x, l.z + Math.cos(l.yaw + ai.slot) * 40 - s.z); s.sail = 0.67; }
    else this.wander(s);
  }
  /** Sail at a base and shell its buildings (keep last). Returns false when there's nothing left to do. */
  bombard(s, baseId) {
    const ai = s.ai;
    const base = this.W.bases.find((b) => b.id === baseId);
    if (!base || !base.owner || !hostile(this.W, s.owner, base.owner) || shielded(this.W, base.owner)) return false;
    const alive = base.buildings.filter((x) => x.hp > 0);
    if (!alive.some(isCore)) {
      // core is down: close in and hold position to capture
      ai.bpos = null;
      const d = Math.hypot(base.x - s.x, base.z - s.z), R = baseRadius(base);
      if (d > R + 70) { ai.want = Math.atan2(base.x - s.x, base.z - s.z); s.sail = 0.67; }
      else { ai.want = Math.atan2(base.x - s.x, base.z - s.z) + Math.PI / 2; s.sail = 0.2; }
      return true;
    }
    const dist = (x) => { const p = buildingPos(base, x); return Math.hypot(p.x - s.x, p.z - s.z); };
    const bd = alive.sort((a, b) => (isCore(a) - isCore(b)) || dist(a) - dist(b))[0];
    const p = buildingPos(base, bd);
    ai.bpos = p;
    this.engage(s, p.x, p.z);
    return true;
  }
  thinkFleet(s) {
    const ai = s.ai, W = this.W;
    const p = W.players[s.owner];
    if (!p) { this.removeShip(s.id); return; }
    const leader = this.ships.get('p:' + s.owner);
    const base = ai.base ? W.bases.find((b) => b.id === ai.base) : null;
    ai.target = null;
    if (ai.mode === 'attack' && base && base.owner === s.owner) { ai.mode = 'guard'; this.msgs.push({ to: s.owner, text: `${s.name}: ${base.name} is ours! Standing guard.`, kind: 'good' }); }
    if (ai.mode === 'attack' && base && !hostile(W, s.owner, base.owner)) ai.mode = 'guard';
    if (ai.mode === 'escort' && (!leader || leader.sink > 0)) { ai.mode = 'guard'; ai.base = this.homeOf(s.owner)?.id || null; }
    if (ai.mode === 'recall') {
      const h = this.nearestHarbour(s.owner, s.x, s.z);
      const d = Math.hypot(h.x - s.x, h.z - s.z);
      if (d < 140) { this.storeFleet(s); this.msgs.push({ to: s.owner, text: `${s.name} is back in harbour.`, kind: 'info' }); return; }
      if (!(ai.avoid > 0)) ai.want = Math.atan2(h.x - s.x, h.z - s.z);
      s.sail = 1; return;
    }
    const anchor = ai.mode === 'escort' ? leader : ai.mode === 'guard' && base ? base : s;
    const radius = ai.mode === 'escort' ? 520 : ai.mode === 'guard' ? 560 : 450;
    const foe = this.nearestTarget(anchor.x, anchor.z, radius, (o) => this.aiWants(s, o) && (ai.mode !== 'escort' || o.role !== 'merchant'));
    if (foe) { ai.target = foe.id; ai.bpos = null; this.engage(s, foe.x, foe.z); return; }
    ai.bpos = null;
    if (ai.mode === 'attack' && base && this.bombard(s, base.id)) return;
    if (ai.mode === 'escort' && leader) {
      const slot = ai.slot ?? 2.6;
      const fx = leader.x + Math.sin(leader.yaw + slot) * (40 + leader.stats.len * 0.8), fz = leader.z + Math.cos(leader.yaw + slot) * (40 + leader.stats.len * 0.8);
      const d = Math.hypot(fx - s.x, fz - s.z);
      if (!(ai.avoid > 0)) ai.want = d > 25 ? Math.atan2(fx - s.x, fz - s.z) : leader.yaw;
      s.sail = d > 160 ? 1 : d > 50 ? Math.min(1, leader.sailNow + 0.34) : Math.max(0.1, leader.sailNow);
      if (leader.docked) s.sail = d > 60 ? 0.34 : 0;
      return;
    }
    if (base) { // patrol a ring around the base
      const R = baseRadius(base) + 140;
      ai.patA = (ai.patA ?? Math.atan2(s.z - base.z, s.x - base.x)) + 0.08;
      const tx = base.x + Math.cos(ai.patA) * R, tz = base.z + Math.sin(ai.patA) * R;
      if (!(ai.avoid > 0)) ai.want = Math.atan2(tx - s.x, tz - s.z);
      s.sail = 0.5;
      return;
    }
    s.sail = 0;
  }
  aiAmmo(s, t) {
    if (!t || s.level < 4) return 'ball';
    const r = this.rand();
    if (t.sails > t.stats.sails * 0.6 && t.spd > s.spd && r < 0.3) return 'chain';
    if (t.crew > t.stats.crew * 0.4 && r < 0.18) return 'grape';
    if (s.level > 12 && r < 0.12) return 'explosive';
    return 'ball';
  }
  engage(s, tx, tz) {
    const ai = s.ai;
    const d = Math.hypot(tx - s.x, tz - s.z);
    const bearing = Math.atan2(tx - s.x, tz - s.z);
    const R = s.stats.range * 0.7;
    if (ai.avoid > 0) return; // let the island probe steer
    if (d > R * 1.1) { ai.want = bearing + (ai.flank || 0.35); s.sail = 1; }
    else if (d < R * 0.35) { ai.want = bearing + Math.PI * 0.7 * (ai.flank > 0 ? 1 : -1); s.sail = 0.67; }
    else {
      const rel = wrapA(bearing - s.yaw);
      ai.want = rel > 0 ? bearing - Math.PI / 2 + 0.15 : bearing + Math.PI / 2 - 0.15;
      s.sail = 0.67;
    }
  }
  wander(s) {
    const ai = s.ai;
    if (!ai.wp || Math.hypot(ai.wp.x - s.x, ai.wp.z - s.z) < 80) {
      const a = this.rand() * TAU, r = 250 + this.rand() * 700;
      const c = ai.home || s;
      ai.wp = { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r };
      const rr = Math.hypot(ai.wp.x, ai.wp.z); if (rr > WORLD_R - 200) { ai.wp.x *= (WORLD_R - 200) / rr; ai.wp.z *= (WORLD_R - 200) / rr; }
    }
    if (!(ai.avoid > 0)) ai.want = Math.atan2(ai.wp.x - s.x, ai.wp.z - s.z);
    s.sail = 0.67;
  }

  /** Busy seas around every online captain: lots of small fry, plus some level-matched heavies. */
  spawnAround(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 2.5;
    const players = [...this.ships.values()].filter((s) => s.pid && s.sink === 0);
    const ai = [...this.ships.values()].filter((s) => !s.pid);
    for (const a of ai) {
      if (a.sink > 12) { this.removeShip(a.id); continue; }
      if (a.tag || a.ai?.raid || a.role === 'fleet') continue;
      const near = players.some((p) => Math.hypot(p.x - a.x, p.z - a.z) < 2300);
      if (!near && players.length) this.removeShip(a.id);
    }
    const dens = this.aiDensity ?? 16;
    for (const p of players) {
      const cnt = ai.filter((a) => a.sink === 0 && a.role !== 'fleet' && Math.hypot(p.x - a.x, p.z - a.z) < 1500).length;
      if (cnt >= dens || this.ships.size > 140) continue;
      const lvl = this.W.players[p.pid]?.level || 1;
      for (let k = 0; k < Math.min(3, dens - cnt); k++) this.spawnAI(lvl, p);
    }
  }
  spawnAI(lvl, near, o = {}) {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rand() * TAU, r = o.dist ?? (750 + this.rand() * 650);
      const x = (near ? near.x : 0) + Math.cos(a) * r, z = (near ? near.z : 0) + Math.sin(a) * r;
      if (Math.hypot(x, z) > WORLD_R - 100 || (this.inHaven(x, z) && !o.owner)) continue;
      if (this.landNear(x, z).some((i) => Math.hypot(i.x - x, i.z - z) < (i.S ? i.S.edge(Math.atan2(z - i.z, x - i.x)) : i.r) + 25)) continue;
      const roll = this.rand();
      const role = o.role || (roll < 0.3 ? 'merchant' : roll < 0.86 ? 'pirate' : 'navy');
      const myTier = near?.spec ? Math.min(AI_TOP_TIER, tierIndex(near.spec.tier)) : 0;
      const allowed = Math.min(AI_TOP_TIER, TIERS.filter((t) => t.level <= lvl + 2).length - 1);
      // 60% small fry (sloops/schooners), 40% matched to the captain (their tier and the two below)
      const strong = o.strong ?? this.rand() < 0.4;
      let ti;
      if (o.tier != null) ti = Math.min(AI_TOP_TIER, tierIndex(o.tier));
      else if (strong) ti = clamp(myTier - Math.floor(this.rand() * 3) + (role === 'navy' && this.rand() < 0.4 ? 1 : 0), 0, Math.max(0, allowed));
      else ti = clamp(Math.floor(this.rand() * 2.3), 0, Math.max(0, Math.min(2, myTier)));
      const T = TIERS[ti];
      const alvl = o.level ?? (strong || o.tier != null ? clamp(lvl + Math.floor(this.rand() * 5) - 2, 1, MAX_LEVEL) : clamp(Math.round(lvl * (0.25 + this.rand() * 0.45)) + 1, 1, MAX_LEVEL));
      const upg = aiUpgrades(alvl);
      const names = { merchant: ['Fat Purse', 'Spice Barge', 'Lady Ledger', 'Salt Hauler', 'Golden Hen', 'Silk Maiden', 'Copper Kettle'], pirate: ['Black Gull', 'Rusty Hook', 'Sea Wolf', 'Cursed Kettle', 'Grim Tide', 'Bilge Rat', 'Red Jenny', 'Howling Dog'], navy: ['HMS Resolute', 'HMS Vigil', 'HMS Dauntless', 'HMS Warden', 'HMS Tenacious', 'HMS Sovereign'] }[role] || ['Raider'];
      const clan = o.owner && this.W.ai?.[o.owner];
      const look = clan ? { hullColor: '#1f1714', trimColor: `hsl(${clan.color},70%,42%)`, sailColor: '#3b332c', emblem: [0, 1, 4, 2][clan.color % 4], flagBg: '#0c0c0c', flagFg: `hsl(${clan.color},80%,60%)` }
        : role === 'navy' ? { hullColor: '#2b2d38', trimColor: '#d8b54a', sailColor: '#f4f1e6', emblem: 5, flagBg: '#1d3a8a', flagFg: '#fff' }
        : role === 'merchant' ? { hullColor: '#7a5532', trimColor: '#2f6b4e', sailColor: '#e9dcb8', emblem: 3, flagBg: '#2f6b4e', flagFg: '#f2e7c4' }
        : { hullColor: '#2a1c14', trimColor: '#8b1e1e', sailColor: '#5b5146', emblem: [0, 1, 4][Math.floor(this.rand() * 3)], flagBg: '#111', flagFg: '#ddd' };
      const nm = o.name || (clan ? `${clan.name.split(' ')[0]} ${['Reaver', 'Marauder', 'Cutthroat', 'Butcher', 'Scourge', 'Ravager'][Math.floor(this.rand() * 6)]}` : names[Math.floor(this.rand() * names.length)]);
      const spec = shipSpec(T.id, { name: nm, ...look });
      const owner = o.owner || (role === 'merchant' ? 'ai:merchant' : role === 'navy' ? 'ai:navy' : 'ai:pirates');
      const s = this.addShip({
        owner, role: clan ? 'pirate' : role, spec, upg, x, z, yaw: this.rand() * TAU, level: alvl, tag: o.tag,
        ai: { skill: clamp(0.3 + alvl * 0.01, 0.3, 0.9), trigger: 0.35 + this.rand() * 0.3, flank: this.rand() < 0.5 ? 0.4 : -0.4, raid: o.raid || null, aggro: o.aggro, leader: o.leader, slot: o.slot, home: o.home || null, bold: !!o.bold || strong },
      });
      s.look = look;
      s.spd = T.speed * 0.5;
      return s;
    }
    return null;
  }

  // ------------------------------------------------------------------ player fleets
  /** Nearest harbour (own base or the Free Port) to a point. */
  nearestHarbour(pid, x, z) {
    let best = { x: 200, z: 0, d: Math.hypot(x - 200, z), id: 'port', yaw: 0 };
    for (const b of this.W.bases) if (b.owner === pid) { const h = harborPoint(b); const d = Math.hypot(h.x - x, h.z - z); if (d < best.d) best = { ...h, d, id: b.id }; }
    return best;
  }
  deployFleet(pid, shipUid, order = {}) {
    const W = this.W, p = W.players[pid];
    if (!p) return 'Unknown captain';
    const spec = p.fleet.find((x) => x.uid === shipUid);
    if (!spec) return 'Not in your fleet';
    if (spec.uid === p.flag) return 'That is your flagship';
    if (tierById(spec.tier).flagshipOnly) return `A ${tierById(spec.tier).name} only sails as your flagship`;
    if (spec.wrecked) return 'That ship is wrecked — repair it in a harbour first';
    const outN = p.fleet.filter((x) => x.out).length;
    if (!spec.out && outN >= fleetCap(p)) return `You can only command ${fleetCap(p)} ships at sea (Commodore upgrades raise this)`;
    const mode = ['escort', 'attack', 'guard'].includes(order.mode) ? order.mode : 'escort';
    const base = order.base ? W.bases.find((b) => b.id === order.base) : null;
    if (mode === 'attack' && (!base || base.owner === pid || !hostile(W, pid, base.owner))) return 'Pick an enemy, pirate or wild island to attack';
    if (mode === 'attack' && shielded(W, base.owner)) return `${base.name}'s owner is offline — their bases are shielded`;
    if (mode === 'guard' && (!base || base.owner !== pid)) return 'Pick one of your own islands to guard';
    const leader = this.ships.get('p:' + pid);
    let s = spec.out ? this.ships.get('f:' + spec.uid) : null;
    if (!s) {
      let x, z, yaw;
      if (mode === 'escort' && leader) { const a = leader.yaw + Math.PI + (this.rand() - 0.5); x = leader.x + Math.sin(a) * 260; z = leader.z + Math.cos(a) * 260; yaw = leader.yaw; }
      else { const tgt = base || leader || { x: 0, z: 0 }; const h = this.nearestHarbour(pid, tgt.x, tgt.z); x = h.x; z = h.z; yaw = h.yaw ?? 0; }
      for (let i = 0; i < 12 && this.groundAt(x, z) != null; i++) { x += (this.rand() - 0.5) * 140; z += (this.rand() - 0.5) * 140; }
      s = this.addShip({ id: 'f:' + spec.uid, owner: pid, role: 'fleet', spec, upg: { ...p.upg }, level: p.level, name: spec.name, x, z, yaw, sail: 0.67,
        ai: { mode, skill: 0.8, trigger: 0.7, flank: this.rand() < 0.5 ? 0.4 : -0.4, bold: true } });
      s.look = { hullColor: spec.hullColor, trimColor: spec.trimColor, sailColor: spec.sailColor, emblem: spec.emblem, flag: p.color, trail: p.trail || null };
      spec.out = true;
    }
    const used = [...this.ships.values()].filter((o) => o.role === 'fleet' && o.owner === pid && o !== s && o.ai.mode === 'escort').map((o) => o.ai.slot);
    const slots = [2.5, -2.5, 3.14, 1.9, -1.9, 2.8, -2.8, 1.5, -1.5];
    s.ai.mode = mode; s.ai.base = base?.id || null; s.ai.slot = slots.find((v) => !used.includes(v)) ?? 3; s.ai.wp = null;
    this.dirty.meta = true; this.dirty.prof.add(pid);
    return null;
  }
  recallFleet(pid, shipUid) {
    const s = this.ships.get('f:' + shipUid);
    if (!s || s.owner !== pid) { const sp = this.W.players[pid]?.fleet.find((x) => x.uid === shipUid); if (sp) sp.out = false; return null; }
    const h = this.nearestHarbour(pid, s.x, s.z);
    if (Math.hypot(h.x - s.x, h.z - s.z) < 400) { this.storeFleet(s); return null; }
    s.ai.mode = 'recall';
    return null;
  }
  storeFleet(s) {
    const p = this.W.players[s.owner];
    const sp = p?.fleet.find((x) => x.uid === s.spec.uid);
    if (sp) { sp.out = false; sp.hp = s.hull >= s.stats.hull - 1 ? null : Math.round(s.hull); }
    this.removeShip(s.id);
    if (p) this.dirty.prof.add(p.id);
  }
  /** A captain goes offline: their ships at sea return to harbour. */
  dismissFleet(pid) { for (const s of [...this.ships.values()]) if (s.role === 'fleet' && s.owner === pid && s.sink === 0) this.storeFleet(s); }

  // ------------------------------------------------------------------ pirate clans + AI traders
  stepClans(dt) {
    this.clanT -= dt;
    this.econT -= dt;
    const W = this.W;
    const players = [...this.ships.values()].filter((s) => s.pid && s.sink === 0);
    const active = (this.aiDensity ?? 16) > 0;
    if (this.clanT <= 0) {
      this.clanT = 4;
      for (const clan of Object.values(W.ai)) {
        if (!clan.clan) continue;
        const base = clan.base && W.bases.find((b) => b.id === clan.base && b.owner === clan.id);
        if (!base) { clan.base = W.bases.find((b) => b.owner === clan.id)?.id || null; if (!clan.base) this.clanRebirth(clan, 4); continue; }
        clan.level = clamp(1 + Math.floor((base.buildings.length - 4) / 2), 1, 20);
        const near = players.filter((p) => Math.hypot(p.x - base.x, p.z - base.z) < 3800);
        const patrols = [...this.ships.values()].filter((s) => s.owner === clan.id && s.sink === 0 && s.tag === 'patrol');
        if (!near.length) { for (const s of patrols) if (players.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 2400)) this.removeShip(s.id); }
        else if (active && patrols.length < Math.min(7, 2 + Math.ceil(clan.level / 2)) && !this.capture.has(base.id)) {
          const lvl = Math.max(...near.map((p) => W.players[p.pid]?.level || 1));
          const ti = clamp(Math.floor(clan.level / 3) + Math.floor(this.rand() * 3) - 1, 0, 5);
          const h = harborPoint(base);
          this.spawnAI(lvl, h, { owner: clan.id, tier: TIERS[ti].id, tag: 'patrol', dist: 40 + this.rand() * 60, home: { x: base.x, z: base.z }, level: clamp(Math.max(lvl - 3, clan.level * 3), 1, MAX_LEVEL), aggro: 600, bold: true });
        }
        // raids on rivals: wild islands, other clans, and online captains
        clan.raidT = (clan.raidT ?? 400) - 4;
        if (clan.raidT <= 0 && active && players.length) {
          clan.raidT = 420 + this.rand() * 360;
          const cands = W.bases.filter((b) => b.owner && b.owner !== clan.id && !shielded(W, b.owner) && !(b.owner === 'ai:wild' && clan.level < 2) && Math.hypot(b.x - base.x, b.z - base.z) < 3000 && (W.players[b.owner] ? W.players[b.owner].online : true));
          cands.sort((a, b) => Math.hypot(a.x - base.x, a.z - base.z) - Math.hypot(b.x - base.x, b.z - base.z));
          const tgt = cands[Math.floor(this.rand() * Math.min(3, cands.length))];
          if (tgt) this.clanRaid(clan, base, tgt);
        }
      }
    }
    if (this.econT <= 0) {
      this.econT = 30;
      for (const clan of Object.values(W.ai)) if (clan.clan) this.clanEconomy(clan);
      this.guildEconomy();
    }
  }
  clanRaid(clan, from, tgt, n = null) {
    const W = this.W;
    const lvlP = Math.max(1, ...Object.values(W.players).filter((p) => p.online).map((p) => p.level));
    const cnt = n ?? Math.min(5, 2 + Math.floor(clan.level / 3));
    const h = harborPoint(from);
    for (let i = 0; i < cnt; i++) {
      const ti = clamp(Math.floor(clan.level / 3) + Math.floor(this.rand() * 2), 0, 5);
      this.spawnAI(lvlP, h, { owner: clan.id, tier: TIERS[ti].id, tag: 'raider', raid: tgt.id, dist: 50 + i * 30, level: clamp(Math.max(lvlP - 2, clan.level * 3), 1, MAX_LEVEL), aggro: 420, bold: true });
    }
    if (W.players[tgt.owner]) this.msgs.push({ to: tgt.owner, text: `PIRATE RAID! ${clan.name} is sailing on ${tgt.name}!`, kind: 'event' });
    this.dirty.meta = true;
  }
  clanRebirth(clan, dt) {
    clan.rebirthT = (clan.rebirthT ?? 900) - dt;
    if (clan.rebirthT > 0) return;
    clan.rebirthT = 900;
    const players = [...this.ships.values()].filter((s) => s.pid);
    const wild = this.W.bases.filter((b) => b.owner === 'ai:wild' && players.every((p) => Math.hypot(p.x - b.x, p.z - b.z) > 2500));
    const b = wild[Math.floor(this.rand() * wild.length)];
    if (!b) return;
    b.owner = clan.id; b.hold = true; delete b.lvl;
    b.buildings = [{ id: uid('b'), type: 'keep', slot: -1, hp: BUILDINGS.keep.hp }, { id: uid('b'), type: 'cannon', slot: dockAngle(b) + 1.5, hp: BUILDINGS.cannon.hp }, { id: uid('b'), type: 'cannon', slot: dockAngle(b) - 1.5, hp: BUILDINGS.cannon.hp }];
    clan.base = b.id; clan.plan = 0;
    this.msgs.push({ to: null, text: `${clan.name} has risen again on ${b.name}!`, kind: 'event' });
    this.dirty.meta = true;
  }
  /** Clans fortify their hold from a build plan, buying what they lack on the market and selling surplus. */
  clanEconomy(clan) {
    const W = this.W;
    const base = W.bases.find((b) => b.id === clan.base && b.owner === clan.id);
    if (!base) return;
    clan.inv.gold += 60 + 25 * (clan.level || 1);
    const next = CLAN_PLAN[clan.plan % CLAN_PLAN.length] || 'cannon';
    const B = BUILDINGS[next];
    for (const [item, need] of Object.entries(B.cost)) {
      if (item === 'gold') continue;
      const miss = need - (clan.inv[item] || 0);
      if (miss <= 0) continue;
      const ask = bestAsk(W, item, clan.id);
      if (ask && ask * miss < clan.inv.gold * 0.5) instantBuy(W, clan.id, item, miss);
    }
    if (canAfford(clan.inv, B.cost)) {
      const da = dockAngle(base);
      const at = B.slot === 'shore' || B.slot === 'sea' ? da + 0.8 + this.rand() * (TAU - 1.6) : null;
      const res = buildOn(W, clan, base.id, next, at);
      if (typeof res !== 'string') { clan.plan++; this.dirty.meta = true; if (this.rand() < 0.5) W.log.push({ at: Date.now(), text: `${clan.name} built a ${B.name} at ${base.name}` }); }
      else if (!res.includes('resources')) clan.plan++;
    }
    for (const item of ['oak', 'iron', 'canvas', 'powder']) {
      if ((clan.inv[item] || 0) < 380) continue;
      if (W.market.some((o) => o.owner === clan.id && o.item === item)) continue;
      const px = Math.max((bestBid(W, item, clan.id) || 0) + 1, Math.round(NPC_PRICES[item] * (1 + this.rand() * 0.15)));
      placeOrder(W, clan.id, { side: 'sell', item, qty: 120, price: px });
    }
    this.dirty.meta = true;
  }
  /** The Merchant Guild sells delivered cargo and bids for scarce goods. */
  guildEconomy() {
    const W = this.W, g = W.ai['ai:merchant'];
    if (!g) return;
    g.inv.gold = Math.min(200000, g.inv.gold + 400);
    for (const item of ['oak', 'iron', 'canvas', 'powder']) {
      if ((g.inv[item] || 0) > 40 && !W.market.some((o) => o.owner === g.id && o.item === item && o.side === 'sell')) placeOrder(W, g.id, { side: 'sell', item, qty: Math.min(80, g.inv[item]), price: Math.round(NPC_PRICES[item] * (0.95 + this.rand() * 0.25)) });
      if (!W.market.some((o) => o.owner === g.id && o.item === item && o.side === 'buy') && g.inv.gold > 3000) placeOrder(W, g.id, { side: 'buy', item, qty: 40, price: Math.max(1, Math.round(NPC_PRICES[item] * (0.72 + this.rand() * 0.12))) });
    }
    this.dirty.meta = true;
  }

  // ------------------------------------------------------------------ loot crates + harvesting
  stepCrates(dt) {
    for (const c of this.crates) c.t += dt;
    const keep = [];
    for (const c of this.crates) {
      if (c.t > 240) continue;
      let taken = false;
      if (this.authority && c.t > 1.5) {
        for (const s of this.ships.values()) {
          if (s.sink > 0 || !(s.pid || s.role === 'fleet')) continue;
          if (Math.abs(s.x - c.x) > 60 || Math.abs(s.z - c.z) > 60) continue;
          if (Math.hypot(s.x - c.x, s.z - c.z) < s.stats.len * 0.6 + 6) {
            const p = this.W.players[s.owner];
            if (!p) continue;
            const loot = { ...c.loot }; loot.gold = Math.round((loot.gold || 0) * (1 + (p.upg.plunder || 0) * UPGRADES.plunder.per));
            gain(p.inv, loot);
            addXp(p, 10);
            this.dirty.prof.add(p.id);
            const txt = Object.entries(loot).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k}`).join('  ');
            this.msgs.push({ to: p.id, text: `${s.role === 'fleet' ? s.name + ' salvaged' : 'Salvaged'}: ${txt}`, kind: 'loot' });
            this.fx.push({ t: 'pickup', x: c.x, z: c.z });
            taken = true; break;
          }
        }
      }
      if (!taken) keep.push(c);
    }
    if (keep.length !== this.crates.length) this.dirty.meta = true;
    this.crates = keep;
  }
  stepHarvest(dt) {
    for (const isl of this.W.islands) if (isl.kind === 'res') isl.amt = Math.min(100, (isl.amt ?? 100) + dt / 15);
    for (const s of this.ships.values()) {
      if (!s.pid || !s.harvest || s.sink > 0) continue;
      const isl = this.W.islands.find((i) => i.kind === 'res' && Math.hypot(i.x - s.x, i.z - s.z) < i.r + 80);
      if (!isl || s.spd > 4 || isl.amt < 1) continue;
      s.harvestT = (s.harvestT || 0) + dt;
      if (s.harvestT >= 1) {
        s.harvestT -= 1;
        const p = this.W.players[s.pid];
        const k = (1 + tierIndex(s.spec.tier) * 0.5) * (1 + (p.upg.harvest || 0) * UPGRADES.harvest.per);
        const q = Math.max(1, Math.round((isl.res === 'powder' ? 1 : 2) * k));
        p.inv[isl.res] = (p.inv[isl.res] || 0) + q;
        isl.amt -= 1;
        addXp(p, 1);
        this.dirty.prof.add(p.id);
        this.fx.push({ t: 'harvest', x: isl.x, z: isl.z, res: isl.res, q, ship: s.id });
      }
    }
  }

  // ------------------------------------------------------------------ world events
  stepEvents(dt) {
    this.evT -= dt;
    const players = [...this.ships.values()].filter((s) => s.pid && s.sink === 0);
    if (this.evT <= 0 && players.length) {
      this.evT = 300 + this.rand() * 180;
      const r = this.rand();
      const owned = this.W.bases.filter((b) => b.owner && !b.owner.startsWith('ai:') && this.W.players[b.owner]?.online);
      if (r < 0.35 && !this.kraken) this.startEvent('kraken');
      else if (r < 0.75 || !owned.length) this.startEvent('treasure');
      else this.startEvent('raid');
    }
    if (this.kraken) this.stepKraken(dt);
  }
  startEvent(kind) {
    const players = [...this.ships.values()].filter((s) => s.pid && s.sink === 0);
    const avg = players.length ? players.reduce((a, s) => a + (this.W.players[s.pid]?.level || 1), 0) / players.length : 1;
    const anchor = players[Math.floor(this.rand() * players.length)] || { x: 0, z: 0 };
    if (kind === 'kraken') {
      let x = 0, z = 0;
      for (let i = 0; i < 30; i++) {
        const a = this.rand() * TAU, d = 500 + this.rand() * 400;
        x = anchor.x + Math.cos(a) * d; z = anchor.z + Math.sin(a) * d;
        if (!this.inHaven(x, z) && !this.landNear(x, z).some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 80) && Math.hypot(x, z) < WORLD_R - 200) break;
      }
      const hp = Math.round(1200 + Math.min(avg, 120) * 70);
      this.kraken = { x, z, hp, maxHp: hp, t: 0, target: null, slamT: 5, phase: 'hunt', tentacles: Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * TAU, up: 0, slam: 0 })) };
      this.msgs.push({ to: null, text: 'THE KRAKEN STIRS! A great beast has surfaced — hunt it for legendary loot.', kind: 'event' });
    } else if (kind === 'treasure') {
      const tier = avg >= 22 ? 'manowar' : 'galleon';
      const lead = this.spawnAI(Math.max(avg + 3, 12), anchor, { role: 'navy', tier, tag: 'treasure', name: 'Treasure Flagship', dist: 800, aggro: 420, strong: true });
      if (!lead) return;
      lead.hull = lead.stats.hull = Math.round(lead.stats.hull * 1.5);
      for (let i = 0; i < 3; i++) {
        const e = this.spawnAI(Math.max(avg, 4), lead, { role: 'navy', tier: avg >= 10 ? 'frigate' : 'brigantine', tag: 'escort', dist: 60 + i * 25, leader: lead.id, slot: [-2.4, 2.4, Math.PI][i], aggro: 500, strong: true });
        if (e) e.ai.leader = lead.id;
      }
      this.msgs.push({ to: null, text: 'A heavily guarded TREASURE FLAGSHIP has been sighted! Check your map.', kind: 'event' });
    } else if (kind === 'raid') {
      const owned = this.W.bases.filter((b) => b.owner && !b.owner.startsWith('ai:') && this.W.players[b.owner]?.online);
      const base = owned[Math.floor(this.rand() * owned.length)];
      if (!base) return;
      const clans = Object.values(this.W.ai).filter((c) => c.clan && c.base).map((c) => ({ c, b: this.W.bases.find((x) => x.id === c.base) })).filter((x) => x.b);
      clans.sort((a, b) => Math.hypot(a.b.x - base.x, a.b.z - base.z) - Math.hypot(b.b.x - base.x, b.b.z - base.z));
      if (clans[0] && Math.hypot(clans[0].b.x - base.x, clans[0].b.z - base.z) < 2500) { this.clanRaid(clans[0].c, clans[0].b, base, 3); return; }
      const lvl = this.W.players[base.owner].level;
      for (let i = 0; i < 3; i++) this.spawnAI(lvl, base, { role: 'pirate', tag: 'raider', raid: base.id, dist: 700 + i * 30, strong: true });
      this.msgs.push({ to: null, text: `PIRATE RAID! Three ships are bearing down on ${base.name}!`, kind: 'event' });
    }
    this.dirty.meta = true;
  }
  stepKraken(dt) {
    const k = this.kraken;
    k.t += dt;
    if (k.hp <= 0) {
      k.dead = (k.dead || 0) + dt;
      for (const tn of k.tentacles) tn.up = Math.max(0, tn.up - dt * 0.4);
      if (k.dead > 6) this.kraken = null;
      return;
    }
    const tgt = this.nearestTarget(k.x, k.z, 1400, (s) => s.pid && s.sink === 0 && !s.docked && !this.inHaven(s.x, s.z));
    k.target = tgt?.id || null;
    if (tgt) {
      const d = Math.hypot(tgt.x - k.x, tgt.z - k.z);
      const sp = d > 60 ? 9 : 0;
      if (d > 1) { k.x += ((tgt.x - k.x) / d) * sp * dt; k.z += ((tgt.z - k.z) / d) * sp * dt; }
      const close = d < 75;
      for (const tn of k.tentacles) tn.up += ((close ? 1 : 0.15) - tn.up) * Math.min(1, dt * 0.8);
      if (close) {
        k.slamT -= dt;
        if (k.slamT <= 0) {
          k.slamT = 4.5;
          const i = Math.floor(this.rand() * k.tentacles.length);
          k.tentacles[i].slam = 1;
          this.hurt(tgt, 26 + k.maxHp * 0.0025, 10, 2, 'ai:kraken');
          tgt.spd *= 0.6;
          this.fx.push({ t: 'slam', x: tgt.x, z: tgt.z, ship: tgt.id });
        }
      }
    } else for (const tn of k.tentacles) tn.up = Math.max(0, tn.up - dt * 0.2);
    for (const tn of k.tentacles) tn.slam = Math.max(0, tn.slam - dt * 1.2);
  }
  krakenParts() {
    const k = this.kraken; if (!k) return [];
    const parts = [{ x: k.x, z: k.z, r: 14, h: 6 }];
    for (const tn of k.tentacles) if (tn.up > 0.3) parts.push({ x: k.x + Math.cos(tn.a + k.t * 0.15) * 30, z: k.z + Math.sin(tn.a + k.t * 0.15) * 30, r: 5, h: 22 * tn.up });
    return parts;
  }
  hitKraken(b) {
    for (const p of this.krakenParts()) {
      if (Math.hypot(b.x - p.x, b.z - p.z) < p.r && b.y < p.h + 2) {
        this.fx.push({ t: 'ink', x: b.x, y: b.y, z: b.z });
        if (this.authority) {
          const k = this.kraken;
          const dmg = b.dmg * (AMMO[b.ammo]?.hull || 1) * (p.r > 10 ? 1.5 : 1.1);
          k.hp -= dmg;
          if (!this.damagers.has('kraken')) this.damagers.set('kraken', new Map());
          const m = this.damagers.get('kraken'); m.set(b.owner, (m.get(b.owner) || 0) + dmg);
          if (k.hp <= 0) this.killKraken();
        }
        return true;
      }
    }
    return false;
  }
  killKraken() {
    const k = this.kraken;
    k.hp = 0;
    this.fx.push({ t: 'krakenDie', x: k.x, z: k.z });
    this.crates.push({ id: uid('c'), x: k.x, z: k.z, loot: { gold: 2000 + k.maxHp * 0.4 | 0, powder: 30, iron: 60, canvas: 40 }, t: 0, big: true });
    const dm = this.damagers.get('kraken');
    if (dm) for (const [owner, v] of dm) {
      const p = this.W.players[owner]; if (!p) continue;
      const xp = 400 + 1400 * Math.min(1, v / k.maxHp);
      const lv = addXp(p, xp);
      this.dirty.prof.add(owner);
      if (lv) this.msgs.push({ to: owner, text: `Level up! You are now level ${p.level}.`, kind: 'level' });
    }
    this.damagers.delete('kraken');
    this.msgs.push({ to: null, text: 'The Kraken has been slain! Its hoard is up for grabs.', kind: 'event' });
  }

  // ------------------------------------------------------------------ main step
  step(dt) {
    this.time += dt;
    if (this.authority) {
      this.W.time = (this.W.time || 0) + dt;
      const list = [...this.ships.values()];
      for (const s of list) {
        if (!this.ships.has(s.id)) continue;
        s.heave = heightAt(s.x, s.z, this.time);
        if (s.sink === 0 && s.stats.regen && this.time - s.hitT > 8 && s.hull < s.stats.hull) s.hull = Math.min(s.stats.hull, s.hull + s.stats.regen * s.stats.hull * dt);
        if (s.ai && s.sink === 0) this.stepAI(s, dt);
        if (!this.ships.has(s.id)) continue;
        if (!s.pid || s.local) this.stepShip(s, dt); // remote players move themselves
        else {
          for (const k in s.reload) if (s.reload[k] > 0) s.reload[k] -= dt;
          if (s.fire > 0) { s.fire -= dt; this.hurt(s, 5 * dt, 0, 0, null, true); }
          if (s.sink > 0) s.sink += dt;
        }
        if (!s.pid && s.sink === 0) this.collideShips(s, list);
      }
      for (const s of list) {
        if (s.pid && s.sink > 6) this.spawnPlayer(s.pid);
        else if (s.role === 'fleet' && s.sink > 10) this.removeShip(s.id);
      }
      this.stepBalls(dt);
      this.stepCrates(dt);
      this.stepHarvest(dt);
      this.stepBases(dt);
      this.stepEvents(dt);
      this.spawnAround(dt);
      this.stepClans(dt);
      const before = this.W.market.length;
      produce(this.W, dt);
      this.restockT -= dt;
      if (this.restockT <= 0) { this.restockT = 45; npcRestock(this.W, this.rand); }
      if (this.W.market.length !== before) this.dirty.meta = true;
    } else {
      for (const s of this.ships.values()) s.heave = heightAt(s.x, s.z, this.time);
      this.stepBalls(dt);
      for (const c of this.crates) c.t += dt;
      if (this.kraken) this.kraken.t += dt;
    }
  }
}

/** Ensure a joining player has a profile (and a home island the first time). */
export function joinPlayer(sim, pid, name) {
  const W = sim.W;
  let p = W.players[pid];
  let fresh = false;
  if (!p) {
    p = W.players[pid] = newProfile(pid, name);
    fresh = true;
    // first island is free: one of the wild islands nearest the Free Port (the squatters move out)
    const free = W.bases.filter((b) => !b.owner || b.owner === 'ai:wild').sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const pick = free[Math.floor(sim.rand() * Math.min(3, free.length))];
    if (pick) sim.claim(pid, pick.id, true);
  }
  if (name) p.name = String(name).slice(0, 20);
  for (const s of p.fleet) if (s.out && !sim.ships.has('f:' + s.uid)) s.out = false;
  p.online = true; p.lastSeen = Date.now();
  sim.dirty.meta = true;
  return { p, fresh };
}
