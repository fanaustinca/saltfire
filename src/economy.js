// Pure economy + progression logic over the persistent world state `W`.
// Host-authoritative: every function here is called on the host (or in solo) and is unit-tested.
import {
  RES, AMMO_ORDER, RECIPES, TIERS, tierById, maxSideFor, UPGRADES, XP_PER_LEVEL, MAX_LEVEL, BUILDINGS,
  MARKET_TAX, LAND_SLOTS, PROD_PERIOD, BASE_RELOAD, rangeFor, MUZZLE, FLEET_BASE,
} from './config.js';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ------------------------------------------------------------------ inventory
export function emptyInv() { const o = {}; for (const r of RES) o[r] = 0; for (const a of AMMO_ORDER) if (a !== 'ball') o[a] = 0; return o; }
export function canAfford(inv, cost) { for (const k in cost) if ((inv[k] || 0) < cost[k]) return false; return true; }
export function pay(inv, cost) { if (!canAfford(inv, cost)) return false; for (const k in cost) inv[k] -= cost[k]; return true; }
export function gain(inv, items, mul = 1) { for (const k in items) inv[k] = (inv[k] || 0) + Math.round(items[k] * mul); }
export function costText(cost) { return Object.entries(cost).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') || 'free'; }

// ------------------------------------------------------------------ profiles
export function newProfile(id, name) {
  const inv = emptyInv();
  inv.gold = 500; inv.oak = 30; inv.iron = 10; inv.canvas = 10;
  inv.chain = 10; inv.grape = 10; inv.explosive = 4;
  const sloop = shipSpec('sloop', { name: 'Gull' });
  return {
    id, name: name || 'Captain', color: Math.floor(Math.random() * 360),
    xp: 0, level: 1, points: 0, upg: {}, inv,
    fleet: [sloop], flag: sloop.uid,
    alliance: null, online: false, lastSeen: Date.now(), kills: 0, created: Date.now(),
  };
}

export function shipSpec(tier, o = {}) {
  const T = tierById(tier);
  return {
    uid: o.uid || uid('s'), tier: T.id, name: o.name || T.name,
    side: clampInt(o.side ?? T.side, T.minSide, maxSideFor(T, clamp(o.size ?? 1, 0.85, 1.2))),
    size: clamp(o.size ?? 1, 0.85, 1.2),
    hullColor: o.hullColor || T.look?.hullColor || '#5a3a22', trimColor: o.trimColor || T.look?.trimColor || '#c9a227',
    sailColor: o.sailColor || T.look?.sailColor || '#efe6cf', emblem: o.emblem ?? 0,
    custom: !!o.custom, hp: null, crew: null,
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clampInt = (v, a, b) => clamp(Math.round(v), a, b);

/** Derived combat/handling stats for a ship spec under a profile's upgrades. */
export function shipStats(spec, upg = {}) {
  const T = tierById(spec.tier);
  const s = spec.size || 1;
  const u = (k) => Math.min(UPGRADES[k].max, upg[k] || 0) * UPGRADES[k].per;
  const side = Math.min(maxSideFor(T, s), (spec.side ?? T.side) + (upg.side || 0));
  const rangeK = 1 + u('range');
  return {
    tier: T.id, name: spec.name,
    len: T.len * s, beam: T.beam * s, depth: T.depth * s,
    side, bow: Math.min(4, upg.bow || 0), stern: Math.min(4, upg.stern || 0),
    speed: T.speed * (1 + u('speed')) * (1.08 - 0.08 * s),
    turn: T.turn * (1 + u('turn')) * (1.1 - 0.1 * s),
    hull: Math.round(T.hull * (1 + u('hull')) * s),
    sails: Math.round(T.sails * (1 + u('sails')) * s),
    crew: Math.round(T.crew * (1 + u('crew')) * s),
    reload: T.reload ?? (BASE_RELOAD / (1 + u('reload'))) * (1 + 0.015 * Math.max(0, side - 3)),
    invincible: !!T.invincible,
    range: rangeFor(T.id) * rangeK,
    muzzle: MUZZLE * Math.sqrt(rangeK),
    dmg: 1 + u('damage'), armor: (1 - u('armor')) * (T.armor ?? 1), spread: 1 - u('accuracy'), regen: u('repair'),
  };
}
/** How many fleet ships a captain may have at sea at once. */
export const fleetCap = (p) => FLEET_BASE + Math.floor(p.level / 25) + (p.upg?.fleet || 0);

/** Crew efficiency: losing crew slows reload and steering. Below 25% it degrades sharply. */
export function crewEff(crew, max) {
  const f = clamp(crew / Math.max(1, max), 0, 1);
  return f < 0.25 ? 0.15 + f * 1.4 : 0.5 + f * 0.5;
}

/** Custom ship cost: tier base scaled by size and extra cannons. */
export function customCost(tier, side, size) {
  const T = tierById(tier);
  const base = T.cost.gold ? T.cost : { gold: 200, oak: 20, iron: 5, canvas: 10 };
  const extra = Math.max(0, side - T.minSide);
  const k = Math.pow(size, 2);
  return {
    gold: Math.round((base.gold || 0) * k * 0.6 + extra * 120),
    oak: Math.round((base.oak || 20) * k),
    iron: Math.round((base.iron || 5) * k + extra * 12),
    canvas: Math.round((base.canvas || 10) * k),
  };
}

// ------------------------------------------------------------------ XP / levels / upgrades
export function addXp(p, amount) {
  p.xp += Math.round(amount);
  let ups = 0;
  while (p.level < MAX_LEVEL && p.xp >= XP_PER_LEVEL(p.level)) { p.xp -= XP_PER_LEVEL(p.level); p.level++; p.points++; ups++; }
  return ups;
}
export function buyUpgrade(p, key, n = 1) {
  const U = UPGRADES[key];
  if (!U) return 'Unknown upgrade';
  n = Math.max(1, Math.min(50, n | 0 || 1));
  if ((p.upg[key] || 0) >= U.max) return 'Already maxed';
  if (p.points < 1) return 'No upgrade points — earn XP to level up';
  for (let i = 0; i < n && p.points > 0 && (p.upg[key] || 0) < U.max; i++) { p.points--; p.upg[key] = (p.upg[key] || 0) + 1; }
  return null;
}

// ------------------------------------------------------------------ crafting
export function craft(p, kind, times = 1) {
  const R = RECIPES[kind];
  if (!R) return 'Unknown recipe';
  const cost = {}; for (const k in R.in) cost[k] = R.in[k] * times;
  if (!pay(p.inv, cost)) return 'Not enough materials';
  p.inv[kind] = (p.inv[kind] || 0) + R.out * times;
  return null;
}

// ------------------------------------------------------------------ ships
export function buyShip(p, tier, opts = {}) {
  const T = tierById(tier);
  if (T.cheatOnly) return 'That ship cannot be bought';
  if (p.level < T.level) return `Requires level ${T.level}`;
  if (!pay(p.inv, T.cost)) return 'Not enough resources';
  const s = shipSpec(T.id, opts);
  p.fleet.push(s);
  return s;
}
export function buildCustomShip(W, p, baseId, o) {
  const b = W.bases.find((x) => x.id === baseId);
  if (!b || b.owner !== p.id) return 'You must be at your own base';
  if (!b.buildings.some((x) => x.type === 'shipyard' && x.hp > 0)) return 'Build a Shipyard first';
  const T = tierById(o.tier);
  if (T.cheatOnly) return 'That hull cannot be built';
  if (p.level < T.level) return `Requires level ${T.level}`;
  const size = clamp(o.size || 1, 0.85, 1.2);
  const side = clampInt(o.side, T.minSide, maxSideFor(T, size));
  const cost = customCost(T.id, side, size);
  if (!pay(p.inv, cost)) return 'Not enough oak, iron, canvas or gold';
  const s = shipSpec(T.id, { ...o, side, size, custom: true, name: String(o.name || 'Unnamed').slice(0, 24) });
  p.fleet.push(s);
  return s;
}
export function setFlagship(p, shipUid) { const s = p.fleet.find((x) => x.uid === shipUid); if (!s) return 'Not in fleet'; if (s.out) return 'That ship is at sea with your fleet — recall it first'; if (s.wrecked) return 'That ship is wrecked — repair it first'; p.flag = shipUid; return null; }
export const flagship = (p) => p.fleet.find((s) => s.uid === p.flag) || p.fleet[0];

// ------------------------------------------------------------------ bases
export function landSlotsUsed(b) { return b.buildings.filter((x) => BUILDINGS[x.type].slot === 'land').length; }
/** Island visual "size" grows with the number of buildings. */
export function baseGrowth(b) { return 1 + Math.min(2.2, b.buildings.length * 0.14); }

export function build(W, p, baseId, type, at = null) {
  const b = W.bases.find((x) => x.id === baseId);
  const B = BUILDINGS[type];
  if (!b || !B) return 'Invalid';
  if (b.owner !== p.id) return 'Not your base';
  if (B.slot === 'core') return 'Cannot build that';
  if (B.unique && b.buildings.some((x) => x.type === type)) return `Only one ${B.name} per base`;
  if (B.needs && !b.buildings.some((x) => x.type === B.needs)) return `Needs ${BUILDINGS[B.needs].name}`;
  if (B.slot === 'land' && landSlotsUsed(b) >= LAND_SLOTS) return 'No free building plots';
  if (B.slot === 'shore' && b.buildings.filter((x) => x.type === 'cannon').length >= 12) return 'Max 12 shore cannons';
  if (B.slot === 'sea' && b.buildings.filter((x) => x.type === 'fort').length >= 3) return 'Max 3 sea forts';
  if (!pay(p.inv, B.cost)) return 'Not enough resources';
  let slot;
  if (B.slot === 'land') { const used = new Set(b.buildings.filter((x) => BUILDINGS[x.type].slot === 'land').map((x) => x.slot)); slot = 0; while (used.has(slot)) slot++; }
  else slot = typeof at === 'number' ? at : Math.random() * Math.PI * 2; // angle around island
  const bd = { id: uid('b'), type, slot, hp: B.hp };
  b.buildings.push(bd);
  return bd;
}
export function demolish(W, p, baseId, bid) {
  const b = W.bases.find((x) => x.id === baseId);
  if (!b || b.owner !== p.id) return 'Not your base';
  const i = b.buildings.findIndex((x) => x.id === bid);
  if (i < 0 || b.buildings[i].type === 'keep') return 'Cannot demolish';
  b.buildings.splice(i, 1);
  return null;
}
export function repairBase(W, p, baseId) {
  const b = W.bases.find((x) => x.id === baseId);
  if (!b || b.owner !== p.id) return 'Not your base';
  let missing = 0; for (const x of b.buildings) missing += BUILDINGS[x.type].hp - x.hp;
  const cost = { gold: Math.ceil(missing * 0.4), oak: Math.ceil(missing * 0.05) };
  if (!missing) return 'Nothing to repair';
  if (!pay(p.inv, cost)) return 'Not enough gold/oak';
  for (const x of b.buildings) x.hp = BUILDINGS[x.type].hp;
  return null;
}
export function setHaven(W, p, baseId, cfg) {
  const b = W.bases.find((x) => x.id === baseId);
  if (!b || b.owner !== p.id) return 'Not your base';
  b.haven = {
    safe: !!cfg.safe, fee: clampInt(cfg.fee || 0, 0, 5000),
    allies: cfg.allies !== false, allow: Array.isArray(cfg.allow) ? cfg.allow.slice(0, 32) : (b.haven?.allow || []),
  };
  return null;
}
/** Passive production for every owned base (dt in seconds of game time). Owners get it even offline. */
export function produce(W, dt) {
  for (const b of W.bases) {
    const p = W.players[b.owner] || W.ai?.[b.owner];
    if (!p || !p.inv) continue;
    b.prodT = (b.prodT || 0) + dt;
    while (b.prodT >= PROD_PERIOD) {
      b.prodT -= PROD_PERIOD;
      const mul = b.buildings.some((x) => x.type === 'warehouse') ? 1.5 : 1;
      for (const x of b.buildings) { const P = BUILDINGS[x.type].prod; if (P && x.hp > 0) gain(p.inv, P, mul); }
      p.inv.gold += 10 + b.buildings.length * 2; // tax income
    }
  }
}

// ------------------------------------------------------------------ relations
export function treatyBetween(W, a, b) {
  return W.treaties.filter((t) => (t.a === a && t.b === b) || (t.a === b && t.b === a)).map((t) => t.type);
}
/** AI faction of an owner id: 'pirates' | 'navy' | 'merchant' | 'clan' | 'wild' (or null for players). */
export const aiFaction = (o) => (o && o.startsWith('ai:') ? o.split(':')[1] : null);
/** Are two owners (player ids, or 'ai:*') hostile to each other? Pirates and clans prey on everyone
 * (including each other and merchants); the navy hunts pirates and escorts merchants. */
export function hostile(W, a, b) {
  if (!a || !b || a === b) return false;
  const fa = aiFaction(a), fb = aiFaction(b);
  if (fa && fb) {
    if (fa === fb && fa !== 'clan' && fa !== 'pirates') return false;
    const peace = (x, y) => (fa === x && fb === y) || (fa === y && fb === x);
    if (peace('navy', 'merchant') || peace('merchant', 'wild') || peace('navy', 'wild') || peace('pirates', 'wild')) return false;
    return true;
  }
  if (fa || fb) return true; // captains may attack anyone at sea, merchants included — it's piracy
  const pa = W.players[a], pb = W.players[b];
  if (pa && pb && pa.alliance && pa.alliance === pb.alliance) return false;
  const t = treatyBetween(W, a, b);
  if (t.includes('peace') || t.includes('alliance')) return false;
  return true;
}
/** May `pid` enter base `b` freely? Returns { ok, fee }. */
export function havenAccess(W, b, pid) {
  if (!b.owner || b.owner === pid) return { ok: true, fee: 0 };
  if (b.owner.startsWith('ai:')) return { ok: false, fee: 0 };
  const h = b.haven || {};
  const p = W.players[pid], o = W.players[b.owner];
  const t = treatyBetween(W, pid, b.owner);
  if (h.allow?.includes(pid)) return { ok: true, fee: 0 };
  if (h.allies !== false && ((p && o && p.alliance && p.alliance === o.alliance) || t.includes('alliance'))) return { ok: true, fee: 0 };
  const fee = t.includes('trade') ? 0 : h.fee || 0;
  return { ok: true, fee };
}
/** Offline peace protection: a player's bases and ships are shielded while they're offline. */
export const shielded = (W, owner) => !!(owner && !owner.startsWith('ai:') && W.players[owner] && !W.players[owner].online);

// diplomacy
export function propose(W, from, to, type) {
  if (!W.players[to] || from === to) return 'Unknown captain';
  if (!['peace', 'trade', 'alliance', 'war'].includes(type)) return 'Bad treaty';
  if (type === 'war') { W.treaties = W.treaties.filter((t) => !((t.a === from && t.b === to) || (t.a === to && t.b === from))); return null; }
  if (treatyBetween(W, from, to).includes(type)) return 'Treaty already in force';
  if (W.proposals.some((x) => x.from === from && x.to === to && x.type === type)) return 'Already proposed';
  W.proposals.push({ id: uid('t'), from, to, type, at: Date.now() });
  return null;
}
export function answer(W, pid, propId, accept) {
  const i = W.proposals.findIndex((x) => x.id === propId && x.to === pid);
  if (i < 0) return 'No such proposal';
  const pr = W.proposals.splice(i, 1)[0];
  if (accept) W.treaties.push({ a: pr.from, b: pr.to, type: pr.type, since: Date.now() });
  return null;
}
export function setAlliance(W, p, name) { p.alliance = name ? String(name).slice(0, 20) : null; return null; }

// ------------------------------------------------------------------ market (order book with 5% tax)
// order: { id, side: 'sell'|'buy', item, qty, price (per unit), owner, ship? }
// Sell orders hold the goods in escrow; buy orders hold the gold.
const escrow = (W, pid) => W.players[pid] || W.ai?.[pid] || W.npc;
/** Display name of a market participant. */
export const traderName = (W, id) => W.players[id]?.name || W.ai?.[id]?.name || (id === 'npc' ? 'Free Port Exchange' : id);

export function placeOrder(W, pid, o) {
  const p = escrow(W, pid);
  const side = o.side === 'buy' ? 'buy' : 'sell';
  const item = o.item;
  const price = Math.max(1, Math.round(o.price));
  if (item !== 'ship' && !MARKET_ITEMS_SET.has(item)) return { err: 'Item not tradeable' };
  let qty = item === 'ship' ? 1 : Math.max(1, Math.round(o.qty));
  const order = { id: uid('o'), side, item, qty, price, owner: pid, at: Date.now() };
  if (side === 'sell') {
    if (item === 'ship') {
      const i = p.fleet ? p.fleet.findIndex((s) => s.uid === o.shipUid) : -1;
      if (i < 0) return { err: 'Ship not in your fleet' };
      if (p.flag === o.shipUid || p.fleet.length < 2) return { err: 'You cannot sell your flagship' };
      if (p.fleet[i].out) return { err: 'Recall that ship from sea before selling it' };
      order.ship = p.fleet.splice(i, 1)[0];
    } else {
      if ((p.inv[item] || 0) < qty) return { err: 'Not enough ' + item };
      p.inv[item] -= qty;
    }
  } else {
    if (item === 'ship') return { err: 'Buy orders for ships are not supported — browse listings' };
    if (p.inv.gold < qty * price) return { err: 'Not enough gold to place that buy order' };
    p.inv.gold -= qty * price;
  }
  const fills = match(W, order);
  if (order.qty > 0 && !o.instant) W.market.push(order);
  else if (order.qty > 0) refund(W, order); // instant (IOC) order: return the unfilled remainder
  return { order, fills };
}
const MARKET_ITEMS_SET = new Set(['oak', 'iron', 'canvas', 'powder', 'chain', 'grape', 'explosive']);

function refund(W, o) {
  const p = escrow(W, o.owner);
  if (o.side === 'sell') { if (o.ship) p.fleet?.push(o.ship); else p.inv[o.item] += o.qty; }
  else p.inv.gold += o.qty * o.price;
  o.qty = 0;
}
export function cancelOrder(W, pid, id) {
  const i = W.market.findIndex((o) => o.id === id && o.owner === pid);
  if (i < 0) return 'No such order';
  refund(W, W.market.splice(i, 1)[0]);
  return null;
}
/** Match an incoming order against the book at the resting (maker) price. */
function match(W, inc) {
  const fills = [];
  const book = W.market
    .filter((o) => o.item === inc.item && o.side !== inc.side && o.owner !== inc.owner && (inc.side === 'buy' ? o.price <= inc.price : o.price >= inc.price))
    .filter((o) => inc.item !== 'ship' || inc.side === 'buy')
    .sort((a, b) => (inc.side === 'buy' ? a.price - b.price : b.price - a.price) || a.at - b.at);
  for (const rest of book) {
    if (inc.qty <= 0) break;
    const q = Math.min(inc.qty, rest.qty);
    const px = rest.price;
    const sell = inc.side === 'sell' ? inc : rest, buy = inc.side === 'buy' ? inc : rest;
    settle(W, sell, buy, q, px);
    fills.push({ q, px });
    inc.qty -= q; rest.qty -= q;
  }
  W.market = W.market.filter((o) => o.qty > 0);
  return fills;
}
function settle(W, sell, buy, q, px) {
  const seller = escrow(W, sell.owner), buyer = escrow(W, buy.owner);
  const gross = q * px, tax = Math.ceil(gross * MARKET_TAX);
  seller.inv.gold += gross - tax;
  W.taxPool = (W.taxPool || 0) + tax;
  if (sell.ship) buyer.fleet?.push(sell.ship);
  else buyer.inv[sell.item] = (buyer.inv[sell.item] || 0) + q;
  // buyer had escrowed at their own price; refund any price improvement
  buyer.inv.gold += q * (buy.price - px);
  W.trades.push({ item: sell.item, q, px, at: Date.now(), seller: sell.owner, buyer: buy.owner });
  if (W.trades.length > 60) W.trades.shift();
}
/** Instant buy: take the cheapest listings up to qty (IOC). */
export function instantBuy(W, pid, item, qty) {
  const px = sweepPrice(W, item, qty, pid, 'sell');
  if (!px) return { err: 'No sellers for ' + item };
  return placeOrder(W, pid, { side: 'buy', item, qty, price: px, instant: true });
}
export function instantSell(W, pid, item, qty) {
  const px = sweepPrice(W, item, qty, pid, 'buy');
  if (!px) return { err: 'No buyers for ' + item };
  return placeOrder(W, pid, { side: 'sell', item, qty, price: px, instant: true });
}
/** Worst price needed to fill `qty` against resting orders on `side`. */
export function sweepPrice(W, item, qty, notOwner, side) {
  const book = W.market.filter((o) => o.item === item && o.side === side && o.owner !== notOwner).sort((a, b) => (side === 'sell' ? a.price - b.price : b.price - a.price));
  let left = qty, px = 0;
  for (const o of book) { px = o.price; left -= o.qty; if (left <= 0) break; }
  return px;
}
export function bestAsk(W, item, notOwner) { let m = 0; for (const o of W.market) if (o.item === item && o.side === 'sell' && o.owner !== notOwner && (!m || o.price < m)) m = o.price; return m; }
export function bestBid(W, item, notOwner) { let m = 0; for (const o of W.market) if (o.item === item && o.side === 'buy' && o.owner !== notOwner && o.price > m) m = o.price; return m; }
/** Buy a specific listing (used for ships). */
export function buyListing(W, pid, id) {
  const o = W.market.find((x) => x.id === id && x.side === 'sell');
  if (!o) return { err: 'Listing gone' };
  if (o.owner === pid) return { err: 'That is your own listing' };
  const p = escrow(W, pid);
  if (p.inv.gold < o.price * o.qty) return { err: 'Not enough gold' };
  p.inv.gold -= o.price * o.qty;
  const buy = { id: uid('o'), side: 'buy', item: o.item, qty: o.qty, price: o.price, owner: pid, at: Date.now() };
  settle(W, o, buy, o.qty, o.price);
  W.market = W.market.filter((x) => x !== o);
  return { ok: true };
}

/** NPC merchants keep liquidity in the book so the market works solo. */
export const NPC_PRICES = { oak: 6, iron: 14, canvas: 11, powder: 22, chain: 9, grape: 8, explosive: 26 };
export function npcRestock(W, rand = Math.random) {
  W.npc.inv.gold = 1e9;
  for (const item of Object.keys(NPC_PRICES)) {
    const base = NPC_PRICES[item];
    const asks = W.market.filter((o) => o.owner === 'npc' && o.item === item && o.side === 'sell');
    const bids = W.market.filter((o) => o.owner === 'npc' && o.item === item && o.side === 'buy');
    if (asks.length < 2) { W.npc.inv[item] = (W.npc.inv[item] || 0) + 60; placeOrder(W, 'npc', { side: 'sell', item, qty: 30 + Math.floor(rand() * 30), price: Math.round(base * (1.25 + rand() * 0.25)) }); }
    if (bids.length < 2) placeOrder(W, 'npc', { side: 'buy', item, qty: 30 + Math.floor(rand() * 30), price: Math.max(1, Math.round(base * (0.6 + rand() * 0.15))) });
  }
}

// ------------------------------------------------------------------ world creation
export function newWorld(seed = Math.floor(Math.random() * 1e9)) {
  return {
    v: 1, seed, created: Date.now(), time: 0,
    players: {}, bases: [], market: [], trades: [], treaties: [], proposals: [], ai: {},
    npc: { id: 'npc', inv: { gold: 1e9 }, fleet: [] }, taxPool: 0,
    log: [],
  };
}
export const sinkLoot = (tier, rand = Math.random) => {
  const i = TIERS.findIndex((t) => t.id === tier);
  const k = 1 + i * 0.9;
  return {
    gold: Math.round((60 + rand() * 60) * k), oak: Math.round((6 + rand() * 8) * k), iron: Math.round((2 + rand() * 4) * k),
    canvas: Math.round((2 + rand() * 5) * k), powder: Math.round(rand() * 3 * k),
  };
};
