// Developer console. In the browser console: dev.help(). Or press ` (backquote) for an in-game prompt.
import { TIERS, RES, AMMO_ORDER, BUILDINGS } from './config.js';
import { addXp, shipSpec, uid } from './economy.js';
import { setSea, SEA } from './waves.js';

const CMDS = {
  help: ['', 'List all dev commands'],
  gold: ['n=10000', 'Add gold'],
  give: ['item, n=100', `Add resources/ammo (${[...RES, ...AMMO_ORDER.filter((a) => a !== 'ball')].join(', ')}) or "all"`],
  xp: ['n=1000', 'Add XP (levels up automatically)'],
  level: ['n', 'Set captain level (grants upgrade points for new levels)'],
  points: ['n=5', 'Add upgrade points'],
  ship: ['tier', `Give yourself a new flagship (${TIERS.map((t) => t.id).join(', ')})`],
  heal: ['', 'Fully repair hull, sails and crew'],
  god: ['on=true', 'Invulnerable flagship'],
  speed: ['k=1', 'Game speed multiplier'],
  spawn: ["role='pirate', tier, n=1", 'Spawn AI ships near you (pirate|merchant|navy)'],
  event: ["kind='kraken'", 'Start a world event: kraken | treasure | raid'],
  kraken: ['', 'Shortcut for event("kraken")'],
  tp: ["where='port'", 'Teleport: "port", "home", a base name, or x, z'],
  sea: ['scale=0.8', 'Wave height (0 = flat, 1.5 = storm)'],
  sun: ['elevation=28, azimuth=140', 'Move the sun (degrees)'],
  clear: ['', 'Remove all AI ships'],
  sinkall: ['radius=600', 'Sink every AI ship within radius'],
  density: ['n=5', 'Ambient AI ships per player'],
  unlock: ['', 'Max level, lots of resources, all ammo'],
  build: ['type', `Free building at the base you're docked at (${Object.keys(BUILDINGS).filter((k) => k !== 'keep').join(', ')})`],
  claim: ['', 'Claim the nearest unclaimed island for free'],
  offline: ['pid', 'Toggle another player offline (test shields)'],
  cam: ['x, y, z, lookX, lookY, lookZ', 'Freeze the camera (no args = release); offsets relative to your ship'],
  fps: ['', 'Show frame rate + entity counts'],
  save: ['', 'Save the world now (host)'],
  info: ['', 'World summary'],
};

