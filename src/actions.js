// Host-side action handler: every player intent (from the local UI or a remote peer) goes through
// here, so the host stays authoritative for the economy, empire and diplomacy.
import { HAVEN_R, BUILDINGS, tierById } from './config.js';
import * as E from './economy.js';
import { baseRadius } from './basegeo.js';

export function dockSite(sim, s) {
  const W = sim.W;
  const port = W.islands.find((i) => i.kind === 'port');
  if (port && Math.hypot(s.x - port.x, s.z - port.z) < port.r + 150) return { kind: 'port', id: 'port', name: port.name };
  for (const b of W.bases) {
    const d = Math.hypot(s.x - b.x, s.z - b.z);
    if (d > baseRadius(b) + 110) continue;
    if (b.owner === s.pid) return { kind: 'base', id: b.id, name: b.name, own: true };
    if (!b.owner) return { kind: 'unclaimed', id: b.id, name: b.name };
    if (b.owner.startsWith('ai:')) continue;
    if (!b.buildings.some((x) => x.type === 'dock' && x.hp > 0)) continue;
    if (E.hostile(W, s.pid, b.owner) && !b.haven?.safe && !b.haven?.fee && !(b.haven?.allow || []).includes(s.pid)) continue;
    const acc = E.havenAccess(W, b, s.pid);
    if (acc.fee > 0 && !((b.paid?.[s.pid] || 0) > W.time)) return { kind: 'fee', id: b.id, name: b.name, fee: acc.fee };
    return { kind: 'base', id: b.id, name: b.name, own: false };
  }
  return null;
}

export function repairCost(s) {
  const mh = s.stats.hull - s.hull, ms = s.stats.sails - s.sails, mc = s.stats.crew - s.crew;
  return { gold: Math.ceil(mh * 0.35 + ms * 0.25 + mc * 3), oak: Math.ceil(mh * 0.03), canvas: Math.ceil(ms * 0.03) };
}

