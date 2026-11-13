// DOM UI: title screen, HUD (captain, resources, ship status, ammo, reloads, minimap, events,
// floating ship labels), port menus (repair, shipyard + custom builder, fleet, upgrades, crafting,
// market, building, haven, diplomacy), world map, prompts and toasts.
import * as THREE from 'three';
import {
  RES, RES_LABEL, RES_ICON, AMMO, AMMO_ORDER, RECIPES, TIERS, shopTiers, tierById, UPGRADES, UPGRADE_TOTAL, XP_PER_LEVEL, BUILDINGS,
  MARKET_ITEMS, MARKET_TAX, TREATY_TYPES, HAVEN_R, WORLD_R, VERSION, LAND_SLOTS, claimFee, FIELD_REPAIR, TRAILS, maxSideFor, WHEEL, HOLIDAY, TITAN_SIZE_PRICE, TREASURE,
} from './config.js';
import { shipStats, customCost, costText, canAfford, holidayState, holidayGift, giftShort, prizeText, voyageCost, freeSpinReady, dayKey, bestAsk, bestBid, crewEff, treatyBetween, shielded, landSlotsUsed, flagship, hostile, fleetCap, traderName, aiFaction } from './economy.js';
import { SAIL_NAMES, SAIL_STEPS, DOCK_SPEED } from './sim.js';
import { dockSite, repairCost } from './actions.js';
import { baseRadius } from './basegeo.js';
import { buildShip } from './render/shipmodel.js';
import { EMBLEMS } from './render/textures.js';
import { sfx } from './audio.js';
import { iconSVG, iconImage, prizeIcon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'k' : String(Math.floor(n)));
const ITEM_NAME = { oak: 'Oak', iron: 'Iron', canvas: 'Canvas', powder: 'Powder', chain: 'Chainshot', grape: 'Grapeshot', explosive: 'Explosive Shot', ship: 'Ship' };

export class UI {
  constructor(app) {
    this.app = app;
    this.root = $('#ui');
    this.panel = null; // open port panel
    this.tab = 'harbor';
    this.mapOpen = false;
    this.labels = new Map();
    this.toastBox = null;
  }
  blocking() { return !!((this.panel && !this.remote) || this.modalEl || this.mapOpen || this.escEl); }

