// Robustness fuzz (node): long multiplayer sim soaks with random helm/gunnery/events, and every action fed
// valid, malformed and hostile parameters. Fails on any exception, NaN/Infinity, negative stock or runaway growth.
//   node tests/fuzz.mjs [minutes=20] [seed=7]
import * as E from '../src/economy.js';
import { Sim, joinPlayer } from '../src/sim.js';
import { handleAct } from '../src/actions.js';
import { generateIslands } from '../src/worldgen.js';
import { TIERS, BUILDINGS, AMMO_ORDER, RES, MARKET_ITEMS, TRAILS } from '../src/config.js';
import { setCalm } from '../src/waves.js';

const MIN = +(process.argv[2] || 20), SEED = +(process.argv[3] || 7);
const rng = (s = 1) => () => ((s = (s * 16807) % 2147483647) / 2147483647);
const R = rng(SEED * 97 + 3);
const pick = (a) => a[Math.floor(R() * a.length)];
const problems = [];
const seen = new Set();
const failTop = (msg) => { const key = msg.replace(/t=\d+s: /, '').replace(/\b[a-d] inv/, 'X inv').replace(/=-?[\d.e+]+/g, '=N').slice(0, 90); if (seen.has(key)) return; seen.add(key); if (problems.length < 40) problems.push(msg); };

// handleAct swallows exceptions (so a bad request can't crash the host) but logs them: treat that as a failure
console.error = (...a) => failTop('console.error: ' + a.map((x) => (x?.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x))).join(' ').slice(0, 300));
console.warn = (...a) => failTop('console.warn: ' + a.map(String).join(' ').slice(0, 200));
const W = E.newWorld(SEED); generateIslands(W);
setCalm(W.islands.map((i) => ({ x: i.x, z: i.z, r: i.r })));
const sim = new Sim(W, { rand: rng(SEED) });
const pids = ['a', 'b', 'c', 'd'];
for (const pid of pids) { joinPlayer(sim, pid, 'Cap ' + pid); sim.spawnPlayer(pid).local = true; }
// give them the means to exercise everything
for (const pid of pids) { const p = W.players[pid]; p.level = 40; p.points = 60; for (const r of [...RES, 'chain', 'grape', 'explosive']) p.inv[r] = 5e6; }

const JUNK = [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1e12, -1e12, '', 'x', '__proto__', 'constructor', [], {}, { x: 1 }, true, 3.7, '5', 'port'];
const junk = () => { const v = pick(JUNK); return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; };
const ACTIONS = ['dock', 'undock', 'seaRepair', 'spinWheel', 'buyMap', 'dig', 'voyage', 'claimHoliday', 'buySizeCard', 'buyTrail', 'setTrail', 'repair', 'craft', 'upgrade', 'buyShip', 'customShip', 'flagship', 'deploy', 'deployAll', 'recall', 'recallAll', 'repairFleet', 'renameShip', 'claim', 'setHome', 'build', 'demolish', 'repairBase', 'haven', 'payFee', 'order', 'instantBuy', 'instantSell', 'cancel', 'buyListing', 'propose', 'answer', 'alliance', 'harvest', 'ammo', 'rename', 'nonsense', undefined];

