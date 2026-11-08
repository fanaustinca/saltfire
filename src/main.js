// Boot: title screen → host a world (new / saved, auto-registers a 6-digit room code) or join a
// friend's world by code. Test hooks: ?auto=solo|host|join&code=NNNNNN&name=X&seed=N, ?net=local.
import './style.css';
import { gallery } from './gallery.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Room } from './net.js';
import { identity, saveIdentity, listWorlds, loadWorld, deleteWorld } from './save.js';
import { newWorld, uid } from './economy.js';
import { generateIslands } from './worldgen.js';
import { installDev } from './dev.js';

const q = new URLSearchParams(location.search);

class App {
  constructor() {
    this.ui = new UI(this);
    try { this.settings = JSON.parse(localStorage.getItem('saltfire-settings') || '{}'); } catch { this.settings = {}; }
    this.game = null;
    window.SALT = { app: this, ready: false, get game() { return window.SALT.app.game; } };
    installDev(this);
  }
  setSetting(k, v) { this.settings[k] = v; try { localStorage.setItem('saltfire-settings', JSON.stringify(this.settings)); } catch { /* */ } }
  async boot() {
    this.id = await identity();
    if (q.get('pid')) this.id = { pid: q.get('pid'), name: this.id.name }; // tests: distinct players per tab
    const name = q.get('name') || this.id.name || '';
    const auto = q.get('auto');
    window.SALT.ready = true;
    if (auto === 'solo' || auto === 'host') return this.newWorld(name || 'Tester', auto === 'solo');
    if (auto === 'join') return this.join(q.get('code'), name || 'Guest');
    await this.showTitle(name);
  }
  async showTitle(name) {
    const worlds = await listWorlds();
    this.ui.title({
      name, worlds,
      onNew: (n) => this.newWorld(n),
      onContinue: (id, n) => this.continueWorld(id, n),
      onJoin: (code, n) => this.join(code, n),
      onDelete: async (id) => { await deleteWorld(id); this.showTitle(name); },
    });
  }
  async remember(name) { this.id.name = name; this.name = name; if (!q.get('pid')) await saveIdentity(this.id); }
  async newWorld(name, offline = false) {
    await this.remember(name);
    const seed = q.get('seed') ? +q.get('seed') : Math.floor(Math.random() * 1e9);
    const W = newWorld(seed);
    generateIslands(W);
    const rec = { id: uid('w'), name: `${name}'s Waters`, W, code: null };
    return this.host(rec, offline);
  }
  async continueWorld(id, name) {
    await this.remember(name);
    const rec = await loadWorld(id);
    if (!rec) { this.ui.status('World not found.'); return; }
    return this.host(rec, false);
  }
  async host(rec, offline) {
    this.ui.status('Raising the sails…');
    for (const p of Object.values(rec.W.players)) p.online = false; // nobody is connected yet
    let room = null;
    if (!offline) {
      try { room = await Room.host(rec.code); rec.code = room.code; }
      catch (e) { console.warn('hosting failed, playing offline', e); }
    }
    this.ui.status('');
    // the host's own captain
    this.game = new Game(this, { role: 'host', W: rec.W, room, pid: this.id.pid, rec });
    const fresh = this.game.fresh;
    this.game.save();
    if (room) this.game.ui.toast(`Your world is open! Room code ${room.code} — friends can join from the title screen.`, 'info', 8);
    else if (!offline) this.game.ui.toast('Could not reach the matchmaking server — playing offline.', 'bad', 6);
    if (fresh) setTimeout(() => this.game.ui.toast('Welcome, Captain! You were granted an island — open the map (M) and sail home, or explore. Press H for controls.', 'info', 10), 1200);
  }
  async join(code, name) {
    await this.remember(name);
    this.ui.status(`Looking for world ${code}…`);
    let room;
    try { room = await Room.join(code, { pid: this.id.pid, name }); }
    catch (e) { this.ui.status(e.message); if (!this.ui.root.querySelector('.title-screen')) await this.showTitle(name); this.ui.status(e.message); return; }
    const welcome = await new Promise((res) => {
      const to = setTimeout(() => res(null), 15000);
      room.onMessage = (_, m) => { if (m?.k === 'welcome') { clearTimeout(to); res(m); } };
    });
    if (!welcome) { this.ui.status('The host did not answer.'); room.close(); return; }
    welcome.W.npc = { id: 'npc', inv: { gold: 1e9 }, fleet: [] };
    this.ui.status('');
    this.game = new Game(this, { role: 'client', W: welcome.W, room, pid: welcome.pid, welcome });
    this.game.ui.toast(welcome.fresh ? 'Welcome aboard! The host granted you an island.' : 'Welcome back, Captain — your empire awaits.', 'good', 6);
  }
}

if (q.has('gallery')) gallery(q);
else new App().boot();