  // ------------------------------------------------------------------ title
  title({ name, worlds, onNew, onContinue, onJoin, onDelete }) {
    this.root.innerHTML = `
    <div class="title-screen">
      <div class="title-card">
        <div class="logo">SALTFIRE</div>
        <div class="tagline">Build a pirate empire. Rule the burning sea.</div>
        <label class="field"><span>Captain name</span><input id="cap-name" maxlength="20" value="${esc(name)}" placeholder="Captain Nobody"></label>
        <div class="title-cols">
          <div class="col">
            <h3>Your Worlds</h3>
            <button class="btn primary big" id="new-world">⚓ New World</button>
            <div class="worlds">${worlds.length ? worlds.map((w) => `<div class="world"><button class="btn" data-cont="${w.id}">▶ ${esc(w.name)}</button><span class="muted">${w.players} captain${w.players === 1 ? '' : 's'} · ${new Date(w.saved).toLocaleDateString()}</span><button class="btn tiny danger" data-del="${w.id}" title="Delete">✕</button></div>`).join('') : '<p class="muted">No saved worlds yet. Your browser saves the world you host automatically.</p>'}</div>
          </div>
          <div class="col">
            <h3>Join a Friend</h3>
            <p class="muted">Enter the 6-digit room code from the host.</p>
            <input id="join-code" class="code-input" inputmode="numeric" maxlength="6" placeholder="000000">
            <button class="btn primary" id="join-btn">Join World</button>
            <p class="muted small">Returning captains rejoin with their saved empire automatically.</p>
          </div>
        </div>
        <div class="title-foot"><button class="btn ghost" id="help-btn">Controls</button><span class="muted small">v${VERSION} · WebGL + WebRTC · saves in your browser</span></div>
      </div>
      <div class="status" id="title-status"></div>
    </div>`;
    const nm = () => $('#cap-name').value.trim() || 'Captain';
    $('#new-world').onclick = () => onNew(nm());
    this.root.querySelectorAll('[data-cont]').forEach((b) => (b.onclick = () => onContinue(b.dataset.cont, nm())));
    this.root.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { if (confirm('Delete this world forever?')) onDelete(b.dataset.del); }));
    const join = () => { const c = $('#join-code').value.replace(/\D/g, ''); if (c.length !== 6) { this.status('Room codes have 6 digits.'); return; } onJoin(c, nm()); };
    $('#join-btn').onclick = join;
    $('#join-code').onkeydown = (e) => { if (e.key === 'Enter') join(); };
    $('#help-btn').onclick = () => this.help();
  }
  status(t) { const s = $('#title-status'); if (s) s.textContent = t; }

  // ------------------------------------------------------------------ HUD
  hud(game) {
    this.root.innerHTML = `
    <div class="hud">
      <div class="captain" id="cap"></div>
      <div class="room" id="room"></div>
      <div class="resbar" id="resbar"></div>
      <div class="events" id="events"></div>
      <div class="toasts" id="toasts"></div>
      <div class="prompt" id="prompt"></div>
      <div class="shippanel" id="shippanel">
        <div class="shipname" id="sname"></div>
        <div class="bars">
          <div class="bar hull"><span>Hull</span><i id="b-hull"></i><b id="t-hull"></b></div>
          <div class="bar sails"><span>Sails</span><i id="b-sails"></i><b id="t-sails"></b></div>
          <div class="bar crew"><span>Crew</span><i id="b-crew"></i><b id="t-crew"></b></div>
        </div>
        <div class="helm"><div id="sail"></div><div id="speed"></div></div>
        <div class="reloads" id="reloads"></div>
        <div class="ammo" id="ammo"></div>
      </div>
      <div class="fleetbox" id="fleetbox"></div>
      <canvas class="minimap" id="minimap" width="220" height="220"></canvas>
      <div class="hotkeys"><button class="btn tiny" id="hk-map">Map (M)</button><button class="btn tiny" id="hk-fleet">Fleet (G)</button><button class="btn tiny" id="hk-dip">Diplomacy</button><button class="btn tiny gold" id="hk-rew">🎡 Rewards (J)</button><button class="btn tiny" id="hk-help">Help (H)</button><button class="btn tiny" id="hk-menu">Menu</button></div>
      <div class="labels" id="labels"></div>
      <div class="crosshair" id="xhair"></div>
    </div>`;
    this.toastBox = $('#toasts');
    $('#hk-map').onclick = () => this.toggleMap(game);
    $('#hk-dip').onclick = () => this.port(game, 'diplomacy', true);
    $('#hk-rew').onclick = () => this.port(game, 'rewards', !game.me()?.docked);
    $('#hk-fleet').onclick = () => this.port(game, 'fleet', !game.me()?.docked);
    $('#fleetbox').onclick = (e) => {
      if (e.target.closest('[data-fcmd]')) { this.port(game, 'fleet', !game.me()?.docked); return; }
      if (e.target.closest('.fbh')) { this.fleetOpen = !this.fleetOpen; this.fleetSig = ''; sfx.ui(); }
    };
    $('#hk-help').onclick = () => this.help();
    $('#hk-menu').onclick = () => this.escape(game);
    $('#ammo').onclick = (e) => { const b = e.target.closest('[data-ammo]'); if (b) game.setAmmo(b.dataset.ammo); };
    this.refresh(game);
  }
  refresh(game) {
    if (!game || !$('#cap')) return;
    const p = game.profile(); if (!p) return;
    const need = XP_PER_LEVEL(p.level);
    $('#cap').innerHTML = `<div class="flagdot" style="background:hsl(${p.color},70%,50%)"></div><div><div class="cname">${esc(p.name)}${p.alliance ? ` <span class="ally">[${esc(p.alliance)}]</span>` : ''}</div><div class="lvl">Level ${p.level}${p.points ? ` · <span class="pts">${p.points} upgrade pt${p.points > 1 ? 's' : ''}</span>` : ''}</div><div class="xp"><i style="width:${Math.min(100, (p.xp / need) * 100)}%"></i></div></div>`;
    const online = Object.values(game.W.players).filter((x) => x.online).length;
    $('#room').innerHTML = game.room ? `<span class="code" title="Click to copy">ROOM ${game.room.code}</span><span class="muted">${online} online · ${game.role === 'host' ? 'hosting' : 'joined'}</span>` : `<span class="muted">Offline world (solo)</span>`;
    $('#room').innerHTML += `<span class="ver">v${VERSION}</span>`;
    const code = $('#room .code'); if (code) code.onclick = () => { navigator.clipboard?.writeText(game.room.code); this.toast('Room code copied — share it with friends!', 'info'); };
    $('#resbar').innerHTML = RES.map((r) => `<div class="res res-${r}" title="${RES_LABEL[r]}"><span class="ri">${RES_ICON[r]}</span>${fmt(p.inv[r] || 0)}</div>`).join('');
    $('#ammo').innerHTML = AMMO_ORDER.map((a, i) => `<button class="am ${((game.ammo || 'ball') === a) ? 'on' : ''} ${a !== 'ball' && !(p.inv[a] > 0) ? 'empty' : ''}" data-ammo="${a}" title="${AMMO[a].name}"><kbd>${i + 1}</kbd><span class="ball b-${a}"></span><small>${a === 'ball' ? '∞' : p.inv[a] || 0}</small></button>`).join('');
    if (this.panel) { const sig = this.panelSig(game); if (sig !== this.lastSig) this.renderPanel(game); }
    if (this.mapOpen) this.drawMap(game);
  }
  panelSig(game) {
    const W = game.W, p = game.profile(), d = game.me()?.docked;
    const b = d && W.bases.find((x) => x.id === d.id);
    return JSON.stringify([p.trail, (p.trails || []).length, (p.cards || []).length, p.wheel, (p.holiday?.days || []).length, p.inv, p.level, p.points, p.upg, p.fleet.map((s) => s.uid + s.name + (s.out ? 'o' : '') + (s.wrecked ? 'w' : '') + (s.hp ?? '')), p.flag, p.alliance, W.market.length, W.trades.length, W.proposals.length, W.treaties.length, b && b.buildings.map((x) => [x.type, Math.round(x.hp)]), b?.haven, Object.values(W.players).map((x) => x.online + x.name), this.tab]);
  }
  frame(game, dt) {
    // optional frame-rate readout next to the version tag
    this.fpsT = (this.fpsT || 0) - dt;
    if (this.fpsT <= 0) {
      this.fpsT = 0.5;
      let el = $('#fpsbox');
      if (game.app.settings.showFps) {
        if (!el && $('#room')) { el = document.createElement('span'); el.id = 'fpsbox'; el.className = 'ver'; $('#room').appendChild(el); }
        if (el) el.textContent = `${Math.round(game.fps)} fps${game.stage.pr < game.stage.maxPR - 0.01 ? ` · ${Math.round((game.stage.pr / game.stage.maxPR) * 100)}% res` : ''}`;
      } else el?.remove();
    }
    const me = game.me(); if (!me || !$('#shippanel')) return;
    const st = me.stats;
    const set = (id, v, max, txt) => { const b = $('#b-' + id); if (b) b.style.width = Math.max(0, Math.min(100, (v / max) * 100)) + '%'; const t = $('#t-' + id); if (t) t.textContent = txt; };
    set('hull', me.hull, st.hull, `${Math.max(0, Math.round(me.hull))}/${st.hull}`);
    set('sails', me.sails, st.sails, `${Math.round((me.sails / st.sails) * 100)}%`);
    set('crew', me.crew, st.crew, `${Math.round(me.crew)}/${st.crew}`);
    $('#sname').innerHTML = `${esc(me.spec.name)} <span class="muted">${tierById(me.spec.tier).name} · ${st.side}×2 guns${st.bow ? ` · ${st.bow} bow` : ''}${st.stern ? ` · ${st.stern} stern` : ''}</span>`;
    const si = SAIL_STEPS.indexOf(me.sail);
    $('#sail').innerHTML = `<span class="sailpips">${[1, 2, 3].map((i) => `<i class="${si >= i ? 'on' : ''}"></i>`).join('')}</span> ${SAIL_NAMES[Math.max(0, si)] || ''}`;
    $('#speed').textContent = `${(me.spd * 1.94).toFixed(1)} kn`;
    const eff = crewEff(me.crew, st.crew);
    const rl = ['L', 'R', ...(st.bow ? ['bow'] : []), ...(st.stern ? ['stern'] : [])].map((k) => {
      const left = Math.max(0, me.reload[k] || 0), tot = st.reload / eff, f = 1 - left / tot;
      const nm = { L: 'Port', R: 'Starboard', bow: 'Bow', stern: 'Stern' }[k];
      return `<div class="rl ${left <= 0 ? 'ready' : ''} ${game.aim?.side === k ? 'aimed' : ''}"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" style="stroke-dasharray:${(f * 94.2).toFixed(1)} 94.2"/></svg><span>${nm}</span></div>`;
    }).join('');
    const rcd = Math.max(0, (game.repairUntil || 0) - performance.now() / 1000);
    const hurt = me.hull < st.hull - 0.5 || me.sails < st.sails - 0.5;
    const oakNeed = Math.max(FIELD_REPAIR.minOak, Math.ceil(Math.min(st.hull - me.hull, st.hull * FIELD_REPAIR.frac) / FIELD_REPAIR.oakPer));
    const rep = me.docked ? '' : `<div class="rchip ${rcd > 0 ? 'cd' : hurt ? 'go' : ''}" title="Carpenters patch the hull with oak (works in battle)"><kbd>R</kbd> ${rcd > 0 ? `Repairing… ${Math.ceil(rcd)}s` : hurt ? `Repair · ${oakNeed} oak` : 'Repair'}</div>`;
    const rlh = rl + rep + (eff < 0.75 ? `<div class="warn">Short-handed: reload ×${(1 / eff).toFixed(1)}</div>` : '');
    const rle = $('#reloads'); if (rle.innerHTML !== rlh) rle.innerHTML = rlh;
    // prompt
    let pr = '';
    if (me.sink > 0) pr = '<b>Your ship is sinking…</b>';
    else if (me.docked) pr = `Docked at <b>${esc(me.docked.name || 'harbour')}</b> — <kbd>E</kbd> open port · <kbd>W</kbd> set sail`;
    else {
      const site = dockSite(game.sim, me);
      if (site) pr = site.kind === 'fee' ? `<kbd>E</kbd> Pay entry fee (${site.fee}g) at ${esc(site.name)}`
        : site.kind === 'unclaimed' ? `<kbd>E</kbd> Claim <b>${esc(site.name)}</b>`
        : site.kind === 'wild' ? `⚔ <b>${esc(site.name)}</b> is held by squatters (lv ${site.lvl}) — destroy their stockade, then hold position to claim it <span class="muted">(charter ${site.fee}g)</span>`
        : site.kind === 'hold' ? `☠ <b>${esc(site.name)}</b> — fortress of ${esc(site.clan)}. Smash the keep, sink the defenders, hold position to conquer.`
        : `<kbd>E</kbd> Dock at <b>${esc(site.name)}</b>${me.spd > DOCK_SPEED ? ' <span class="muted">(slow down)</span>' : ''}`;
      const isl = game.W.islands.find((i) => i.kind === 'res' && Math.hypot(i.x - me.x, i.z - me.z) < i.r + 80);
      if (isl) pr += `${pr ? '<br>' : ''}Hold <kbd>F</kbd> to harvest <b>${RES_LABEL[isl.res]}</b> (${Math.floor(isl.amt ?? 100)}%)${me.spd > 4 ? ' <span class="muted">— stop the ship</span>' : ''}`;
      const tm = (game.profile()?.tmaps || []).find((m) => Math.hypot(m.x - me.x, m.z - me.z) < m.range);
      if (tm) pr = `<kbd>E</kbd> Send a shore party to dig up the treasure on <b>${esc(tm.name)}</b>${me.spd > 4 ? ' <span class="muted">— stop the ship</span>' : ''}${pr ? '<br>' + pr : ''}`;
      const cap = game.sim.capture?.get?.(game.W.bases.find((b) => Math.hypot(b.x - me.x, b.z - me.z) < baseRadius(b) + 90)?.id);
      if (cap) pr += `<br><b>Capturing… ${Math.floor(cap.t)}/12s</b>`;
    }
    const pe = $('#prompt'); if (pe.innerHTML !== pr) pe.innerHTML = pr;
    pe.style.display = pr ? '' : 'none';
    // events
    const ev = [];
    const k = game.sim.kraken;
    if (k && k.hp > 0) ev.push(`<div class="ev kraken"><b>🐙 The Kraken</b> ${Math.round(game.distTo(k.x, k.z))}m<div class="evbar"><i style="width:${(k.hp / k.maxHp) * 100}%"></i></div></div>`);
    for (const s of game.sim.ships.values()) if (s.tag === 'treasure' && s.sink === 0) ev.push(`<div class="ev treasure"><b>💰 Treasure Flagship</b> ${Math.round(game.distTo(s.x, s.z))}m<div class="evbar"><i style="width:${(s.hull / s.stats.hull) * 100}%"></i></div></div>`);
    for (const s of game.sim.ships.values()) if (s.tag === 'bounty' && s.sink === 0) ev.push(`<div class="ev bounty"><b>☠ ${esc(s.name)}</b> ${Math.round(game.distTo(s.x, s.z))}m${s.bounty ? ` · ${s.bounty.toLocaleString()}g` : ''}<div class="evbar"><i style="width:${(s.hull / s.stats.hull) * 100}%"></i></div></div>`);
    for (const m of game.profile()?.tmaps || []) ev.push(`<div class="ev tmap"><b>✕ Treasure</b> on ${esc(m.name)} · ${Math.round(game.distTo(m.x, m.z))}m</div>`);
    const myFleet = [...game.sim.ships.values()].filter((s) => s.role === 'fleet' && s.owner === game.pid && s.sink === 0);
    const fb = $('#fleetbox');
    if (fb) {
      const avg = myFleet.length ? myFleet.reduce((a, s) => a + s.hull / s.stats.hull, 0) / myFleet.length : 0;
      const fh = !myFleet.length ? '' : `<div class="fbh"><b>⚓ Fleet</b> <span class="muted">${myFleet.length} at sea · ${Math.round(avg * 100)}%</span><span class="fbt">${this.fleetOpen ? '▾' : '▸'}</span></div>`
        + (this.fleetOpen ? `<div class="fbl">${myFleet.map((s) => `<div class="fbr"><span class="fbn">${esc(s.name)}</span><i class="fh"><i style="width:${Math.round((s.hull / s.stats.hull) * 100)}%"></i></i><small>${s.ai?.mode || ''}</small></div>`).join('')}<button class="btn tiny" data-fcmd>Orders (G)</button></div>` : '');
      if (fb.innerHTML !== fh) fb.innerHTML = fh;
      fb.style.display = fh ? '' : 'none';
    }
    const raiders = [...game.sim.ships.values()].filter((s) => s.tag === 'raider' && s.sink === 0).length;
    if (raiders) ev.push(`<div class="ev raid"><b>⚔ Pirate raid</b> ${raiders} ship${raiders > 1 ? 's' : ''} left</div>`);
    const evh = ev.join(''); const ee = $('#events'); if (ee.innerHTML !== evh) ee.innerHTML = evh;
    // minimap ~10 Hz
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 0.1; this.drawMinimap(game); }
    this.updateLabels(game);
  }
  updateLabels(game) {
    const box = $('#labels'); if (!box) return;
    const me = game.me();
    const cam = game.camera;
    const v = new THREE.Vector3();
    const seen = new Set();
    for (const s of game.sim.ships.values()) {
      if (s === me || s.sink > 3) continue;
      const d = me ? Math.hypot(s.x - me.x, s.z - me.z) : 0;
      if (d > 700) continue;
      const view = game.views.get(s.id); if (!view) continue;
      v.set(view.model.root.position.x, view.model.root.position.y + s.stats.len * 0.95 + 4, view.model.root.position.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      seen.add(s.id);
      let el = this.labels.get(s.id);
      if (!el) { el = document.createElement('div'); el.className = 'slabel'; box.appendChild(el); this.labels.set(s.id, el); }
      const hostileTo = me && s.owner !== me.owner;
      const fac = aiFaction(s.owner);
      const cls = s.pid ? 'player' : s.role === 'fleet' ? (s.owner === game.pid ? 'fleet' : 'player') : s.role === 'merchant' ? 'merchant' : s.role === 'navy' ? 'navy' : fac === 'clan' ? 'clan' : 'pirate';
      const sub = s.role === 'fleet' ? `${esc(game.W.players[s.owner]?.name || '')}'s fleet` : fac === 'clan' ? esc(game.W.ai?.[s.owner]?.name || '') : '';
      const html = `<div class="ln ${cls}">${s.tag === 'treasure' ? '💰 ' : ''}${esc(s.name)} <small>Lv ${s.level}</small>${sub ? `<div class="lsub">${sub}</div>` : ''}</div><div class="lh"><i style="width:${(s.hull / s.stats.hull) * 100}%"></i></div>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%,-100%) scale(${Math.max(0.6, 1 - d / 1400)})`;
      el.style.opacity = hostileTo ? 1 : 0.85;
    }
    for (const [id, el] of this.labels) if (!seen.has(id)) { el.remove(); this.labels.delete(id); }
  }
  drawMinimap(game) {
    const c = $('#minimap'); if (!c) return;
    const g = c.getContext('2d'); const W = c.width, R = 900;
    const me = game.me(); if (!me) return;
    g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 7); g.clip();
    g.fillStyle = 'rgba(8,40,62,0.85)'; g.fillRect(0, 0, W, W);
    const k = (W / 2) / R;
    // rotate so that the ship's heading is up
    g.translate(W / 2, W / 2); g.rotate(Math.PI + me.yaw);
    const P = (x, z) => [-(x - me.x) * k, (z - me.z) * k];
    for (const i of game.W.islands) { const [x, y] = P(i.x, i.z); g.fillStyle = i.kind === 'port' ? '#f2d58a' : i.kind === 'res' ? ({ oak: '#5fbf5a', iron: '#aaa', canvas: '#e8e0c0', powder: '#e8c64a' })[i.res] : '#7d776c'; g.beginPath(); g.arc(x, y, Math.max(1.5, i.r * k), 0, 7); g.fill(); }
    const HP = (x, z) => P(x, z);
    { const [x, y] = HP(0, 0); g.strokeStyle = 'rgba(120,220,255,0.35)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(x, y, HAVEN_R * k, 0, 7); g.stroke(); g.setLineDash([]); }
    for (const b of game.W.bases) {
      const [x, y] = P(b.x, b.z);
      g.fillStyle = baseColor(game, b);
      g.beginPath(); g.arc(x, y, Math.max(3, baseRadius(b) * k), 0, 7); g.fill();
      if (shielded(game.W, b.owner)) { g.strokeStyle = '#7cc8ff'; g.beginPath(); g.arc(x, y, Math.max(5, baseRadius(b) * k + 3), 0, 7); g.stroke(); }
    }
    for (const cr of game.sim.crates) { const [x, y] = P(cr.x, cr.z); g.fillStyle = cr.big ? '#ffd34a' : '#9be7ff'; g.fillRect(x - 2, y - 2, 4, 4); }
    for (const s of game.sim.ships.values()) {
      if (s === me || s.sink > 0) continue;
      const [x, y] = P(s.x, s.z);
      g.fillStyle = s.pid ? '#4ad9ff' : s.role === 'fleet' ? (s.owner === game.pid ? '#7dffb0' : '#4ad9ff') : s.role === 'merchant' ? '#e8d27a' : s.role === 'navy' ? '#6f8cff' : aiFaction(s.owner) === 'clan' ? '#ff2a6a' : '#ff5a4a';
      if (s.tag === 'treasure') g.fillStyle = '#ffd34a';
      if (s.tag === 'bounty') g.fillStyle = '#ff2020';
      g.beginPath(); g.arc(x, y, s.tag ? 4.5 : 3, 0, 7); g.fill();
    }
    // treasure X marks (pinned to the rim when off the edge, so they point the way)
    for (const m of game.profile()?.tmaps || []) {
      let [x, y] = P(m.x, m.z); const d = Math.hypot(x, y), lim = W / 2 - 9;
      if (d > lim) { x *= lim / d; y *= lim / d; }
      g.strokeStyle = '#ff3b2a'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke(); g.lineWidth = 1;
    }
    if (game.sim.kraken && game.sim.kraken.hp > 0) { const [x, y] = P(game.sim.kraken.x, game.sim.kraken.z); g.fillStyle = '#c23aff'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    g.restore();
    // me
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(W / 2, W / 2 - 8); g.lineTo(W / 2 - 5, W / 2 + 6); g.lineTo(W / 2 + 5, W / 2 + 6); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 2, 0, 7); g.stroke();
    // north marker
    const na = Math.PI + me.yaw; g.fillStyle = '#ffd34a'; g.font = 'bold 12px Inter'; g.textAlign = 'center';
    g.fillText('N', W / 2 + Math.sin(-na) * (W / 2 - 10) * -1, W / 2 + Math.cos(na) * (W / 2 - 10) * -1 + 4);
  }

  // ------------------------------------------------------------------ toasts / prompts / modals
  toast(text, kind = 'info', secs = 4) {
    const box = this.toastBox || $('#toasts'); if (!box) return;
    const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    if (kind === 'event') { sfx.bell(); this.banner(text); }
    if (kind === 'level') sfx.fanfare();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 500); }, secs * 1000);
  }
  banner(text) {
    const b = document.createElement('div'); b.className = 'banner'; b.textContent = text;
    this.root.appendChild(b); setTimeout(() => b.remove(), 5200);
  }
  floatText(t) { const el = document.createElement('div'); el.className = 'floattext'; el.textContent = t; this.root.appendChild(el); setTimeout(() => el.remove(), 1400); }
  modal(title, html, buttons = [], cls = '') {
    this.closeModal();
    const el = document.createElement('div'); el.className = 'modal-wrap';
    el.innerHTML = `<div class="modal ${cls}"><h2>${title}</h2><div class="mbody">${html}</div><div class="mbtns">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
    el.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const B = buttons[+b.dataset.i]; if (B.keep) { B.fn?.(el); return; } this.closeModal(); B.fn?.(el); }));
    this.root.appendChild(el); this.modalEl = el;
    return el;
  }
  closeModal() { if (this.modalEl) { this.modalEl.remove(); this.modalEl = null; } }
  feePrompt(game, p) {
    if (this.modalEl) return;
    this.modal('Entry Fee', `<p><b>${esc(p.name)}</b>${p.owner ? ` (owned by ${esc(p.owner)})` : ''} charges <b>${p.fee} gold</b> for visitors.</p><p class="muted">Pay to trade and dock here for 30 minutes. Refuse and stay inside the harbour for 20 seconds and its guns will treat you as a trespasser.</p>`, [
      { label: `Pay ${p.fee} gold`, primary: true, fn: async () => { const r = await game.act({ type: 'payFee', base: p.base }); this.toast(r.err || 'Fee paid. Welcome to port!', r.err ? 'bad' : 'good'); } },
      { label: 'Turn away', fn: () => {} },
    ]);
  }
  claimPrompt(game, site) {
    const first = !game.W.bases.some((b) => b.owner === game.pid);
    this.modal(`Claim ${esc(site.name)}?`, `<p>This island is unclaimed. Raise your flag to found a base: build docks, a shipyard, production and defences — the island grows as you build.</p><p>${first ? '<b>Your first island is free.</b>' : `A colony charter costs <b>${claimFee(game.W.bases.filter((b) => b.owner === game.pid).length)} gold</b>.`}</p>`, [
      { label: 'Raise the flag', primary: true, fn: async () => { const r = await game.act({ type: 'claim', base: site.id }); this.toast(r.err || `${site.name} is yours!`, r.err ? 'bad' : 'good'); if (!r.err) sfx.fanfare(); } },
      { label: 'Not now' },
    ]);
  }
  help() {
    this.modal('How to Play', `
      <div class="help">
        <div><h4>Sailing</h4><p><kbd>W</kbd>/<kbd>S</kbd> raise / lower sails · <kbd>A</kbd>/<kbd>D</kbd> steer · right-drag orbit camera · wheel zoom · <kbd>C</kbd> reset camera</p></div>
        <div><h4>Gunnery</h4><p>Move the mouse over the water: a firing sector appears on the side you're aiming at and a 3D arc shows exactly where your shot lands. <span class="g">Green</span> = valid, <span class="y">yellow</span> = reloading, <span class="r">red</span> = out of range / arc or blocked by land. <kbd>Click</kbd> or <kbd>Space</kbd> fires the broadside.</p><p><kbd>1</kbd>–<kbd>4</kbd> / <kbd>Q</kbd> ammo: Round shot · Chainshot (sails) · Grapeshot (crew) · Explosive (hull + fire).</p></div>
        <div><h4>Crew & repairs</h4><p>Losing crew slows reloads and steering. Rehire at any harbour. <kbd>R</kbd> at sea: your carpenters patch the hull (and some canvas) with oak from your hold and put out fires — it works mid-battle, then needs a few seconds before the next patch.</p></div>
        <div><h4>Empire</h4><p><kbd>E</kbd> dock · <kbd>F</kbd> (hold, stopped) harvest resource islets · <kbd>M</kbd> map. Wild islands are held by squatters: smash their stockade and hold position nearby to claim them (each new colony's charter costs more). Pirate clans hold fortresses and keep fortifying them — smash the keep, sink the defenders and hold position to conquer. Build docks, shipyards, mills and defences — the island and its village grow as you build.</p></div>
        <div><h4>Fleet</h4><p><kbd>G</kbd> fleet command: send the ships you own (beyond your flagship) to escort you, guard an island, or attack an enemy, clan or wild island — they bombard it and capture it for you. Sunk fleet ships come home as wrecks to repair.</p></div>
        <div><h4>World</h4><p>Hunt the <b>Kraken</b> and <b>Treasure Flagships</b>, sink level-matched AI, trade on the player market (5% tax), sign treaties, set safe havens & entry fees. Offline captains' bases are shielded.</p></div>
        <div><h4>Multiplayer</h4><p>Share your 6-digit room code (top-left). Friends join from the title screen. Your browser saves the world.</p></div>
      </div>`, [{ label: 'Aye!', primary: true }], 'wide');
  }
  escape(game) {
    if (this.modalEl) { this.closeModal(); return; }
    if (this.panel) { this.closePanel(game); return; }
    if (this.mapOpen) { this.toggleMap(game); return; }
    const q = game.app.settings;
    this.modal('Menu', `
      <div class="menu-grid">
        ${game.room ? `<p>Room code: <b class="bigcode">${game.room.code}</b><br><span class="muted">Friends enter this on the title screen to join.</span></p>` : '<p class="muted">Solo world (offline).</p>'}
        <label>Graphics <select id="q-sel"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
        <label>Volume <input type="range" id="vol" min="0" max="1" step="0.05" value="${sfx.volume}"></label>
        <label><input type="checkbox" id="mus" ${sfx.music ? 'checked' : ''}> Shanty music</label>
        <label><input type="checkbox" id="autores" ${q.autoRes !== false ? 'checked' : ''}> Auto resolution <span class="muted small">(keeps the frame rate smooth on slower PCs)</span></label>
        <label><input type="checkbox" id="showfps" ${q.showFps ? 'checked' : ''}> Show frame rate</label>
        <p class="muted small">${game.role === 'host' ? `World saved ${game.lastSave ? new Date(game.lastSave).toLocaleTimeString() : 'automatically'} in this browser.` : 'The host saves your empire.'}</p>
      </div>`, [
      { label: 'Resume', primary: true },
      { label: 'Help', fn: () => this.help() },
      { label: game.role === 'host' ? 'Save & Quit' : 'Leave', fn: async () => { await game.save(); location.href = location.pathname + location.search.replace(/[?&]auto[^&]*/g, ''); } },
    ]);
    const qs = $('#q-sel'); qs.value = q.quality || 'high';
    qs.onchange = () => { game.app.setSetting('quality', qs.value); this.toast('Graphics setting applies after reload.', 'info'); };
    $('#vol').oninput = (e) => sfx.setVolume(+e.target.value);
    $('#mus').onchange = (e) => sfx.setMusic(e.target.checked);
    $('#autores').onchange = (e) => { game.app.setSetting('autoRes', e.target.checked); game.stage.autoRes = e.target.checked; if (!e.target.checked) { game.stage.pr = game.stage.maxPR; game.stage.renderer.setPixelRatio(game.stage.pr); game.stage.resize(); } };
    $('#showfps').onchange = (e) => { game.app.setSetting('showFps', e.target.checked); };
  }

  // ------------------------------------------------------------------ map
  toggleMap(game) {
    this.mapOpen = !this.mapOpen;
    let el = $('#bigmap');
    if (!this.mapOpen) { el?.remove(); return; }
    el = document.createElement('div'); el.id = 'bigmap'; el.className = 'bigmap';
    el.innerHTML = `<div class="mapcard"><canvas id="mapc" width="900" height="900"></canvas><div class="maplegend"><h3>Sea Chart</h3>
      <div><i style="background:#4ad9ff"></i>Your bases & captains · <i style="background:#7dffb0"></i>your fleet</div><div><i style="background:#c9b98a"></i>Wild island (squatters — claim it)</div><div><i style="background:#c03a2a"></i>Pirate clan fortress (conquerable)</div><div><i style="background:#f2d58a"></i>Free Port (safe haven, market)</div><div class="muted small">Click an island to send your fleet.</div>
      <div><i style="background:#5fbf5a"></i>Oak · <i style="background:#aaa"></i>Iron · <i style="background:#e8e0c0"></i>Canvas · <i style="background:#e8c64a"></i>Powder</div>
      <div><i style="background:#c23aff"></i>Kraken · <i style="background:#ffd34a"></i>Treasure / loot · <i style="background:#ff2020"></i>Wanted captain · <b style="color:#ff3b2a">✕</b> your treasure maps</div><div class="muted small">Ring = offline shield</div>
      <button class="btn" id="mapclose">Close (M)</button></div></div>`;
    this.root.appendChild(el);
    $('#mapclose').onclick = () => this.toggleMap(game);
    const mc = $('#mapc');
    mc.onclick = (e) => {
      const rc = mc.getBoundingClientRect(), N = mc.width, k = N / (WORLD_R * 2.1);
      const wx = ((e.clientX - rc.left) / rc.width * N - N / 2) / k, wz = ((e.clientY - rc.top) / rc.height * N - N / 2) / k;
      const b = game.W.bases.map((b) => ({ b, d: Math.hypot(b.x - wx, b.z - wz) })).sort((a, c) => a.d - c.d)[0];
      if (!b || b.d > Math.max(140, baseRadius(b.b) * 2)) return;
      this.mapOrder(game, b.b);
    };
    this.drawMap(game);
  }
  drawMap(game) {
    const c = $('#mapc'); if (!c) return;
    const g = c.getContext('2d'), N = c.width, k = N / (WORLD_R * 2.1);
    const P = (x, z) => [N / 2 + x * k, N / 2 + z * k];
    const grd = g.createRadialGradient(N / 2, N / 2, 50, N / 2, N / 2, N / 2); grd.addColorStop(0, '#2e6f8e'); grd.addColorStop(1, '#173b52');
    g.fillStyle = grd; g.fillRect(0, 0, N, N);
    g.strokeStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < N; i += 45) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, N); g.moveTo(0, i); g.lineTo(N, i); g.stroke(); }
    g.font = '12px Inter'; g.textAlign = 'center';
    for (const i of game.W.islands) {
      const [x, y] = P(i.x, i.z);
      g.fillStyle = i.kind === 'port' ? '#f2d58a' : i.kind === 'res' ? ({ oak: '#5fbf5a', iron: '#aaa', canvas: '#e8e0c0', powder: '#e8c64a' })[i.res] : '#7d776c';
      g.beginPath(); g.arc(x, y, Math.max(2, i.r * k), 0, 7); g.fill();
      if (i.kind === 'port') { g.strokeStyle = 'rgba(120,220,255,0.5)'; g.setLineDash([4, 4]); g.beginPath(); g.arc(x, y, HAVEN_R * k, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = '#fff'; g.fillText('Free Port', x, y - HAVEN_R * k - 4); }
    }
    for (const b of game.W.bases) {
      const [x, y] = P(b.x, b.z);
      const own = b.owner && game.W.players[b.owner];
      g.fillStyle = baseColor(game, b);
      g.beginPath(); g.arc(x, y, Math.max(4, baseRadius(b) * k), 0, 7); g.fill();
      if (aiFaction(b.owner) === 'clan') { g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1; }
      if (shielded(game.W, b.owner)) { g.strokeStyle = '#7cc8ff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, baseRadius(b) * k + 5, 0, 7); g.stroke(); g.lineWidth = 1; }
      if (b.haven?.safe) { g.strokeStyle = 'rgba(120,220,255,0.4)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(x, y, HAVEN_R * 0.75 * k, 0, 7); g.stroke(); g.setLineDash([]); }
      if (b.owner === 'ai:wild') continue;
      const clan = game.W.ai?.[b.owner];
      g.fillStyle = clan ? '#ffb0a0' : '#fff'; g.fillText(b.name + (own ? ` (${own.name})` : clan ? ` ☠ ${clan.name} lv ${clan.level || 1}` : ''), x, y - baseRadius(b) * k - 5);
    }
    for (const s of game.sim.ships.values()) {
      if (s.sink > 0) continue;
      const [x, y] = P(s.x, s.z);
      if (s.pid) { g.fillStyle = s.pid === game.pid ? '#fff' : '#4ad9ff'; g.beginPath(); g.arc(x, y, s.pid === game.pid ? 6 : 4, 0, 7); g.fill(); g.fillText(game.W.players[s.pid]?.name || '', x, y + 16); }
      else if (s.role === 'fleet' && s.owner === game.pid) { g.fillStyle = '#7dffb0'; g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
      else if (s.tag === 'treasure') { g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.fillText('Treasure Flagship', x, y + 16); }
      else if (s.tag === 'bounty') { g.fillStyle = '#ff2020'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#ffb0a0'; g.fillText(s.name, x, y + 16); }
    }
    for (const m of game.profile()?.tmaps || []) {
      const [x, y] = P(m.x, m.z);
      g.strokeStyle = '#ff3b2a'; g.lineWidth = 4; g.beginPath(); g.moveTo(x - 7, y - 7); g.lineTo(x + 7, y + 7); g.moveTo(x + 7, y - 7); g.lineTo(x - 7, y + 7); g.stroke(); g.lineWidth = 1;
      g.fillStyle = '#ffd0c0'; g.fillText('Treasure: ' + m.name, x, y + 20);
    }
    // the old edge of the world: past it lie the Deep Reaches (tougher squatters, bigger fortresses)
    { g.strokeStyle = 'rgba(255,255,255,0.12)'; g.setLineDash([6, 8]); g.beginPath(); g.arc(N / 2, N / 2, 6000 * k, 0, 7); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText('— The Deep Reaches —', N / 2, N / 2 - 6000 * k - 6); }
    const kr = game.sim.kraken; if (kr && kr.hp > 0) { const [x, y] = P(kr.x, kr.z); g.fillStyle = '#c23aff'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText('KRAKEN', x, y + 20); }
    for (const cr of game.sim.crates) if (cr.big) { const [x, y] = P(cr.x, cr.z); g.fillStyle = '#ffd34a'; g.fillRect(x - 3, y - 3, 6, 6); }
  }

  mapOrder(game, b) {
    const W = game.W, p = game.profile();
    const mine = b.owner === game.pid;
    const canAtk = b.owner && !mine && hostile(W, game.pid, b.owner) && !shielded(W, b.owner);
    const idle = p.fleet.filter((s) => s.uid !== p.flag && !s.wrecked).length;
    const who = b.owner === 'ai:wild' ? `held by squatters (level ${b.lvl || 1}) — claim charter ${claimFee(W.bases.filter((x) => x.owner === game.pid).length)} gold` : W.ai?.[b.owner] ? `fortress of ${W.ai[b.owner].name}` : mine ? 'your island' : W.players[b.owner] ? `held by ${W.players[b.owner].name}` : 'unclaimed';
    this.modal(esc(b.name), `<p>${esc(who)} · ${b.buildings.length} structure${b.buildings.length === 1 ? '' : 's'}.</p><p class="muted small">${idle ? `You have ${idle} ship${idle > 1 ? 's' : ''} that can sail (${fleetCap(p)} at sea at once).` : 'You have no fleet ships yet — buy one at the Shipwright.'}</p>`, [
      ...(canAtk && idle ? [{ label: '⚔ Send fleet to attack', primary: true, fn: async () => { const r = await game.act({ type: 'deployAll', mode: 'attack', base: b.id, redirect: true }); this.toast(r.err || 'Your fleet sets sail!', r.err ? 'bad' : 'good'); } }] : []),
      ...(mine && idle ? [{ label: 'Send fleet to guard', primary: true, fn: async () => { const r = await game.act({ type: 'deployAll', mode: 'guard', base: b.id, redirect: true }); this.toast(r.err || 'Your fleet stands guard.', r.err ? 'bad' : 'good'); } }] : []),
      { label: 'Close' },
    ]);
  }

  // ------------------------------------------------------------------ port panel
  port(game, tab = null, remote = false) {
    const me = game.me();
    if (!remote && !me?.docked) { this.toast('Dock first (E near a harbour).', 'bad'); return; }
    this.remote = remote;
    if (tab) this.tab = tab;
    if (!this.panel) { this.panel = document.createElement('div'); this.root.appendChild(this.panel); }
    // at sea the panel docks to the right edge as a slim drawer so you can keep sailing and see the battle
    this.panel.className = remote ? 'port-wrap side' : 'port-wrap';
    this.renderPanel(game);
  }
  closePanel(game) {
    if (this.preview) { this.preview.dispose(); this.preview = null; }
    this.panel?.remove(); this.panel = null;
    if (!this.remote && game.me()?.docked) game.undock();
    this.remote = false;
  }
  tabs(game) {
    const me = game.me(); const d = me?.docked;
    const site = d || {};
    const own = site.kind === 'base' && game.W.bases.find((b) => b.id === site.id)?.owner === game.pid;
    const T = [];
    if (!this.remote) { T.push(['harbor', 'Harbour'], ['ships', 'Shipwright'], ['fleet', 'Fleet'], ['upgrades', 'Upgrades'], ['craft', 'Crafting'], ['market', 'Market'], ['trails', 'Wake Trails'], ['rewards', '🎡 Rewards']); if (own) T.push(['build', 'Build'], ['haven', 'Haven']); }
    if (this.remote) T.push(['fleet', 'Fleet Command'], ['rewards', '🎡 Rewards']);
    T.push(['diplomacy', 'Diplomacy']);
    return T;
  }
  renderPanel(game) {
    if (!this.panel) return;
    const ae = document.activeElement;
    if (ae && this.panel.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && ae.type !== 'range') return; // don't clobber typing
    const tabs = this.tabs(game);
    if (!tabs.some(([k]) => k === this.tab)) this.tab = tabs[0][0];
    this.lastSig = this.panelSig(game);
    this.panel.classList.toggle('wide', this.remote && this.tab === 'rewards');
    const me = game.me(); const p = game.profile();
    const title = this.remote ? (this.tab === 'fleet' ? 'Fleet Command' : this.tab === 'rewards' ? 'Rewards' : 'Diplomacy') : esc(me?.docked?.name || 'Harbour');
    const keepScroll = this.panel.querySelector('.pbody')?.scrollTop || 0;
    this.panel.innerHTML = `<div class="port"><div class="phead"><h2>${title}</h2><div class="ptabs">${tabs.map(([k, n]) => `<button class="tab ${k === this.tab ? 'on' : ''}" data-tab="${k}">${n}${k === 'upgrades' && p.points ? ` <b class="badge">${p.points}</b>` : ''}${k === 'diplomacy' && game.W.proposals.some((x) => x.to === game.pid) ? ' <b class="badge">!</b>' : ''}${k === 'rewards' && this.rewardsReady(game) ? ' <b class="badge">!</b>' : ''}</button>`).join('')}</div>${this.remote ? `<button class="btn tiny" id="pmin" title="Minimise">${this.panelMin ? '▢' : '—'}</button>` : ''}<button class="btn close" id="pclose">${this.remote ? '✕' : 'Set Sail ⛵'}</button></div><div class="pres">${RES.map((r) => `<span class="res res-${r}">${RES_ICON[r]} ${fmt(p.inv[r] || 0)}</span>`).join('')}${['chain', 'grape', 'explosive'].map((a) => `<span class="res"><span class="ball b-${a}"></span> ${p.inv[a] || 0}</span>`).join('')}</div><div class="pbody" id="pbody"></div></div>`;
    this.panel.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; sfx.ui(); if (this.preview) { this.preview.dispose(); this.preview = null; } this.renderPanel(game); }));
    $('#pclose').onclick = () => this.closePanel(game);
    const pm = $('#pmin'); if (pm) pm.onclick = () => { this.panelMin = !this.panelMin; this.renderPanel(game); };
    this.panel.classList.toggle('min', !!(this.remote && this.panelMin));
    const body = $('#pbody');
    const fn = this['tab_' + this.tab];
    if (fn) fn.call(this, game, body);
    body.scrollTop = keepScroll;
  }
  async doAct(game, a, okMsg) {
    const r = await game.act(a);
    if (r.err) { this.toast(r.err, 'bad'); sfx.click(); }
    else { if (okMsg) this.toast(okMsg, 'good'); sfx.ui(); }
    this.refresh(game);
    return r;
  }

  tab_harbor(game, body) {
    const me = game.me(); const c = repairCost(me);
    const dmg = me.hull < me.stats.hull || me.sails < me.stats.sails || me.crew < me.stats.crew;
    const site = me.docked || {};
    const b = game.W.bases.find((x) => x.id === site.id);
    body.innerHTML = `
      <div class="cards">
        <div class="card"><h3>${esc(me.spec.name)}</h3><p class="muted">${tierById(me.spec.tier).name}</p>
          <div class="stat"><span>Hull</span><b>${Math.round(me.hull)} / ${me.stats.hull}</b></div>
          <div class="stat"><span>Sails</span><b>${Math.round(me.sails)} / ${me.stats.sails}</b></div>
          <div class="stat"><span>Crew</span><b>${Math.round(me.crew)} / ${me.stats.crew}</b></div>
          <button class="btn primary" id="repair" ${dmg ? '' : 'disabled'}>${dmg ? `Repair & rehire crew (${costText(c)})` : 'Ship in top shape'}</button></div>
        <div class="card"><h3>${site.kind === 'port' ? 'Free Port of Saltfire' : esc(b?.name || '')}</h3>
          ${site.kind === 'port' ? '<p>A neutral trade town and permanent safe haven. No cannon may fire within the buoys. The market, shipwright and chandlers are open to every captain.</p>' : b?.owner === game.pid ? `<p>Your base. ${b.buildings.length} building${b.buildings.length === 1 ? '' : 's'} · ${landSlotsUsed(b)}/${LAND_SLOTS} plots used.</p><button class="btn" id="sethome" ${game.profile().home === b.id ? 'disabled' : ''}>${game.profile().home === b.id ? 'Home port ✓' : 'Make home port (respawn here)'}</button>` : `<p>Guest of ${esc(game.W.players[b?.owner]?.name || '')}.</p>`}
        </div>
        ${this.voyageCard(game, site)}
        <div class="card"><h3>Captain's Log</h3><div class="log">${(game.W.log || []).slice(-6).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('') || '<p class="muted">Quiet seas.</p>'}</div></div>
      </div>`;
    $('#repair').onclick = () => this.doAct(game, { type: 'repair' }, 'Ship repaired and crew rehired.');
    const sh = $('#sethome'); if (sh) sh.onclick = () => this.doAct(game, { type: 'setHome', base: b.id }, 'Home port set.');
    body.querySelectorAll('[data-voy]').forEach((bt) => (bt.onclick = async () => {
      const r = await game.act({ type: 'voyage', to: bt.dataset.voy });
      if (r.err) { this.toast(r.err, 'bad'); return; }
      const me2 = game.me(); if (me2 && game.role !== 'host') me2.docked = r.data.docked;
      this.toast(`You chartered passage to ${r.data.name} (−${r.data.cost.toLocaleString()} gold).`, 'good'); sfx.bell?.();
      game.snapCamera?.(); this.refresh(game); this.renderPanel(game);
    }));
    const bm = $('#buymap'); if (bm) bm.onclick = () => this.doAct(game, { type: 'buyMap' }, 'The tavern keeper slides a stained map across the bar — the X is on your chart (M).');
  }
  voyageCard(game, site) {
    const me = game.me(), p = game.profile();
    if (!(site.kind === 'port' || game.W.bases.find((b) => b.id === site.id)?.owner === game.pid)) return '';
    const dests = [];
    if (site.kind !== 'port') dests.push({ id: 'port', name: 'Free Port of Saltfire', x: 0, z: 0 });
    for (const b of game.W.bases) if (b.owner === game.pid && b.id !== site.id) dests.push({ id: b.id, name: b.name, x: b.x, z: b.z });
    const rows = dests.map((d) => { const dist = Math.hypot(d.x - me.x, d.z - me.z), c = voyageCost(dist); return `<div class="stat"><span>${esc(d.name)} <span class="muted small">${(dist / 1000).toFixed(1)} km</span></span><button class="btn tiny" data-voy="${d.id}" ${(p.inv.gold || 0) < c ? 'disabled' : ''}>Sail — ${c.toLocaleString()}g</button></div>`; }).join('');
    const maps = p.tmaps || [];
    return `<div class="card"><h3>Voyages</h3><p class="muted small">Charter passage straight to another harbour — no sailing, no pirates. Your fleet at sea stays where it is.</p>${rows || '<p class="muted">Claim more islands to open new routes.</p>'}
      ${site.kind === 'port' ? `<h4>Tavern: treasure maps</h4><p class="muted small">Sail to the X, heave to and press E to dig. Pirates you sink sometimes carry maps too. You hold ${maps.length}/${TREASURE.max}.</p><button class="btn" id="buymap" ${maps.length >= TREASURE.max || (p.inv.gold || 0) < TREASURE.price ? 'disabled' : ''}>Buy a map — ${TREASURE.price.toLocaleString()} gold</button>` : ''}</div>`;
  }

  tab_ships(game, body) {
    const p = game.profile(); const me = game.me();
    const site = me.docked || {};
    const b = game.W.bases.find((x) => x.id === site.id);
    const ownBase = b && b.owner === game.pid;
    const canDesign = site.kind === 'port' || ownBase;
    const hasYard = ownBase && b.buildings.some((x) => x.type === 'shipyard' && x.hp > 0);
    const cards = p.cards || [];
    const shipCards = (id) => cards.filter((c) => c.kind === 'ship' && c.tier === id);
    const sizeCards = cards.filter((c) => c.kind === 'titanSize').length;
    body.innerHTML = `
      ${cards.length ? `<div class="cardbar">🎴 Reward cards: ${this.cardsText(cards)} <span class="muted small">— redeem a ship card on its hull below, or pick it under "Pay with" in the custom shipyard.</span></div>` : ''}
      <h3>Shipwright — standard hulls</h3>
      <div class="shipgrid">${TIERS.map((T) => {
        const st = shipStats({ tier: T.id, side: T.side, size: 1 }); const locked = p.level < T.level; const mine = shipCards(T.id);
        const buy = T.cardOnly ? `<button class="btn" disabled>Reward card only</button>` : `<button class="btn" data-buy="${T.id}" ${locked || !T.cost.gold || !canAfford(p.inv, T.cost) ? 'disabled' : ''}>${locked ? `Level ${T.level}` : !T.cost.gold ? 'Starter' : 'Buy'}</button>`;
        return `<div class="shipcard ${locked && !mine.length ? 'locked' : ''} ${T.cardOnly ? 'legend' : ''}"><h4>${T.name}</h4><div class="muted">${T.side} cannon${T.side > 1 ? 's' : ''} per side (up to ${maxSideFor(T, 1)}${T.sizeGuns ? `, ${T.sizeGuns[1]} at 120% size` : ''}) · ${T.masts} mast${T.masts > 1 ? 's' : ''}${T.flagshipOnly ? ' · <b class="y">flagship only</b>' : ''}</div><div class="mini">Hull ${st.hull} · Speed ${(st.speed * 1.94).toFixed(0)} kn · Crew ${st.crew}</div><div class="cost">${T.cardOnly ? 'Win it on the Wheel of Fortune (0.1%) or the Holiday Tides event' : T.cost.gold ? costText(T.cost) : 'free'}</div>${buy}${mine.length ? `<button class="btn primary" data-redeem="${mine[0].id}" data-tier="${T.id}">🎴 Redeem card${mine.length > 1 ? ` (${mine.length})` : ''}</button>` : ''}</div>`;
      }).join('')}</div>
      <div class="card sizecard"><b>Titan Size card</b> <span class="muted small">— lets a Titan be built above 100% size (up to 150 guns a side) in the custom shipyard. You hold ${sizeCards}.</span>
        <button class="btn" id="buy-size" ${(p.inv.gold || 0) < TITAN_SIZE_PRICE ? 'disabled' : ''}>Buy — ${TITAN_SIZE_PRICE.toLocaleString()} gold</button></div>
      <h3>Custom Shipyard ${canDesign ? `<span class="muted small">— ${hasYard ? 'your Shipyard takes 20% off' : site.kind === 'port' ? 'Free Port yards' : 'build a Shipyard here for 20% off'}</span>` : '<span class="muted small">— dock at the Free Port or one of your own islands to design ships</span>'}</h3>
      ${canDesign ? this.builderHTML(p) : ''}`;
    this.builderYard = hasYard;
    body.querySelectorAll('[data-buy]').forEach((bt) => (bt.onclick = () => this.doAct(game, { type: 'buyShip', tier: bt.dataset.buy }, 'New ship added to your fleet — make it your flagship in Fleet.')));
    body.querySelectorAll('[data-redeem]').forEach((bt) => (bt.onclick = () => this.doAct(game, { type: 'buyShip', tier: bt.dataset.tier, card: bt.dataset.redeem }, `Card redeemed: your ${tierById(bt.dataset.tier).name} waits in Fleet!`)));
    $('#buy-size', body).onclick = () => this.doAct(game, { type: 'buySizeCard' }, 'Titan Size card added to your collection.');
    if (canDesign) this.bindBuilder(game, body);
  }
  cardsText(cards) {
    const n = {};
    for (const c of cards) { const k = c.kind === 'ship' ? tierById(c.tier).name : 'Titan Size'; n[k] = (n[k] || 0) + 1; }
    return Object.entries(n).map(([k, v]) => `<b>${esc(k)}</b>${v > 1 ? ` ×${v}` : ''}`).join(', ');
  }
  rewardsReady(game) {
    const p = game.profile(), now = game.sim.clock();
    const h = holidayState(p, now);
    return freeSpinReady(p, now) || (h.active && !h.claimed);
  }
  builderHTML(p) {
    const cards = (p.cards || []).filter((c) => c.kind === 'ship');
    const avail = shopTiers().filter((t) => p.level >= t.level);
    return `<div class="builder"><div class="bform">
      <label>Pay with <select id="cb-pay"><option value="">Gold + materials</option>${cards.map((c) => `<option value="${c.id}" data-tier="${c.tier}">🎴 ${tierById(c.tier).name} card (hull is free)</option>`).join('')}</select></label>
      <label>Hull class <select id="cb-tier">${avail.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')}</select></label>
      <label>Size <input type="range" id="cb-size" min="0.85" max="1.2" step="0.05" value="1"><b id="cb-size-t">100%</b></label>
      <label>Cannons per side <input type="range" id="cb-side" min="1" max="2" step="1" value="1"><b id="cb-side-t">1</b></label>
      <label>Name <input id="cb-name" maxlength="24" value="Sea Wraith"></label>
      <div class="colors"><label>Hull <input type="color" id="cb-hull" value="#5a3a22"></label><label>Trim <input type="color" id="cb-trim" value="#c9a227"></label><label>Sails <input type="color" id="cb-sail" value="#efe6cf"></label></div>
      <label>Flag <select id="cb-emb">${EMBLEMS.map((e, i) => `<option value="${i}">${e}</option>`).join('')}</select></label>
      <div class="cost" id="cb-cost"></div><button class="btn primary" id="cb-build">Lay the keel</button></div>
      <div class="bprev"><canvas id="cb-prev" width="460" height="300"></canvas><div class="muted small" id="cb-stats"></div></div></div>`;
  }
  bindBuilder(game, body) {
    const p = game.profile();
    const g = (id) => $('#' + id, body);
    const read = () => ({ card: g('cb-pay').value || undefined, tier: g('cb-tier').value, size: +g('cb-size').value, side: +g('cb-side').value, name: g('cb-name').value, hullColor: g('cb-hull').value, trimColor: g('cb-trim').value, sailColor: g('cb-sail').value, emblem: +g('cb-emb').value });
    const S = this.builderState;
    if (S) { if ([...g('cb-tier').options].some((o) => o.value === S.tier)) g('cb-tier').value = S.tier; g('cb-size').value = S.size; g('cb-name').value = S.name; g('cb-hull').value = S.hullColor; g('cb-trim').value = S.trimColor; g('cb-sail').value = S.sailColor; g('cb-emb').value = S.emblem; }
    if (this.preview) g('cb-prev').replaceWith(this.preview.r.domElement);
    let first = true;
    const upd = () => {
      // a ship card fixes the hull class (and adds the Titan to the list when you hold its card)
      const pay = g('cb-pay'), ct = pay.selectedOptions[0]?.dataset.tier, ts = g('cb-tier');
      if (ct) { if (![...ts.options].some((o) => o.value === ct)) ts.add(new Option(tierById(ct).name, ct)); ts.value = ct; ts.disabled = true; } else { ts.disabled = false; for (const o of [...ts.options]) if (tierById(o.value).cardOnly) ts.removeChild(o); }
      const T = tierById(ts.value);
      const sizeOk = T.id !== 'titan' || (p.cards || []).some((c) => c.kind === 'titanSize');
      const sz = g('cb-size'); sz.max = sizeOk ? 1.2 : 1; if (+sz.value > +sz.max) sz.value = sz.max;
      const mx = maxSideFor(T, +g('cb-size').value || 1); const sl = g('cb-side'); sl.min = T.minSide; sl.max = mx; if (first && S) sl.value = S.side; if (+sl.value < T.minSide) sl.value = T.side; if (+sl.value > mx) sl.value = mx;
      first = false;
      const o = read();
      this.builderState = o;
      g('cb-size-t').textContent = Math.round(o.size * 100) + '%'; g('cb-side-t').textContent = o.side;
      const cost = o.card ? {} : customCost(o.tier, o.side, o.size, this.builderYard);
      g('cb-cost').innerHTML = o.card ? `Cost: <b>free — uses your ${tierById(o.tier).name} card</b>${T.id === 'titan' && o.size > 1 ? ' + 1 Titan Size card' : ''}` : `Cost: <b>${costText(cost)}</b> ${canAfford(p.inv, cost) ? '' : '<span class="bad">— not enough</span>'}`;
      if (T.id === 'titan' && !sizeOk) g('cb-cost').innerHTML += '<div class="muted small">Above 100% needs a Titan Size card.</div>';
      const st = shipStats({ tier: o.tier, side: o.side, size: o.size }, {});
      g('cb-stats').textContent = `${st.len.toFixed(0)} m long · hull ${st.hull} · speed ${st.speed.toFixed(1)} m/s · turn ${st.turn.toFixed(2)} · crew ${st.crew} · reload ${st.reload.toFixed(1)} s`;
      if (!this.preview) this.preview = new ShipPreview(g('cb-prev') || this.preview?.r.domElement);
      this.preview.show(st, o);
    };
    for (const id of ['cb-pay', 'cb-tier', 'cb-size', 'cb-side', 'cb-hull', 'cb-trim', 'cb-sail', 'cb-emb', 'cb-name']) g(id).oninput = upd;
    g('cb-build').onclick = () => this.doAct(game, { type: 'customShip', spec: read() }, `The ${read().name} has been launched! Find her in Fleet.`);
    upd();
  }
  tab_fleet(game, body) {
    const p = game.profile(), W = game.W, me = game.me();
    const out = p.fleet.filter((s) => s.out).length, cap = fleetCap(p);
    const from = me || { x: 0, z: 0 };
    const dist = (b) => Math.round(Math.hypot(b.x - from.x, b.z - from.z));
    const targets = W.bases.filter((b) => b.owner && b.owner !== game.pid && hostile(W, game.pid, b.owner) && !shielded(W, b.owner)).sort((a, b) => dist(a) - dist(b)).slice(0, 40);
    const mine = W.bases.filter((b) => b.owner === game.pid);
    const ownerLabel = (b) => b.owner === 'ai:wild' ? `squatters lv ${b.lvl || 1}` : W.ai?.[b.owner]?.name || W.players[b.owner]?.name || '';
    this.fleetTarget ??= targets[0]?.id || '';
    this.fleetGuard ??= mine[0]?.id || '';
    const tgtSel = `<select id="fl-tgt">${targets.map((b) => `<option value="${b.id}" ${b.id === this.fleetTarget ? 'selected' : ''}>${esc(b.name)} — ${esc(ownerLabel(b))} · ${dist(b)} m</option>`).join('') || '<option value="">(no targets)</option>'}</select>`;
    const guardSel = `<select id="fl-guard">${mine.map((b) => `<option value="${b.id}" ${b.id === this.fleetGuard ? 'selected' : ''}>${esc(b.name)}</option>`).join('') || '<option value="">(no islands)</option>'}</select>`;
    const row = (s) => {
      const st = shipStats(s, p.upg);
      const live = game.sim.ships.get('f:' + s.uid);
      const flag = s.uid === p.flag;
      const status = flag ? '<span class="tagflag">Flagship</span>' : s.wrecked ? '<span class="bad">Wrecked</span>' : s.out ? `<span class="good">At sea — ${live?.ai?.mode || 'sailing'}${live?.ai?.base ? ': ' + esc(W.bases.find((b) => b.id === live.ai.base)?.name || '') : ''}</span>${live ? ` <span class="muted">${Math.round((live.hull / live.stats.hull) * 100)}% hull</span>` : ''}` : '<span class="muted">In harbour</span>';
      let btns = '';
      if (!flag && !s.wrecked) btns += `<button class="btn tiny" data-dep="${s.uid}" data-m="escort">Escort me</button><button class="btn tiny" data-dep="${s.uid}" data-m="attack">Attack target</button><button class="btn tiny" data-dep="${s.uid}" data-m="guard">Guard island</button>`;
      if (s.out) btns += `<button class="btn tiny" data-rec="${s.uid}">Recall</button>`;
      if (s.wrecked || s.hp != null) btns += `<button class="btn tiny" data-fix="${s.uid}" ${me?.docked ? '' : 'disabled title="Dock in a harbour"'}>Repair</button>`;
      if (!flag && !this.remote && !s.out && !s.wrecked) btns += `<button class="btn tiny" data-flag="${s.uid}">Make flagship</button>`;
      if (!this.remote) btns += `<button class="btn tiny" data-ren="${s.uid}">Rename</button>`;
      return `<div class="fship ${flag ? 'flag' : ''}"><div class="swatch" style="background:${s.hullColor};border-color:${s.trimColor}"></div><div class="finfo"><b>${esc(s.name)}</b> <span class="muted">${tierById(s.tier).name}${s.custom ? ' · custom' : ''}</span><div class="mini">${st.side} guns/side · hull ${st.hull} · speed ${st.speed.toFixed(1)} · crew ${st.crew}</div><div class="mini">${status}</div></div><div class="fbtns">${btns}</div></div>`;
    };
    body.innerHTML = `<div class="fleetcmd"><div class="card"><h3>Fleet orders</h3>
        <p class="muted small">Ships you own (other than your flagship) sail as AI captains under your colours. <b>${out}/${cap}</b> at sea (more with levels and the Commodore upgrade). They share your upgrades, pick up loot for you and capture what they conquer.</p>
        <label>Attack target ${tgtSel}</label><label>Guard island ${guardSel}</label>
        <div class="row"><button class="btn primary" id="fl-all-atk">⚔ Send all idle ships to attack</button><button class="btn" id="fl-all-esc">Escort me</button><button class="btn" id="fl-all-grd">Guard island</button><button class="btn" id="fl-recall">Recall all</button></div></div>
      <div class="fleet">${p.fleet.map(row).join('')}</div>
      <p class="muted small">Buy ships at the Shipwright or design them in your Shipyard, then send them out here. Sell ships on the Market tab.</p></div>`;
    const tsel = $('#fl-tgt', body), gsel = $('#fl-guard', body);
    tsel.onchange = () => { this.fleetTarget = tsel.value; };
    gsel.onchange = () => { this.fleetGuard = gsel.value; };
    const order = (mode) => (mode === 'attack' ? { mode, base: tsel.value } : mode === 'guard' ? { mode, base: gsel.value } : { mode });
    const ok = { escort: 'Ship falls in behind you.', attack: 'Ship is sailing to attack!', guard: 'Ship is standing guard.' };
    body.querySelectorAll('[data-dep]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'deploy', uid: b.dataset.dep, ...order(b.dataset.m) }, ok[b.dataset.m])));
    body.querySelectorAll('[data-rec]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'recall', uid: b.dataset.rec }, 'Recalled to harbour.')));
    body.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'repairFleet', uid: b.dataset.fix }, 'Ship repaired.')));
    body.querySelectorAll('[data-flag]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'flagship', uid: b.dataset.flag }, 'Flagship changed.')));
    body.querySelectorAll('[data-ren]').forEach((b) => (b.onclick = () => { const n = prompt('New name?'); if (n) this.doAct(game, { type: 'renameShip', uid: b.dataset.ren, name: n }); }));
    $('#fl-all-atk', body).onclick = () => this.doAct(game, { type: 'deployAll', ...order('attack'), redirect: true }, 'Your fleet sets sail to attack!');
    $('#fl-all-esc', body).onclick = () => this.doAct(game, { type: 'deployAll', mode: 'escort', redirect: true }, 'Your fleet forms up on you.');
    $('#fl-all-grd', body).onclick = () => this.doAct(game, { type: 'deployAll', ...order('guard'), redirect: true }, 'Your fleet stands guard.');
    $('#fl-recall', body).onclick = () => this.doAct(game, { type: 'recallAll' }, 'Fleet recalled.');
  }
  tab_trails(game, body) {
    const p = game.profile();
    const owned = p.trails || ['foam'], cur = p.trail || 'foam';
    const sw = (c) => c === 'rainbow' ? 'linear-gradient(90deg,#f33,#fc3,#3f6,#3cf,#a4f)' : c ? `linear-gradient(90deg, transparent, ${c} 30%, ${c})` : 'linear-gradient(90deg, transparent, #fff 40%, #dfe)';
    body.innerHTML = `<p class="muted">Paint the sea behind you. A wake trail is a cosmetic glow that follows your flagship wherever you sail — everyone in the world sees it. Bought once with gold, yours forever.</p>
      <div class="cards trails">${Object.entries(TRAILS).map(([id, T]) => {
        const has = owned.includes(id), on = cur === id;
        return `<div class="card trail ${on ? 'on' : ''}"><div class="tsw" style="background:${sw(T.color)}"></div><h4>${esc(T.name)}</h4><div class="muted small">${T.cost ? `${fmt(T.cost)} gold` : 'Free'}</div>
          ${on ? '<button class="btn" disabled>Equipped ✓</button>' : has ? `<button class="btn" data-eq="${id}">Equip</button>` : `<button class="btn primary" data-tb="${id}" ${(p.inv.gold || 0) < T.cost ? 'disabled' : ''}>Buy</button>`}</div>`;
      }).join('')}</div>`;
    body.querySelectorAll('[data-tb]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'buyTrail', id: b.dataset.tb }, `${TRAILS[b.dataset.tb].name} bought and equipped!`)));
    body.querySelectorAll('[data-eq]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'setTrail', id: b.dataset.eq }, `${TRAILS[b.dataset.eq].name} equipped.`)));
  }
  // ------------------------------------------------------------------ rewards: Wheel of Fortune + Holiday Tides
  tab_rewards(game, body) {
    const p = game.profile(), now = Date.now();
    const free = p.wheel?.free !== dayKey(now), bonus = p.wheel?.bonus || 0;
    const h = holidayState(p, now);
    const pct = (x) => (x * 100 < 1 ? (x * 100).toFixed(1) : (x * 100).toFixed(x * 100 < 10 ? 1 : 0)) + '%';
    const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const tick = '<svg class="stamp ok" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#2f9a52" stroke="#c9f5d4" stroke-width="1.5"/><path d="M6.5 12.5l3.5 3.5 7.5-8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const cross = '<svg class="stamp no" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#a3302a" stroke="#ffc9c4" stroke-width="1.5"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
    const cal = [];
    let mon = -1;
    for (let i = 0; i < h.total; i++) {
      const key = h.dayKeyOf(i), got = h.days.includes(key), past = i < h.i, today = i === h.i;
      const m = +key.slice(5, 7) - 1;
      if (m !== mon) {
        mon = m; cal.push(`<div class="hmon">${MON[m]} ${key.slice(0, 4)}</div>`);
        const lead = (new Date(key + 'T12:00:00Z').getUTCDay() + 6) % 7; // Monday-first grid
        for (let k = 0; k < lead; k++) cal.push('<div class="hday pad"></div>');
      }
      const last = i === h.total - 1, gift = holidayGift(i, h.perfect);
      const tip = last ? 'Titan reward card for perfect attendance — otherwise 60,000 gold' : prizeText(gift);
      cal.push(`<div class="hday ${got ? 'got' : past ? 'miss' : today ? 'today' : 'future'} ${gift.big ? 'big' : ''}" title="${esc(key)}: ${esc(tip)}"><span class="dn">${+key.slice(8)}</span>${iconSVG(prizeIcon(gift), 34)}<b>${esc(giftShort(gift))}</b>${got ? tick : past ? cross : ''}</div>`);
    }
    const wk = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => `<div class="hwd">${d}</div>`).join('');
    body.innerHTML = `<div class="rewards">
      <div class="card wheelcard"><h3>Wheel of Fortune</h3>
        <div class="wheelwrap"><canvas id="wheel" width="680" height="680"></canvas></div>
        <div class="row spinrow"><button class="btn primary" id="spin-free" ${free || bonus ? '' : 'disabled'}>${free ? 'Free daily spin' : bonus ? `Bonus spin (${bonus})` : 'Free spin used today'}</button>
          <button class="btn" id="spin-paid" ${(p.inv.gold || 0) < WHEEL.cost ? 'disabled' : ''}>Spin — ${WHEEL.cost.toLocaleString()} gold</button></div>
        <div class="odds">${WHEEL.prizes.map((x) => `<span>${iconSVG(prizeIcon(x), 18)}${esc(x.label)} <b>${pct(x.p)}</b></span>`).join('')}</div>
        <p class="muted small">Ships you win arrive as reward cards — redeem them at any Shipwright or use them in the custom shipyard.</p></div>
      <div class="card holiday"><h3>${esc(HOLIDAY.name)}</h3>
        <p class="small">A gift every day until <b>1 January</b>. Claim <b>every single day</b> and New Year's Day brings a <b class="y">Titan reward card</b>. Christmas brings a Titan Size card; treasure chests every other Sunday.</p>
        <div class="hcal">${wk}${cal.join('')}</div>
        <p class="small">${h.count}/${h.total} claimed · ${h.i < 0 ? 'starts soon' : !h.active ? 'event over' : h.perfect ? '<span class="good">perfect attendance — the Titan is still yours to win</span>' : `<span class="bad">missed ${h.missed} day${h.missed > 1 ? 's' : ''} — no Titan this year, New Year's Day pays 60,000 gold instead</span>`}</p>
        <button class="btn primary" id="hol-claim" ${h.active && !h.claimed ? '' : 'disabled'}>${h.claimed ? 'Claimed today ✓ — come back tomorrow' : h.active ? `Claim day ${h.i + 1}` : 'Not running'}</button></div>
      <div class="card"><h3>Your reward cards</h3>${(p.cards || []).length ? `<div class="cardrow">${(p.cards || []).map((c) => `<div class="rcard">${iconSVG(c.kind === 'ship' ? (c.tier === 'titan' ? 'titan' : 'ship') : 'size', 54)}<b>${esc(c.kind === 'ship' ? tierById(c.tier).name : 'Titan Size')}</b></div>`).join('')}</div><p class="muted small">Use them at the Shipwright (Redeem) or in the custom shipyard (Pay with).</p>` : '<p class="muted">No cards yet — spin the wheel!</p>'}</div>
    </div>`;
    this.drawWheel();
    const spin = async (paid) => {
      if (this.wheelAnim && performance.now() < this.wheelAnim.t0 + this.wheelAnim.dur) return;
      const r = await game.act({ type: 'spinWheel', paid });
      if (r.err) { this.toast(r.err, 'bad'); sfx.click(); return; }
      const res = r.data, n = WHEEL.prizes.length, seg = (Math.PI * 2) / n;
      const from = this.wheelAngle || 0;
      // land the pointer (top) inside the won slice
      const target = -(res.index + 0.2 + Math.random() * 0.6) * seg;
      const to = from - ((from - target) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI * 2 * 5;
      this.wheelAnim = { from, to, t0: performance.now(), dur: 4200, res };
      this.wheelWin = null;
      sfx.ui();
      let lastSeg = Math.floor(from / seg);
      const step = () => {
        const a = this.wheelAnim; if (!a) return;
        const t = Math.min(1, (performance.now() - a.t0) / a.dur), e = 1 - Math.pow(1 - t, 4);
        this.wheelAngle = a.from + (a.to - a.from) * e;
        const sg = Math.floor(this.wheelAngle / seg);
        if (sg !== lastSeg) { lastSeg = sg; sfx.click(); }
        this.drawWheel();
        if (t < 1) requestAnimationFrame(step);
        else {
          this.wheelAnim = null; this.wheelWin = { i: a.res.index, t0: performance.now() };
          const big = a.res.prize.kind === 'ship' || a.res.prize.kind === 'titanSize';
          this.toast(`${big ? 'JACKPOT! ' : ''}You won ${a.res.text}!`, big ? 'event' : 'good', big ? 8 : 3);
          this.refresh(game); if (this.panel) this.renderPanel(game);
          const glow = () => { if (!this.wheelWin || performance.now() - this.wheelWin.t0 > 2500) { this.drawWheel(); return; } this.drawWheel(); requestAnimationFrame(glow); };
          requestAnimationFrame(glow);
        }
      };
      requestAnimationFrame(step);
    };
    $('#spin-free', body).onclick = () => spin(false);
    $('#spin-paid', body).onclick = () => spin(true);
    $('#hol-claim', body).onclick = async () => {
      const r = await game.act({ type: 'claimHoliday' });
      if (r.err) { this.toast(r.err, 'bad'); return; }
      const big = r.data.gift.big;
      this.toast(`${HOLIDAY.name} day ${r.data.day}/${r.data.total}: ${r.data.text}!`, big ? 'event' : 'good', big ? 8 : 3); sfx.ui();
      this.refresh(game); if (this.panel) this.renderPanel(game);
    };
  }
  drawWheel() {
    const c = this.panel?.querySelector('#wheel'); if (!c) return;
    const g = c.getContext('2d'), n = WHEEL.prizes.length, seg = (Math.PI * 2) / n;
    const W = c.width, cx = W / 2, cy = W / 2 + 8, RO = W / 2 - 14, R = RO - 34, TAU = Math.PI * 2;
    const ang = this.wheelAngle || 0, spinning = !!this.wheelAnim, now = performance.now();
    const redraw = () => this.drawWheel();
    g.clearRect(0, 0, W, W);
    // drop shadow + wooden rim
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 24; g.shadowOffsetY = 8;
    g.beginPath(); g.arc(cx, cy, RO, 0, TAU); g.fillStyle = '#3a220f'; g.fill(); g.restore();
    const rim = g.createRadialGradient(cx, cy, R, cx, cy, RO);
    rim.addColorStop(0, '#2a1608'); rim.addColorStop(0.45, '#7a4a22'); rim.addColorStop(1, '#3a200c');
    g.beginPath(); g.arc(cx, cy, RO, 0, TAU); g.arc(cx, cy, R, 0, TAU, true); g.fillStyle = rim; g.fill();
    for (const [r, w] of [[RO - 1, 3], [R + 1, 4]]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.strokeStyle = '#e8bd4a'; g.lineWidth = w; g.stroke(); }
    // marquee bulbs: chase while spinning, glow steady at rest
    const NB = 24;
    for (let i = 0; i < NB; i++) {
      const a = (i / NB) * TAU, bx = cx + Math.cos(a) * (R + 17), by = cy + Math.sin(a) * (R + 17);
      const on = spinning ? (i + Math.floor(now / 90)) % 3 === 0 : this.wheelWin ? (Math.floor(now / 160) + i) % 2 === 0 : true;
      g.beginPath(); g.arc(bx, by, 7, 0, TAU);
      if (on) { g.save(); g.shadowColor = '#ffd86a'; g.shadowBlur = 16; g.fillStyle = '#fff3c0'; g.fill(); g.restore(); }
      else { g.fillStyle = '#7a5a2a'; g.fill(); }
      g.strokeStyle = '#4a2c10'; g.lineWidth = 2; g.stroke();
    }
    // slices
    g.save(); g.translate(cx, cy); g.rotate(ang);
    const lum = (hex) => { const v = parseInt(hex.slice(1), 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255; };
    WHEEL.prizes.forEach((pr, i) => {
      const a0 = -Math.PI / 2 + i * seg, a1 = a0 + seg, am = a0 + seg / 2;
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a1); g.closePath();
      g.fillStyle = pr.color; g.fill();
      const sh = g.createRadialGradient(0, 0, R * 0.15, 0, 0, R);
      sh.addColorStop(0, 'rgba(255,255,255,.22)'); sh.addColorStop(0.7, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.28)');
      g.fillStyle = sh; g.fill();
      if (this.wheelWin && this.wheelWin.i === i) { g.fillStyle = `rgba(255,240,170,${0.25 + 0.25 * Math.sin(now / 90)})`; g.fill(); }
      if (pr.kind === 'ship' && pr.tier === 'titan') { g.save(); g.clip(); g.strokeStyle = '#ffd25a'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, R - 4, a0, a1); g.stroke(); g.restore(); }
      // icon, upright along the spoke
      g.save(); g.rotate(am + Math.PI / 2);
      const im = iconImage(prizeIcon(pr), redraw);
      if (im) g.drawImage(im, -38, -R * 0.78 - 38, 76, 76);
      g.restore();
      // label runs along the spoke, flipped on the left half so it never reads upside down
      g.save(); g.rotate(am);
      const flip = Math.cos(am + ang) < 0;
      if (flip) g.rotate(Math.PI);
      const dark = lum(pr.color) > 0.6;
      g.fillStyle = dark ? '#3a2408' : '#fff'; g.strokeStyle = dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.6)'; g.lineWidth = 4;
      g.font = `900 ${pr.label.length > 9 ? 20 : 23}px "Trebuchet MS", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const tx = (flip ? -1 : 1) * R * 0.4;
      g.strokeText(pr.label, tx, 0); g.fillText(pr.label, tx, 0);
      g.restore();
    });
    // gilt dividers with pegs
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * seg;
      g.beginPath(); g.moveTo(Math.cos(a) * 46, Math.sin(a) * 46); g.lineTo(Math.cos(a) * R, Math.sin(a) * R); g.strokeStyle = '#e8bd4a'; g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9), 6, 0, TAU); g.fillStyle = '#f7dc84'; g.fill(); g.strokeStyle = '#6b4310'; g.lineWidth = 2; g.stroke();
    }
    // hub: a gilt boss with a compass star
    const hub = g.createRadialGradient(-12, -12, 4, 0, 0, 52);
    hub.addColorStop(0, '#fff3b0'); hub.addColorStop(0.5, '#d9a52c'); hub.addColorStop(1, '#6b4310');
    g.beginPath(); g.arc(0, 0, 50, 0, TAU); g.fillStyle = hub; g.fill(); g.strokeStyle = '#3a2208'; g.lineWidth = 3; g.stroke();
    g.beginPath(); for (let i = 0; i < 16; i++) { const r = i % 2 ? 12 : i % 4 ? 26 : 40, a = (i / 16) * TAU; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath();
    g.fillStyle = '#2a1a0a'; g.fill();
    g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fillStyle = '#f7dc84'; g.fill();
    g.restore();
    // pointer at the top: flicks back as each peg passes under it
    const ph = ((((ang / seg) % 1) + 1) % 1), flick = spinning ? Math.max(0, 0.35 - ph) * 0.9 : 0;
    g.save(); g.translate(cx, cy - RO + 6); g.rotate(-flick);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
    g.beginPath(); g.moveTo(-22, -14); g.lineTo(22, -14); g.lineTo(0, 40); g.closePath();
    const pg = g.createLinearGradient(-22, 0, 22, 0); pg.addColorStop(0, '#a8701a'); pg.addColorStop(0.5, '#fff0a0'); pg.addColorStop(1, '#a8701a');
    g.fillStyle = pg; g.fill(); g.shadowColor = 'transparent'; g.strokeStyle = '#5a3a0a'; g.lineWidth = 2.5; g.stroke();
    g.beginPath(); g.arc(0, -10, 9, 0, TAU); g.fillStyle = '#b3201c'; g.fill(); g.stroke();
    g.restore();
  }
  tab_upgrades(game, body) {
    const p = game.profile();
    const cats = {};
    for (const [k, U] of Object.entries(UPGRADES)) (cats[U.cat] ||= []).push([k, U]);
    const spent = Object.values(p.upg).reduce((a, b) => a + b, 0);
    body.innerHTML = `<p>Level <b>${p.level}</b> · XP ${p.xp}/${XP_PER_LEVEL(p.level)} · <b>${p.points}</b> upgrade point${p.points === 1 ? '' : 's'} to spend · ${spent}/${UPGRADE_TOTAL} ranks bought. Upgrades apply to every ship you sail and your fleet.</p>
      ${Object.entries(cats).map(([cat, list]) => `<h4>${cat}</h4><div class="upgrades">${list.map(([k, U]) => { const r = p.upg[k] || 0; return `<div class="upg"><div><b>${U.name}</b> <span class="muted small">${r}/${U.max}</span><div class="muted small">${U.desc}</div><div class="ubar"><i style="width:${(r / U.max) * 100}%"></i></div></div><div class="ubtn"><button class="btn" data-up="${k}" ${r >= U.max || !p.points ? 'disabled' : ''}>+1</button><button class="btn tiny" data-up5="${k}" ${r >= U.max || p.points < 2 ? 'disabled' : ''}>+5</button></div></div>`; }).join('')}</div>`).join('')}`;
    body.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'upgrade', key: b.dataset.up }, 'Upgrade installed.')));
    body.querySelectorAll('[data-up5]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'upgrade', key: b.dataset.up5, n: 5 }, 'Upgrades installed.')));
  }
  tab_craft(game, body) {
    const p = game.profile();
    const desc = { chain: 'Two half-balls joined by chain. Shreds sails and rigging — slows the enemy.', grape: 'A bag of musket balls. Cuts down enemy crew, slowing their reload and steering.', explosive: 'Hollow shell packed with powder. Heavy hull damage and sets ships ablaze.', powder: 'Mix charcoal and saltpetre into gunpowder (needed for explosive shot).' };
    body.innerHTML = `<div class="crafts">${Object.entries(RECIPES).map(([k, R]) => `<div class="craft"><span class="ball b-${k}"></span><div><b>${ITEM_NAME[k]}</b> <span class="muted">(have ${p.inv[k] || 0})</span><div class="muted small">${desc[k]}</div><div class="cost">${costText(R.in)} → ${R.out}</div></div><input type="number" min="1" max="50" value="1" id="cq-${k}"><button class="btn" data-craft="${k}" ${canAfford(p.inv, R.in) ? '' : 'disabled'}>Craft</button></div>`).join('')}</div>`;
    body.querySelectorAll('[data-craft]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'craft', kind: b.dataset.craft, times: +$('#cq-' + b.dataset.craft).value || 1 }, 'Crafted!')));
  }
  tab_market(game, body) {
    const W = game.W, p = game.profile();
    const mine = W.market.filter((o) => o.owner === game.pid);
    const ships = W.market.filter((o) => o.item === 'ship');
    body.innerHTML = `
      <p class="muted small">Player market — instant trades take the best listed prices. Sellers pay a ${Math.round(MARKET_TAX * 100)}% transaction tax. Offline captains' listings keep trading.</p>
      <table class="mkt"><tr><th>Item</th><th>You have</th><th>Best bid</th><th>Best ask</th><th>Qty</th><th></th></tr>
      ${MARKET_ITEMS.map((it) => `<tr><td>${ITEM_NAME[it]}</td><td>${p.inv[it] || 0}</td><td>${bestBid(W, it, game.pid) || '—'}</td><td>${bestAsk(W, it, game.pid) || '—'}</td><td><input type="number" min="1" value="10" id="mq-${it}"></td><td><button class="btn tiny" data-ib="${it}">Buy now</button><button class="btn tiny" data-is="${it}">Sell now</button></td></tr>`).join('')}</table>
      <div class="cards">
        <div class="card"><h3>Place an order</h3>
          <label>Side <select id="mo-side"><option value="sell">Sell (list)</option><option value="buy">Buy (bid)</option></select></label>
          <label>Item <select id="mo-item">${MARKET_ITEMS.map((i) => `<option value="${i}">${ITEM_NAME[i]}</option>`).join('')}</select></label>
          <label>Quantity <input type="number" id="mo-qty" min="1" value="20"></label>
          <label>Price each <input type="number" id="mo-price" min="1" value="10"></label>
          <button class="btn primary" id="mo-go">Place order</button></div>
        <div class="card"><h3>Your orders</h3>${mine.length ? mine.map((o) => `<div class="ord"><span class="${o.side}">${o.side.toUpperCase()}</span> ${o.item === 'ship' ? esc(o.ship?.name) : `${o.qty} ${ITEM_NAME[o.item]}`} @ ${o.price} <button class="btn tiny" data-cancel="${o.id}">Cancel</button></div>`).join('') : '<p class="muted">None.</p>'}</div>
        <div class="card"><h3>Ships for sale</h3>${ships.length ? ships.map((o) => `<div class="ord">${esc(o.ship?.name)} <span class="muted">${tierById(o.ship?.tier).name} · ${o.ship?.side} guns/side · by ${esc(traderName(W, o.owner))}</span> <b>${o.price}g</b> ${o.owner === game.pid ? '' : `<button class="btn tiny" data-bl="${o.id}">Buy</button>`}</div>`).join('') : '<p class="muted">No ships listed.</p>'}
          <h4>List one of yours</h4><select id="ms-ship">${p.fleet.filter((s) => s.uid !== p.flag).map((s) => `<option value="${s.uid}">${esc(s.name)} (${tierById(s.tier).name})</option>`).join('') || '<option value="">(no spare ships)</option>'}</select><input type="number" id="ms-price" min="1" value="1000"><button class="btn" id="ms-go">List ship</button></div>
        <div class="card"><h3>Recent trades</h3>${W.trades.slice(-10).reverse().map((t) => `<div class="small">${t.q} ${ITEM_NAME[t.item] || t.item} @ ${t.px} <span class="muted">${esc(traderName(W, t.seller))} → ${esc(traderName(W, t.buyer))}</span></div>`).join('') || '<p class="muted">No trades yet.</p>'}</div>
      </div>`;
    body.querySelectorAll('[data-ib]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'instantBuy', item: b.dataset.ib, qty: +$('#mq-' + b.dataset.ib).value }, 'Bought.')));
    body.querySelectorAll('[data-is]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'instantSell', item: b.dataset.is, qty: +$('#mq-' + b.dataset.is).value }, 'Sold (5% tax paid).')));
    body.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'cancel', id: b.dataset.cancel }, 'Order cancelled.')));
    body.querySelectorAll('[data-bl]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'buyListing', id: b.dataset.bl }, 'Ship purchased — see Fleet.')));
    $('#mo-go').onclick = () => this.doAct(game, { type: 'order', o: { side: $('#mo-side').value, item: $('#mo-item').value, qty: +$('#mo-qty').value, price: +$('#mo-price').value } }, 'Order placed.');
    $('#ms-go').onclick = () => { const uid = $('#ms-ship').value; if (uid) this.doAct(game, { type: 'order', o: { side: 'sell', item: 'ship', shipUid: uid, price: +$('#ms-price').value } }, 'Ship listed.'); };
  }
  tab_build(game, body) {
    const me = game.me(); const b = game.W.bases.find((x) => x.id === me.docked.id); const p = game.profile();
    const list = Object.entries(BUILDINGS).filter(([k]) => k !== 'keep');
    this.buildAng ??= 0;
    body.innerHTML = `<div class="buildcols"><div>
      <p>${landSlotsUsed(b)}/${LAND_SLOTS} building plots used. Every building physically expands the island.</p>
      <div class="blist">${list.map(([k, B]) => { const has = B.unique && b.buildings.some((x) => x.type === k); const need = B.needs && !b.buildings.some((x) => x.type === B.needs); return `<div class="bld"><div><b>${B.name}</b> <span class="muted small">${B.slot === 'shore' ? '(choose position →)' : B.slot === 'sea' ? '(choose position →)' : ''}</span><div class="muted small">${B.desc}</div><div class="cost">${costText(B.cost)}</div></div><button class="btn" data-build="${k}" ${has || need || !canAfford(p.inv, B.cost) ? 'disabled' : ''}>${has ? 'Built' : need ? `Needs ${BUILDINGS[B.needs].name}` : 'Build'}</button></div>`; }).join('')}</div></div>
      <div><h4>Defence placement</h4><p class="muted small">Click the ring to aim where the next Shore Cannon or Sea Fort goes.</p>${this.placementSVG(b)}
      <h4>Structures</h4><div class="structs">${b.buildings.map((x) => `<div class="small">${BUILDINGS[x.type].name} <span class="${x.hp <= 0 ? 'bad' : 'muted'}">${Math.round(x.hp)}/${BUILDINGS[x.type].hp}</span>${x.type !== 'keep' ? ` <button class="btn tiny" data-demo="${x.id}">✕</button>` : ''}</div>`).join('')}</div>
      <button class="btn" id="rb">Repair all structures</button></div></div>`;
    body.querySelectorAll('[data-build]').forEach((bt) => (bt.onclick = () => this.doAct(game, { type: 'build', base: b.id, btype: bt.dataset.build, at: this.buildAng }, `${BUILDINGS[bt.dataset.build].name} built!`)));
    body.querySelectorAll('[data-demo]').forEach((bt) => (bt.onclick = () => { if (confirm('Demolish?')) this.doAct(game, { type: 'demolish', base: b.id, bid: bt.dataset.demo }); }));
    $('#rb').onclick = () => this.doAct(game, { type: 'repairBase', base: b.id }, 'Repaired.');
    const svg = $('#place-svg', body);
    svg.onclick = (e) => { const r = svg.getBoundingClientRect(); const x = e.clientX - r.left - r.width / 2, y = e.clientY - r.top - r.height / 2; this.buildAng = Math.atan2(y, x); this.renderPanel(game); };
  }
  placementSVG(b) {
    const S = 220, c = S / 2, R = 60;
    const dots = b.buildings.filter((x) => x.type === 'cannon' || x.type === 'fort').map((x) => { const rr = x.type === 'fort' ? R + 30 : R; return `<circle cx="${c + Math.cos(x.slot) * rr}" cy="${c + Math.sin(x.slot) * rr}" r="${x.type === 'fort' ? 9 : 5}" fill="${x.hp > 0 ? '#c9c2b4' : '#533'}" stroke="#222"/>`; }).join('');
    const da = ((b.seed || 0) % 628) / 100;
    return `<svg id="place-svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" class="placesvg"><circle cx="${c}" cy="${c}" r="${R + 50}" fill="#1d5674"/><circle cx="${c}" cy="${c}" r="${R + 6}" fill="#e9d39a"/><circle cx="${c}" cy="${c}" r="${R - 6}" fill="#58b043"/><rect x="${c - 8}" y="${c - 8}" width="16" height="16" fill="#aaa"/><line x1="${c + Math.cos(da) * R}" y1="${c + Math.sin(da) * R}" x2="${c + Math.cos(da) * (R + 34)}" y2="${c + Math.sin(da) * (R + 34)}" stroke="#9a7048" stroke-width="6"/>${dots}<line x1="${c}" y1="${c}" x2="${c + Math.cos(this.buildAng) * (R + 45)}" y2="${c + Math.sin(this.buildAng) * (R + 45)}" stroke="#ffd34a" stroke-width="2" stroke-dasharray="4 3"/><circle cx="${c + Math.cos(this.buildAng) * R}" cy="${c + Math.sin(this.buildAng) * R}" r="6" fill="none" stroke="#ffd34a" stroke-width="2"/></svg>`;
  }
  tab_haven(game, body) {
    const me = game.me(); const b = game.W.bases.find((x) => x.id === me.docked.id);
    const h = b.haven || {};
    const others = Object.values(game.W.players).filter((x) => x.id !== game.pid);
    body.innerHTML = `<div class="card"><h3>Harbour rules for ${esc(b.name)}</h3>
      <label><input type="checkbox" id="hv-safe" ${h.safe ? 'checked' : ''}> <b>Safe haven</b> — no combat within the buoys (except against trespassers)</label>
      <label><input type="checkbox" id="hv-allies" ${h.allies !== false ? 'checked' : ''}> Alliance members & allied treaties enter free</label>
      <label>Entry fee for outside visitors <input type="number" id="hv-fee" min="0" max="5000" value="${h.fee || 0}"> gold <span class="muted small">(0 = free)</span></label>
      <h4>Always allow</h4><div class="allow">${others.map((o) => `<label><input type="checkbox" data-allow="${o.id}" ${h.allow?.includes(o.id) ? 'checked' : ''}> ${esc(o.name)}</label>`).join('') || '<p class="muted">No other captains yet.</p>'}</div>
      <button class="btn primary" id="hv-save">Save rules</button>
      <p class="muted small">While you are offline your bases are shielded automatically, but trading continues.</p></div>`;
    $('#hv-save').onclick = () => this.doAct(game, { type: 'haven', base: b.id, cfg: { safe: $('#hv-safe').checked, allies: $('#hv-allies').checked, fee: +$('#hv-fee').value, allow: [...body.querySelectorAll('[data-allow]')].filter((x) => x.checked).map((x) => x.dataset.allow) } }, 'Harbour rules updated.');
  }
  tab_diplomacy(game, body) {
    const W = game.W, p = game.profile();
    const others = Object.values(W.players).filter((x) => x.id !== game.pid);
    const inc = W.proposals.filter((x) => x.to === game.pid);
    body.innerHTML = `<div class="card"><h3>Alliance</h3><p class="muted small">Captains with the same alliance name never fight and share havens.</p><input id="al-name" maxlength="20" value="${esc(p.alliance || '')}" placeholder="e.g. Red Tide"><button class="btn" id="al-go">Set alliance</button></div>
      ${inc.length ? `<div class="card"><h3>Proposals for you</h3>${inc.map((x) => `<div class="ord">${esc(W.players[x.from]?.name)} proposes <b>${x.type}</b> <button class="btn tiny" data-acc="${x.id}">Accept</button><button class="btn tiny" data-rej="${x.id}">Reject</button></div>`).join('')}</div>` : ''}
      <div class="card"><h3>Captains</h3>${others.length ? others.map((o) => { const t = treatyBetween(W, game.pid, o.id); const bases = W.bases.filter((b) => b.owner === o.id).length; return `<div class="dip"><span class="dot ${o.online ? 'on' : ''}"></span><b>${esc(o.name)}</b> <span class="muted">Lv ${o.level}${o.alliance ? ` · [${esc(o.alliance)}]` : ''} · ${bases} base${bases === 1 ? '' : 's'}${o.online ? '' : ' · offline (shielded)'}</span><div class="tr">${t.length ? t.map((x) => `<span class="treaty">${x}</span>`).join('') : '<span class="muted small">no treaties — hostile</span>'}</div><div>${Object.keys(TREATY_TYPES).map((k) => `<button class="btn tiny" data-prop="${o.id}" data-t="${k}" title="${TREATY_TYPES[k]}" ${t.includes(k) ? 'disabled' : ''}>${k}</button>`).join('')}${t.length ? `<button class="btn tiny danger" data-prop="${o.id}" data-t="war">Declare war</button>` : ''}</div></div>`; }).join('') : '<p class="muted">No other captains in this world yet — share your room code!</p>'}</div>`;
    $('#al-go').onclick = () => this.doAct(game, { type: 'alliance', name: $('#al-name').value.trim() }, 'Alliance updated.');
    body.querySelectorAll('[data-prop]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'propose', to: b.dataset.prop, ttype: b.dataset.t }, b.dataset.t === 'war' ? 'Treaties torn up. War!' : 'Proposal sent.')));
    body.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'answer', id: b.dataset.acc, accept: true }, 'Treaty signed.')));
    body.querySelectorAll('[data-rej]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'answer', id: b.dataset.rej, accept: false })));
  }
}