/** A plausible (mostly valid) action for this player, so the fuzz reaches deep code paths, not just early returns. */
function goodAction(pid) {
  const p = W.players[pid], s = sim.ships.get('p:' + pid);
  const own = W.bases.filter((b) => b.owner === pid);
  const b = pick(own.length ? own : W.bases);
  const fleet = p.fleet || [];
  const sh = fleet.length ? pick(fleet) : null;
  const t = pick(ACTIONS);
  switch (t) {
    case 'craft': return { type: t, kind: pick(['chain', 'grape', 'explosive', 'powder']), times: 1 + Math.floor(R() * 5) };
    case 'upgrade': return { type: t, key: pick(['side', 'bow', 'stern', 'reload', 'hull', 'speed', 'fleet', 'repair']) };
    case 'buyShip': return { type: t, tier: pick(TIERS).id, card: R() < 0.2 ? p.cards?.[0]?.id : undefined };
    case 'customShip': return { type: t, spec: { tier: pick(TIERS).id, side: Math.floor(R() * 40), size: 0.8 + R() * 0.5, name: 'Fz', hullColor: '#123456', card: R() < 0.3 ? p.cards?.[0]?.id : undefined } };
    case 'flagship': case 'renameShip': case 'deploy': case 'recall': return { type: t, uid: sh?.uid, name: 'Renamed', mode: pick(['escort', 'guard', 'attack', 'patrol']), base: b?.id };
    case 'build': return { type: t, base: b?.id, btype: pick(Object.keys(BUILDINGS)), kind: pick(Object.keys(BUILDINGS)), slot: R() * 6.28 };
    case 'demolish': return { type: t, base: b?.id, bid: b?.buildings?.length ? pick(b.buildings).id : 'nope' };
    case 'claim': case 'setHome': case 'repairBase': case 'payFee': return { type: t, base: b?.id };
    case 'haven': return { type: t, base: b?.id, cfg: { safe: R() < 0.5, fee: Math.floor(R() * 500), allow: [pick(pids)] } };
    case 'order': return { type: t, o: { side: pick(['buy', 'sell']), item: pick(MARKET_ITEMS), qty: 1 + Math.floor(R() * 50), price: 1 + Math.floor(R() * 40) } };
    case 'instantBuy': case 'instantSell': return { type: t, item: pick(MARKET_ITEMS), qty: 1 + Math.floor(R() * 30) };
    case 'cancel': case 'buyListing': return { type: t, id: W.market.length ? pick(W.market).id : 'none' };
    case 'propose': return { type: t, to: pick(pids), ttype: pick(['peace', 'trade', 'alliance']) };
    case 'answer': return { type: t, id: W.treaties?.length ? pick(W.treaties).id : 'x', yes: R() < 0.5 };
    case 'alliance': return { type: t, name: 'Fuzz Pact' };
    case 'harvest': return { type: t, on: R() < 0.5 };
    case 'ammo': return { type: t, ammo: pick(AMMO_ORDER) };
    case 'buyTrail': case 'setTrail': return { type: t, id: pick(Object.keys(TRAILS)) };
    case 'voyage': return { type: t, to: R() < 0.5 ? 'port' : b?.id };
    case 'spinWheel': return { type: t, paid: R() < 0.7 };
    case 'dock': if (s && R() < 0.3) { const tgt = R() < 0.5 ? W.islands.find((i) => i.kind === 'port') : b; if (tgt) { s.x = tgt.x + 60; s.z = tgt.z + 60; s.spd = 0; } } return { type: t };
    default: return { type: t };
  }
}
/** The same action with fields replaced by junk. */
function badAction(pid) {
  const a = goodAction(pid);
  for (const k of Object.keys(a)) if (k !== 'type' && R() < 0.6) a[k] = junk();
  if (a.spec && typeof a.spec === 'object' && R() < 0.8) for (const k of Object.keys(a.spec)) if (R() < 0.5) a.spec[k] = junk();
  if (a.o && typeof a.o === 'object' && R() < 0.8) for (const k of Object.keys(a.o)) if (R() < 0.5) a.o[k] = junk();
  if (R() < 0.05) a.type = junk();
  return a;
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const broken = new Set(); // report each corrupted field once, at the moment it first goes bad
function checkInvariants(where) {
  const fail = (msg) => { const k = msg.split(': ').slice(1).join(': ').replace(/[=\s-]?[-\d.e+]*(NaN|Infinity|null|undefined)?$/, '').replace(/negative.*/, 'negative').replace(/ to .*/, ''); if (broken.has(k)) return; broken.add(k); failTop(msg); };
  for (const s of sim.ships.values()) {
    for (const k of ['x', 'z', 'yaw', 'spd', 'hull', 'sails', 'crew']) if (!finite(s[k])) { fail(`${where}: ship ${s.id} ${k}=${s[k]}`); break; }
    if (s.hull > s.stats.hull + 1e-6) fail(`${where}: ship ${s.id} hull ${s.hull} > max ${s.stats.hull}`);
    if (Math.hypot(s.x, s.z) > 30000) fail(`${where}: ship ${s.id} flew off to ${s.x | 0},${s.z | 0}`);
  }
  for (const [pid, p] of Object.entries(W.players)) {
    for (const [k, v] of Object.entries(p.inv)) { if (!finite(v)) fail(`${where}: ${pid} inv.${k}=${v}`); else if (v < -1e-6) fail(`${where}: ${pid} inv.${k} negative ${v}`); }
    if (!finite(p.level) || !finite(p.xp) || !finite(p.points)) fail(`${where}: ${pid} level/xp/points not finite`);
    if (p.points < 0) fail(`${where}: ${pid} points negative ${p.points}`);
    for (const sp of p.fleet || []) if (!TIERS.some((t) => t.id === sp.tier)) fail(`${where}: ${pid} fleet ship with bad tier ${sp.tier}`);
  }
  for (const o of W.market) if (!finite(o.qty) || !finite(o.price) || o.qty <= 0 || o.price <= 0) fail(`${where}: bad market order ${JSON.stringify(o)}`);
  for (const b of W.bases) for (const bd of b.buildings) if (!finite(bd.hp)) fail(`${where}: base ${b.id} building hp ${bd.hp}`);
}

const t0 = Date.now();
const dt = 1 / 20, steps = Math.round((MIN * 60) / dt);
let acts = 0, threw = 0, peakShips = 0, peakBalls = 0;
for (let i = 0; i < steps; i++) {
  // helm: every player sails around, sometimes firing at whatever is close
  for (const pid of pids) {
    const s = sim.ships.get('p:' + pid); if (!s || s.sink > 0) continue;
    if (i % 40 === 0) { s.rud = R() * 2 - 1; s.sail = pick([0, 0.34, 0.67, 1]); if (s.docked && R() < 0.5) handleAct(sim, pid, { type: 'undock' }); }
    if (i % 30 === 0 && R() < 0.5) {
      try { sim.fire(s, pick(['L', 'R', 'bow', 'stern', junk()]), s.x + (R() - 0.5) * 400, s.z + (R() - 0.5) * 400, R() < 0.8 ? pick(AMMO_ORDER) : junk(), R() < 0.1 ? junk() : null); }
      catch (e) { threw++; failTop(`fire threw: ${e.stack.split('\n').slice(0, 2).join(' | ')}`); }
    }
  }
  // actions: ~1 per second per player, a third of them malformed
  if (i % 5 === 0) {
    const pid = pick(pids);
    const a = R() < 0.35 ? badAction(pid) : goodAction(pid);
    try { const r = handleAct(sim, pid, a); if (!r || (typeof r !== 'object')) failTop(`act ${a.type} returned ${r}`); acts++; checkInvariants(`after ${JSON.stringify(a, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v === undefined ? 'undef' : v))}`); }
    catch (e) { threw++; failTop(`act ${JSON.stringify(a)} threw: ${e.stack.split('\n').slice(0, 2).join(' | ')}`); }
  }
  if (i % 2400 === 0) { try { sim.startEvent(pick(['kraken', 'treasure', 'bounty', 'raid'])); } catch (e) { threw++; failTop(`event threw: ${e.message}`); } }
  if (i % 6000 === 3000) { for (const pid of pids) W.players[pid].online = R() < 0.7; }
  try { sim.step(dt); } catch (e) { threw++; failTop(`step ${i} threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); if (threw > 20) break; }
  sim.fx.length = 0; sim.msgs.length = 0;
  peakShips = Math.max(peakShips, sim.ships.size); peakBalls = Math.max(peakBalls, sim.balls.length);
  if (i % 200 === 0) checkInvariants(`t=${(i * dt).toFixed(0)}s`);
  if (problems.length >= 40) break;
}
checkInvariants('end');
// runaway growth: lists that would bloat saves / snapshots in a long session
const json = JSON.stringify(W);
if (json.length > 3e6) failTop(`world save grew to ${(json.length / 1e6).toFixed(1)} MB`);
if (W.log && W.log.length > 500) failTop(`W.log grew to ${W.log.length}`);
if (peakShips > 400) failTop(`ships peaked at ${peakShips}`);
if (W.market.length > 2000) failTop(`market grew to ${W.market.length}`);
console.log(`fuzz: ${MIN} game-min, seed ${SEED}, ${acts} actions, peak ${peakShips} ships / ${peakBalls} balls, save ${(json.length / 1e3).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (problems.length) { console.log(`✗ ${problems.length} problem(s):\n  ` + problems.join('\n  ')); process.exit(1); }
console.log('✓ no exceptions, NaNs, negative stock or runaway growth');
