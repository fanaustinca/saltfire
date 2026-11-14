// Pure logic tests (node): economy, market + tax, crafting, upgrades, shipyard, bases, sim combat,
// sinking/loot/XP, safe havens, offline shields, conquest, events, diplomacy.
import * as E from '../src/economy.js';
import { Sim, joinPlayer, solveElev, arcOf } from '../src/sim.js';
import { handleAct } from '../src/actions.js';
import { generateIslands } from '../src/worldgen.js';
import * as CFG from '../src/config.js';
import { TIERS, MARKET_TAX, BUILDINGS, GRAVITY, MUZZLE, UPGRADE_TOTAL, claimFee, BASE_RELOAD, TRAILS } from '../src/config.js';
import { setCalm, heightAt } from '../src/waves.js';
import { gunLayout } from '../src/layout.js';
import { buildingPos, baseShape, dockAngle, harborPoint, baseRadius } from '../src/basegeo.js';

let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const world = (seed = 42) => { const W = E.newWorld(seed); generateIslands(W); return W; };
const rng = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

T('ship tiers match the spec cannon counts', () => {
  const want = { sloop: 1, schooner: 1, brigantine: 2, xebec: 3, frigate: 3, junk: 4, galleon: 5, manowar: 10, sovereign: 16, leviathan: 30, ghost: 9, harvest: 16, yule: 16, midnight: 18, collector: 14, titan: 120 };
  for (const t of TIERS) ok(t.side === want[t.id], t.id);
  for (const t of TIERS) { const st = E.shipStats(E.shipSpec(t.id)); const g = gunLayout(st); ok(g.filter((x) => x.side === 'L').length === t.side && g.filter((x) => x.side === 'R').length === t.side, 'layout ' + t.id); }
});
T('upgrades add chasers + side guns within the tier limit', () => {
  const st = E.shipStats(E.shipSpec('sloop'), { bow: 2, stern: 1, side: 3 });
  const g = gunLayout(st);
  ok(g.filter((x) => x.side === 'bow').length === 2 && g.filter((x) => x.side === 'stern').length === 1);
  ok(st.side === 2, 'sloop capped at maxSide 2: ' + st.side);
});
T('ballistic solution lands where aimed', () => {
  for (const d of [40, 120, 250]) {
    const el = solveElev(d, -2);
    const vx = MUZZLE * Math.cos(el), vy = MUZZLE * Math.sin(el);
    let x = 0, y = 2, t = 0; const dt = 1 / 600; let vyy = vy;
    while (y > 0 || t === 0) { vyy -= GRAVITY * dt; x += vx * dt; y += vyy * dt; t += dt; }
    ok(Math.abs(x - d) < 1.5, `d=${d} landed ${x.toFixed(1)}`);
  }
});
T('crew loss slows reload and steering', () => { ok(E.crewEff(100, 100) === 1); ok(E.crewEff(50, 100) < 0.8); ok(E.crewEff(10, 100) < 0.35); });
T('xp levels grant upgrade points', () => {
  const p = E.newProfile('a', 'A'); const ups = E.addXp(p, 5000); ok(ups > 3 && p.points === ups);
  ok(E.buyUpgrade(p, 'reload') === null && p.upg.reload === 1);
  p.points = 0; ok(E.buyUpgrade(p, 'hull') !== null);
});
T('crafting specialty ammo consumes materials', () => {
  const p = E.newProfile('a'); p.inv.iron = 10; p.inv.canvas = 5; p.inv.chain = 0;
  ok(E.craft(p, 'chain', 2) === null && p.inv.chain === 20 && p.inv.iron === 4 && p.inv.canvas === 3);
  ok(E.craft(p, 'explosive', 5) !== null, 'not enough powder');
});
T('market: limit orders match at maker price with 5% tax', () => {
  const W = world(); const a = W.players.a = E.newProfile('a'); const b = W.players.b = E.newProfile('b');
  a.inv.oak = 100; b.inv.gold = 10000; b.inv.oak = 0; const g0 = a.inv.gold;
  const s1 = E.placeOrder(W, 'a', { side: 'sell', item: 'oak', qty: 50, price: 10 });
  ok(!s1.err && a.inv.oak === 50 && W.market.length === 1);
  const r2 = E.placeOrder(W, 'b', { side: 'buy', item: 'oak', qty: 30, price: 12 });
  ok(r2.fills.length === 1 && r2.fills[0].px === 10, 'filled at maker price');
  ok(b.inv.oak === 30, 'buyer got oak');
  ok(b.inv.gold === 10000 - 300, 'buyer paid 300 (refund of improvement) ' + b.inv.gold);
  ok(a.inv.gold === g0 + 300 - Math.ceil(300 * MARKET_TAX), 'seller got 285');
  ok(W.market[0].qty === 20);
  ok(E.cancelOrder(W, 'a', W.market[0].id) === null && a.inv.oak === 70);
});
T('market: instant buy sweeps listings; ships can be listed + bought', () => {
  const W = world(); E.npcRestock(W, rng(3));
  const p = W.players.p = E.newProfile('p'); p.inv.gold = 100000;
  const r = E.instantBuy(W, 'p', 'iron', 40); ok(!r.err && p.inv.iron >= 50, JSON.stringify(r.err) + p.inv.iron);
  const q = W.players.q = E.newProfile('q'); q.fleet.push(E.shipSpec('schooner', { name: 'Seller' }));
  const sh = q.fleet[1]; const lr = E.placeOrder(W, 'q', { side: 'sell', item: 'ship', shipUid: sh.uid, price: 900 });
  ok(!lr.err && q.fleet.length === 1);
  ok(E.placeOrder(W, 'q', { side: 'sell', item: 'ship', shipUid: q.flag, price: 9 }).err, 'cannot sell flagship');
  const b = E.buyListing(W, 'p', lr.order.id); ok(!b.err && p.fleet.some((s) => s.name === 'Seller'));
});
T('custom shipyard respects tier limits and costs', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(2) }); const { p } = joinPlayer(sim, 'u', 'U');
  const base = W.bases.find((b) => b.owner === 'u'); ok(base, 'got a free island');
  p.level = 10; p.inv = { ...p.inv, gold: 1e6, oak: 1e5, iron: 1e5, canvas: 1e5 };
  const g0 = p.inv.gold; ok(typeof E.buildCustomShip(W, p, base.id, { tier: 'frigate', side: 5 }) === 'object', 'works without a shipyard');
  const full = g0 - p.inv.gold;
  ok(typeof E.buildCustomShip(W, p, 'port', { tier: 'frigate', side: 5 }) === 'object', 'and at the Free Port');
  ok(typeof E.buildCustomShip(W, p, W.bases.find((b) => b.owner !== 'u').id, { tier: 'frigate', side: 5 }) === 'string', 'not on someone else\'s island');
  ok(typeof E.build(W, p, base.id, 'dock') === 'object'); ok(typeof E.build(W, p, base.id, 'shipyard') === 'object');
  const g1 = p.inv.gold; E.buildCustomShip(W, p, base.id, { tier: 'frigate', side: 5 }); ok(g1 - p.inv.gold < full, 'shipyard discount');
  const s = E.buildCustomShip(W, p, base.id, { tier: 'frigate', side: 99, size: 1.2, name: 'Vengeance', hullColor: '#223344' });
  ok(typeof s === 'object' && s.side === 8 && s.size === 1.2 && s.custom && s.name === 'Vengeance');
  ok(typeof E.buildCustomShip(W, p, base.id, { tier: 'manowar', side: 10 }) === 'string', 'level gate');
});
T('base growth: buildings enlarge the island', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(4) }); const { p } = joinPlayer(sim, 'u', 'U');
  const b = W.bases.find((x) => x.owner === 'u'); p.inv.gold = 1e6; p.inv.oak = 1e5; p.inv.iron = 1e5;
  const g0 = E.baseGrowth(b);
  for (const t of ['dock', 'lumber', 'mine', 'loft', 'watchtower', 'warehouse']) ok(typeof E.build(W, p, b.id, t) === 'object', t);
  ok(E.baseGrowth(b) > g0 + 0.3);
  ok(typeof E.build(W, p, b.id, 'cannon', 1.5) === 'object' && b.buildings.at(-1).slot === 1.5, 'positioned cannon');
  const oak0 = p.inv.oak; E.produce(W, 61); ok(p.inv.oak > oak0, 'lumber produces');
});
T('combat: broadside hits a ship in the sector and sinks it for loot + XP', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(5) }); joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.local = true; me.x = 1200; me.z = 1200; me.yaw = 0; me.docked = null;
  sim.ships.forEach((s) => { if (s !== me) sim.removeShip(s.id); });
  sim.aiDensity = 0;
  const foe = sim.addShip({ owner: 'ai:pirates', role: 'pirate', spec: E.shipSpec('sloop'), x: me.x + 80, z: me.z, yaw: 0, ai: { skill: 0 } });
  foe.ai = null; foe.sail = 0;
  const arc = arcOf(me, foe.x, foe.z); ok(arc.side === 'L' && arc.inSector, JSON.stringify(arc));
  ok(sim.planBroadside(me, 'R', foe.x, foe.z).err, 'wrong side rejected');
  let shots = 0; const xp0 = W.players.u.xp + W.players.u.level * 1e6;
  for (let i = 0; i < 60 * 120 && foe.sink === 0; i++) { if (me.reload.L <= 0) { const r = sim.fire(me, 'L', foe.x, foe.z); if (!r.err) shots++; } sim.step(1 / 60); }
  ok(foe.sink > 0, `sank after ${shots} broadsides (hull ${foe.hull})`);
  ok(sim.crates.length >= 1, 'loot crate');
  ok(W.players.u.xp + W.players.u.level * 1e6 > xp0, 'xp');
});
T('ammo types: grapeshot kills crew, chainshot shreds sails', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(6) });
  const t = sim.addShip({ owner: 'ai:pirates', role: 'pirate', spec: E.shipSpec('frigate'), x: 0, z: 2000 });
  const c0 = t.crew, s0 = t.sails;
  sim.ballHitShip({ ammo: 'grape', dmg: 30, owner: 'x', level: 1 }, t, false);
  const dc = c0 - t.crew; const t2 = sim.addShip({ owner: 'ai:pirates', role: 'pirate', spec: E.shipSpec('frigate'), x: 0, z: 1900 });
  sim.ballHitShip({ ammo: 'chain', dmg: 30, owner: 'x', level: 1 }, t2, false);
  ok(dc >= 3, 'crew loss ' + dc); ok(s0 - t2.sails > 30, 'sail loss ' + (s0 - t2.sails));
});
T('safe haven blocks firing; offline owners are shielded', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(7) }); joinPlayer(sim, 'u', 'U'); joinPlayer(sim, 'v', 'V');
  const me = sim.spawnPlayer('u'); me.x = 30; me.z = 30; me.docked = null;
  ok(sim.planBroadside(me, 'L', me.x + 60, me.z).err.includes('haven'));
  W.players.v.online = false;
  ok(E.shielded(W, 'v') && !E.shielded(W, 'u'));
  const vb = W.bases.find((b) => b.owner === 'v'); const keep = vb.buildings[0]; const hp = keep.hp;
  const p = buildingPos(vb, keep);
  sim.hitBuilding({ x: p.x, y: p.y + 3, z: p.z, owner: 'u', ammo: 'ball', dmg: 30 }); ok(keep.hp === hp, 'shielded keep undamaged');
  W.players.v.online = true; sim.hitBuilding({ x: p.x, y: p.y + 3, z: p.z, owner: 'u', ammo: 'ball', dmg: 30 }); ok(keep.hp < hp, 'online keep damaged');
});
T('treaties and alliances stop hostility', () => {
  const W = world(); W.players.a = E.newProfile('a'); W.players.b = E.newProfile('b');
  ok(E.hostile(W, 'a', 'b'));
  ok(E.propose(W, 'a', 'b', 'peace') === null); ok(E.answer(W, 'b', W.proposals[0].id, true) === null);
  ok(!E.hostile(W, 'a', 'b')); E.propose(W, 'a', 'b', 'war'); ok(E.hostile(W, 'a', 'b'));
  W.players.a.alliance = W.players.b.alliance = 'Red Tide'; ok(!E.hostile(W, 'a', 'b'));
  ok(E.hostile(W, 'a', 'ai:merchant') && E.hostile(W, 'a', 'ai:pirates'), 'captains may plunder merchants');
  ok(E.hostile(W, 'ai:pirates', 'ai:merchant') && E.hostile(W, 'ai:navy', 'ai:pirates') && !E.hostile(W, 'ai:navy', 'ai:merchant'), 'AI factions');
  ok(E.hostile(W, 'ai:clan:0', 'ai:clan:1') && E.hostile(W, 'ai:clan:0', 'ai:pirates') && E.hostile(W, 'ai:clan:0', 'ai:wild'), 'clans fight everyone');
});
T('entry fee: paying credits the owner; refusing makes you a trespasser', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(8) }); joinPlayer(sim, 'o', 'Owner'); joinPlayer(sim, 'v', 'Visitor');
  const b = W.bases.find((x) => x.owner === 'o'); E.setHaven(W, W.players.o, b.id, { safe: true, fee: 50 });
  sim.aiDensity = 0;
  const vs = sim.spawnPlayer('v'); vs.x = b.x + 120; vs.z = b.z; vs.docked = null; vs.local = true; vs.sail = 0;
  for (let i = 0; i < 60 * 22; i++) sim.step(1 / 60);
  ok(sim.prompts.some((p) => p.kind === 'fee' && p.to === 'v'), 'prompted');
  ok(vs.trespass[b.id], 'trespasser after 20s');
  const g = W.players.o.inv.gold; ok(!handleAct(sim, 'v', { type: 'payFee', base: b.id }).err); ok(W.players.o.inv.gold === g + 50 && !vs.trespass[b.id]);
});
T('conquest: destroy the keep and hold position to capture', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(9) }); joinPlayer(sim, 'u', 'U');
  sim.aiDensity = 0;
  const hold = W.bases.find((b) => b.hold);
  hold.buildings.forEach((bd) => { bd.hp = 0; }); hold.hitT = 0;
  const me = sim.spawnPlayer('u'); me.x = hold.x + hold.r + 60; me.z = hold.z; me.docked = null; me.local = true; me.sail = 0;
  for (let i = 0; i < 60 * 14; i++) sim.step(1 / 60);
  ok(hold.owner === 'u', 'captured: ' + hold.owner);
});
T('AI: lots of small fry plus level-matched heavies up to your tier', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(10) }); const { p } = joinPlayer(sim, 'u', 'U'); p.level = 30;
  const me = sim.spawnPlayer('u'); me.x = 1500; me.z = -900; me.docked = null; me.local = true;
  p.fleet[0] = E.shipSpec('manowar'); p.flag = p.fleet[0].uid; sim.spawnPlayer('u'); const m2 = sim.ships.get('p:u'); m2.x = 3000; m2.z = 3000; m2.local = true;
  for (let i = 0; i < 60 * 12; i++) sim.step(1 / 60);
  const ai = [...sim.ships.values()].filter((s) => !s.pid && !s.tag && Math.hypot(s.x - m2.x, s.z - m2.z) < 1600);
  ok(ai.length >= 12, 'busy seas: ' + ai.length);
  const tiers = ai.map((a) => a.spec.tier);
  ok(tiers.filter((t) => t === 'sloop' || t === 'schooner').length >= 4, 'small fry ' + tiers);
  ok(tiers.some((t) => ['frigate', 'galleon', 'manowar'].includes(t)), 'heavies ' + tiers);
  ok(ai.filter((a) => ['frigate', 'galleon', 'manowar'].includes(a.spec.tier)).every((a) => Math.abs(a.level - 30) <= 3), 'heavies level-matched');
});
T('AI ships fight each other (pirates vs navy and merchants)', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(21) }); sim.aiDensity = 0;
  const pir = sim.spawnAI(10, { x: 2600, z: -2600 }, { role: 'pirate', tier: 'frigate', dist: 1, strong: true });
  const nav = sim.spawnAI(10, pir, { role: 'navy', tier: 'frigate', dist: 160, strong: true });
  ok(pir && nav, 'spawned');
  const h0 = pir.hull + nav.hull;
  for (let i = 0; i < 60 * 60 && pir.sink === 0 && nav.sink === 0; i++) sim.step(1 / 60);
  ok(pir.hull + nav.hull < h0 - 50, 'they traded broadsides: ' + (h0 - pir.hull - nav.hull));
});
T('man of war carries up to 20 guns a side; ~230 upgrade ranks to spend', () => {
  const st = E.shipStats(E.shipSpec('manowar'), { side: 10 });
  ok(st.side === 20 && gunLayout(st).filter((g) => g.side === 'L').length === 20, 'side ' + st.side);
  ok(E.shipStats(E.shipSpec('manowar'), { side: 50 }).side === 20, 'capped at 20');
  ok(E.shipStats(E.shipSpec('manowar'), { side: 20 }).side === 20, 'MoW still capped at 20 with 20 ranks');
  ok(UPGRADE_TOTAL >= 199, 'ranks ' + UPGRADE_TOTAL);
  const p = E.newProfile('a'); p.points = 30; ok(E.buyUpgrade(p, 'speed', 30) === null && p.upg.speed === 25 && p.points === 5, 'bulk buy caps at max');
  const fast = E.shipStats(E.shipSpec('sloop'), { speed: 25, range: 15, reload: 20 });
  const base = E.shipStats(E.shipSpec('sloop'));
  ok(fast.speed > base.speed * 1.5 && fast.range > base.range * 1.4 && fast.reload < base.reload * 0.6 && fast.muzzle > base.muzzle);
  ok(TIERS.find((t) => t.id === 'manowar').speed >= 14 && TIERS[0].speed >= 20, 'ships are faster');
});
T('waves calm down near islands', () => {
  setCalm([{ x: 0, z: 0, r: 100 }]);
  let near = 0, far = 0;
  for (let t = 0; t < 20; t += 0.5) { near = Math.max(near, Math.abs(heightAt(110, 0, t))); far = Math.max(far, Math.abs(heightAt(900, 0, t))); }
  setCalm([]);
  ok(near < far * 0.5, `near ${near.toFixed(2)} far ${far.toFixed(2)}`);
});
T('island coves: the bay is open water, the hills are land', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(22) });
  const b = W.bases.find((x) => x.owner === 'ai:wild'); const S = baseShape(b); const a = dockAngle(b);
  ok(S.edge(a) < S.R * 0.75, 'bay cuts in: ' + (S.edge(a) / S.R).toFixed(2));
  const bx = b.x + Math.cos(a) * S.R * 0.85, bz = b.z + Math.sin(a) * S.R * 0.85;
  ok(sim.groundAt(bx, bz) == null, 'inside the bay is water');
  ok(sim.groundAt(b.x, b.z) > 1, 'centre is land');
  const h = harborPoint(b, 74); ok(sim.groundAt(h.x, h.z) == null, 'harbour point afloat');
});
T('wild islands: squatters fight back; claiming costs a charter that grows', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(23) }); const { p } = joinPlayer(sim, 'u', 'U'); sim.aiDensity = 0;
  ok(W.bases.filter((b) => b.owner === 'ai:wild').length > 40, 'many wild islands');
  ok(claimFee(1) < claimFee(3) && claimFee(3) < claimFee(8), 'charter grows');
  const wild = W.bases.filter((b) => b.owner === 'ai:wild').sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z))[0];
  ok(wild.buildings.filter((x) => x.type === 'cannon').length >= 3, 'far islands are well defended');
  wild.buildings.forEach((x) => { x.hp = 0; }); wild.hitT = 1e9;
  const me = sim.spawnPlayer('u'); const h = harborPoint(wild, 16); me.x = h.x; me.z = h.z; me.docked = null; me.local = true; me.sail = 0;
  p.inv.gold = 10;
  for (let i = 0; i < 60 * 14; i++) sim.step(1 / 60);
  ok(wild.owner === 'ai:wild', 'no charter money, no claim');
  p.inv.gold = 50000;
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  ok(wild.owner === 'u' && p.inv.gold < 50000, 'claimed after paying: ' + wild.owner);
  ok(wild.buildings.some((x) => x.type === 'keep'), 'stockade became a keep');
});
T('fleet: send a ship to attack an island; it bombards and captures', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(24) }); const { p } = joinPlayer(sim, 'u', 'U'); sim.aiDensity = 0;
  p.inv.gold = 1e5; p.level = 30; p.fleet.push(E.shipSpec('frigate', { name: 'Avenger' }));
  const me = sim.spawnPlayer('u'); me.local = true; me.sail = 0;
  const home = sim.homeOf('u');
  const tgt = W.bases.filter((b) => b.owner === 'ai:wild').sort((a, b) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(b.x - home.x, b.z - home.z))[0];
  ok(sim.deployFleet('u', p.fleet[0].uid, { mode: 'attack', base: tgt.id }), 'flagship cannot deploy');
  ok(!sim.deployFleet('u', p.fleet[1].uid, { mode: 'attack', base: tgt.id }), 'deployed');
  const f = sim.ships.get('f:' + p.fleet[1].uid); ok(f && f.owner === 'u' && p.fleet[1].out);
  f.x = tgt.x + Math.cos(dockAngle(tgt)) * (baseRadius(tgt) + 160); f.z = tgt.z + Math.sin(dockAngle(tgt)) * (baseRadius(tgt) + 160);
  const hp0 = tgt.buildings.reduce((a, b) => a + b.hp, 0);
  for (let i = 0; i < 60 * 240 && tgt.owner !== 'u' && f.sink === 0; i++) { f.hull = f.stats.hull; sim.step(1 / 60); }
  ok(tgt.buildings.reduce((a, b) => a + b.hp, 0) < hp0 || tgt.owner === 'u', 'buildings damaged');
  ok(tgt.owner === 'u', 'fleet captured the island: ' + tgt.owner + ' core hp ' + tgt.buildings.find((x) => x.type === 'camp' || x.type === 'keep')?.hp);
  ok(!sim.recallFleet('u', p.fleet[1].uid));
  E.setFlagship(p, p.fleet[1].uid) && ok(true);
});
T('clans fortify their holds, buying materials on the market', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(25) }); E.npcRestock(W, rng(2));
  const clan = Object.values(W.ai).find((c) => c.clan); const base = W.bases.find((b) => b.id === clan.base);
  ok(base.owner === clan.id && base.hold, 'clan owns its hold');
  clan.inv = { gold: 50000, oak: 0, iron: 0, canvas: 0, powder: 0 };
  const n0 = base.buildings.length, t0 = W.trades.length;
  for (let i = 0; i < 6; i++) sim.clanEconomy(clan);
  ok(base.buildings.length > n0, 'built: ' + n0 + ' -> ' + base.buildings.length);
  ok(W.trades.slice(t0).some((t) => t.buyer === clan.id), 'bought on the market');
  // the guild trades too
  W.ai['ai:merchant'].inv.oak = 500; sim.guildEconomy(); ok(W.market.some((o) => o.owner === 'ai:merchant'), 'guild lists cargo');
});
T('kraken is a fair fight now', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(26) }); joinPlayer(sim, 'u', 'U'); const me = sim.spawnPlayer('u'); me.local = true;
  sim.startEvent('kraken'); ok(sim.kraken.maxHp < 2000, 'hp ' + sim.kraken.maxHp);
});
T('world events: kraken, treasure fleet, raid', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(11) }); joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.local = true;
  sim.startEvent('kraken'); ok(sim.kraken && sim.kraken.hp > 0);
  sim.startEvent('treasure'); ok([...sim.ships.values()].some((s) => s.tag === 'treasure'));
  sim.startEvent('raid'); ok([...sim.ships.values()].filter((s) => s.tag === 'raider').length === 3);
  sim.kraken.hp = 1; sim.hitKraken({ x: sim.kraken.x, y: 2, z: sim.kraken.z, owner: 'u', ammo: 'ball', dmg: 30 }); ok(sim.kraken.hp <= 0 && sim.crates.some((c) => c.big));
});
T('actions: dock at the Free Port, repair, buy ship, craft, upgrade', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(12) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 150; me.z = 0; me.spd = 0; me.docked = null;
  me.hull -= 50; const d = handleAct(sim, 'u', { type: 'dock' }); ok(!d.err && me.docked.kind === 'port', d.err);
  ok(!handleAct(sim, 'u', { type: 'repair' }).err && me.hull === me.stats.hull);
  p.level = 3; p.inv.gold = 1e5; p.inv.oak = 1e3; p.inv.iron = 1e3; p.inv.canvas = 1e3;
  const b = handleAct(sim, 'u', { type: 'buyShip', tier: 'schooner' }); ok(!b.err, b.err);
  ok(!handleAct(sim, 'u', { type: 'flagship', uid: b.data }).err && sim.ships.get('p:u').spec.tier === 'schooner');
  ok(handleAct(sim, 'u', { type: 'buyShip', tier: 'manowar' }).err.includes('level'));
  p.points = 1; ok(!handleAct(sim, 'u', { type: 'upgrade', key: 'bow' }).err && sim.ships.get('p:u').stats.bow === 1);
});
T('save round-trip: world JSON survives serialisation', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(13) }); joinPlayer(sim, 'u', 'U'); E.npcRestock(W, rng(1));
  const W2 = JSON.parse(JSON.stringify(W)); ok(W2.players.u && W2.bases.length === W.bases.length && W2.market.length === W.market.length);
});
T('leviathan: flagship-only ship of the line; cannon limit grows with hull size (30 @85% .. 60 @120%)', () => {
  const at = (size) => E.shipStats(E.shipSpec('leviathan', { size }), { side: 30 });
  ok(at(0.85).side === 30 && at(1.2).side === 60 && at(1).side > 40 && at(1).side < 50, `sides ${at(0.85).side}/${at(1).side}/${at(1.2).side}`);
  const lv = at(1.2);
  ok(gunLayout(lv).filter((g) => g.side === 'L').length === 60, 'all 60 mounted');
  ok(E.shipSpec('leviathan', { side: 99, size: 0.85 }).side === 30, 'shipyard clamps to the size limit');
  ok(E.shipStats(E.shipSpec('frigate', { size: 1.2 }), { side: 30 }).side === 8 && E.shipStats(E.shipSpec('frigate', { size: 0.85 }), { side: 30 }).side === 6, 'other tiers scale too');
  const mow = E.shipStats(E.shipSpec('manowar'));
  ok(lv.hull > mow.hull * 2.5 && lv.armor < 0.7 && lv.len > mow.len * 1.4, 'tougher + bigger');
  // guns never sit under water, even on the lowest of the four decks
  ok(gunLayout(lv).every((g) => g.y > 2.5), 'gun decks above the waterline');
  const W = world(); const sim = new Sim(W, { rand: rng(31) }); const { p } = joinPlayer(sim, 'u', 'U');
  p.level = 60; p.inv = { gold: 1e7, oak: 1e6, iron: 1e6, canvas: 1e6, powder: 1e5 };
  const me = sim.spawnPlayer('u'); me.x = 150; me.z = 0; me.spd = 0; handleAct(sim, 'u', { type: 'dock' });
  const b = handleAct(sim, 'u', { type: 'buyShip', tier: 'leviathan' }); ok(!b.err, b.err);
  ok(sim.deployFleet('u', b.data, { mode: 'escort' }).includes('flagship'), 'cannot sail in a fleet');
  ok(!handleAct(sim, 'u', { type: 'flagship', uid: b.data }).err && sim.ships.get('p:u').spec.tier === 'leviathan', 'but can be your flagship');
  // AI captains never get one, even around a Leviathan
  const lead = sim.ships.get('p:u'); lead.docked = null; lead.x = 2500; lead.z = 2500;
  for (let i = 0; i < 80; i++) { const s = sim.spawnAI(200, lead, { strong: true }); if (s) ok(s.spec.tier !== 'leviathan', 'AI leviathan'); }
});
T('sovereign sits between man of war and leviathan; titan only comes as a reward card', () => {
  const ids = TIERS.map((t) => t.id);
  ok(ids.indexOf('manowar') < ids.indexOf('sovereign') && ids.indexOf('sovereign') < ids.indexOf('leviathan'), 'order');
  const sv = E.shipStats(E.shipSpec('sovereign')), mow = E.shipStats(E.shipSpec('manowar')), lv = E.shipStats(E.shipSpec('leviathan'));
  ok(sv.hull > mow.hull && sv.hull < lv.hull && sv.side > mow.side && sv.side < lv.side && sv.len > mow.len && sv.len < lv.len, 'in between');
  ok(gunLayout(E.shipStats(E.shipSpec('sovereign', { size: 1.2 }), { side: 40 })).every((g) => g.y > 1.2), 'sovereign gun decks dry');
  const tier = (id) => TIERS.find((t) => t.id === id);
  ok(!tier('sovereign').flagshipOnly, 'sovereign can sail in a fleet');
  ok(tier('sovereign').cost.gold >= 20 * tier('manowar').cost.gold && tier('leviathan').cost.gold >= 4 * tier('sovereign').cost.gold, 'top tiers are very expensive');
  ok(lv.beam / lv.len > 0.27 && lv.beam / lv.len < 0.33, 'leviathan broad but not a barge');
  const W = world(); const sim = new Sim(W, { rand: rng(33) }); const { p } = joinPlayer(sim, 'u', 'U');
  p.level = 200; p.inv = { gold: 1e7, oak: 1e6, iron: 1e6, canvas: 1e6, powder: 1e5 };
  const me = sim.spawnPlayer('u'); me.x = 150; me.z = 0; me.spd = 0; handleAct(sim, 'u', { type: 'dock' });
  ok(handleAct(sim, 'u', { type: 'buyShip', tier: 'titan' }).err, 'titan cannot be bought');
  const sb = handleAct(sim, 'u', { type: 'buyShip', tier: 'sovereign' }); ok(!sb.err, 'sovereign can');
  ok(!sim.deployFleet('u', sb.data, { mode: 'escort' })?.includes?.('flagship'), 'sovereign deploys');
  const c = E.addCard(p, { kind: 'ship', tier: 'titan' });
  const tb = handleAct(sim, 'u', { type: 'buyShip', tier: 'titan', card: c.id }); ok(!tb.err, tb.err);
  ok(!(p.cards || []).length, 'card used up');
  const ti = p.fleet.find((x) => x.uid === tb.data); p.flag = ti.uid; const s = sim.spawnPlayer('u'); s.docked = null;
  const st = s.stats;
  ok(st.speed * 1.94 >= 28 && st.speed * 1.94 <= 42, 'titan ~30-40 kn: ' + (st.speed * 1.94).toFixed(1));
  ok(st.hull > lv.hull && st.hull < 60000 && !st.invincible, 'titan has a real hull');
  sim.hurt(s, 1e6, 0, 0, 'x'); ok(s.sink > 0, 'and can be sunk');
  // custom Titan: a card pays for the hull; above 100% needs a Titan Size card
  const c2 = E.addCard(p, { kind: 'ship', tier: 'titan' });
  ok(typeof E.buildCustomShip(W, p, 'port', { card: c2.id, size: 1.2, side: 150 }) === 'string', 'size card needed');
  E.addCard(p, { kind: 'titanSize' });
  const big = E.buildCustomShip(W, p, 'port', { card: c2.id, size: 1.2, side: 150 });
  ok(typeof big === 'object' && big.side === 150 && big.size === 1.2 && !(p.cards || []).length, 'big titan built, both cards used');
  const gold = p.inv.gold; ok(typeof E.buyTitanSizeCard(p) === 'object' && gold - p.inv.gold >= 1e6, 'size card for a lot of gold');
});
T('wheel of fortune: one free spin a day, paid spins, odds, ships arrive as cards', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(35) }); const { p } = joinPlayer(sim, 'u', 'U');
  const day = Date.UTC(2026, 10, 20, 12);
  p.inv.gold = 0;
  ok(typeof E.spinWheel(p, day, () => 0.5) === 'object', 'free daily spin');
  ok(typeof E.spinWheel(p, day, () => 0.5) === 'string', 'second spin needs gold');
  p.inv.gold = 100000; const r = E.spinWheel(p, day, () => 0.0005); ok(r.prize.tier === 'titan' && p.inv.gold === 100000 - 20000, 'paid spin, 0.1% titan');
  ok(p.cards.length === 1 && p.cards[0].tier === 'titan', 'titan card');
  ok(typeof E.spinWheel(p, day + 864e5, () => 0.5) === 'object' && p.inv.gold === 80000, 'free again next day');
  const odds = Object.fromEntries(CFG.WHEEL.prizes.map((x) => [x.id, x.p]));
  ok(odds.titan === 0.001 && odds.leviathan === 0.005 && odds.sovereign === 0.007 && odds.manowar === 0.01 && odds.galleon === 0.02, 'odds as specified');
  // empirical check
  const q = { ...p, inv: { gold: 1e12 }, cards: [], wheel: {} }; const R = rng(77); let ships = 0;
  for (let i = 0; i < 20000; i++) { const x = E.spinWheel(q, day, R, { paid: true }); if (x.prize.kind === 'ship') ships++; }
  ok(Math.abs(ships / 20000 - 0.043) < 0.006, 'ship rate ' + ships / 20000);
  const a = handleAct(sim, 'u', { type: 'spinWheel' }); ok(a.ok || a.err, 'action works');
});
T('greenhorn\'s luck: new captains take less damage, mend, keep cargo, and are left alone unless they start it', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(61) }); const { p } = joinPlayer(sim, 'u', 'U');
  ok(p.inv.gold >= 1500 && p.inv.explosive >= 12, 'a fair starting kit');
  const me = sim.spawnPlayer('u'); me.x = 1500; me.z = -1500; me.docked = null;
  sim.ships.forEach((s) => { if (s !== me) sim.removeShip(s.id); }); sim.aiDensity = 0;
  ok(CFG.greenK(1) === 1 && CFG.greenK(CFG.GREENHORN.until) === 0 && CFG.greenK(3) > 0 && CFG.greenK(3) < 1, 'fades with level');
  const h0 = me.hull; sim.hurt(me, 100, 0, 0, 'ai:pirates'); const took = h0 - me.hull;
  ok(Math.abs(took - 100 * CFG.GREENHORN.dmg) < 1e-6, 'level 1 takes ' + took);
  p.level = 20; const h1 = me.hull; sim.hurt(me, 100, 0, 0, 'ai:pirates'); ok(Math.abs(h1 - me.hull - 100) < 1e-6, 'veterans take full damage'); p.level = 1;
  // carpenters mend between fights
  me.hull = me.stats.hull * 0.5; sim.time += 30; const hb = me.hull; for (let i = 0; i < 120; i++) sim.step(1 / 60);
  ok(me.hull > hb + 1, 'greenhorn mends out of combat');
  // pirates far off leave a greenhorn alone, close ones (or provoked ones) don't
  const pir = sim.addShip({ owner: 'ai:pirates', role: 'pirate', spec: E.shipSpec('sloop'), x: me.x + 500, z: me.z, yaw: 0, ai: { skill: 0.3, bold: true } });
  ok(!sim.aiWants(pir, me), 'not hunted from 500 m');
  pir.x = me.x + 150; ok(sim.aiWants(pir, me), 'close range: fair game');
  pir.x = me.x + 500; sim.hurt(pir, 1, 0, 0, 'u'); ok(sim.aiWants(pir, me), 'shoot first and they come for you');
  p.level = 20; pir.ai.grudge = null; ok(sim.aiWants(pir, me), 'veterans are hunted at range'); p.level = 1;
  // sunk greenhorns keep their cargo
  const g0 = p.inv.gold, o0 = p.inv.oak; sim.hurt(me, 1e9, 0, 0, 'ai:pirates');
  ok(me.sink > 0 && p.inv.gold === g0 && p.inv.oak === o0, 'cargo kept');
  // fewer strong spawns near a level-1 captain
  let strong = 0; for (let i = 0; i < 200; i++) { const s2 = sim.spawnAI(1, { x: 1500, z: -1500 }); if (s2?.ai.bold) strong++; if (s2) sim.removeShip(s2.id); }
  ok(strong < 50, 'mostly small fry: ' + strong + '/200 strong');
});
T('festival ships: only on sale in their window (every year), bring their trail, never sailed by AI', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(51) }); const { p } = joinPlayer(sim, 'u', 'U');
  p.level = 60; Object.assign(p.inv, { gold: 1e7, oak: 1e5, iron: 1e5, canvas: 1e5, powder: 1e5 });
  const at = (y, m, d) => new Date(y, m - 1, d, 12).getTime();
  for (const [id, inside, outside] of [['harvest', [2026, 11, 26], [2026, 11, 10]], ['yule', [2026, 12, 25], [2026, 12, 30]], ['midnight', [2027, 1, 1], [2026, 12, 20]], ['midnight', [2026, 12, 31], [2027, 1, 20]]]) {
    ok(typeof E.buyShip(p, id, { now: at(...outside) }) === 'string', id + ' not sold outside its festival');
    ok(typeof E.buildCustomShip(W, p, 'port', { tier: id, side: 10, size: 1 }, at(...outside)) === 'string', id + ' no custom build outside');
    ok(CFG.limitedOpen(id, at(...inside)) && !CFG.limitedOpen(id, at(...outside)), id + ' window');
  }
  const r = E.buyShip(p, 'harvest', { now: at(2026, 11, 28) });
  ok(typeof r === 'object' && r.tier === 'harvest', 'bought in window');
  ok(p.trails.includes('autumn'), 'Harvest Moon brings the Falling Leaves trail');
  ok(CFG.limitedOpen('harvest', at(2031, 11, 25)), 'recurs every year');
  const c = E.buildCustomShip(W, p, 'port', { tier: 'yule', side: 20, size: 1.1 }, at(2026, 12, 20));
  ok(typeof c === 'object' && p.trails.includes('frost'), 'custom Yuletide in season + Frostwake');
  // a reward card works any time of year
  E.addCard(p, { kind: 'ship', tier: 'midnight' });
  ok(typeof E.buyShip(p, 'midnight', { card: p.cards.at(-1).id, now: at(2026, 6, 1) }) === 'object', 'card redeems out of season');
  const idx = (id) => TIERS.findIndex((t) => t.id === id);
  for (const id of ['harvest', 'yule', 'midnight', 'collector']) ok(idx(id) > CFG.AI_TOP_TIER, id + ' is never an AI hull');
  ok(!CFG.shopTiers().some((t) => t.id === 'collector'), 'the Ark is not for sale');
  ok(typeof E.buyShip(p, 'collector', { now: at(2026, 11, 20) }) === 'string', 'the Ark cannot be bought');
});
T('exclusive trails cannot be bought; equipping needs ownership', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(52) }); const { p } = joinPlayer(sim, 'u', 'U');
  p.inv.gold = 1e6; const g0 = p.inv.gold;
  for (const id of ['autumn', 'frost', 'fireworks', 'arcade']) {
    ok(handleAct(sim, 'u', { type: 'buyTrail', id }).err, id + ' not for sale');
    ok(handleAct(sim, 'u', { type: 'setTrail', id }).err, id + ' not owned');
  }
  ok(p.inv.gold === g0, 'no gold taken');
  ok(!handleAct(sim, 'u', { type: 'buyTrail', id: 'gold' }).err, 'normal trails still sell');
});
T('games month advent: a door a day from 12 Nov, catch-up to the 30th, Titan at 7, Collector\'s Ark at 14', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(53) }); const { p } = joinPlayer(sim, 'u', 'U');
  const day = (d, h = 12, y = 2026) => new Date(y, 10, d, h).getTime();
  ok(typeof E.openAdvent(p, day(11)) === 'string', 'not before the 12th');
  ok(typeof E.openAdvent(p, new Date(2026, 9, 30).getTime()) === 'string', 'not in October');
  ok(E.adventState(p, day(12)).canOpen, 'door 1 ready on the 12th');
  const r1 = E.openAdvent(p, day(12, 9)); ok(r1.door === 1, 'door 1');
  ok(typeof E.openAdvent(p, day(12, 22)) === 'string', 'one door a day');
  // skip the 13th + 14th, then catch up one a day
  for (let d = 15; d <= 20; d++) { const r = E.openAdvent(p, day(d)); ok(typeof r === 'object', 'catch-up ' + d + ' ' + r); ok(typeof E.openAdvent(p, day(d, 20)) === 'string', 'still one a day'); }
  ok(p.advent.opened === 7, 'seven doors by the 20th');
  ok(p.cards.some((c) => c.kind === 'ship' && c.tier === 'titan'), 'door 7 = Titan card');
  ok(p.trails.includes('arcade'), 'door 5 = Arcade Wake');
  ok(E.adventState(p, day(21)).canFinish, '7 doors + 10 days left: can still finish');
  for (let d = 21; d <= 27; d++) ok(typeof E.openAdvent(p, day(d)) === 'object', 'door on ' + d);
  ok(p.advent.opened === 14 && p.cards.some((c) => c.kind === 'ship' && c.tier === 'collector'), 'door 14 = Collector\'s Ark card');
  ok(typeof E.openAdvent(p, day(28)) === 'string', 'nothing after 14 doors');
  ok(typeof E.openAdvent(p, day(1, 12, 2026) + 30 * 864e5 + 864e5) === 'string', 'closed in December');
  // never more doors than days elapsed (can't open ahead)
  const q = { inv: { gold: 0 }, trails: ['foam'], cards: [] };
  ok(typeof E.openAdvent(q, day(12)) === 'object' && typeof E.openAdvent(q, day(12, 23)) === 'string', 'no opening ahead');
  const late = { inv: { gold: 0 }, trails: ['foam'], cards: [] };
  ok(!E.adventState(late, day(25)).canFinish, 'starting on the 25th cannot reach door 14');
  // next November starts fresh
  ok(E.adventState(p, day(12, 12, 2027)).opened === 0 && E.adventState(p, day(12, 12, 2027)).canOpen, 'resets next year');
  // the Collector's Ark card builds the ship
  const card = p.cards.find((c) => c.tier === 'collector');
  const s = E.buyShip(p, 'collector', { card: card.id });
  ok(typeof s === 'object' && s.tier === 'collector', 'redeem the Ark');
  const st = E.shipStats(s); ok(st.hull >= 3500 && st.speed > 15 && st.side >= 10, 'and it is a decent ship');
  // via the host action (uses the sim clock)
  sim.clock = () => day(13); const ra = handleAct(sim, 'u', { type: 'openAdvent' }); ok(!ra.err || /already|door|day/.test(ra.err), 'action wired');
});
T('holiday tides: daily gifts; claim every day to New Year for a Titan card', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(36) }); const { p } = joinPlayer(sim, 'u', 'U');
  const start = new Date(2026, 10, 9, 12).getTime(), D = 864e5, n = E.holidayLength();
  ok(n === 54, 'Nov 9 .. Jan 1 = 54 days: ' + n);
  ok(typeof E.claimHoliday(p, start - D) === 'string', 'not before it starts');
  for (let i = 0; i < n; i++) { const r = E.claimHoliday(p, start + i * D); ok(typeof r === 'object', 'day ' + i + ' ' + r); ok(typeof E.claimHoliday(p, start + i * D + 3600e3) === 'string', 'once a day'); }
  ok(p.cards.some((c) => c.tier === 'titan'), 'perfect attendance -> Titan card');
  ok(p.cards.some((c) => c.kind === 'titanSize'), 'Christmas size card');
  ok(typeof E.claimHoliday(p, start + n * D) === 'string', 'over after Jan 1');
  const q = { ...p, cards: [], holiday: null, inv: { gold: 0 } };
  for (let i = 0; i < n; i++) if (i !== 10) E.claimHoliday(q, start + i * D);
  ok(!q.cards.some((c) => c.tier === 'titan') && q.inv.gold > 60000, 'missed a day: gold instead');
  joinPlayer(sim, 'v', 'V'); sim.clock = () => start; ok(!handleAct(sim, 'v', { type: 'claimHoliday' }).err, 'claim action');
});
T('delayed broadside guns fire from where the ship is now; decks 0.2 s apart', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(37) }); const { p } = joinPlayer(sim, 'u', 'U');
  const sp = E.shipSpec('manowar'); p.fleet.push(sp); p.flag = sp.uid;
  const s = sim.spawnPlayer('u'); s.docked = null; s.x = 2600; s.z = 2600; s.yaw = 0; s.spd = 0;
  const plan = sim.planBroadside(s, 'L', s.x + 200, s.z, 'ball');
  ok(!plan.err, plan.err);
  const byDeck = {}; for (const b of plan.balls) { const d = Math.round((b.delay - 0.0) / 0.2 - 0.49); (byDeck[d] ||= []).push(b); }
  const delays = plan.balls.map((b) => b.delay); ok(Math.max(...delays) < 0.2 * 2 + 0.25, 'quick decks: max ' + Math.max(...delays).toFixed(2));
  sim.fire(s, 'L', s.x + 200, s.z, 'ball', plan.balls);
  const late = sim.balls.filter((b) => b.t < -0.3);
  ok(late.length > 0, 'some guns wait');
  s.x += 40; s.z += 25; // the ship sails on
  for (let i = 0; i < 40; i++) sim.stepBalls(1 / 60);
  for (const b of late) ok(Math.hypot(b.x - s.x, b.z - s.z) < 80, 'ball fired near the ship, not the old spot');
});
T('base islands grow a lot with buildings, but never into a neighbour', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(34) }); void sim;
  const b = W.bases.find((x) => x.owner === 'ai:wild');
  const r0 = baseRadius(b);
  for (let i = 0; i < 16; i++) b.buildings.push({ id: 'g' + i, type: 'watchtower', slot: i, hp: 1 });
  ok(baseRadius(b) > r0 * 1.8 || baseRadius(b) >= b.room - 0.01, `grows ${r0.toFixed(0)} -> ${baseRadius(b).toFixed(0)} (room ${b.room.toFixed(0)})`);
  for (const a of W.bases) for (let i = 0; i < 20; i++) a.buildings.push({ id: 'h' + i, type: 'watchtower', slot: i, hp: 1 });
  for (const a of W.bases) for (const c of W.bases) if (a !== c) ok(Math.hypot(a.x - c.x, a.z - c.z) > (baseRadius(a) + baseRadius(c)) * 1.12 + 40, 'overlap ' + a.id + ' ' + c.id);
  for (const a of W.bases) for (const i of W.islands) ok(Math.hypot(a.x - i.x, a.z - i.z) > baseRadius(a) * 1.12 + i.r * 1.1, 'islet overlap ' + a.id + ' ' + i.id);
});
T('cannons reload fast; R repairs at sea with oak', () => {
  ok(BASE_RELOAD <= 3.5, 'reload ' + BASE_RELOAD);
  ok(E.shipStats(E.shipSpec('manowar'), { side: 10 }).reload < 5, 'MoW 20-gun reload');
  const W = world(); const sim = new Sim(W, { rand: rng(32) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 1500; me.z = 1500; me.docked = null;
  me.hull = me.stats.hull * 0.3; me.sails = me.stats.sails * 0.5; me.fire = 5;
  p.inv.oak = 0; ok(handleAct(sim, 'u', { type: 'seaRepair' }).err.includes('oak'), 'needs oak');
  p.inv.oak = 100; const h0 = me.hull;
  const r = handleAct(sim, 'u', { type: 'seaRepair' }); ok(!r.err, r.err);
  ok(me.hull > h0 && p.inv.oak < 100 && me.fire === 0 && sim.fx.some((f) => f.t === 'repair'), 'patched');
  ok(handleAct(sim, 'u', { type: 'seaRepair' }).err.includes('work'), 'cooldown');
  sim.time += 10; me.hull = me.stats.hull; me.sails = me.stats.sails; ok(handleAct(sim, 'u', { type: 'seaRepair' }).err.includes('no repairs'));
});
T('wake trails: buy with gold, equip, shown on your ship', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(33) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u');
  p.inv.gold = 100; ok(handleAct(sim, 'u', { type: 'buyTrail', id: 'gold' }).err, 'too poor');
  p.inv.gold = 1e5; ok(!handleAct(sim, 'u', { type: 'buyTrail', id: 'ember' }).err && p.inv.gold === 1e5 - TRAILS.ember.cost);
  ok(p.trail === 'ember' && sim.ships.get('p:u').look.trail === 'ember', 'equipped');
  ok(!handleAct(sim, 'u', { type: 'setTrail', id: 'foam' }).err && me.look.trail === 'foam');
  ok(handleAct(sim, 'u', { type: 'setTrail', id: 'rainbow' }).err, 'not owned');
  ok(sim.spawnPlayer('u').look.trail === 'foam', 'survives respawn');
});
T('respawn: the new flagship keeps local control and bumps its life', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(34) }); joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.local = true; me.life = 3;
  sim.hurt(me, 1e6, 0, 0, null);
  for (let i = 0; i < 80; i++) sim.step(0.1);
  const ns = sim.ships.get('p:u'); ok(ns !== me && ns.sink === 0 && ns.local && ns.life === 4, 'respawned ' + ns.life);
  ns.sail = 1; const x0 = ns.x, z0 = ns.z; for (let i = 0; i < 60; i++) sim.step(0.1);
  ok(ns.sailNow > 0.8 && Math.hypot(ns.x - x0, ns.z - z0) > 15, 'sails unfurl and it moves');
});
T('v2.5 world: 12 km radius, more islands; old 6 km worlds gain the Deep Reaches without moving anything', () => {
  const W = world(7);
  ok(W.worldR === CFG.WORLD_R && CFG.WORLD_R === 12000, 'radius');
  ok(W.bases.filter((b) => b.hold).length >= 12 && W.bases.length > 150 && W.islands.filter((i) => i.kind === 'res').length > 200, `counts ${W.bases.length}/${W.islands.length}`);
  ok(W.bases.some((b) => Math.hypot(b.x, b.z) > 10000), 'islands reach the outer seas');
  // an old world: keep only what fits in 6 km, then migrate
  const O = world(9); O.bases = O.bases.filter((b) => Math.hypot(b.x, b.z) < 5800); O.islands = O.islands.filter((i) => Math.hypot(i.x, i.z) < 5800); delete O.worldR;
  const before = O.bases.map((b) => `${b.id}@${b.x},${b.z}`);
  const sim = new Sim(O, { rand: rng(3) });
  ok(O.worldR === 12000 && O.bases.length > before.length, 'expanded');
  ok(before.every((k, i) => k === `${O.bases[i].id}@${O.bases[i].x},${O.bases[i].z}`), 'existing islands untouched');
  const ids = [...O.bases, ...O.islands].map((o) => o.id); ok(new Set(ids).size === ids.length, 'unique ids');
  const all = [...O.bases.map((b) => ({ x: b.x, z: b.z, r: b.r })), ...O.islands.filter((i) => i.kind !== 'rock')];
  let clash = 0; for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) < all[i].r + all[j].r) clash++;
  ok(clash === 0, 'no overlapping islands: ' + clash);
  ok(Object.keys(O.ai).filter((k) => k.startsWith('ai:clan:')).length >= 12 && sim, 'new clans for the new fortresses');
});
T('treasure maps: buy at the port, sail to the X, heave to and dig', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(21) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 150; me.z = 0; me.spd = 0; me.docked = null;
  ok(handleAct(sim, 'u', { type: 'buyMap' }).err, 'only in the Free Port');
  handleAct(sim, 'u', { type: 'dock' }); p.inv.gold = 1e5;
  const r = handleAct(sim, 'u', { type: 'buyMap' }); ok(!r.err && p.tmaps.length === 1 && p.inv.gold === 1e5 - CFG.TREASURE.price, r.err);
  const m = p.tmaps[0];
  ok(W.islands.concat(W.bases).some((i) => i.id === m.isl && Math.hypot(i.x - m.x, i.z - m.z) < i.r), 'X is on an island');
  handleAct(sim, 'u', { type: 'undock' }); me.docked = null;
  ok(handleAct(sim, 'u', { type: 'dig' }).err, 'nothing to dig here');
  me.x = m.x + m.range * 0.8; me.z = m.z; me.spd = 6;
  ok(handleAct(sim, 'u', { type: 'dig' }).err.includes('Heave'), 'must stop');
  me.spd = 0; const g0 = p.inv.gold, x0 = p.inv.explosive || 0;
  const d = handleAct(sim, 'u', { type: 'dig' }); ok(!d.err && p.inv.gold > g0 + 4000 && p.inv.explosive > x0 && p.tmaps.length === 0, d.err);
  for (let i = 0; i < 5; i++) E.addTreasureMap(p, E.makeTreasureMap(W, rng(i + 1), 0, 0, 5));
  ok(p.tmaps.length === CFG.TREASURE.max, 'map cap');
});
T('voyages: charter passage between your harbours for gold', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(22) }); const { p } = joinPlayer(sim, 'u', 'U');
  const home = sim.homeOf('u'); const me = sim.spawnPlayer('u');
  me.x = 150; me.z = 0; me.spd = 0; me.docked = null; handleAct(sim, 'u', { type: 'dock' });
  p.inv.gold = 50;
  ok(handleAct(sim, 'u', { type: 'voyage', to: home.id }).err.includes('costs'), 'needs gold');
  p.inv.gold = 1e5; const life = me.life || 0;
  const r = handleAct(sim, 'u', { type: 'voyage', to: home.id });
  ok(!r.err && me.docked?.id === home.id && Math.hypot(me.x - home.x, me.z - home.z) < baseRadius(home) + 120 && me.life === life + 1, r.err);
  ok(p.inv.gold === 1e5 - E.voyageCost(Math.hypot(home.x - 150, home.z)), 'paid by distance');
  ok(handleAct(sim, 'u', { type: 'voyage', to: W.bases.find((b) => b.owner !== 'u').id }).err, 'only to your own islands');
  ok(!handleAct(sim, 'u', { type: 'voyage', to: 'port' }).err && me.docked.kind === 'port', 'back to port');
});
T('bounty hunts: a wanted captain pays gold, a spin and a map', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(23) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 3000; me.z = 0; me.docked = null;
  sim.startEvent('bounty');
  const w = [...sim.ships.values()].find((s) => s.tag === 'bounty');
  ok(w && w.name.startsWith('Wanted: ') && w.bounty > 6000 && w.hull === w.stats.hull, 'spawned');
  const g0 = p.inv.gold; sim.hurt(w, 1e7, 0, 0, 'u');
  ok(w.sink > 0 && p.inv.gold >= g0 + w.bounty && p.wheel.bonus === 1 && p.tmaps?.length === 1, `paid ${p.inv.gold - g0}`);
});
T('v2.6 ships: xebec + war junk on the ladder, the Ghost Ship is a reward card that heals itself', () => {
  const p = E.newProfile('u', 'U'); p.inv.gold = 1e6; p.inv.oak = 1e5; p.inv.iron = 1e5; p.inv.canvas = 1e5;
  p.level = 7; ok(typeof E.buyShip(p, 'xebec') === 'string', 'xebec needs level 8');
  p.level = 8; ok(typeof E.buyShip(p, 'xebec') === 'object', 'xebec at 8');
  p.level = 12; ok(typeof E.buyShip(p, 'junk') === 'object', 'junk at 12');
  ok(typeof E.buyShip(p, 'ghost') === 'string', 'ghost cannot be bought');
  E.addCard(p, { kind: 'ship', tier: 'ghost' }); const c = p.cards.find((x) => x.tier === 'ghost');
  ok(typeof E.buyShip(p, 'ghost', { card: c.id }) === 'object', 'ghost redeemed from a card');
  const xs = E.shipStats(E.shipSpec('xebec')), fs = E.shipStats(E.shipSpec('frigate')), js = E.shipStats(E.shipSpec('junk')), gs = E.shipStats(E.shipSpec('ghost'));
  ok(xs.speed > fs.speed && xs.speed > E.shipStats(E.shipSpec('schooner')).speed, 'xebec is the fastest buyable hull');
  ok(js.armor < 1 && js.hull > fs.hull, 'junk is tough');
  ok(gs.regen > 0, 'ghost regenerates');
  ok(CFG.AI_TOP_TIER === CFG.TIERS.findIndex((t) => t.id === 'manowar'), 'AI tops out at the Man of War');
  ok(Math.abs(CFG.WHEEL.prizes.reduce((a, x) => a + x.p, 0) - 1) < 1e-9, 'wheel odds add up');
  for (const t of ['xebec', 'junk', 'ghost']) { const g = gunLayout(E.shipStats(E.shipSpec(t))); ok(g.every((x) => Number.isFinite(x.x + x.y + x.z)), t + ' guns'); }
});
T('night brings the Phantom; sinking it pays out, dawn makes it vanish', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(31) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 3000; me.z = 0; me.docked = null;
  sim.startEvent('phantom');
  let w = [...sim.ships.values()].find((s) => s.tag === 'phantom');
  ok(w && w.spec.tier === 'ghost' && w.name === 'The Phantom', 'spawned as a ghost ship even though AI normally stops at the Man of War');
  const g0 = p.inv.gold; sim.hurt(w, 1e7, 0, 0, 'u');
  ok(w.sink > 0 && p.inv.gold >= g0 + 15000 && p.wheel.bonus === 1 && p.tmaps?.length === 1, 'reward');
  // a fresh one fades at dawn
  for (const s of [...sim.ships.values()]) if (s.tag === 'phantom') sim.removeShip(s.id);
  sim.startEvent('phantom'); ok([...sim.ships.values()].some((s) => s.tag === 'phantom' && s.sink === 0), 'second phantom');
  sim.wasNight = true; sim.dayOff = 0; sim.time = 0; sim.stepNight([me]);
  ok(![...sim.ships.values()].some((s) => s.tag === 'phantom' && s.sink === 0), 'faded at dawn');
});
T('storms roll in, raise the sea and spoil the aim, then clear', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(37) }); joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 3000; me.z = 0; me.docked = null;
  sim.startEvent('storm');
  for (let i = 0; i < 120 * 20; i++) sim.stepWeather(0.05, [me]);
  ok(sim.weather.storm > 0.8, 'storm built up: ' + sim.weather.storm);
  sim.time += 400; for (let i = 0; i < 90 * 20; i++) { sim.time += 0.05; sim.stepWeather(0.05, [me]); }
  ok(sim.weather.storm < 0.05, 'storm cleared: ' + sim.weather.storm);
});
T('host rejects broken broadsides from peers', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(41) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 3000; me.z = 0; me.docked = null; p.inv.grape = 50;
  ok(sim.fire(me, 'nope', me.x + 100, me.z).err, 'bad battery');
  ok(sim.fire(me, 'L', NaN, 0).err, 'bad target');
  ok(sim.fire(me, 'L', me.x + 1, me.z, 'ball', { length: 3 }).err, 'balls must be an array');
  ok(sim.fire(me, 'L', me.x + 1, me.z, 'ball', [{ x: 1e9, y: 0, z: 0, vx: 1, vy: 1, vz: 1 }]).err, 'balls must start at the ship');
  const g0 = p.inv.gold; sim.fire(me, 'L', me.x, me.z + 100, 'gold'); ok(p.inv.gold === g0 && Number.isFinite(p.inv.gold), 'gold is not ammo');
  sim.fire(me, 'R', me.x, me.z + 100, 'constructor'); ok(!Object.hasOwn(p.inv, 'constructor'), 'no prototype keys');
});
T('boarding: capture a crippled ship into the fleet, or plunder and scuttle it', () => {
  const W = world(); const sim = new Sim(W, { rand: rng(43) }); const { p } = joinPlayer(sim, 'u', 'U');
  const me = sim.spawnPlayer('u'); me.x = 3000; me.z = 0; me.docked = null; me.spd = 0; me.yaw = 0;
  const mk = () => { const o = sim.spawnAI(5, me, { role: 'pirate', tier: 'brigantine', dist: 10, strong: true }); o.x = me.x + 12; o.z = me.z; o.spd = 0; o.yaw = 0; return o; };
  let o = mk();
  ok(handleAct(sim, 'u', { type: 'board' }).err, 'healthy ship cannot be boarded');
  o.hull = o.stats.hull * 0.2; o.crew = 1;
  ok(sim.boardTarget(me) === o, 'target found');
  const n0 = p.fleet.length;
  const r = handleAct(sim, 'u', { type: 'board', mode: 'capture' });
  ok(r.ok && r.data.win && r.data.mode === 'capture' && p.fleet.length === n0 + 1 && !sim.ships.has(o.id), 'captured: ' + JSON.stringify(r));
  ok(p.fleet.at(-1).tier === 'brigantine' && p.fleet.at(-1).hp > 0, 'prize in fleet, battered');
  ok(handleAct(sim, 'u', { type: 'board' }).err, 'cooldown');
  me.boardT = 0; o = mk(); o.hull = o.stats.hull * 0.2; o.crew = 1;
  const g0 = p.inv.gold; const r2 = handleAct(sim, 'u', { type: 'board', mode: 'plunder' });
  ok(r2.ok && r2.data.win && p.inv.gold > g0 && o.sink > 0, 'plundered + scuttled');
  me.boardT = 0; o = mk(); o.tag = 'bounty'; o.hull = o.stats.hull * 0.2; o.crew = 1;
  ok(!sim.capturable(o) && handleAct(sim, 'u', { type: 'board', mode: 'capture' }).data?.mode === 'plunder', 'wanted ships are only plundered');
});
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