export function handleAct(sim, pid, a) {
  const W = sim.W;
  const p = W.players[pid];
  if (!p) return { err: 'Unknown captain' };
  const s = sim.ships.get('p:' + pid);
  const mark = () => { sim.dirty.prof.add(pid); sim.dirty.meta = true; };
  const docked = s?.docked;
  const atOwnBase = (id) => docked && docked.kind === 'base' && docked.id === id && W.bases.find((b) => b.id === id)?.owner === pid;
  const r = (err, data) => (err ? { err } : { ok: true, data });
  let err = null;
  switch (a.type) {
    case 'dock': {
      if (!s || s.sink > 0) return r('No ship');
      if (s.spd > 7) return r('Slow down to dock (reduce sail with S)');
      const site = dockSite(sim, s);
      if (!site) return r('No friendly harbour nearby');
      if (site.kind === 'fee') return r(`Pay the ${site.fee} gold entry fee first`);
      if (site.kind === 'unclaimed') return { ok: true, data: { unclaimed: site } };
      s.docked = site; s.spd = 0; s.sail = 0;
      mark();
      return { ok: true, data: site };
    }
    case 'undock': if (s) { s.docked = null; s.sail = 0.34; } mark(); return r();
    case 'repair': {
      if (!docked) return r('Dock first');
      const c = repairCost(s);
      if (!E.pay(p.inv, c)) return r(`Repairs cost ${E.costText(c)}`);
      s.hull = s.stats.hull; s.sails = s.stats.sails; s.crew = s.stats.crew; s.fire = 0;
      mark(); return r();
    }
    case 'craft': err = E.craft(p, a.kind, Math.max(1, Math.min(50, a.times | 0 || 1))); if (!err) E.addXp(p, 2); mark(); return r(err);
    case 'upgrade': {
      err = E.buyUpgrade(p, a.key);
      if (!err && s) { sim.refreshShip(s); }
      mark(); return r(err);
    }
    case 'buyShip': {
      if (!docked) return r('Visit a harbour to buy ships');
      const res = E.buyShip(p, a.tier, { name: a.name });
      if (typeof res === 'string') return r(res);
      E.addXp(p, 20); mark(); return r(null, res.uid);
    }
    case 'customShip': {
      if (!docked) return r('Dock at your shipyard');
      const res = E.buildCustomShip(W, p, docked.id, a.spec || {});
      if (typeof res === 'string') return r(res);
      E.addXp(p, 60); mark(); return r(null, res.uid);
    }
    case 'flagship': {
      if (!docked) return r('Change flagship while docked');
      err = E.setFlagship(p, a.uid);
      if (err) return r(err);
      const keep = { x: s.x, z: s.z, yaw: s.yaw, docked: s.docked };
      const ns = sim.spawnPlayer(pid); Object.assign(ns, keep); ns.local = s.local;
      mark(); return r();
    }
    case 'renameShip': { const sh = p.fleet.find((x) => x.uid === a.uid); if (!sh) return r('No ship'); sh.name = String(a.name || sh.name).slice(0, 24); mark(); return r(); }
    case 'claim': {
      if (!s) return r('No ship');
      const b = W.bases.find((x) => x.id === a.base);
      if (!b || Math.hypot(s.x - b.x, s.z - b.z) > baseRadius(b) + 140) return r('Sail closer to the island');
      err = sim.claim(pid, a.base, !W.bases.some((x) => x.owner === pid));
      mark(); return r(err);
    }
    case 'setHome': { const b = W.bases.find((x) => x.id === a.base && x.owner === pid); if (!b) return r('Not your base'); p.home = b.id; mark(); return r(); }
    case 'build': {
      if (!atOwnBase(a.base)) return r('Dock at this base to build');
      const res = E.build(W, p, a.base, a.btype, a.at);
      if (typeof res === 'string') return r(res);
      E.addXp(p, Math.round((BUILDINGS[a.btype].cost.gold || 100) / 25));
      mark(); return r(null, res.id);
    }
    case 'demolish': if (!atOwnBase(a.base)) return r('Dock at this base'); err = E.demolish(W, p, a.base, a.bid); mark(); return r(err);
    case 'repairBase': if (!atOwnBase(a.base)) return r('Dock at this base'); err = E.repairBase(W, p, a.base); mark(); return r(err);
    case 'haven': err = E.setHaven(W, p, a.base, a.cfg || {}); mark(); return r(err);
    case 'payFee': {
      const b = W.bases.find((x) => x.id === a.base);
      if (!b || !b.owner || b.owner.startsWith('ai:')) return r('No fee here');
      const acc = E.havenAccess(W, b, pid);
      if (!acc.fee) return r();
      if (p.inv.gold < acc.fee) return r('Not enough gold for the entry fee');
      p.inv.gold -= acc.fee;
      const o = W.players[b.owner]; if (o) { o.inv.gold += acc.fee; sim.dirty.prof.add(o.id); }
      b.paid ||= {}; b.paid[pid] = W.time + 1800;
      if (s) { s.trespass ||= {}; s.trespass[b.id] = false; if (s.feeT) s.feeT[b.id] = 0; }
      sim.msgs.push({ to: b.owner, text: `${p.name} paid ${acc.fee} gold to enter ${b.name}.`, kind: 'loot' });
      mark(); return r();
    }
    case 'order': { const res = E.placeOrder(W, pid, a.o || {}); mark(); return res.err ? r(res.err) : r(null, { fills: res.fills }); }
    case 'instantBuy': { const res = E.instantBuy(W, pid, a.item, a.qty | 0); mark(); return res.err ? r(res.err) : r(null, { fills: res.fills }); }
    case 'instantSell': { const res = E.instantSell(W, pid, a.item, a.qty | 0); mark(); return res.err ? r(res.err) : r(null, { fills: res.fills }); }
    case 'cancel': err = E.cancelOrder(W, pid, a.id); mark(); return r(err);
    case 'buyListing': { const res = E.buyListing(W, pid, a.id); mark(); return r(res.err); }
    case 'propose': err = E.propose(W, pid, a.to, a.ttype); if (!err) sim.msgs.push({ to: a.to, text: `${p.name} proposes a ${a.ttype} treaty — see Diplomacy.`, kind: 'info' }); mark(); return r(err);
    case 'answer': {
      const pr = W.proposals.find((x) => x.id === a.id);
      err = E.answer(W, pid, a.id, !!a.accept);
      if (!err && pr) sim.msgs.push({ to: pr.from, text: `${p.name} ${a.accept ? 'accepted' : 'rejected'} your ${pr.type} treaty.`, kind: a.accept ? 'good' : 'bad' });
      mark(); return r(err);
    }
    case 'alliance': err = E.setAlliance(W, p, a.name); mark(); return r(err);
    case 'harvest': if (s) s.harvest = !!a.on; return r();
    case 'ammo': if (s) s.ammo = a.ammo; return r();
    case 'rename': p.name = String(a.name || p.name).slice(0, 20); mark(); return r();
    default: return r('Unknown action ' + a.type);
  }
}