function baseColor(game, b) {
  if (!b.owner) return '#e9e4d4';
  if (b.owner === game.pid) return '#4ad9ff';
  if (b.owner === 'ai:wild') return '#c9b98a';
  if (b.owner.startsWith('ai:')) return '#c03a2a';
  return `hsl(${game.W.players[b.owner]?.color || 0},70%,55%)`;
}

/** Small separate renderer for the custom-ship builder preview. */
class ShipPreview {
  constructor(canvas) {
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.r.setPixelRatio(Math.min(2, devicePixelRatio));
    this.r.toneMapping = THREE.ACESFilmicToneMapping; this.r.toneMappingExposure = 0.9;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x405060, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.5); d.position.set(30, 50, 20); this.scene.add(d);
    const water = new THREE.Mesh(new THREE.CircleGeometry(120, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a7a9a, roughness: 0.3, metalness: 0.1 }));
    this.scene.add(water);
    this.cam = new THREE.PerspectiveCamera(40, canvas.width / canvas.height, 0.5, 1000);
    this.t = 0;
    this.alive = true;
    const loop = () => { if (!this.alive) return; requestAnimationFrame(loop); this.t += 0.016; if (this.ship) { this.ship.root.rotation.y = this.t * 0.35; this.ship.update(this.t); } this.r.render(this.scene, this.cam); };
    loop();
  }
  show(st, look) {
    const key = JSON.stringify([st.tier, st.side, st.len, look]);
    if (key === this.key) return; this.key = key;
    if (this.ship) { this.scene.remove(this.ship.root); this.ship.dispose(); }
    this.ship = buildShip(st, look);
    this.scene.add(this.ship.root);
    const L = st.len;
    this.cam.position.set(L * 1.1, L * 0.55, L * 1.1); this.cam.lookAt(0, L * 0.3, 0);
  }
  dispose() { this.alive = false; this.r.dispose(); }
}
