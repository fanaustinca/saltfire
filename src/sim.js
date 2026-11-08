// World simulation. On the host (authority) it runs everything: ship physics for AI, gunnery and
// damage, loot, AI spawning, bases + defences, conquest, world events, production. On clients it only
// advances visual cannonballs and effects; ship state arrives in snapshots.
import {
  TIERS, tierById, tierIndex, AMMO, GRAVITY, MUZZLE, SECTOR_HALF, CHASE_HALF, MIN_RANGE, BUILDINGS,
  HAVEN_R, WORLD_R, MAX_LEVEL,
} from './config.js';
import {
  shipStats, shipSpec, crewEff, flagship, addXp, hostile, shielded, havenAccess, sinkLoot, gain, produce,
  npcRestock, newProfile, uid, clamp,
} from './economy.js';
import { gunLayout } from './layout.js';
import { buildingPos, harborPoint, baseRadius } from './basegeo.js';
import { heightAt } from './waves.js';

export const SAIL_STEPS = [0, 0.34, 0.67, 1];
export const SAIL_NAMES = ['Anchored', 'Battle Sails', 'Half Sail', 'Full Sail'];
const TAU = Math.PI * 2;
export const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const BALL_DMG = 30;

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

export class Sim {
  constructor(W, { authority = true, rand = Math.random } = {}) {
    this.W = W;
    this.authority = authority;
    this.rand = rand;
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
    this.time = 0;
    this.capture = new Map(); // baseId -> { pid, t }
    this.damagers = new Map(); // targetId -> Map(owner -> dmg)
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
      ai: o.ai || null, tag: o.tag || null, docked: null, harvest: false, recoil: 0, hitT: 0, look: o.look || null,
    };
    if (o.spec.hp != null) s.hull = Math.min(stats.hull, o.spec.hp);
    this.ships.set(s.id, s);
    this.dirty.meta = true;
    return s;
  }
  /** Recompute stats after upgrades / flagship changes, keeping damage fractions. */
  refreshShip(s) {
    const fh = s.hull / s.stats.hull, fs = s.sails / s.stats.sails, fc = s.crew / s.stats.crew;
    if (s.pid) s.upg = { ...this.W.players[s.pid].upg };
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
    if (home) { const h = harborPoint(home); x = h.x; z = h.z; yaw = h.yaw; }
    else { const a = this.rand() * TAU; x = Math.cos(a) * 200; z = Math.sin(a) * 200; yaw = Math.atan2(Math.cos(a), Math.sin(a)); }
    const old = this.ships.get('p:' + pid);
    if (old) this.ships.delete(old.id);
    const s = this.addShip({ id: 'p:' + pid, pid, owner: pid, spec, upg: p.upg, x, z, yaw, level: p.level, name: spec.name, sail: 0 });
    s.look = { hullColor: spec.hullColor, trimColor: spec.trimColor, sailColor: spec.sailColor, emblem: spec.emblem, flag: p.color };
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
    s.sailNow += (s.sail - s.sailNow) * Math.min(1, dt * 0.9);
    const sailF = 0.35 + 0.65 * (s.sails / st.sails);
    const eff = crewEff(s.crew, st.crew);
    const target = st.speed * s.sailNow * sailF * (0.85 + 0.15 * eff);
    const acc = target > s.spd ? 0.12 + 0.18 * s.sailNow : 0.35;
    s.spd += (target - s.spd) * Math.min(1, dt * acc);
    const way = 0.3 + 0.7 * Math.min(1, s.spd / (st.speed * 0.35));
    s.yaw = wrapA(s.yaw + s.rud * st.turn * eff * way * dt);
    s.x += Math.sin(s.yaw) * s.spd * dt;
    s.z += Math.cos(s.yaw) * s.spd * dt;
    s.recoil *= Math.exp(-dt * 2.5);
    if (s.fire > 0) { s.fire -= dt; if (this.authority) this.hurt(s, 5 * dt, 0, 0, null, true); }
    for (const k in s.reload) if (s.reload[k] > 0) s.reload[k] -= dt;
    this.collideIslands(s);
    // world edge: gently turn back
    const r = Math.hypot(s.x, s.z);
    if (r > WORLD_R) { s.x *= WORLD_R / r; s.z *= WORLD_R / r; s.spd *= 0.9; }
  }
  collideIslands(s) {
    const pts = [[0, 0], [0, s.stats.len * 0.38], [0, -s.stats.len * 0.38]];
    for (const isl of this.landmasses()) {
      for (const [lx, lz] of pts) {
        const [wx, , wz] = localToWorld(s, lx, 0, lz);
        const dx = wx - isl.x, dz = wz - isl.z, d = Math.hypot(dx, dz);
        const R = isl.r * 0.92 + s.stats.beam * 0.35;
        if (d < R && d > 0.01) {
          const push = R - d;
          s.x += (dx / d) * push; s.z += (dz / d) * push;
          s.spd *= 0.9;
          if (this.authority && s.spd > 6 && this.rand() < 0.05) this.hurt(s, 4, 0, 0, null);
        }
      }
    }
  }
  /** Circles that ships can't sail through. */
  landmasses() {
    if (this._landT === this.time && this._land) return this._land;
    const L = [];
    for (const i of this.W.islands) L.push({ x: i.x, z: i.z, r: i.r });
    for (const b of this.W.bases) {
      L.push({ x: b.x, z: b.z, r: baseRadius(b) });
      for (const bd of b.buildings) if (bd.type === 'fort') { const p = buildingPos(b, bd); L.push({ x: p.x, z: p.z, r: 14 }); }
    }
    this._land = L; this._landT = this.time;
    return L;
  }
  collideShips(s, others) {
    const rs = s.stats.beam * 0.6;
    for (const o of others) {
      if (o === s || o.sink > 0) continue;
      const dx = s.x - o.x, dz = s.z - o.z;
      const reach = (s.stats.len + o.stats.len) * 0.5;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
      // 3 circles along each hull
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
    for (const b of this.W.bases) if (b.owner && b.haven?.safe && Math.hypot(x - b.x, z - b.z) < HAVEN_R * 0.75) return true;
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
    let d = Math.min(arc.dist, range);
    const eff = crewEff(s.crew, s.stats.crew);
    const balls = [];
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    // aim point clamped to range along the aim line
    const dirx = (ax - s.x) / (arc.dist || 1), dirz = (az - s.z) / (arc.dist || 1);
    const tx = s.x + dirx * d, tz = s.z + dirz * d;
    const heave = s.heave || 0;
    guns.forEach((g, i) => {
      const [mx, my0, mz] = localToWorld(s, g.x, g.y, g.z);
      const my = my0 + heave;
      // broadside guns fire parallel: shift the aim point by the gun's offset along the hull
      const along = side === 'L' || side === 'R' ? g.z : g.x;
      const ox = side === 'L' || side === 'R' ? fx * along : Math.cos(s.yaw) * along;
      const oz = side === 'L' || side === 'R' ? fz * along : -Math.sin(s.yaw) * along;
      const spread = (0.012 + 0.03 * (1 - eff)) * d;
      const px = tx + ox + (rand() - 0.5) * 2 * spread, pz = tz + oz + (rand() - 0.5) * 2 * spread;
      const hd = Math.max(MIN_RANGE * 0.5, Math.hypot(px - mx, pz - mz));
      const v = MUZZLE * A.speed;
      const el = solveElev(hd, heightAt(px, pz, this.time) + 1.6 - my, v) ?? 0.26;
      const hx = (px - mx) / hd, hz = (pz - mz) / hd;
      balls.push({ x: mx, y: my, z: mz, vx: hx * v * Math.cos(el), vy: v * Math.sin(el), vz: hz * v * Math.cos(el), ammo, delay: i * 0.07 + rand() * 0.04 });
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
    s.recoil += (side === 'L' ? 1 : side === 'R' ? -1 : 0) * Math.min(1, plan.balls.length * 0.12);
    for (const b of plan.balls) this.spawnBall(s, b);
    this.fx.push({ t: 'fire', ship: s.id, side, n: plan.balls.length, balls: plan.balls.map((b) => [b.x, b.y, b.z, b.vx, b.vy, b.vz, b.delay || 0]), ammo });
    return plan;
  }
  spawnBall(s, b) {
    this.balls.push({ ...b, shooter: s ? s.id : b.shooter, owner: s ? s.owner : b.owner, level: s ? s.level : (b.level || 1), t: -(b.delay || 0), dmg: b.dmg || BALL_DMG, vis: !this.authority });
  }

  stepBalls(dt) {
    const keep = [];
    for (const b of this.balls) {
      b.t += dt;
      if (b.t < 0) { keep.push(b); continue; }
      b.vy -= GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      if (b.t > 12) continue;
      // ships
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
          this.fx.push({ t: 'hit', x: b.x, y: b.y, z: b.z, rig: inRig, ammo: b.ammo, ship: s.id });
          break;
        }
      }
      if (hit) continue;
      // kraken
      if (this.kraken && this.kraken.hp > 0 && this.hitKraken(b)) continue;
      // buildings
      if (b.y < 30 && this.hitBuilding(b)) continue;
      // land
      for (const isl of this.landmasses()) {
        const d = Math.hypot(b.x - isl.x, b.z - isl.z);
        if (d < isl.r * 0.9 && b.y < 3 + (1 - d / isl.r) * 10) { hit = true; this.fx.push({ t: 'dirt', x: b.x, y: b.y, z: b.z }); break; }
      }
      if (hit) continue;
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
    const lvl = 0.85 + 0.03 * (b.level || 1);
    const base = b.dmg * lvl;
    const hullD = base * A.hull * (rig ? 0.2 : 1);
    const sailD = base * A.sail * (rig ? 1.6 : 0.6);
    const crewD = A.crew * (1.5 + this.rand() * 2) * (rig ? 0.6 : 1);
    this.hurt(s, hullD, sailD, crewD, b.owner);
    if (A.fire && this.rand() < 0.35) s.fire = Math.max(s.fire, 6);
    const shooter = this.ships.get(b.shooter);
    if (shooter?.pid) { const p = this.W.players[shooter.pid]; if (p) { addXp(p, 2); this.dirty.prof.add(p.id); } }
  }
  hurt(s, hull, sail, crew, by, quiet = false) {
    if (s.sink > 0) return;
    s.hull -= hull; s.sails = Math.max(0, s.sails - sail); s.crew = Math.max(0, s.crew - crew);
    s.hitT = this.time;
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
    this.crates.push({ id: uid('c'), x: s.x, z: s.z, loot, t: 0, big: s.tag === 'treasure' || ti >= 4 });
    // XP to everyone who damaged it, the killer gets the most
    const dm = this.damagers.get(s.id);
    if (dm) {
      let tot = 0; for (const v of dm.values()) tot += v;
      for (const [owner, v] of dm) {
        const p = this.W.players[owner];
        if (!p) continue;
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
      if (Math.abs(b.x - base.x) > R + 70 || Math.abs(b.z - base.z) > R + 70) continue;
      for (const bd of base.buildings) {
        const p = buildingPos(base, bd);
        if (Math.hypot(b.x - p.x, b.z - p.z) < p.rad && b.y < p.y + p.h) {
          this.fx.push({ t: 'stone', x: b.x, y: b.y, z: b.z });
          if (!this.authority) return true;
          if (!base.owner || !hostile(this.W, b.owner, base.owner)) return true;
          if (shielded(this.W, base.owner)) { this.fx.push({ t: 'shield', x: b.x, y: b.y, z: b.z }); return true; }
          if (base.haven?.safe && this.inHaven(b.x, b.z) && !this.isTrespasser(b.owner, base)) return true;
          const A = AMMO[b.ammo] || AMMO.ball;
          bd.hp = Math.max(0, bd.hp - b.dmg * (0.6 + A.hull * 0.6));
          base.hitT = this.time;
          this.dirty.meta = true;
          if (bd.hp <= 0) this.fx.push({ t: 'collapse', x: p.x, y: p.y, z: p.z, base: base.id, bd: bd.id });
          const p2 = this.W.players[b.owner];
          if (p2) { addXp(p2, 1); this.dirty.prof.add(p2.id); }
          return true;
        }
      }
    }
    return false;
  }
  isTrespasser(owner, base) { const s = this.ships.get('p:' + owner); return !!(s && s.trespass && s.trespass[base.id]); }

  stepBases(dt) {
    const W = this.W;
    for (const base of W.bases) {
      if (!base.owner) continue;
      const shield = shielded(W, base.owner);
      // AI holds slowly rebuild when left alone
      if (base.owner.startsWith('ai:') && this.time - (base.hitT ?? -1e9) > 60) for (const bd of base.buildings) bd.hp = Math.min(BUILDINGS[bd.type].hp, bd.hp + BUILDINGS[bd.type].hp * 0.004 * dt);
      for (const bd of base.buildings) {
        const B = BUILDINGS[bd.type];
        const gun = B.gun || (bd.type === 'keep' ? { range: 220, dmg: 34, reload: 3.5 } : null);
        if (!gun || bd.hp <= 0 || shield) continue;
        bd.cd = (bd.cd || 0) - dt;
        if (bd.cd > 0) continue;
        const p = buildingPos(base, bd);
        const tgt = this.nearestTarget(p.x, p.z, gun.range, (s) => this.baseHostileTo(base, s));
        if (!tgt) { bd.cd = 0.5; continue; }
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
      // conquest: keep destroyed + hostile captain lingering nearby
      const keep = base.buildings.find((x) => x.type === 'keep');
      if (keep && keep.hp <= 0 && !shield) {
        const R = baseRadius(base);
        let cap = null;
        for (const s of this.ships.values()) if (s.pid && s.sink === 0 && hostile(W, s.owner, base.owner) && Math.hypot(s.x - base.x, s.z - base.z) < R + 90) { cap = s; break; }
        const defenders = [...this.ships.values()].some((s) => s.sink === 0 && s.owner === base.owner && Math.hypot(s.x - base.x, s.z - base.z) < R + 200);
        const c = this.capture.get(base.id);
        if (cap && !defenders) {
          if (!c || c.pid !== cap.pid) { this.capture.set(base.id, { pid: cap.pid, t: 0 }); this.msgs.push({ to: cap.pid, text: `Capturing ${base.name}… hold position!`, kind: 'event' }); }
          else { c.t += dt; if (c.t >= 12) this.conquer(base, cap.pid); }
        } else if (c) this.capture.delete(base.id);
      }
      // entry fees for visitors
      if (base.haven && base.haven.fee > 0 && !base.owner.startsWith('ai:')) {
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
  baseHostileTo(base, s) {
    if (s.sink > 0 || s.docked) return false;
    if (base.owner.startsWith('ai:')) return hostile(this.W, base.owner, s.owner) && !(s.owner.startsWith('ai:') && s.role !== 'navy');
    if (s.trespass?.[base.id]) return true;
    if (base.haven?.safe) return false;
    if (s.pid && havenAccess(this.W, base, s.pid).fee === 0 && !hostile(this.W, base.owner, s.owner)) return false;
    return hostile(this.W, base.owner, s.owner);
  }
  conquer(base, pid) {
    const W = this.W, prev = base.owner;
    base.owner = pid;
    base.haven = { safe: false, fee: 0, allies: true, allow: [] };
    base.paid = {};
    const keep = base.buildings.find((x) => x.type === 'keep');
    if (keep) keep.hp = BUILDINGS.keep.hp * 0.3;
    this.capture.delete(base.id);
    const p = W.players[pid];
    const loot = { gold: 800 + base.buildings.length * 150, oak: 60, iron: 30 };
    gain(p.inv, loot);
    addXp(p, 500);
    if (!p.home || !W.bases.some((b) => b.id === p.home && b.owner === pid)) p.home = base.id;
    this.dirty.prof.add(pid); this.dirty.meta = true;
    const was = prev.startsWith('ai:') ? 'the pirates' : (W.players[prev]?.name || 'someone');
    this.msgs.push({ to: null, text: `${p.name} conquered ${base.name} from ${was}!`, kind: 'event' });
    W.log.push({ at: Date.now(), text: `${p.name} conquered ${base.name}` });
  }
  claim(pid, baseId, free = false) {
    const b = this.W.bases.find((x) => x.id === baseId);
    if (!b || b.owner) return 'Island already claimed';
    const p = this.W.players[pid];
    if (!free) { if (p.inv.gold < 300) return 'Claiming costs 300 gold'; p.inv.gold -= 300; }
    b.owner = pid;
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
      const d = Math.hypot(s.x - x, s.z - z);
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
  stepAI(s, dt) {
    const ai = s.ai;
    ai.think = (ai.think || 0) - dt;
    if (ai.think <= 0) {
      ai.think = 0.4 + this.rand() * 0.3;
      if (s.role === 'merchant') {
        const threat = this.nearestTarget(s.x, s.z, 380, (o) => o.sink === 0 && o.pid && hostile(this.W, o.owner, s.owner));
        ai.target = null;
        if (threat) { ai.want = Math.atan2(s.x - threat.x, s.z - threat.z); s.sail = 1; }
        else { this.wander(s); s.sail = 0.67; }
      } else {
        let tgt = ai.raid ? null : this.nearestTarget(s.x, s.z, ai.aggro || 650, (o) => o.sink === 0 && !o.docked && hostile(this.W, s.owner, o.owner) && !this.inHaven(o.x, o.z) && (!o.pid || !shielded(this.W, o.owner)));
        if (s.tag === 'escort' && !tgt) tgt = null;
        ai.target = tgt ? tgt.id : null;
        if (!tgt && ai.raid) {
          const base = this.W.bases.find((b) => b.id === ai.raid);
          if (base && base.owner && !shielded(this.W, base.owner) && base.buildings.some((x) => x.hp > 0)) {
            const bd = base.buildings.filter((x) => x.hp > 0).sort((a, b) => (a.type === 'keep') - (b.type === 'keep'))[0];
            const p = buildingPos(base, bd);
            ai.bpos = p;
            this.engage(s, p.x, p.z, 0, 0, dt);
          } else { ai.raid = null; this.wander(s); }
        } else if (tgt) {
          ai.bpos = null;
          this.engage(s, tgt.x, tgt.z, tgt.yaw, tgt.spd, dt);
        } else {
          ai.bpos = null;
          if (s.tag === 'escort' && ai.leader && this.ships.get(ai.leader)) { const l = this.ships.get(ai.leader); ai.want = Math.atan2(l.x + Math.sin(l.yaw + ai.slot) * 40 - s.x, l.z + Math.cos(l.yaw + ai.slot) * 40 - s.z); s.sail = 0.67; }
          else this.wander(s);
        }
      }
      // island avoidance probe
      const look = 60 + s.spd * 5;
      const px = s.x + Math.sin(s.yaw) * look, pz = s.z + Math.cos(s.yaw) * look;
      for (const isl of this.landmasses()) {
        const d = Math.hypot(px - isl.x, pz - isl.z);
        if (d < isl.r + 40) {
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
      if (ai.target && !t) { ai.target = null; return; }
      const tx = t ? t.x : ai.bpos.x, tz = t ? t.z : ai.bpos.z;
      for (const side of ['L', 'R', 'bow', 'stern']) {
        if (s.reload[side] > 0) continue;
        if ((side === 'bow' && !s.stats.bow) || (side === 'stern' && !s.stats.stern)) continue;
        // lead the target
        let ax = tx, az = tz;
        if (t) { const ft = Math.hypot(tx - s.x, tz - s.z) / MUZZLE; ax += Math.sin(t.yaw) * t.spd * ft * 1.05; az += Math.cos(t.yaw) * t.spd * ft * 1.05; }
        const arc = arcOf(s, ax, az);
        if (arc.side !== side || !arc.inSector || arc.dist > s.stats.range * 0.95) continue;
        if (this.rand() > (ai.trigger ?? 0.5)) { s.reload[side] = 0.6; continue; }
        const ammo = this.aiAmmo(s, t);
        const plan = this.planBroadside(s, side, ax, az, ammo, () => 0.5 + (this.rand() - 0.5) * (1.4 - (ai.skill || 0.5)));
        if (!plan.err) this.fire(s, side, ax, az, ammo, plan.balls);
      }
    }
  }
  aiAmmo(s, t) {
    if (!t || s.level < 4) return 'ball';
    const r = this.rand();
    if (t.sails > t.stats.sails * 0.6 && t.spd > s.spd && r < 0.3) return 'chain';
    if (t.crew > t.stats.crew * 0.4 && r < 0.18) return 'grape';
    if (s.level > 12 && r < 0.12) return 'explosive';
    return 'ball';
  }
  engage(s, tx, tz, tyaw, tspd, dt) {
    const ai = s.ai;
    const d = Math.hypot(tx - s.x, tz - s.z);
    const bearing = Math.atan2(tx - s.x, tz - s.z);
    const R = s.stats.range * 0.7;
    if (d > R * 1.1) { ai.want = bearing + (ai.flank || 0.35); s.sail = 1; }
    else if (d < R * 0.35) { ai.want = bearing + Math.PI * 0.7 * (ai.flank > 0 ? 1 : -1); s.sail = 0.67; }
    else {
      // present a broadside: turn perpendicular, on whichever side is closer
      const rel = wrapA(bearing - s.yaw);
      ai.want = rel > 0 ? bearing - Math.PI / 2 + 0.15 : bearing + Math.PI / 2 - 0.15;
      s.sail = 0.67;
    }
  }
  wander(s) {
    const ai = s.ai;
    if (!ai.wp || Math.hypot(ai.wp.x - s.x, ai.wp.z - s.z) < 80) {
      const a = this.rand() * TAU, r = 300 + this.rand() * (WORLD_R - 500);
      ai.wp = { x: Math.cos(a) * r, z: Math.sin(a) * r };
      if (ai.home) ai.wp = { x: ai.home.x + Math.cos(a) * 500, z: ai.home.z + Math.sin(a) * 500 };
    }
    if (!(ai.avoid > 0)) ai.want = Math.atan2(ai.wp.x - s.x, ai.wp.z - s.z);
  }

  /** Level-matched AI population around each online player. */
  spawnAround(dt) {
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    this.spawnT = 3;
    const players = [...this.ships.values()].filter((s) => s.pid && s.sink === 0);
    const ai = [...this.ships.values()].filter((s) => !s.pid);
    // despawn far-away ambient AI
    for (const a of ai) {
      if (a.tag || a.ai?.raid) continue;
      const near = players.some((p) => Math.hypot(p.x - a.x, p.z - a.z) < 1700);
      if (!near && players.length) this.removeShip(a.id);
      if (a.sink > 12) this.removeShip(a.id);
    }
    for (const p of players) {
      const cnt = ai.filter((a) => a.sink === 0 && Math.hypot(p.x - a.x, p.z - a.z) < 1100).length;
      if (cnt >= (this.aiDensity ?? 5) || this.ships.size > 40) continue;
      const lvl = this.W.players[p.pid]?.level || 1;
      for (let k = 0; k < Math.min(2, (this.aiDensity ?? 5) - cnt); k++) this.spawnAI(lvl, p);
    }
  }
  spawnAI(lvl, near, o = {}) {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rand() * TAU, r = o.dist ?? (650 + this.rand() * 350);
      const x = (near ? near.x : 0) + Math.cos(a) * r, z = (near ? near.z : 0) + Math.sin(a) * r;
      if (Math.hypot(x, z) > WORLD_R - 100 || this.inHaven(x, z)) continue;
      if (this.landmasses().some((i) => Math.hypot(i.x - x, i.z - z) < i.r + 60)) continue;
      const roll = this.rand();
      const role = o.role || (roll < 0.42 ? 'merchant' : roll < 0.85 ? 'pirate' : 'navy');
      const myTier = near?.spec ? tierIndex(near.spec.tier) : 0;
      const allowed = TIERS.filter((t) => t.level <= lvl + 2).length - 1;
      let ti = o.tier != null ? tierIndex(o.tier) : clamp(myTier + Math.floor(this.rand() * 3) - 1 + (role === 'navy' ? 1 : 0), 0, Math.max(0, allowed));
      const T = TIERS[ti];
      const alvl = clamp(lvl + Math.floor(this.rand() * 3) - 1, 1, MAX_LEVEL);
      const rank = Math.floor(alvl / 5);
      const upg = { hull: rank, reload: rank, speed: Math.min(3, rank), turn: Math.min(3, rank), bow: alvl > 8 ? 1 : 0, stern: alvl > 14 ? 1 : 0 };
      const names = { merchant: ['Fat Purse', 'Spice Barge', 'Lady Ledger', 'Salt Hauler', 'Golden Hen'], pirate: ['Black Gull', 'Rusty Hook', 'Sea Wolf', 'Cursed Kettle', 'Grim Tide'], navy: ['HMS Resolute', 'HMS Vigil', 'HMS Dauntless', 'HMS Warden'] }[role];
      const look = role === 'navy' ? { hullColor: '#2b2d38', trimColor: '#d8b54a', sailColor: '#f4f1e6', emblem: 5, flagBg: '#1d3a8a', flagFg: '#fff' }
        : role === 'merchant' ? { hullColor: '#7a5532', trimColor: '#2f6b4e', sailColor: '#e9dcb8', emblem: 3, flagBg: '#2f6b4e', flagFg: '#f2e7c4' }
        : { hullColor: '#2a1c14', trimColor: '#8b1e1e', sailColor: '#5b5146', emblem: [0, 1, 4][Math.floor(this.rand() * 3)], flagBg: '#111', flagFg: '#ddd' };
      const spec = shipSpec(T.id, { name: o.name || names[Math.floor(this.rand() * names.length)], ...look });
      const s = this.addShip({
        owner: role === 'merchant' ? 'ai:merchant' : role === 'navy' ? 'ai:navy' : 'ai:pirates',
        role, spec, upg, x, z, yaw: this.rand() * TAU, level: alvl, tag: o.tag,
        ai: { skill: clamp(0.3 + alvl * 0.02, 0.3, 0.9), trigger: 0.35 + this.rand() * 0.3, flank: this.rand() < 0.5 ? 0.4 : -0.4, raid: o.raid || null, aggro: o.aggro, leader: o.leader, slot: o.slot },
      });
      s.look = look;
      s.spd = T.speed * 0.5;
      return s;
    }
    return null;
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
          if (!s.pid || s.sink > 0) continue;
          if (Math.hypot(s.x - c.x, s.z - c.z) < s.stats.len * 0.6 + 6) {
            const p = this.W.players[s.pid];
            gain(p.inv, c.loot);
            addXp(p, 10);
            this.dirty.prof.add(p.id);
            const txt = Object.entries(c.loot).filter(([, v]) => v > 0).map(([k, v]) => `+${v} ${k}`).join('  ');
            this.msgs.push({ to: s.pid, text: `Salvaged: ${txt}`, kind: 'loot' });
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
        const k = 1 + tierIndex(s.spec.tier) * 0.5;
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
      if (r < 0.4 && !this.kraken) this.startEvent('kraken');
      else if (r < 0.8 || !owned.length) this.startEvent('treasure');
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
        if (!this.inHaven(x, z) && !this.landmasses().some((l) => Math.hypot(l.x - x, l.z - z) < l.r + 80) && Math.hypot(x, z) < WORLD_R - 200) break;
      }
      const hp = Math.round(3000 + avg * 260);
      this.kraken = { x, z, hp, maxHp: hp, t: 0, target: null, slamT: 4, phase: 'hunt', tentacles: Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * TAU, up: 0, slam: 0 })) };
      this.msgs.push({ to: null, text: 'THE KRAKEN STIRS! A great beast has surfaced — hunt it for legendary loot.', kind: 'event' });
    } else if (kind === 'treasure') {
      const tier = avg >= 22 ? 'manowar' : 'galleon';
      const lead = this.spawnAI(Math.max(avg + 3, 12), anchor, { role: 'navy', tier, tag: 'treasure', name: 'Treasure Flagship', dist: 800, aggro: 420 });
      if (!lead) return;
      lead.hull = lead.stats.hull = Math.round(lead.stats.hull * 1.5);
      for (let i = 0; i < 3; i++) {
        const e = this.spawnAI(Math.max(avg, 4), lead, { role: 'navy', tier: avg >= 10 ? 'frigate' : 'brigantine', tag: 'escort', dist: 60 + i * 25, leader: lead.id, slot: [-2.4, 2.4, Math.PI][i], aggro: 500 });
        if (e) e.ai.leader = lead.id;
      }
      this.msgs.push({ to: null, text: 'A heavily guarded TREASURE FLAGSHIP has been sighted! Check your map.', kind: 'event' });
    } else if (kind === 'raid') {
      const owned = this.W.bases.filter((b) => b.owner && !b.owner.startsWith('ai:') && this.W.players[b.owner]?.online);
      const base = owned[Math.floor(this.rand() * owned.length)];
      if (!base) return;
      const lvl = this.W.players[base.owner].level;
      for (let i = 0; i < 3; i++) this.spawnAI(lvl, base, { role: 'pirate', tag: 'raider', raid: base.id, dist: 700 + i * 30 });
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
    // hunt the nearest player (not in a haven)
    const tgt = this.nearestTarget(k.x, k.z, 1400, (s) => s.pid && s.sink === 0 && !s.docked && !this.inHaven(s.x, s.z));
    k.target = tgt?.id || null;
    if (tgt) {
      const d = Math.hypot(tgt.x - k.x, tgt.z - k.z);
      const sp = d > 60 ? 7 : 0;
      if (d > 1) { k.x += ((tgt.x - k.x) / d) * sp * dt; k.z += ((tgt.z - k.z) / d) * sp * dt; }
      const close = d < 75;
      for (const tn of k.tentacles) tn.up += ((close ? 1 : 0.15) - tn.up) * Math.min(1, dt * 0.8);
      if (close) {
        k.slamT -= dt;
        if (k.slamT <= 0) {
          k.slamT = 3.2;
          const i = Math.floor(this.rand() * k.tentacles.length);
          k.tentacles[i].slam = 1;
          this.hurt(tgt, 46 + k.maxHp * 0.004, 18, 3, 'ai:kraken');
          tgt.spd *= 0.5;
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
          const dmg = b.dmg * (AMMO[b.ammo]?.hull || 1) * (p.r > 10 ? 1.4 : 1);
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
    this.crates.push({ id: uid('c'), x: k.x, z: k.z, loot: { gold: 2500 + k.maxHp * 0.3 | 0, powder: 30, iron: 60, canvas: 40 }, t: 0, big: true });
    const dm = this.damagers.get('kraken');
    if (dm) for (const [owner, v] of dm) {
      const p = this.W.players[owner]; if (!p) continue;
      const xp = 400 + 1400 * (v / k.maxHp);
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
        s.heave = heightAt(s.x, s.z, this.time);
        if (s.ai && s.sink === 0) this.stepAI(s, dt);
        if (!s.pid || s.local) this.stepShip(s, dt); // remote players move themselves
        else { // still tick timers for remote players
          for (const k in s.reload) if (s.reload[k] > 0) s.reload[k] -= dt;
          if (s.fire > 0) { s.fire -= dt; this.hurt(s, 5 * dt, 0, 0, null, true); }
          if (s.sink > 0) s.sink += dt;
        }
        if (!s.pid && s.sink === 0) this.collideShips(s, list);
      }
      for (const s of list) if (s.pid && s.sink > 6) { this.spawnPlayer(s.pid); }
      this.stepBalls(dt);
      this.stepCrates(dt);
      this.stepHarvest(dt);
      this.stepBases(dt);
      this.stepEvents(dt);
      this.spawnAround(dt);
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
    // first island is free: the unclaimed island nearest the Free Port
    const free = W.bases.filter((b) => !b.owner).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    const pick = free[Math.floor(sim.rand() * Math.min(3, free.length))];
    if (pick) sim.claim(pid, pick.id, true);
  }
  if (name) p.name = String(name).slice(0, 20);
  p.online = true; p.lastSeen = Date.now();
  sim.dirty.meta = true;
  return { p, fresh };
}
