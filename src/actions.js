// Host-side action handler: every player intent (from the local UI or a remote peer) goes through
// here, so the host stays authoritative for the economy, empire and diplomacy.
import { HAVEN_R, BUILDINGS, tierById, claimFee, FIELD_REPAIR, TRAILS } from './config.js';
import { DOCK_SPEED } from './sim.js';
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
    if (b.owner === 'ai:wild') return { kind: 'wild', id: b.id, name: b.name, fee: claimFee(W.bases.filter((x) => x.owner === s.pid).length), lvl: b.lvl || 1 };
    if (b.owner.startsWith('ai:')) return { kind: 'hold', id: b.id, name: b.name, clan: W.ai?.[b.owner]?.name || 'Pirates' };
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
      if (s.spd > DOCK_SPEED) return r('Slow down to dock (reduce sail with S)');
      const site = dockSite(sim, s);
      if (!site) return r('No friendly harbour nearby');
      if (site.kind === 'wild') return r(`Squatters hold ${site.name}: destroy their stockade, then hold position nearby to claim it (charter ${site.fee} gold).`);
      if (site.kind === 'hold') return r(`${site.name} is a fortress of ${site.clan}. Smash its keep, sink its defenders and hold position to conquer it.`);
      if (site.kind === 'fee') return r(`Pay the ${site.fee} gold entry fee first`);
      if (site.kind === 'unclaimed') return { ok: true, data: { unclaimed: site } };
      s.docked = site; s.spd = 0; s.sail = 0;
      mark();
      return { ok: true, data: site };
    }
    case 'undock': if (s) { s.docked = null; s.sail = 0.34; } mark(); return r();
    case 'seaRepair': {
      // carpenters patch the hull (and some canvas) with oak from the hold — works mid-battle
      if (!s || s.sink > 0) return r('No ship');
      if (docked) return r('You are docked — use the shipwright');
      const FR = FIELD_REPAIR;
      if ((s.repairT || 0) > sim.time) return r(`Carpenters are still at work (${Math.ceil(s.repairT - sim.time)}s)`);
      const missH = s.stats.hull - s.hull, missS = s.stats.sails - s.sails;
      if (missH < 1 && missS < 1 && !(s.fire > 0)) return r('Your ship needs no repairs');
      const wantH = Math.min(missH, s.stats.hull * FR.frac);
      const need = Math.max(FR.minOak, Math.ceil(wantH / FR.oakPer));
      const have = Math.floor(p.inv.oak || 0);
      if (have < FR.minOak) return r('No oak in the hold — harvest a Timber Islet (F) or buy oak in port');
      const k = Math.min(1, have / need), oak = Math.min(have, need);
      s.hull = Math.min(s.stats.hull, s.hull + wantH * k);
      s.sails = Math.min(s.stats.sails, s.sails + s.stats.sails * FR.sails * k);
      s.fire = 0;
      p.inv.oak -= oak;
      s.repairT = sim.time + FR.cd;
      sim.fx.push({ t: 'repair', ship: s.id, x: s.x, z: s.z });
      mark(); return r(null, { oak, hull: Math.round(wantH * k), cd: FR.cd });
    }
    case 'buyTrail': {
      const T = TRAILS[a.id];
      if (!T) return r('Unknown trail');
      p.trails ||= ['foam'];
      if (p.trails.includes(a.id)) return r('You already own that trail');
      if ((p.inv.gold || 0) < T.cost) return r(`Needs ${T.cost} gold`);
      p.inv.gold -= T.cost; p.trails.push(a.id);
      p.trail = a.id; if (s) s.look = { ...(s.look || {}), trail: a.id };
      mark(); return r();
    }
    case 'setTrail': {
      p.trails ||= ['foam'];
      if (!TRAILS[a.id] || !p.trails.includes(a.id)) return r('You don\'t own that trail');
      p.trail = a.id; if (s) s.look = { ...(s.look || {}), trail: a.id };
      mark(); return r();
    }
    case 'repair': {
      if (!docked) return r('Dock first');
      const c = repairCost(s);
      if (!E.pay(p.inv, c)) return r(`Repairs cost ${E.costText(c)}`);
      s.hull = s.stats.hull; s.sails = s.stats.sails; s.crew = s.stats.crew; s.fire = 0;
      mark(); return r();
    }
    case 'craft': err = E.craft(p, a.kind, Math.max(1, Math.min(50, a.times | 0 || 1))); if (!err) E.addXp(p, 2); mark(); return r(err);
    case 'upgrade': {
      err = E.buyUpgrade(p, a.key, a.n || 1);
      if (!err && s) { sim.refreshShip(s); }
      if (!err) for (const f of sim.ships.values()) if (f.role === 'fleet' && f.owner === pid) sim.refreshShip(f);
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
    case 'deploy': err = sim.deployFleet(pid, a.uid, { mode: a.mode, base: a.base }); mark(); return r(err);
    case 'deployAll': {
      const idle = p.fleet.filter((x) => x.uid !== p.flag && !x.wrecked && !tierById(x.tier).flagshipOnly && (a.redirect || !x.out));
      if (!idle.length) return r('No ships available — buy or build more ships, or repair wrecks');
      let n = 0, last = null;
      for (const x of idle) { const e = sim.deployFleet(pid, x.uid, { mode: a.mode, base: a.base }); if (e) last = e; else n++; }
      mark(); return n ? r(null, n) : r(last);
    }
    case 'recall': err = sim.recallFleet(pid, a.uid); mark(); return r(err);
    case 'recallAll': for (const x of p.fleet) if (x.out) sim.recallFleet(pid, x.uid); mark(); return r();
    case 'repairFleet': {
      if (!docked) return r('Dock in a harbour to repair ships');
      const sh = p.fleet.find((x) => x.uid === a.uid);
      if (!sh || (!sh.wrecked && sh.hp == null)) return r('Nothing to repair');
      const T = tierById(sh.tier);
      const st = E.shipStats(sh, p.upg);
      const miss = st.hull - (sh.hp ?? st.hull);
      const c = { gold: Math.ceil(miss * 0.45 + (sh.wrecked ? T.hull * 0.2 : 0)), oak: Math.ceil(miss * 0.04) };
      if (!E.pay(p.inv, c)) return r(`Repairs cost ${E.costText(c)}`);
      sh.wrecked = false; sh.hp = null;
      mark(); return r();
    }
    case 'renameShip': { const sh = p.fleet.find((x) => x.uid === a.uid); if (!sh) return r('No ship'); sh.name = String(a.name || sh.name).slice(0, 24); mark(); return r(); }
    case 'claim': {
      if (!s) return r('No ship');
      const b = W.bases.find((x) => x.id === a.base);
      if (!b || Math.hypot(s.x - b.x, s.z - b.z) > baseRadius(b) + 140) return r('Sail closer to the island');
      if (b.owner && b.owner !== 'ai:wild') return r('Island already claimed');
      if (b.owner === 'ai:wild' && W.bases.some((x) => x.owner === pid)) return r('Squatters hold this island — destroy their stockade and hold position to claim it');
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
