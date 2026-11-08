// DOM UI: title screen, HUD (captain, resources, ship status, ammo, reloads, minimap, events,
// floating ship labels), port menus (repair, shipyard + custom builder, fleet, upgrades, crafting,
// market, building, haven, diplomacy), world map, prompts and toasts.
import * as THREE from 'three';
import {
  RES, RES_LABEL, RES_ICON, AMMO, AMMO_ORDER, RECIPES, TIERS, tierById, UPGRADES, XP_PER_LEVEL, BUILDINGS,
  MARKET_ITEMS, MARKET_TAX, TREATY_TYPES, HAVEN_R, WORLD_R, VERSION, LAND_SLOTS,
} from './config.js';
import { shipStats, customCost, costText, canAfford, bestAsk, bestBid, crewEff, treatyBetween, shielded, landSlotsUsed, flagship } from './economy.js';
import { SAIL_NAMES, SAIL_STEPS } from './sim.js';
import { dockSite, repairCost } from './actions.js';
import { baseRadius } from './basegeo.js';
import { buildShip } from './render/shipmodel.js';
import { EMBLEMS } from './render/textures.js';
import { sfx } from './audio.js';

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
  blocking() { return !!(this.panel || this.modalEl || this.mapOpen || this.escEl); }

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
      <canvas class="minimap" id="minimap" width="220" height="220"></canvas>
      <div class="hotkeys"><button class="btn tiny" id="hk-map">Map (M)</button><button class="btn tiny" id="hk-dip">Diplomacy</button><button class="btn tiny" id="hk-help">Help (H)</button><button class="btn tiny" id="hk-menu">Menu</button></div>
      <div class="labels" id="labels"></div>
      <div class="crosshair" id="xhair"></div>
    </div>`;
    this.toastBox = $('#toasts');
    $('#hk-map').onclick = () => this.toggleMap(game);
    $('#hk-dip').onclick = () => this.port(game, 'diplomacy', true);
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
    const code = $('#room .code'); if (code) code.onclick = () => { navigator.clipboard?.writeText(game.room.code); this.toast('Room code copied — share it with friends!', 'info'); };
    $('#resbar').innerHTML = RES.map((r) => `<div class="res res-${r}" title="${RES_LABEL[r]}"><span class="ri">${RES_ICON[r]}</span>${fmt(p.inv[r] || 0)}</div>`).join('');
    $('#ammo').innerHTML = AMMO_ORDER.map((a, i) => `<button class="am ${((game.ammo || 'ball') === a) ? 'on' : ''} ${a !== 'ball' && !(p.inv[a] > 0) ? 'empty' : ''}" data-ammo="${a}" title="${AMMO[a].name}"><kbd>${i + 1}</kbd><span class="ball b-${a}"></span><small>${a === 'ball' ? '∞' : p.inv[a] || 0}</small></button>`).join('');
    if (this.panel) { const sig = this.panelSig(game); if (sig !== this.lastSig) this.renderPanel(game); }
    if (this.mapOpen) this.drawMap(game);
  }
  panelSig(game) {
    const W = game.W, p = game.profile(), d = game.me()?.docked;
    const b = d && W.bases.find((x) => x.id === d.id);
    return JSON.stringify([p.inv, p.level, p.points, p.upg, p.fleet.map((s) => s.uid + s.name), p.flag, p.alliance, W.market.length, W.trades.length, W.proposals.length, W.treaties.length, b && b.buildings.map((x) => [x.type, Math.round(x.hp)]), b?.haven, Object.values(W.players).map((x) => x.online + x.name), this.tab]);
  }
  frame(game, dt) {
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
    $('#reloads').innerHTML = rl + (eff < 0.75 ? `<div class="warn">Short-handed: reload ×${(1 / eff).toFixed(1)}</div>` : '');
    // prompt
    let pr = '';
    if (me.sink > 0) pr = '<b>Your ship is sinking…</b>';
    else if (me.docked) pr = `Docked at <b>${esc(me.docked.name || 'harbour')}</b> — <kbd>E</kbd> open port · <kbd>W</kbd> set sail`;
    else {
      const site = dockSite(game.sim, me);
      if (site) pr = site.kind === 'fee' ? `<kbd>E</kbd> Pay entry fee (${site.fee}g) at ${esc(site.name)}` : site.kind === 'unclaimed' ? `<kbd>E</kbd> Claim <b>${esc(site.name)}</b>` : `<kbd>E</kbd> Dock at <b>${esc(site.name)}</b>${me.spd > 7 ? ' <span class="muted">(slow down)</span>' : ''}`;
      const isl = game.W.islands.find((i) => i.kind === 'res' && Math.hypot(i.x - me.x, i.z - me.z) < i.r + 80);
      if (isl) pr += `${pr ? '<br>' : ''}Hold <kbd>F</kbd> to harvest <b>${RES_LABEL[isl.res]}</b> (${Math.floor(isl.amt ?? 100)}%)${me.spd > 4 ? ' <span class="muted">— stop the ship</span>' : ''}`;
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
      const hostile = me && game.sim && s.owner !== me.owner && !(s.owner === 'ai:merchant') && (s.pid ? true : true);
      const cls = s.pid ? 'player' : s.role === 'merchant' ? 'merchant' : s.role === 'navy' ? 'navy' : 'pirate';
      const html = `<div class="ln ${cls}">${s.tag === 'treasure' ? '💰 ' : ''}${esc(s.name)} <small>Lv ${s.level}</small></div><div class="lh"><i style="width:${(s.hull / s.stats.hull) * 100}%"></i></div>`;
      if (el._h !== html) { el.innerHTML = html; el._h = html; }
      el.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%,-100%) scale(${Math.max(0.6, 1 - d / 1400)})`;
      el.style.opacity = hostile ? 1 : 0.85;
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
      g.fillStyle = !b.owner ? '#e9e4d4' : b.owner === game.pid ? '#4ad9ff' : b.owner.startsWith('ai:') ? '#c03a2a' : `hsl(${game.W.players[b.owner]?.color || 0},70%,55%)`;
      g.beginPath(); g.arc(x, y, Math.max(3, baseRadius(b) * k), 0, 7); g.fill();
      if (shielded(game.W, b.owner)) { g.strokeStyle = '#7cc8ff'; g.beginPath(); g.arc(x, y, Math.max(5, baseRadius(b) * k + 3), 0, 7); g.stroke(); }
    }
    for (const cr of game.sim.crates) { const [x, y] = P(cr.x, cr.z); g.fillStyle = cr.big ? '#ffd34a' : '#9be7ff'; g.fillRect(x - 2, y - 2, 4, 4); }
    for (const s of game.sim.ships.values()) {
      if (s === me || s.sink > 0) continue;
      const [x, y] = P(s.x, s.z);
      g.fillStyle = s.pid ? '#4ad9ff' : s.role === 'merchant' ? '#e8d27a' : s.role === 'navy' ? '#6f8cff' : '#ff5a4a';
      if (s.tag === 'treasure') g.fillStyle = '#ffd34a';
      g.beginPath(); g.arc(x, y, s.tag === 'treasure' ? 4.5 : 3, 0, 7); g.fill();
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
    this.modal(`Claim ${esc(site.name)}?`, `<p>This island is unclaimed. Raise your flag to found a base: build docks, a shipyard, production and defences — the island grows as you build.</p><p>${first ? '<b>Your first island is free.</b>' : 'Claiming costs <b>300 gold</b>.'}</p>`, [
      { label: 'Raise the flag', primary: true, fn: async () => { const r = await game.act({ type: 'claim', base: site.id }); this.toast(r.err || `${site.name} is yours!`, r.err ? 'bad' : 'good'); if (!r.err) sfx.fanfare(); } },
      { label: 'Not now' },
    ]);
  }
  help() {
    this.modal('How to Play', `
      <div class="help">
        <div><h4>Sailing</h4><p><kbd>W</kbd>/<kbd>S</kbd> raise / lower sails · <kbd>A</kbd>/<kbd>D</kbd> steer · right-drag orbit camera · wheel zoom · <kbd>C</kbd> reset camera</p></div>
        <div><h4>Gunnery</h4><p>Move the mouse over the water: a firing sector appears on the side you're aiming at and a 3D arc shows exactly where your shot lands. <span class="g">Green</span> = valid, <span class="y">yellow</span> = reloading, <span class="r">red</span> = out of range / arc or blocked by land. <kbd>Click</kbd> or <kbd>Space</kbd> fires the broadside.</p><p><kbd>1</kbd>–<kbd>4</kbd> / <kbd>Q</kbd> ammo: Round shot · Chainshot (sails) · Grapeshot (crew) · Explosive (hull + fire).</p></div>
        <div><h4>Crew</h4><p>Losing crew slows reloads and steering. Rehire at any harbour.</p></div>
        <div><h4>Empire</h4><p><kbd>E</kbd> dock / claim islands · <kbd>F</kbd> (hold, stopped) harvest resource islets · <kbd>M</kbd> map. Build docks, shipyards, mills and defences at your base — the island grows as you build. Hold enemy bases' keeps at 0 and linger to conquer them.</p></div>
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
  }

  // ------------------------------------------------------------------ map
  toggleMap(game) {
    this.mapOpen = !this.mapOpen;
    let el = $('#bigmap');
    if (!this.mapOpen) { el?.remove(); return; }
    el = document.createElement('div'); el.id = 'bigmap'; el.className = 'bigmap';
    el.innerHTML = `<div class="mapcard"><canvas id="mapc" width="900" height="900"></canvas><div class="maplegend"><h3>Sea Chart</h3>
      <div><i style="background:#4ad9ff"></i>Your bases & captains</div><div><i style="background:#e9e4d4"></i>Unclaimed island</div><div><i style="background:#c03a2a"></i>Pirate hold (conquerable)</div><div><i style="background:#f2d58a"></i>Free Port (safe haven, market)</div>
      <div><i style="background:#5fbf5a"></i>Oak · <i style="background:#aaa"></i>Iron · <i style="background:#e8e0c0"></i>Canvas · <i style="background:#e8c64a"></i>Powder</div>
      <div><i style="background:#c23aff"></i>Kraken · <i style="background:#ffd34a"></i>Treasure / loot</div><div class="muted small">Ring = offline shield</div>
      <button class="btn" id="mapclose">Close (M)</button></div></div>`;
    this.root.appendChild(el);
    $('#mapclose').onclick = () => this.toggleMap(game);
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
      g.fillStyle = !b.owner ? '#e9e4d4' : b.owner === game.pid ? '#4ad9ff' : b.owner.startsWith('ai:') ? '#c03a2a' : `hsl(${own?.color || 0},70%,55%)`;
      g.beginPath(); g.arc(x, y, Math.max(4, baseRadius(b) * k), 0, 7); g.fill();
      if (shielded(game.W, b.owner)) { g.strokeStyle = '#7cc8ff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, baseRadius(b) * k + 5, 0, 7); g.stroke(); g.lineWidth = 1; }
      if (b.haven?.safe) { g.strokeStyle = 'rgba(120,220,255,0.4)'; g.setLineDash([3, 3]); g.beginPath(); g.arc(x, y, HAVEN_R * 0.75 * k, 0, 7); g.stroke(); g.setLineDash([]); }
      g.fillStyle = '#fff'; g.fillText(b.name + (own ? ` (${own.name})` : b.owner?.startsWith('ai:') ? ' (pirates)' : ''), x, y - baseRadius(b) * k - 5);
    }
    for (const s of game.sim.ships.values()) {
      if (s.sink > 0) continue;
      const [x, y] = P(s.x, s.z);
      if (s.pid) { g.fillStyle = s.pid === game.pid ? '#fff' : '#4ad9ff'; g.beginPath(); g.arc(x, y, s.pid === game.pid ? 6 : 4, 0, 7); g.fill(); g.fillText(game.W.players[s.pid]?.name || '', x, y + 16); }
      else if (s.tag === 'treasure') { g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); g.fillText('Treasure Flagship', x, y + 16); }
    }
    const kr = game.sim.kraken; if (kr && kr.hp > 0) { const [x, y] = P(kr.x, kr.z); g.fillStyle = '#c23aff'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = '#fff'; g.fillText('KRAKEN', x, y + 20); }
    for (const cr of game.sim.crates) if (cr.big) { const [x, y] = P(cr.x, cr.z); g.fillStyle = '#ffd34a'; g.fillRect(x - 3, y - 3, 6, 6); }
  }

  // ------------------------------------------------------------------ port panel
  port(game, tab = null, remote = false) {
    const me = game.me();
    if (!remote && !me?.docked) { this.toast('Dock first (E near a harbour).', 'bad'); return; }
    this.remote = remote;
    if (tab) this.tab = tab;
    if (!this.panel) { this.panel = document.createElement('div'); this.panel.className = 'port-wrap'; this.root.appendChild(this.panel); }
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
    if (!this.remote) { T.push(['harbor', 'Harbour'], ['ships', 'Shipwright'], ['fleet', 'Fleet'], ['upgrades', 'Upgrades'], ['craft', 'Crafting'], ['market', 'Market']); if (own) T.push(['build', 'Build'], ['haven', 'Haven']); }
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
    const me = game.me(); const p = game.profile();
    const title = this.remote ? 'Diplomacy' : esc(me?.docked?.name || 'Harbour');
    const keepScroll = this.panel.querySelector('.pbody')?.scrollTop || 0;
    this.panel.innerHTML = `<div class="port"><div class="phead"><h2>${title}</h2><div class="ptabs">${tabs.map(([k, n]) => `<button class="tab ${k === this.tab ? 'on' : ''}" data-tab="${k}">${n}${k === 'upgrades' && p.points ? ` <b class="badge">${p.points}</b>` : ''}${k === 'diplomacy' && game.W.proposals.some((x) => x.to === game.pid) ? ' <b class="badge">!</b>' : ''}</button>`).join('')}</div><button class="btn close" id="pclose">${this.remote ? 'Close' : 'Set Sail ⛵'}</button></div><div class="pres">${RES.map((r) => `<span class="res res-${r}">${RES_ICON[r]} ${fmt(p.inv[r] || 0)}</span>`).join('')}${['chain', 'grape', 'explosive'].map((a) => `<span class="res"><span class="ball b-${a}"></span> ${p.inv[a] || 0}</span>`).join('')}</div><div class="pbody" id="pbody"></div></div>`;
    this.panel.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab; sfx.ui(); if (this.preview) { this.preview.dispose(); this.preview = null; } this.renderPanel(game); }));
    $('#pclose').onclick = () => this.closePanel(game);
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
        <div class="card"><h3>Captain's Log</h3><div class="log">${(game.W.log || []).slice(-6).reverse().map((l) => `<div>${esc(l.text)}</div>`).join('') || '<p class="muted">Quiet seas.</p>'}</div></div>
      </div>`;
    $('#repair').onclick = () => this.doAct(game, { type: 'repair' }, 'Ship repaired and crew rehired.');
    const sh = $('#sethome'); if (sh) sh.onclick = () => this.doAct(game, { type: 'setHome', base: b.id }, 'Home port set.');
  }

  tab_ships(game, body) {
    const p = game.profile(); const me = game.me();
    const site = me.docked || {};
    const b = game.W.bases.find((x) => x.id === site.id);
    const hasYard = b && b.owner === game.pid && b.buildings.some((x) => x.type === 'shipyard' && x.hp > 0);
    body.innerHTML = `
      <h3>Shipwright — standard hulls</h3>
      <div class="shipgrid">${TIERS.map((T) => { const st = shipStats({ tier: T.id, side: T.side, size: 1 }); const locked = p.level < T.level; return `<div class="shipcard ${locked ? 'locked' : ''}"><h4>${T.name}</h4><div class="muted">${T.side} cannon${T.side > 1 ? 's' : ''} per side · ${T.masts} mast${T.masts > 1 ? 's' : ''}</div><div class="mini">Hull ${st.hull} · Speed ${st.speed.toFixed(1)} · Crew ${st.crew}</div><div class="cost">${T.cost.gold ? costText(T.cost) : 'free'}</div><button class="btn" data-buy="${T.id}" ${locked || !T.cost.gold || !canAfford(p.inv, T.cost) ? 'disabled' : ''}>${locked ? `Level ${T.level}` : !T.cost.gold ? 'Starter' : 'Buy'}</button></div>`; }).join('')}</div>
      <h3>Custom Shipyard ${hasYard ? '' : '<span class="muted small">— build a Shipyard on your base to design custom ships</span>'}</h3>
      ${hasYard ? this.builderHTML(p) : ''}`;
    body.querySelectorAll('[data-buy]').forEach((bt) => (bt.onclick = () => this.doAct(game, { type: 'buyShip', tier: bt.dataset.buy }, 'New ship added to your fleet — make it your flagship in Fleet.')));
    if (hasYard) this.bindBuilder(game, body);
  }
  builderHTML(p) {
    const avail = TIERS.filter((t) => p.level >= t.level);
    return `<div class="builder"><div class="bform">
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
    const read = () => ({ tier: g('cb-tier').value, size: +g('cb-size').value, side: +g('cb-side').value, name: g('cb-name').value, hullColor: g('cb-hull').value, trimColor: g('cb-trim').value, sailColor: g('cb-sail').value, emblem: +g('cb-emb').value });
    const S = this.builderState;
    if (S) { if ([...g('cb-tier').options].some((o) => o.value === S.tier)) g('cb-tier').value = S.tier; g('cb-size').value = S.size; g('cb-name').value = S.name; g('cb-hull').value = S.hullColor; g('cb-trim').value = S.trimColor; g('cb-sail').value = S.sailColor; g('cb-emb').value = S.emblem; }
    if (this.preview) g('cb-prev').replaceWith(this.preview.r.domElement);
    let first = true;
    const upd = () => {
      const T = tierById(g('cb-tier').value);
      const sl = g('cb-side'); sl.min = T.minSide; sl.max = T.maxSide; if (first && S) sl.value = S.side; if (+sl.value < T.minSide || +sl.value > T.maxSide) sl.value = T.side;
      first = false;
      const o = read();
      this.builderState = o;
      g('cb-size-t').textContent = Math.round(o.size * 100) + '%'; g('cb-side-t').textContent = o.side;
      const cost = customCost(o.tier, o.side, o.size);
      g('cb-cost').innerHTML = `Cost: <b>${costText(cost)}</b> ${canAfford(p.inv, cost) ? '' : '<span class="bad">— not enough</span>'}`;
      const st = shipStats({ tier: o.tier, side: o.side, size: o.size }, {});
      g('cb-stats').textContent = `${st.len.toFixed(0)} m long · hull ${st.hull} · speed ${st.speed.toFixed(1)} m/s · turn ${st.turn.toFixed(2)} · crew ${st.crew} · reload ${st.reload.toFixed(1)} s`;
      if (!this.preview) this.preview = new ShipPreview(g('cb-prev') || this.preview?.r.domElement);
      this.preview.show(st, o);
    };
    for (const id of ['cb-tier', 'cb-size', 'cb-side', 'cb-hull', 'cb-trim', 'cb-sail', 'cb-emb', 'cb-name']) g(id).oninput = upd;
    g('cb-build').onclick = () => this.doAct(game, { type: 'customShip', spec: read() }, `The ${read().name} has been launched! Find her in Fleet.`);
    upd();
  }
  tab_fleet(game, body) {
    const p = game.profile();
    body.innerHTML = `<div class="fleet">${p.fleet.map((s) => { const st = shipStats(s, p.upg); return `<div class="fship ${s.uid === p.flag ? 'flag' : ''}"><div class="swatch" style="background:${s.hullColor};border-color:${s.trimColor}"></div><div class="finfo"><b>${esc(s.name)}</b> <span class="muted">${tierById(s.tier).name}${s.custom ? ' · custom' : ''}</span><div class="mini">${st.side} guns/side · hull ${st.hull} · speed ${st.speed.toFixed(1)} · crew ${st.crew}</div></div>${s.uid === p.flag ? '<span class="tagflag">Flagship</span>' : `<button class="btn" data-flag="${s.uid}">Make flagship</button>`}<button class="btn tiny" data-ren="${s.uid}">Rename</button></div>`; }).join('')}</div><p class="muted small">Sell ships on the Market tab. Your flagship is the ship you sail.</p>`;
    body.querySelectorAll('[data-flag]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'flagship', uid: b.dataset.flag }, 'Flagship changed.')));
    body.querySelectorAll('[data-ren]').forEach((b) => (b.onclick = () => { const n = prompt('New name?'); if (n) this.doAct(game, { type: 'renameShip', uid: b.dataset.ren, name: n }); }));
  }
  tab_upgrades(game, body) {
    const p = game.profile();
    body.innerHTML = `<p>Level <b>${p.level}</b> · XP ${p.xp}/${XP_PER_LEVEL(p.level)} · <b>${p.points}</b> upgrade point${p.points === 1 ? '' : 's'} to spend. Upgrades apply to every ship you sail.</p>
      <div class="upgrades">${Object.entries(UPGRADES).map(([k, U]) => { const r = p.upg[k] || 0; return `<div class="upg"><div><b>${U.name}</b><div class="muted small">${U.desc}</div></div><div class="ranks">${Array.from({ length: U.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('')}</div><button class="btn" data-up="${k}" ${r >= U.max || !p.points ? 'disabled' : ''}>+</button></div>`; }).join('')}</div>`;
    body.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => this.doAct(game, { type: 'upgrade', key: b.dataset.up }, 'Upgrade installed.')));
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
        <div class="card"><h3>Ships for sale</h3>${ships.length ? ships.map((o) => `<div class="ord">${esc(o.ship?.name)} <span class="muted">${tierById(o.ship?.tier).name} · ${o.ship?.side} guns/side · by ${esc(W.players[o.owner]?.name || 'NPC')}</span> <b>${o.price}g</b> ${o.owner === game.pid ? '' : `<button class="btn tiny" data-bl="${o.id}">Buy</button>`}</div>`).join('') : '<p class="muted">No ships listed.</p>'}
          <h4>List one of yours</h4><select id="ms-ship">${p.fleet.filter((s) => s.uid !== p.flag).map((s) => `<option value="${s.uid}">${esc(s.name)} (${tierById(s.tier).name})</option>`).join('') || '<option value="">(no spare ships)</option>'}</select><input type="number" id="ms-price" min="1" value="1000"><button class="btn" id="ms-go">List ship</button></div>
        <div class="card"><h3>Recent trades</h3>${W.trades.slice(-8).reverse().map((t) => `<div class="small">${t.q} ${ITEM_NAME[t.item] || t.item} @ ${t.px}</div>`).join('') || '<p class="muted">No trades yet.</p>'}</div>
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