export function installDev(app) {
  const g = () => app.game;
  const host = () => { if (g()?.role !== 'host') throw new Error('Host-only command (you are a client).'); return g(); };
  const me = () => g()?.me();
  const P = () => g()?.profile();
  const done = (msg) => { g()?.ui.refresh(g()); g()?.sim && (g().sim.dirty.meta = true); console.log('%c' + msg, 'color:#4ad9ff'); g()?.ui.toast('[dev] ' + msg, 'info', 2); return msg; };
  const dev = {
    help() {
      const lines = Object.entries(CMDS).map(([k, [a, d]]) => `dev.${k}(${a})`.padEnd(42) + d);
      console.log('%cSALTFIRE dev commands\n%c' + lines.join('\n'), 'font-weight:bold;font-size:14px;color:#ffd34a', 'font-family:monospace');
      return lines.join('\n');
    },
    gold(n = 10000) { host(); P().inv.gold += n; return done(`+${n} gold`); },
    give(item = 'all', n = 100) {
      host();
      const items = item === 'all' ? [...RES, 'chain', 'grape', 'explosive'] : [item];
      for (const it of items) P().inv[it] = (P().inv[it] || 0) + n;
      return done(`+${n} ${item}`);
    },
    xp(n = 1000) { host(); const l = addXp(P(), n); return done(`+${n} XP${l ? `, +${l} levels` : ''}`); },
    level(n = 10) { host(); const p = P(); const gained = Math.max(0, n - p.level); p.level = n; p.points += gained; p.xp = 0; me() && g().sim.refreshShip(me()); return done(`Level ${n}`); },
    points(n = 5) { host(); P().points += n; return done(`+${n} upgrade points`); },
    ship(tier = 'frigate') {
      host();
      const p = P(); const s = shipSpec(tier, { name: TIERS.find((t) => t.id === tier)?.name || tier });
      p.fleet.push(s); p.flag = s.uid;
      const old = me(); const keep = old ? { x: old.x, z: old.z, yaw: old.yaw } : {};
      const ns = g().sim.spawnPlayer(g().pid); Object.assign(ns, keep); ns.local = true;
      return done(`Flagship is now a ${tier}`);
    },
    heal() { host(); const s = me(); s.hull = s.stats.hull; s.sails = s.stats.sails; s.crew = s.stats.crew; s.fire = 0; return done('Healed'); },
    god(on = true) { host(); const s = me(); if (on) { s._hurt = g().sim.hurt; g().sim.hurt = function (t, ...a) { if (t === g().me()) return; return s._hurt.call(this, t, ...a); }; } else if (s._hurt) g().sim.hurt = s._hurt; return done(`God mode ${on ? 'on' : 'off'}`); },
    speed(k = 1) { g().timeScale = k; return done(`Speed ×${k}`); },
    spawn(role = 'pirate', tier = null, n = 1) {
      host();
      const out = [];
      for (let i = 0; i < n; i++) { const s = g().sim.spawnAI(P().level, me(), { role, tier, dist: 260 + i * 40 }); if (s) out.push(s.name); }
      return done(`Spawned ${out.join(', ') || 'nothing (no room)'}`);
    },
    event(kind = 'kraken') { host(); g().sim.startEvent(kind); if (kind === 'kraken' && g().sim.kraken && me()) { const k = g().sim.kraken; const a = Math.random() * 6.28; k.x = me().x + Math.cos(a) * 220; k.z = me().z + Math.sin(a) * 220; } return done(`Event: ${kind}`); },
    kraken() { return dev.event('kraken'); },
    tp(where = 'port', z = null) {
      host();
      const s = me(); s.docked = null;
      let x = 0, zz = 0;
      if (typeof where === 'number') { x = where; zz = z ?? 0; }
      else if (where === 'port') { x = 180; zz = 0; }
      else { const b = where === 'home' ? g().sim.homeOf(g().pid) : g().W.bases.find((b) => b.name.toLowerCase().includes(String(where).toLowerCase())); if (!b) return done('No such place'); x = b.x + b.r + 120; zz = b.z; }
      s.x = x; s.z = zz; s.spd = 0;
      return done(`Teleported to ${where}`);
    },
    sea(k = 0.8) { setSea(k); return done(`Sea state ${k}`); },
    sun(e = 28, a = 140) { const st = g().stage; st.setSun(e, a); st.ocean.uniforms.uSunDir.value.copy(st.sunDir); st.bakeEnv(); return done(`Sun ${e}°/${a}°`); },
    clear() { host(); for (const s of [...g().sim.ships.values()]) if (!s.pid) g().sim.removeShip(s.id); g().sim.kraken = null; return done('AI cleared'); },
    sinkall(r = 600) { host(); let n = 0; for (const s of g().sim.ships.values()) if (!s.pid && s.sink === 0 && Math.hypot(s.x - me().x, s.z - me().z) < r) { g().sim.hurt(s, 1e6, 0, 0, g().pid); n++; } return done(`Sank ${n}`); },
    density(n = 5) { host(); g().sim.aiDensity = n; return done(`AI density ${n}`); },
    unlock() { host(); const p = P(); p.level = 40; p.points += 30; for (const r of [...RES, 'chain', 'grape', 'explosive']) p.inv[r] = (p.inv[r] || 0) + 99999; return done('Unlocked everything'); },
    build(type = 'watchtower') {
      host();
      const d = me().docked; if (!d || d.kind !== 'base') return done('Dock at your base first');
      const b = g().W.bases.find((x) => x.id === d.id);
      const ang = Math.random() * Math.PI * 2;
      const B = BUILDINGS[type]; if (!B) return done('Unknown building');
      let slot = ang;
      if (B.slot === 'land') { const used = new Set(b.buildings.filter((x) => BUILDINGS[x.type].slot === 'land').map((x) => x.slot)); slot = 0; while (used.has(slot)) slot++; }
      b.buildings.push({ id: uid('b'), type, slot, hp: B.hp });
      return done(`Built ${type}`);
    },
    claim() { host(); const s = me(); const b = g().W.bases.filter((x) => !x.owner).sort((a, c) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(c.x - s.x, c.z - s.z))[0]; if (!b) return done('Nothing to claim'); g().sim.claim(g().pid, b.id, true); return done(`Claimed ${b.name}`); },
    offline(pid) { host(); const p = g().W.players[pid]; if (!p) return done('No such player: ' + Object.keys(g().W.players).join(', ')); p.online = !p.online; return done(`${p.name} is now ${p.online ? 'online' : 'offline'}`); },
    cam(x, y, z, lx = 0, ly = 0, lz = 0) { const s = me(); if (x == null) { g().freeCam = null; return done('Camera released'); } g().freeCam = { pos: [s.x + x, y, s.z + z], look: [s.x + lx, ly, s.z + lz] }; return done('Camera frozen'); },
    fps() { const G = g(); const info = `fps ${G.fps.toFixed(0)} · ships ${G.sim.ships.size} · balls ${G.sim.balls.length} · calls ${G.stage.renderer.info.render.calls} · tris ${(G.stage.renderer.info.render.triangles / 1000).toFixed(0)}k`; return done(info); },
    save() { host(); g().save(); return done('Saved'); },
    info() { const W = g().W; return done(`seed ${W.seed} · ${Object.keys(W.players).length} captains · ${W.bases.filter((b) => b.owner).length} owned bases · ${W.market.length} orders · sea ${SEA}`); },
  };
  window.dev = dev;
  // in-game console
  addEventListener('keydown', (e) => {
    if (e.code !== 'Backquote' || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    e.preventDefault();
    let el = document.getElementById('devcon');
    if (el) { el.remove(); return; }
    el = document.createElement('div'); el.id = 'devcon'; el.className = 'devcon';
    el.innerHTML = '<input placeholder="dev command, e.g. kraken  |  give all 500  |  help" autocomplete="off"><pre></pre>';
    document.body.appendChild(el);
    const inp = el.querySelector('input'), out = el.querySelector('pre');
    inp.focus();
    inp.onkeydown = (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || ev.code === 'Backquote') { ev.preventDefault(); el.remove(); return; }
      if (ev.key !== 'Enter') return;
      const parts = inp.value.trim().split(/\s+/); inp.value = '';
      const [cmd, ...args] = parts;
      try {
        if (!dev[cmd]) throw new Error('Unknown command. Try: help');
        const res = dev[cmd](...args.map((a) => (/^-?\d+(\.\d+)?$/.test(a) ? +a : a === 'true' ? true : a === 'false' ? false : a)));
        out.textContent = String(res ?? 'ok');
      } catch (err) { out.textContent = '✗ ' + err.message; }
    };
  });
  return dev;
}
