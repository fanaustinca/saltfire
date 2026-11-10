// The running game: renders the world, drives the local flagship (3rd-person), visual targeting
// (firing sector + colour-coded 3D trajectory arc), and keeps host/clients in sync.
import * as THREE from 'three';
import { Stage } from './render/scene.js';
import { buildShip } from './render/shipmodel.js';
import { buildIsland, BaseView } from './render/islands.js';
import { Effects } from './render/effects.js';
import { KrakenView } from './render/kraken.js';
import { Sim, joinPlayer, arcOf, solveElev, localToWorld, SAIL_STEPS, wrapA } from './sim.js';
import { handleAct, dockSite } from './actions.js';
import { heightAt, setCalm } from './waves.js';
import { baseRadius } from './basegeo.js';
import { AMMO, AMMO_ORDER, MUZZLE, GRAVITY, SECTOR_HALF, CHASE_HALF, MIN_RANGE, VERSION } from './config.js';
import { shipStats, crewEff, flagship } from './economy.js';
import { saveWorld } from './save.js';
import { sfx } from './audio.js';

const SNAP_HZ = 10, ST_HZ = 15;

export class Game {
  constructor(app, { role, W, room, pid, rec, welcome }) {
    this.app = app; this.ui = app.ui; this.welcome = welcome;
    this.role = role; this.room = room; this.pid = pid; this.rec = rec;
    const q = new URLSearchParams(location.search);
    this.stage = new Stage(document.getElementById('view'), { quality: q.get('q') || app.settings.quality || 'high', preserve: q.has('test') });
    this.scene = this.stage.scene; this.camera = this.stage.camera;
    this.fx = new Effects(this.scene);
    this.krakenView = new KrakenView(this.scene);
    this.sim = new Sim(W, { authority: role === 'host' });
    this.views = new Map();   // ship id -> view
    this.baseViews = new Map();
    this.islandGroups = [];
    this.t = 0; this.frames = 0; this.fps = 60;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, rmb: false, lastX: 0, lastY: 0 };
    this.cam = { yawOff: 0, pitch: 0.2, zoom: 1, yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.aim = { point: null, side: null, valid: false };
    this.pending = new Map(); this.reqId = 1;
    this.peers = new Map(); // host: peerId -> { pid, known:Set }
    this.clock = { off: null };
    this.sendT = 0; this.metaT = 0; this.saveT = 0; this.defT = 0;
    this.fxOut = []; // host: queued fx/msgs for peers
    this.sailIdx = 0;
    this.paused = false;
    this.buildStaticWorld();
    this.buildAimHelpers();
    this.bindInput();
    if (role === 'host') this.initHost(); else this.initClient();
    this.ui.hud(this);
    this.last = performance.now();
    this.running = true;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    // hidden tabs still simulate (host keeps the world alive) via a worker tick
    this.ticker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),50)'], { type: 'text/javascript' })));
    this.ticker.onmessage = () => { if (document.hidden && this.running) this.tick(Math.max(0, Math.min(0.1, (performance.now() - this.last) / 1000)), true); };
  }

  // ------------------------------------------------------------------ setup
  get W() { return this.sim.W; }
  me() { return this.sim.ships.get('p:' + this.pid); }
  profile() { return this.W.players[this.pid]; }

  /** Islands are built lazily (and dropped again) by distance: the world is far too big to keep in memory. */
  buildStaticWorld() {
    for (const e of this.islandGroups) if (e.group) this.scene.remove(e.group);
    this.islandGroups = this.W.islands.map((isl) => ({ isl, group: null }));
    this.updateShallows();
  }
  updateShallows() {
    const sig = this.W.bases.map((b) => baseRadius(b).toFixed(1)).join(',');
    if (sig === this.shallowSig) return;
    this.shallowSig = sig;
    this.shallows = [...this.W.islands.filter((i) => i.kind !== 'rock').map((i) => ({ x: i.x, z: i.z, r: i.r, shallow: 26 })), ...this.W.bases.map((b) => ({ x: b.x, z: b.z, r: baseRadius(b), shallow: 30 }))];
    setCalm(this.shallows);
    this.sim._land = null;
  }
  /** Distance LOD for islands + bases; also refreshes the ocean's shallows/calm set. */
  updateWorldLOD(focus) {
    const BUILD = 3300, DROP = 4300;
    for (const e of this.islandGroups) {
      const d = Math.hypot(e.isl.x - focus.x, e.isl.z - focus.z);
      if (!e.group && d < BUILD) { e.group = buildIsland(e.isl); this.scene.add(e.group); }
      else if (e.group && d > DROP) { this.scene.remove(e.group); e.group.traverse((o) => { if (o.geometry && !o.isInstancedMesh) o.geometry.dispose(); }); e.group = null; }
    }
    this.updateShallows();
    this.stage.ocean.setIslands(this.shallows, focus);
    // ground clutter LOD: grass + flowers only near the camera, bushes/boulders a bit further
    const cam = this.camera.position;
    const groups = [...this.islandGroups.map((e) => e.group), ...[...this.baseViews.values()].map((v) => v.group)];
    for (const g of groups) {
      if (!g) continue;
      g.userData.lodMeshes ||= (() => { const l = []; g.traverse((o) => { if (o.userData.lod) l.push(o); }); return l; })();
      for (const o of g.userData.lodMeshes) {
        const c = o.userData.c || (o.userData.c = (() => { const b = new THREE.Box3().setFromObject(o); return b.getCenter(new THREE.Vector3()); })());
        const d = Math.hypot(c.x - cam.x, c.z - cam.z);
        o.visible = d < (o.userData.lod === 1 ? 650 : 1500);
      }
    }
  }
  syncBases(focus) {
    for (const b of this.W.bases) {
      let v = this.baseViews.get(b.id);
      if (!v) { v = new BaseView(this.scene); this.baseViews.set(b.id, v); }
      const d = Math.hypot(b.x - focus.x, b.z - focus.z);
      if (d < 3300) v.update(b, this.W, this.W.players);
      else if (d > 4300 && v.group) { v.dispose(); v.group = null; v.sig = ''; }
    }
  }

  initHost() {
    this.fresh = joinPlayer(this.sim, this.pid, this.app.name).fresh;
    const me = this.sim.spawnPlayer(this.pid);
    me.local = true;
    this.sim.dirty.meta = true;
    if (this.room) {
      this.room.onJoin = (peer, m) => this.hostJoin(peer, m);
      this.room.onLeave = (peer) => this.hostLeave(peer);
      this.room.onMessage = (peer, m) => this.hostMsg(peer, m);
    }
    addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }
  initClient() {
    this.room.onMessage = (_, m) => this.clientMsg(m);
    this.room.onLeave = () => { this.ui.modal('Disconnected', '<p>The host closed the world or the connection dropped.</p>', [{ label: 'Main menu', primary: true, fn: () => location.reload() }]); };
    const p = this.profile();
    const s = this.sim.addShip({ id: 'p:' + this.pid, pid: this.pid, owner: this.pid, spec: flagship(p), upg: p.upg, level: p.level, x: this.welcome.ship.x, z: this.welcome.ship.z, yaw: this.welcome.ship.yaw, sail: 0 });
    s.local = true; s.life = this.welcome.ship.life || 0;
    s.look = this.welcome.ship.look;
  }

  // ------------------------------------------------------------------ host networking
  publicW() { const { npc, ...rest } = this.W; return rest; }
  hostJoin(peer, m) {
    const pid = String(m.pid || peer).slice(0, 24);
    for (const [pp, info] of this.peers) if (info.pid === pid) { this.room.kick(pp); this.peers.delete(pp); }
    const { p, fresh } = joinPlayer(this.sim, pid, m.name);
    const s = this.sim.spawnPlayer(pid);
    s.life = (s.life || 0) + 1;
    this.peers.set(peer, { pid, known: new Map(), seen: performance.now() });
    this.room.send(peer, { k: 'welcome', pid, W: this.publicW(), code: this.room.code, ship: { x: s.x, z: s.z, yaw: s.yaw, life: s.life, look: s.look }, fresh, v: VERSION });
    this.ui.toast(`${p.name} ${fresh ? 'joined the world for the first time' : 'returned to the world'}.`, 'info');
    this.sim.msgs.push({ to: null, text: `${p.name} ${fresh ? 'has joined' : 'is back'}!`, kind: 'info' });
    this.save();
  }
  hostLeave(peer) {
    const info = this.peers.get(peer); if (!info) return;
    this.peers.delete(peer);
    const p = this.W.players[info.pid];
    if (p) { p.online = false; p.lastSeen = Date.now(); }
    this.sim.removeShip('p:' + info.pid);
    this.sim.dismissFleet(info.pid);
    this.sim.msgs.push({ to: null, text: `${p?.name || 'A captain'} went offline — their bases are now shielded.`, kind: 'info' });
    this.sim.dirty.meta = true;
    this.save();
  }
  hostMsg(peer, m) {
    const info = this.peers.get(peer); if (!info || !m) return;
    info.seen = performance.now();
    const s = this.sim.ships.get('p:' + info.pid);
    if (m.k === 'st' && s) {
      if ((m.life || 0) !== (s.life || 0)) return; // stale state from before a respawn
      if (s.sink > 0) return;
      s.x = m.x; s.z = m.z; s.yaw = m.yaw; s.spd = m.spd; s.sail = m.sail; s.sailNow = m.sn; s.rud = m.rud; s.recoil = m.rc || 0;
      pushBuf(s, this.sim.time, m);
    } else if (m.k === 'fire' && s) {
      const r = this.sim.fire(s, m.side, m.ax, m.az, m.ammo, m.balls);
      if (!r.err) sfx.cannon(this.distTo(s.x, s.z), r.balls.length);
    } else if (m.k === 'act') {
      const res = handleAct(this.sim, info.pid, m.a || {});
      this.room.send(peer, { k: 'res', id: m.id, res });
    } else if (m.k === 'chat') {
      this.sim.msgs.push({ to: null, text: `${this.W.players[info.pid]?.name}: ${String(m.text).slice(0, 140)}`, kind: 'chat' });
    }
  }
  hostSend(dt) {
    this.sendT -= dt; this.metaT -= dt; this.defT -= dt;
    const fx = this.sim.fx.splice(0);
    const msgs = this.sim.msgs.splice(0);
    const prompts = this.sim.prompts.splice(0);
    // local presentation of the host's own events
    for (const f of fx) this.playFx(f, true);
    for (const m of msgs) if (!m.to || m.to === this.pid) this.ui.toast(m.text, m.kind);
    for (const p of prompts) if (p.to === this.pid) this.ui.feePrompt(this, p);
    if (!this.room || !this.peers.size) { this.fxOut.length = 0; this.sim.dirty.prof.clear(); if (this.sim.dirty.meta) { this.sim.dirty.meta = false; this.ui.refresh(this); } return; }
    this.fxOut.push(...fx.filter((f) => f.t !== 'fire' || true));
    for (const [peer, info] of this.peers) {
      const mm = msgs.filter((m) => !m.to || m.to === info.pid);
      const pp = prompts.filter((p) => p.to === info.pid);
      if (mm.length || pp.length) this.room.send(peer, { k: 'msg', msgs: mm, prompts: pp });
    }
    if (this.sim.dirty.meta && this.metaT <= 0) {
      this.metaT = 0.5; this.sim.dirty.meta = false; this.sim.dirty.prof.clear();
      this.room.broadcast({ k: 'meta', W: this.publicW() });
      this.ui.refresh(this);
    } else if (this.sim.dirty.prof.size && this.metaT <= 0) {
      this.metaT = 0.5;
      const profs = {}; for (const id of this.sim.dirty.prof) profs[id] = this.W.players[id];
      this.sim.dirty.prof.clear();
      this.room.broadcast({ k: 'prof', profs });
      this.ui.refresh(this);
    }
    if (this.sendT > 0) return;
    this.sendT = 1 / SNAP_HZ;
    // drop peers that went silent (closed tab without a goodbye)
    for (const [peer, info] of this.peers) if (performance.now() - info.seen > 25000) { this.room.kick(peer); this.hostLeave(peer); }
    const ships = [];
    for (const s of this.sim.ships.values()) ships.push([s.id, r2(s.x), r2(s.z), r3(s.yaw), r2(s.spd), r2(s.sailNow), r1(s.hull), r1(s.sails), Math.round(s.crew), s.fire > 0 ? 1 : 0, r2(s.sink), s.docked ? 1 : 0, s.rev || 0, r2(s.rud), s.life || 0, r2(s.recoil)]);
    const kr = this.sim.kraken ? { x: r2(this.sim.kraken.x), z: r2(this.sim.kraken.z), hp: r1(this.sim.kraken.hp), maxHp: this.sim.kraken.maxHp, t: r2(this.sim.kraken.t), dead: this.sim.kraken.dead || 0, tn: this.sim.kraken.tentacles.map((x) => [r2(x.a), r2(x.up), r2(x.slam)]) } : null;
    const crates = this.sim.crates.map((c) => ({ id: c.id, x: r2(c.x), z: r2(c.z), big: c.big, t: c.t }));
    const out = this.fxOut.splice(0);
    for (const [peer, info] of this.peers) {
      const defs = [];
      const full = this.defT <= 0;
      for (const s of this.sim.ships.values()) {
        const rev = s.rev || 0;
        if (full || info.known.get(s.id) !== rev) { info.known.set(s.id, rev); defs.push(shipDef(s)); }
      }
      const myId = 'p:' + info.pid;
      const me = this.sim.ships.get(myId);
      const fxp = out.filter((f) => !(f.t === 'fire' && f.ship === myId));
      this.room.send(peer, { k: 'snap', t: r2(this.sim.time), ships, defs, kr, crates, fx: fxp, rel: me ? { reload: me.reload, docked: me.docked, trespass: me.trespass } : null });
    }
    if (this.defT <= 0) this.defT = 3;
  }
  async save() {
    if (this.role !== 'host' || !this.rec) return;
    try { this.rec.W = this.W; this.rec.code = this.room?.code || this.rec.code; await saveWorld(this.rec); this.lastSave = Date.now(); }
    catch (e) { console.warn('save failed', e); }
  }

  // ------------------------------------------------------------------ client networking
  clientMsg(m) {
    if (!m) return;
    if (m.k === 'snap') this.applySnap(m);
    else if (m.k === 'meta') {
      const keepNpc = this.W.npc;
      for (const k of Object.keys(m.W)) this.W[k] = m.W[k];
      this.W.npc = keepNpc;
      this.sim._landT = -1;
      this.ui.refresh(this);
    } else if (m.k === 'prof') { Object.assign(this.W.players, m.profs); this.ui.refresh(this); }
    else if (m.k === 'msg') { for (const x of m.msgs) this.ui.toast(x.text, x.kind); for (const p of m.prompts) this.ui.feePrompt(this, p); }
    else if (m.k === 'res') { const p = this.pending.get(m.id); if (p) { this.pending.delete(m.id); p(m.res); } }
  }
  applySnap(m) {
    const now = performance.now() / 1000;
    const off = m.t - now;
    this.clock.off = this.clock.off == null ? off : this.clock.off + (off - this.clock.off) * 0.05;
    for (const d of m.defs) {
      let s = this.sim.ships.get(d.id);
      if (d.id === 'p:' + this.pid) {
        if (s) { const p = this.profile(); if (s.spec.uid !== d.spec.uid || (s.rev || 0) !== (d.rev || 0)) { s.spec = d.spec; s.upg = d.upg; this.sim.refreshShip(s); s.rev = d.rev; this.dropView(s.id); } s.look = d.look; }
        continue;
      }
      if (!s) { s = this.sim.addShip({ id: d.id, owner: d.owner, pid: d.pid, role: d.role, spec: d.spec, upg: d.upg, level: d.level, name: d.name, tag: d.tag, look: d.look }); s.rev = d.rev; }
      else if ((s.rev || 0) !== (d.rev || 0)) { s.spec = d.spec; s.upg = d.upg; s.stats = shipStats(d.spec, d.upg); s.guns = undefined; s.rev = d.rev; this.sim.refreshShip(s); s.rev = d.rev; this.dropView(s.id); }
      s.look = d.look; s.level = d.level; s.name = d.name;
    }
    const seen = new Set();
    for (const a of m.ships) {
      const [id, x, z, yaw, spd, sn, hull, sails, crew, fire, sink, docked, rev, rud, life, recoil] = a;
      seen.add(id);
      const s = this.sim.ships.get(id); if (!s) continue;
      if (id === 'p:' + this.pid) {
        s.hull = hull; s.sails = sails; s.crew = crew; s.fire = fire ? 1 : 0;
        if (sink > 0 && s.sink === 0) s.sink = sink;
        if (sink === 0 && s.sink > 0) s.sink = 0;
        if ((life || 0) !== (s.life || 0)) { s.life = life; s.x = x; s.z = z; s.yaw = yaw; s.spd = 0; s.sink = 0; s.sail = 0; }
        if (m.rel) { s.docked = m.rel.docked; s.trespass = m.rel.trespass; }
        continue;
      }
      s.hull = hull; s.sails = sails; s.crew = crew; s.fire = fire ? 1 : 0; s.sink = sink; s.docked = docked ? {} : null; s.recoil = recoil || 0;
      pushBuf(s, m.t, { x, z, yaw, spd, sn, rud });
      s.x = x; s.z = z; s.yaw = yaw; s.spd = spd; s.sailNow = sn; s.rud = rud;
    }
    for (const id of [...this.sim.ships.keys()]) if (!seen.has(id) && id !== 'p:' + this.pid) { this.sim.ships.delete(id); this.dropView(id); }
    // kraken
    if (m.kr) {
      const k = this.sim.kraken || (this.sim.kraken = { tentacles: [] });
      Object.assign(k, { x: m.kr.x, z: m.kr.z, hp: m.kr.hp, maxHp: m.kr.maxHp, t: m.kr.t, dead: m.kr.dead });
      k.tentacles = m.kr.tn.map(([a, up, slam]) => ({ a, up, slam }));
    } else this.sim.kraken = null;
    this.sim.crates = m.crates.map((c) => ({ ...c, loot: {} }));
    for (const f of m.fx) this.playFx(f, false);
  }
  act(a) {
    if (this.role === 'host') {
      const res = handleAct(this.sim, this.pid, a);
      this.ui.refresh(this);
      return Promise.resolve(res);
    }
    const id = this.reqId++;
    return new Promise((res) => { this.pending.set(id, res); this.room.toHost({ k: 'act', id, a }); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); res({ err: 'No answer from host' }); } }, 8000); });
  }

  /** Muzzle smoke/flash for one gun, from where its ship is at the moment the gun goes off. */
  muzzleAt(shipId, b, flash, k = 1) {
    let x = b[0], y = b[1], z = b[2], dx = b[3], dz = b[5];
    const sh = shipId && this.sim.ships.get(shipId);
    if (sh && b.length > 7) {
      const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
      x = sh.x + b[7] * c + b[9] * sn; y = b[8] + (sh.heave || 0); z = sh.z - b[7] * sn + b[9] * c;
      const d = sh.yaw - b[10], cd = Math.cos(d), sd = Math.sin(d), vx = dx; dx = vx * cd + dz * sd; dz = -vx * sd + dz * cd;
    }
    const len = Math.hypot(dx, dz) || 1;
    this.fx.muzzle(x, y, z, dx / len, dz / len, flash, k);
  }
  // ------------------------------------------------------------------ fx presentation
  playFx(f, local) {
    const t = this.sim.time;
    const d = this.distTo(f.x ?? 0, f.z ?? 0);
    switch (f.t) {
      case 'fire': {
        const s = f.ship ? this.sim.ships.get(f.ship) : null;
        if (!local && f.ship !== 'p:' + this.pid) for (const b of f.balls) this.sim.spawnBall(null, { x: b[0], y: b[1], z: b[2], vx: b[3], vy: b[4], vz: b[5], delay: b[6], ammo: f.ammo, shooter: f.ship || 'base', owner: s?.owner || 'base', ...(b.length > 7 ? { gl: [b[7], b[8], b[9]], yaw0: b[10] } : {}) });
        // big broadsides: fewer smoke puffs per gun (the cloud merges anyway), one flash per few guns,
        // and nothing at all for far-off battles beyond what you can see
        const n = f.balls.length, dist = this.distTo(f.balls[0][0], f.balls[0][2]);
        if (dist < 2600) {
          const k = Math.max(0.25, Math.min(1, 3 / Math.sqrt(n))) * (dist > 1200 ? 0.5 : 1);
          f.balls.forEach((b, i) => {
            const len = Math.hypot(b[3], b[5]) || 1;
            setTimeout(() => this.muzzleAt(f.ship, b, i % Math.max(1, Math.round(n / 4)) === 0 ? 1 : 0, k), (b[6] || 0) * 1000);
          });
        }
        sfx.cannon(this.distTo(f.balls[0][0], f.balls[0][2]), f.balls.length);
        break;
      }
      case 'hit': { this.fx.hit(f.x, f.y, f.z, f.rig, f.ammo); sfx.crack(d); const v = this.views.get(f.ship); if (v && !f.rig && f.lx != null) v.model.addHole(f.lx, f.ly, f.lz); break; }
      case 'splash': this.fx.splash(f.x, f.z, 1, t); sfx.splash(d); break;
      case 'dirt': case 'stone': this.fx.dustPuff(f.x, f.y, f.z); sfx.crack(d * 1.3); break;
      case 'shield': this.fx.glow.add({ x: f.x, y: f.y, z: f.z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.6, s0: 6, s1: 14, a: 0.8, c: new THREE.Color(0.4, 0.75, 1) }); break;
      case 'collapse': this.fx.explosion(f.x, f.y + 4, f.z, 1.2); this.fx.dustPuff(f.x, f.y, f.z, 0x9a9080); sfx.boom(d); break;
      case 'sink': this.fx.explosion(f.x, 3, f.z, 1); for (let i = 0; i < 25; i++) this.fx.addChunk(f.x + (Math.random() - 0.5) * 10, 3, f.z + (Math.random() - 0.5) * 10); sfx.boom(d); break;
      case 'pickup': sfx.coin(); break;
      case 'repair': {
        sfx.chop(d); setTimeout(() => sfx.chop(d), 180); setTimeout(() => sfx.chop(d), 420);
        const v = this.views.get(f.ship), s = this.sim.ships.get(f.ship);
        if (v) v.model.patchHoles(0.5);
        const L = s?.stats.len || 20;
        for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28, r = Math.random() * L * 0.4; this.fx.glow.add({ x: f.x + Math.cos(a) * r, y: 3 + Math.random() * 4, z: f.z + Math.sin(a) * r, vx: 0, vy: 2 + Math.random() * 2, vz: 0, age: 0, life: 1.2, s0: 2, s1: 0.3, a: 0.9, c: new THREE.Color(0.55, 1, 0.45), drag: 1 }); }
        this.fx.dustPuff(f.x, 4, f.z, 0xb08a5a);
        break;
      }
      case 'harvest': if (f.ship === 'p:' + this.pid) { this.ui.floatText(`+${f.q} ${f.res}`); sfx.chop(); } break;
      case 'ink': for (let i = 0; i < 8; i++) this.fx.smoke.add({ x: f.x, y: f.y, z: f.z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 6, age: 0, life: 2, s0: 2, s1: 7, a: 0.8, c: new THREE.Color(0x200818), drag: 1 }); sfx.crack(d); break;
      case 'slam': this.fx.splash(f.x, f.z, 2.5, t); for (let i = 0; i < 12; i++) this.fx.addChunk(f.x, 3, f.z); sfx.boom(d); if (f.ship === 'p:' + this.pid) this.shake = 1; break;
      case 'krakenDie': this.fx.explosion(f.x, 4, f.z, 2); this.fx.splash(f.x, f.z, 4, t); sfx.boom(0); break;
      default: break;
    }
  }
  distTo(x, z) { const me = this.me(); return me ? Math.hypot(me.x - x, me.z - z) : 0; }

  // ------------------------------------------------------------------ input
  bindInput() {
    const cv = document.getElementById('view');
    this.onKey = (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const down = e.type === 'keydown';
      if (down) this.keys.add(e.code); else this.keys.delete(e.code);
      if (!down || e.repeat) { if (e.code === 'KeyF' && !down) this.act({ type: 'harvest', on: false }); return; }
      if (this.ui.blocking() && e.code !== 'Escape' && e.code !== 'KeyM' && e.code !== 'Backquote' && e.code !== 'KeyG' && e.code !== 'KeyJ') return;
      const me = this.me();
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': this.setSail(+1); break;
        case 'KeyS': case 'ArrowDown': this.setSail(-1); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.setAmmo(AMMO_ORDER[+e.code.slice(5) - 1]); break;
        case 'KeyQ': this.cycleAmmo(); break;
        case 'KeyE': this.interact(); break;
        case 'KeyF': this.act({ type: 'harvest', on: true }); break;
        case 'KeyM': case 'Tab': e.preventDefault(); this.ui.toggleMap(this); break;
        case 'KeyH': this.ui.help(); break;
        case 'KeyC': this.cam.yawOff = 0; this.cam.pitch = 0.2; break;
        case 'Space': e.preventDefault(); this.tryFire(); break;
        case 'Escape': this.ui.escape(this); break;
        case 'KeyP': if (me?.docked) this.ui.port(this); break;
        case 'KeyG': if (this.ui.panel && this.ui.remote) this.ui.closePanel(this); else this.ui.port(this, 'fleet', !me?.docked); break;
        case 'KeyJ': if (this.ui.panel && this.ui.tab === 'rewards') this.ui.closePanel(this); else this.ui.port(this, 'rewards', !me?.docked); break;
        case 'KeyR': this.seaRepair(); break;
        default: break;
      }
    };
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
    cv.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    cv.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    cv.addEventListener('mousemove', (e) => {
      this.mouse.inside = true;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / innerWidth) * 2 - 1; this.mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
      if (this.mouse.rmb) {
        this.cam.yawOff -= (e.clientX - this.mouse.lastX) * 0.005;
        this.cam.pitch = Math.max(-0.05, Math.min(1.2, this.cam.pitch + (e.clientY - this.mouse.lastY) * 0.004));
      }
      this.mouse.lastX = e.clientX; this.mouse.lastY = e.clientY;
    });
    cv.addEventListener('mousedown', (e) => {
      if (e.button === 2) { this.mouse.rmb = true; this.mouse.lastX = e.clientX; this.mouse.lastY = e.clientY; }
      if (e.button === 0) this.tryFire();
    });
    addEventListener('mouseup', (e) => { if (e.button === 2) this.mouse.rmb = false; });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('wheel', (e) => { this.cam.zoom = Math.max(0.45, Math.min(3, this.cam.zoom * (1 + Math.sign(e.deltaY) * 0.1))); }, { passive: true });
  }
  setSail(d) {
    const me = this.me(); if (!me || me.docked) return;
    this.sailIdx = Math.max(0, Math.min(3, this.sailIdx + d));
    me.sail = SAIL_STEPS[this.sailIdx];
    sfx.rope();
  }
  setAmmo(a) {
    const me = this.me(); if (!me) return;
    const p = this.profile();
    if (a !== 'ball' && !(p.inv[a] > 0)) { this.ui.toast(`No ${AMMO[a].name} left — craft more in port.`, 'bad'); return; }
    me.ammo = a; this.ammo = a;
    if (this.role !== 'host') this.act({ type: 'ammo', ammo: a });
    this.ui.refresh(this);
  }
  cycleAmmo() { const i = AMMO_ORDER.indexOf(this.ammo || 'ball'); for (let k = 1; k <= 4; k++) { const a = AMMO_ORDER[(i + k) % 4]; if (a === 'ball' || this.profile().inv[a] > 0) { this.setAmmo(a); return; } } }
  async interact() {
    const me = this.me(); if (!me || me.sink > 0) return;
    if (me.docked) { this.ui.port(this); return; }
    if ((this.profile()?.tmaps || []).some((m) => Math.hypot(m.x - me.x, m.z - me.z) < m.range)) {
      const r = await this.act({ type: 'dig' });
      if (r.err) { this.ui.toast(r.err, 'bad'); return; }
      const l = r.data.loot;
      this.ui.toast(`Treasure on ${r.data.name}! +${l.gold.toLocaleString()} gold, ${l.explosive} explosive shells, supplies${r.data.extra.length ? ' — and ' + r.data.extra.join(', ') : ''}`, r.data.extra.length ? 'event' : 'good', 6);
      sfx.bell(); this.ui.refresh(this); return;
    }
    const site = dockSite(this.sim, me);
    if (site?.kind === 'fee') { this.ui.feePrompt(this, { base: site.id, fee: site.fee, name: site.name, owner: this.W.players[this.W.bases.find((b) => b.id === site.id)?.owner]?.name }); return; }
    const res = await this.act({ type: 'dock' });
    if (res.err) { this.ui.toast(res.err, 'bad'); return; }
    if (res.data?.unclaimed) { this.ui.claimPrompt(this, res.data.unclaimed); return; }
    if (this.role !== 'host') me.docked = res.data;
    this.sailIdx = 0; me.sail = 0;
    sfx.bell();
    this.ui.port(this);
  }
  async seaRepair() {
    const me = this.me(); if (!me || me.sink > 0) return;
    if (me.docked) { this.ui.port(this, 'ship'); return; }
    const res = await this.act({ type: 'seaRepair' });
    if (res.err) { this.ui.toast(res.err, 'bad'); return; }
    this.repairUntil = performance.now() / 1000 + (res.data?.cd || 7);
    this.ui.toast(`Carpenters patched ${res.data?.hull ?? 0} hull (−${res.data?.oak ?? 0} oak)`, 'good');
    this.ui.refresh(this);
  }
  async undock() {
    await this.act({ type: 'undock' });
    const me = this.me(); if (me) { me.docked = null; this.sailIdx = 1; me.sail = SAIL_STEPS[1]; }
  }

  // ------------------------------------------------------------------ targeting
  buildAimHelpers() {
    this.sectorMeshes = {};
    const mk = (half, color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    for (const side of ['L', 'R', 'bow', 'stern']) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mk(side === 'L' || side === 'R' ? SECTOR_HALF : CHASE_HALF, 0xffffff));
      m.renderOrder = 10; m.visible = false; this.scene.add(m);
      this.sectorMeshes[side] = m;
    }
    this.arcMat = new THREE.MeshBasicMaterial({ color: 0x44ff66, transparent: true, opacity: 0.85, depthWrite: false });
    this.arc = new THREE.Mesh(new THREE.BufferGeometry(), this.arcMat); this.arc.renderOrder = 11; this.scene.add(this.arc);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x44ff66, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = 12; this.scene.add(this.ring);
    this.raycaster = new THREE.Raycaster();
    this.sectorKey = '';
  }
  sectorGeo(side, range) {
    const half = side === 'L' || side === 'R' ? SECTOR_HALF : CHASE_HALF;
    const center = { L: Math.PI / 2, R: -Math.PI / 2, bow: 0, stern: Math.PI }[side];
    const N = 28, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const a = center - half + (2 * half * i) / N;
      for (const r of [MIN_RANGE, range]) pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  }
  updateAim() {
    const me = this.me();
    const show = me && me.sink === 0 && !me.docked && !this.ui.blocking();
    this.arc.visible = this.ring.visible = !!show;
    for (const m of Object.values(this.sectorMeshes)) m.visible = false;
    if (!show) { this.aim.valid = false; return; }
    const A = AMMO[this.ammo || 'ball'];
    const range = me.stats.range * A.speed * A.speed;
    const key = `${range.toFixed(0)}`;
    if (key !== this.sectorKey) { this.sectorKey = key; for (const side of Object.keys(this.sectorMeshes)) { this.sectorMeshes[side].geometry.dispose(); this.sectorMeshes[side].geometry = this.sectorGeo(side, range); } }
    this.raycaster.setFromCamera({ x: this.mouse.nx, y: this.mouse.ny }, this.camera);
    const ray = this.raycaster.ray;
    let P = null;
    if (ray.direction.y < -0.002) { const tt = -ray.origin.y / ray.direction.y; P = ray.origin.clone().addScaledVector(ray.direction, tt); }
    else P = ray.origin.clone().addScaledVector(new THREE.Vector3(ray.direction.x, 0, ray.direction.z).normalize(), range * 2);
    const arc = arcOf(me, P.x, P.z);
    const side = arc.side;
    const hasGuns = side === 'L' || side === 'R' || (side === 'bow' ? me.stats.bow : me.stats.stern) > 0;
    // show the sector we're pointing into (brighter) and the opposite one faintly
    const sm = this.sectorMeshes[side];
    sm.visible = true; sm.position.set(me.x, 0.6, me.z); sm.rotation.y = me.yaw;
    const reloading = me.reload[side] > 0;
    // clamp to range along aim line
    let d = Math.min(arc.dist, range);
    const dx = (P.x - me.x) / (arc.dist || 1), dz = (P.z - me.z) / (arc.dist || 1);
    const tx = me.x + dx * d, tz = me.z + dz * d;
    // trajectory from the middle gun of that side
    const guns = me.guns.filter((g) => g.side === side);
    const g = guns[Math.floor(guns.length / 2)] || { x: 0, y: 2, z: 0 };
    const [mx, my0, mz] = localToWorld(me, g.x, g.y, g.z);
    const my = my0 + (me.heave || heightAt(me.x, me.z, this.sim.time));
    const hd = Math.max(1, Math.hypot(tx - mx, tz - mz));
    const v = (me.stats.muzzle || MUZZLE) * A.speed;
    const el = solveElev(hd, this.sim.surfaceAt(tx, tz) + 1.6 - my, v) ?? 0.26;
    const hx = (tx - mx) / hd, hz = (tz - mz) / hd;
    const pts = [];
    let blocked = false;
    let x = mx, y = my, z = mz, vy = v * Math.sin(el); const vh = v * Math.cos(el);
    const dt = 0.04;
    for (let i = 0; i < 200; i++) {
      pts.push(new THREE.Vector3(x, y, z));
      if (y < heightAt(x, z, this.sim.time) - 0.2 && i > 2) break;
      if (i > 2 && this.sim.landHit(x, y, z)) { if (Math.hypot(x - tx, z - tz) > 22) blocked = true; break; }
      x += hx * vh * dt; z += hz * vh * dt; vy -= GRAVITY * dt; y += vy * dt;
    }
    const haven = this.sim.inHaven(me.x, me.z) || this.sim.inHaven(tx, tz);
    const valid = hasGuns && arc.inSector && arc.dist <= range && arc.dist >= MIN_RANGE && !blocked && !haven;
    // target highlight: an enemy near the landing point
    let onTarget = false;
    for (const s of this.sim.ships.values()) if (s !== me && s.sink === 0 && Math.hypot(s.x - tx, s.z - tz) < s.stats.len * 0.55) onTarget = true;
    const col = !valid ? 0xff3b30 : reloading ? 0xffc23a : onTarget ? 0x2bff5a : 0x7dff8f;
    this.arcMat.color.setHex(col); this.ring.material.color.setHex(col);
    sm.material.color.setHex(valid ? 0x7dff8f : 0xff6a5a);
    sm.material.opacity = valid ? 0.24 : 0.07;
    if (pts.length > 2) {
      const curve = new THREE.CatmullRomCurve3(pts);
      this.arc.geometry.dispose();
      this.arc.geometry = new THREE.TubeGeometry(curve, Math.min(80, pts.length * 2), 0.32 + hd * 0.0025, 6, false);
    }
    const end = pts[pts.length - 1] || new THREE.Vector3(tx, 0, tz);
    this.ring.position.set(end.x, heightAt(end.x, end.z, this.sim.time) + 0.3, end.z);
    this.ring.scale.setScalar(1 + hd * 0.012);
    this.aim = { point: { x: tx, z: tz }, rawX: P.x, rawZ: P.z, side, valid, reloading, blocked, haven, onTarget, out: arc.dist > range, inSector: arc.inSector, hasGuns };
  }
  tryFire() {
    const me = this.me(); if (!me || this.ui.blocking()) return;
    const a = this.aim;
    if (!a.point) return;
    if (!a.valid) {
      this.ui.toast(a.haven ? 'No fighting inside a safe haven.' : a.blocked ? 'Shot blocked by land.' : !a.hasGuns ? 'No cannons on that side — buy bow/stern chasers as upgrades.' : !a.inSector ? 'Outside the firing arc.' : a.out ? 'Out of range.' : 'Too close.', 'bad', 1.2);
      return;
    }
    if (me.reload[a.side] > 0) { sfx.click(); return; }
    let ammo = this.ammo || 'ball';
    if (ammo !== 'ball' && !(this.profile().inv[ammo] > 0)) { ammo = 'ball'; this.ammo = 'ball'; }
    if (this.role === 'host') {
      const r = this.sim.fire(me, a.side, a.point.x, a.point.z, ammo);
      if (r.err) this.ui.toast(r.err, 'bad', 1);
    } else {
      const plan = this.sim.planBroadside(me, a.side, a.point.x, a.point.z, ammo);
      if (plan.err) { this.ui.toast(plan.err, 'bad', 1); return; }
      this.sim.fire(me, a.side, a.point.x, a.point.z, ammo, plan.balls);
      this.room.toHost({ k: 'fire', side: a.side, ax: a.point.x, az: a.point.z, ammo, balls: plan.balls });
      // local presentation of our own shot (host won't echo it back)
      const f = this.sim.fx.splice(0).filter((x) => x.t === 'fire');
      for (const x of f) { const n = x.balls.length, k = Math.max(0.25, Math.min(1, 3 / Math.sqrt(n))); x.balls.forEach((b, i) => setTimeout(() => this.muzzleAt(x.ship, b, i % Math.max(1, Math.round(n / 4)) === 0 ? 1 : 0, k), (b[6] || 0) * 1000)); sfx.cannon(0, n); }
    }
    this.shake = Math.max(this.shake || 0, 0.25);
  }

  // ------------------------------------------------------------------ frame
  loop() {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    try { this.tick(dt, false); }
    catch (e) { console.error(e); this.ui.toast('Error: ' + e.message, 'bad'); }
  }
  tick(dt, hidden) {
    if (hidden) this.last = performance.now();
    dt *= this.timeScale || 1;
    this.t += dt;
    const me = this.me();
    // a respawned / swapped flagship starts with furled sails: reset the sail selector to match
    if (me && (me !== this._meRef || (me.life || 0) !== this._meLife)) { if (this._meRef) { this.sailIdx = 0; me.sail = 0; } this._meRef = me; this._meLife = me.life || 0; }
    // local helm
    if (me && me.sink === 0 && !me.docked) {
      const l = this.keys.has('KeyA') || this.keys.has('ArrowLeft'), r = this.keys.has('KeyD') || this.keys.has('ArrowRight');
      const want = (l ? 1 : 0) - (r ? 1 : 0);
      me.rud += (want - me.rud) * Math.min(1, dt * 3.5);
    }
    if (this.role === 'host') {
      this.sim.step(dt);
      this.hostSend(dt);
      this.saveT -= dt;
      if (this.saveT <= 0) { this.saveT = 20; this.save(); }
    } else {
      if (me) {
        if (me.sink === 0) { this.sim.stepShip(me, dt); this.sim.collideShips(me, [...this.sim.ships.values()]); }
        else me.sink += dt;
        this.sendT -= dt;
        if (this.sendT <= 0) { this.sendT = 1 / ST_HZ; this.room.toHost({ k: 'st', x: me.x, z: me.z, yaw: me.yaw, spd: me.spd, sail: me.sail, sn: me.sailNow, rud: me.rud, rc: me.recoil, life: me.life || 0 }); }
      }
      if (this.clock.off != null) this.sim.time = performance.now() / 1000 + this.clock.off - dt;
      this.sim.step(dt);
      this.sim.fx.length = 0; // clients present the host's authoritative fx instead
    }
    if (hidden) return;
    this.render(dt);
  }
  /** Interpolated pose for remote ships. */
  pose(s) {
    if (s.local || !s.buf || s.buf.length < 2) return s;
    const rt = (this.role === 'host' ? this.sim.time : performance.now() / 1000 + (this.clock.off || 0)) - 0.16;
    const b = s.buf;
    let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
    const a = b[Math.max(0, i - 1)], c = b[i];
    if (rt >= c.t) { const e = Math.min(0.25, rt - c.t); return { x: c.x + Math.sin(c.yaw) * c.spd * e, z: c.z + Math.cos(c.yaw) * c.spd * e, yaw: c.yaw }; }
    const k = Math.max(0, Math.min(1, (rt - a.t) / Math.max(1e-3, c.t - a.t)));
    return { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + wrapA(c.yaw - a.yaw) * k };
  }
  /** A red X on the ground and a pillar of light for each treasure map you hold. */
  updateTreasureMarks(t) {
    const maps = this.profile()?.tmaps || [];
    this.tmarks ||= new Map();
    for (const [id, g] of this.tmarks) if (!maps.some((m) => m.id === id)) { this.scene.remove(g); g.traverse((o) => o.geometry?.dispose()); this.tmarks.delete(id); }
    if (!this.tmarkMats) this.tmarkMats = {
      x: new THREE.MeshBasicMaterial({ color: 0xff3b2a }),
      beam: new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    };
    for (const m of maps) {
      let g = this.tmarks.get(m.id);
      if (!g) {
        g = new THREE.Group();
        const y = (this.sim.groundAt(m.x, m.z) ?? 1) + 0.4;
        for (const r of [Math.PI / 4, -Math.PI / 4]) { const b = new THREE.Mesh(new THREE.BoxGeometry(11, 0.5, 2.2), this.tmarkMats.x); b.rotation.y = r; b.position.y = y; g.add(b); }
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, 160, 12, 1, true), this.tmarkMats.beam); beam.position.y = y + 80; g.add(beam);
        g.userData.beam = beam;
        g.position.set(m.x, 0, m.z);
        this.scene.add(g); this.tmarks.set(m.id, g);
      }
      const k = 1 + Math.sin(t * 3) * 0.15; g.userData.beam.scale.set(k, 1, k);
    }
  }
  dropView(id) { const v = this.views.get(id); if (v) { this.scene.remove(v.model.root); v.model.dispose(); this.views.delete(id); } }
  render(dt) {
    const t = this.sim.time;
    this.frames++;
    this.fps += (1 / Math.max(1e-3, dt) - this.fps) * 0.05;
    const me = this.me();
    const focus = me ? { x: me.x, z: me.z } : { x: this.camera.position.x, z: this.camera.position.z };
    this.lodT = (this.lodT || 0) - dt;
    if (this.lodT <= 0) { this.lodT = 0.5; this.updateWorldLOD(focus); this.syncBases(focus); }
    this.updateTreasureMarks(t);
    // ships
    for (const [id, v] of this.views) if (!this.sim.ships.has(id)) this.dropView(id);
    let built = 0;
    for (const s of this.sim.ships.values()) {
      let v = this.views.get(s.id);
      const dist = Math.hypot(s.x - focus.x, s.z - focus.z);
      const far = 700 + s.stats.len * 20;
      if (dist > far + 300 && s !== me) { if (v) this.dropView(s.id); continue; }
      const key = s.spec.uid + ':' + (s.rev || 0) + ':' + JSON.stringify({ ...s.look, trail: undefined });
      if (!v || v.key !== key) {
        if (built >= 3 && v == null && s !== me) continue; // spread model building over frames
        if (v) this.dropView(s.id);
        const model = buildShip(s.stats, s.look || s.spec);
        this.scene.add(model.root);
        v = { model, key, pitch: 0, roll: 0, heave: 0, hullF: 1 };
        this.views.set(s.id, v);
        built++;
      }
      v.model.root.visible = dist < far || s === me;
      if (!v.model.root.visible) continue;
      { const cd = s === me ? 0 : Math.hypot(s.x - this.camera.position.x, s.z - this.camera.position.z), L = s.stats.len; v.model.setLOD(cd > 900 + L * 6 ? 2 : cd > 300 + L * 3 ? 1 : 0); }
      const p = this.pose(s);
      this.poseShip(v, s, p, t, dt);
      if (s.sink === 0) this.fx.wake({ ...s, x: p.x, z: p.z, yaw: p.yaw }, t);
      if (s.fire > 0 && Math.random() < 0.6) { const [fx, , fz] = localToWorld({ ...s, ...p }, (Math.random() - 0.5) * s.stats.beam, 0, (Math.random() - 0.5) * s.stats.len * 0.7); this.fx.fire(fx, v.model.root.position.y + s.stats.depth * 0.7, fz); }
      // battle damage: holes clear when repaired, smoke thickens and fires break out as the hull fails
      const hf = Math.max(0, s.hull / s.stats.hull);
      if (hf > v.hullF + 0.05) v.model.clearHoles();
      v.hullF = hf;
      v.model.setHullDamage(s.sink > 0 ? 1 : Math.max(0, 1 - hf) * 0.95);
      if (s.sink === 0 && hf < 0.6 && dist < 900 && Math.random() < (hf < 0.35 ? 0.3 : 0.08)) { const [sx, , sz] = localToWorld({ ...s, ...p }, (Math.random() - 0.5) * s.stats.beam * 0.6, 0, (Math.random() - 0.5) * s.stats.len * 0.6); this.fx.smoke.add({ x: sx, y: v.model.root.position.y + s.stats.depth, z: sz, vx: 0.6, vy: 2.5, vz: 0.4, age: 0, life: 4, s0: 2 + s.stats.len * 0.04, s1: 8 + s.stats.len * 0.2, a: hf < 0.35 ? 0.45 : 0.25, c: new THREE.Color(hf < 0.35 ? 0x2a2622 : 0x5a5550), drag: 0.3 }); if (hf < 0.3 && Math.random() < 0.4) this.fx.fire(sx, v.model.root.position.y + s.stats.depth * 0.8, sz); }
    }
    this.krakenView.update(this.sim.kraken, t);
    this.fx.syncCrates(this.sim.crates, t);
    this.fx.update(dt, t, this.sim.balls);
    // camera
    if (me) {
      const v = this.views.get(me.id);
      const L = me.stats.len;
      const dist = (L * 1.45 + 32) * this.cam.zoom;
      if (!this.cam.init) { this.cam.yaw = me.yaw; this.cam.init = true; }
      // edge-look: pushing the cursor toward a screen side swings the camera over that broadside
      const nx = this.mouse.inside && !this.ui.blocking() && !this.mouse.rmb && me.sink === 0 ? this.mouse.nx : 0;
      const edge = -Math.sign(nx) * Math.max(0, Math.abs(nx) - 0.15) / 0.85 * 1.45;
      this.cam.edge = (this.cam.edge || 0) + (edge - (this.cam.edge || 0)) * Math.min(1, dt * 1.8);
      this.cam.yaw += wrapA(me.yaw + this.cam.yawOff + this.cam.edge - this.cam.yaw) * Math.min(1, dt * 2.6);
      const pitch = 0.18 + this.cam.pitch * 0.6;
      const focus = new THREE.Vector3(me.x, (v ? v.heave : 0) * 0.5 + L * 0.18, me.z);
      const want = focus.clone().add(new THREE.Vector3(-Math.sin(this.cam.yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist + 4, -Math.cos(this.cam.yaw) * Math.cos(pitch) * dist));
      want.y = Math.max(want.y, heightAt(want.x, want.z, t) + 3);
      if (!this.cam.ready || this.cam.pos.distanceTo(want) > 800) { this.cam.pos.copy(want); this.cam.look.copy(focus); this.cam.yaw = me.yaw + this.cam.yawOff; this.cam.ready = true; } // first frame, voyages, respawns
      this.cam.pos.lerp(want, Math.min(1, dt * 4));
      this.cam.look.lerp(focus.clone().add(new THREE.Vector3(Math.sin(this.cam.yaw) * L * 0.6, 0, Math.cos(this.cam.yaw) * L * 0.6)), Math.min(1, dt * 5));
      this.camera.position.copy(this.cam.pos);
      if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 2); }
      this.camera.lookAt(this.cam.look);
    }
    if (this.freeCam) { this.camera.position.set(...this.freeCam.pos); this.camera.lookAt(...this.freeCam.look); }
    this.updateAim();
    this.stage.frame(t, me ? new THREE.Vector3(me.x, 0, me.z) : new THREE.Vector3());
    this.ui.frame(this, dt);
  }
  poseShip(v, s, p, t, dt) {
    const m = v.model;
    const L = s.stats.len, B = s.stats.beam;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const hb = heightAt(p.x + fx * L * 0.4, p.z + fz * L * 0.4, t), hs = heightAt(p.x - fx * L * 0.4, p.z - fz * L * 0.4, t);
    const hp = heightAt(p.x + rx * B * 0.5, p.z + rz * B * 0.5, t), hr = heightAt(p.x - rx * B * 0.5, p.z - rz * B * 0.5, t);
    const hc = heightAt(p.x, p.z, t);
    const heave = (hb + hs + hp + hr + hc * 2) / 6;
    const pitch = Math.atan2(hb - hs, L * 0.8);
    const heel = s.rud * Math.min(1, s.spd / 10) * 0.07 + (s.recoil || 0) * 0.06;
    const roll = Math.atan2(hp - hr, B) * 0.8 + heel;
    const k = Math.min(1, dt * (5 / Math.sqrt(L / 16)));
    v.heave += (heave - v.heave) * k; v.pitch += (pitch - v.pitch) * k; v.roll += (roll - v.roll) * k;
    let y = v.heave, pitchX = v.pitch, rollZ = v.roll;
    const dmg = Math.max(0, 1 - s.hull / s.stats.hull);
    if (s.sink === 0 && dmg > 0.3) { const k2 = (dmg - 0.3) / 0.7; y -= k2 * s.stats.depth * 0.22; rollZ += k2 * 0.09 * ((s.id.charCodeAt(s.id.length - 1) & 1) ? 1 : -1); pitchX -= k2 * 0.025; }
    if (s.sink > 0) { y -= s.sink * s.sink * 0.25 + s.sink * 0.8; pitchX += Math.min(0.6, s.sink * 0.06); rollZ += Math.min(0.9, s.sink * 0.1); }
    m.root.position.set(p.x, y, p.z);
    // yaw about Y, then pitch (nose up = -X rot), then roll about the hull's axis
    m.root.rotation.set(0, 0, 0);
    m.root.rotation.order = 'YXZ';
    m.root.rotation.y = p.yaw; m.root.rotation.x = -pitchX; m.root.rotation.z = rollZ;
    m.setSailLevel(s.sailNow ?? s.sail);
    m.setDamage(Math.max(0, 1 - s.sails / s.stats.sails) * 0.9);
    m.update(t, 1);
    v.heaveNow = y;
  }
  destroy() {
    this.running = false;
    this.ticker.terminate();
    removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey);
    this.room?.close();
  }
}

function pushBuf(s, t, m) {
  s.buf ||= [];
  s.buf.push({ t, x: m.x, z: m.z, yaw: m.yaw, spd: m.spd });
  if (s.buf.length > 12) s.buf.shift();
}
function shipDef(s) { return { id: s.id, owner: s.owner, pid: s.pid, role: s.role, name: s.name, spec: s.spec, upg: s.upg, level: s.level, look: s.look, tag: s.tag, rev: s.rev || 0 }; }
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
