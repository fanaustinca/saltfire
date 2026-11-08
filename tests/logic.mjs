// Pure logic tests (node): economy, market + tax, crafting, upgrades, shipyard, bases, sim combat,
// sinking/loot/XP, safe havens, offline shields, conquest, events, diplomacy.
import * as E from '../src/economy.js';
import { Sim, joinPlayer, solveElev, arcOf } from '../src/sim.js';
import { handleAct } from '../src/actions.js';
import { generateIslands } from '../src/worldgen.js';
import { TIERS, MARKET_TAX, BUILDINGS, GRAVITY, MUZZLE, UPGRADE_TOTAL, claimFee } from '../src/config.js';
import { setCalm, heightAt } from '../src/waves.js';
import { gunLayout } from '../src/layout.js';
import { buildingPos, baseShape, dockAngle, harborPoint, baseRadius } from '../src/basegeo.js';

let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.stack.split('\n').slice(0, 3).join('\n      ')); } };
const ok = (c, m) => { if (!c) throw new Error(m || 'assert'); };
const world = (seed = 42) => { const W = E.newWorld(seed); generateIslands(W); return W; };
const rng = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

T('ship tiers match the spec cannon counts', () => {
  const want = { sloop: 1, schooner: 1, brigantine: 2, frigate: 3, galleon: 5, manowar: 10 };
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
  ok(typeof E.buildCustomShip(W, p, base.id, { tier: 'frigate', side: 5 }) === 'string', 'needs shipyard');
  ok(typeof E.build(W, p, base.id, 'dock') === 'object'); ok(typeof E.build(W, p, base.id, 'shipyard') === 'object');
  const s = E.buildCustomShip(W, p, base.id, { tier: 'frigate', side: 99, size: 1.2, name: 'Vengeance', hullColor: '#223344' });
  ok(typeof s === 'object' && s.side === 7 && s.size === 1.2 && s.custom && s.name === 'Vengeance');
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
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
