// Game data: ship tiers, upgrades, ammo, resources, buildings, recipes.
// Everything balance-related lives here so logic tests and the dev console can read it.

export const VERSION = '2.7.0';

export const RES = ['gold', 'oak', 'iron', 'canvas', 'powder'];
export const RES_LABEL = { gold: 'Gold', oak: 'Oak', iron: 'Iron', canvas: 'Canvas', powder: 'Powder' };
export const RES_ICON = { gold: '◉', oak: '▤', iron: '▣', canvas: '◫', powder: '✸' };

// Ammo. `ball` is unlimited round shot; the rest are crafted.
export const AMMO = {
  ball:      { name: 'Round Shot',  hull: 1.0, sail: 0.25, crew: 0.15, speed: 1.0,  color: 0x222222, key: '1' },
  chain:     { name: 'Chainshot',   hull: 0.3, sail: 2.4,  crew: 0.1,  speed: 0.92, color: 0x555555, key: '2' },
  grape:     { name: 'Grapeshot',   hull: 0.2, sail: 0.4,  crew: 2.6,  speed: 0.9,  color: 0x777766, key: '3' },
  explosive: { name: 'Explosive',   hull: 2.3, sail: 0.6,  crew: 0.6,  speed: 0.95, color: 0xaa3311, key: '4', fire: true },
};
export const AMMO_ORDER = ['ball', 'chain', 'grape', 'explosive'];

// Crafting: inputs -> amount of rounds out.
export const RECIPES = {
  chain:     { in: { iron: 3, canvas: 1 }, out: 10 },
  grape:     { in: { iron: 2, gold: 10 }, out: 10 },
  explosive: { in: { iron: 2, powder: 3 }, out: 6 },
  powder:    { in: { oak: 4, gold: 20 }, out: 3, res: true },
};

// Ship tiers. `side` = cannons per broadside (spec), `minSide`/`maxSide` = shipyard/upgrade range.
// len/beam in metres, speed m/s at full sail, turn rad/s. Every tier has its own hull design (layout.js).
export const TIERS = [
  { id: 'sloop',      name: 'Sloop',       side: 1,  minSide: 1, maxSide: 2,  len: 16, beam: 4.4, depth: 2.3, masts: 1, rig: 'sloop',      speed: 23,   turn: 0.72, hull: 260,  sails: 120, crew: 18,  decks: 1, level: 1,  look: { hullColor: '#6b4a2e', trimColor: '#e6dcc4', sailColor: '#efe6cf' }, cost: { gold: 0 } },
  { id: 'schooner',   name: 'Schooner',    side: 1,  minSide: 1, maxSide: 3,  len: 24, beam: 5.2, depth: 2.7, masts: 2, rig: 'schooner',   speed: 25,   turn: 0.6,  hull: 380,  sails: 170, crew: 26,  decks: 1, level: 3,  cost: { gold: 600, oak: 40, iron: 10, canvas: 20 } },
  { id: 'brigantine', name: 'Brigantine',  side: 2,  minSide: 2, maxSide: 4,  len: 30, beam: 7.4, depth: 3.5, masts: 2, rig: 'brigantine', speed: 21.5, turn: 0.5,  hull: 560,  sails: 240, crew: 45,  decks: 1, level: 6,  cost: { gold: 1500, oak: 90, iron: 30, canvas: 45 } },
  // The Xebec: a lean Barbary raider with three lateen sails and overhanging bow + stern. The fastest hull you can buy.
  { id: 'xebec',      name: 'Xebec',       side: 3,  minSide: 2, maxSide: 6,  len: 34, beam: 7.2, depth: 3.3, masts: 3, rig: 'xebec',     speed: 26.5, turn: 0.64, hull: 640,  sails: 270, crew: 70,  decks: 1, level: 8,  look: { hullColor: '#7a3f1c', trimColor: '#e9c46a', sailColor: '#f3e6c6' }, cost: { gold: 2600, oak: 120, iron: 45, canvas: 75 } },
  { id: 'frigate',    name: 'Frigate',     side: 3,  minSide: 3, maxSide: 7,  len: 42, beam: 10.2, depth: 4.6, masts: 3, rig: 'ship',      speed: 20,   turn: 0.42, hull: 900,  sails: 340, crew: 80,  decks: 1, level: 10, look: { hullColor: '#1b1a18', trimColor: '#d9a63a', sailColor: '#f2ede0' }, cost: { gold: 3600, oak: 180, iron: 70, canvas: 90 } },
  // The War Junk: teak-hulled and heavily built, red battened sails, a towering stern. Slow but shrugs off shot.
  { id: 'junk',       name: 'War Junk',    side: 4,  minSide: 3, maxSide: 8,  len: 44, beam: 12, depth: 5.4, masts: 3, rig: 'junk',       speed: 18.5, turn: 0.42, hull: 1350, sails: 430, crew: 130, decks: 1, level: 12, armor: 0.88, look: { hullColor: '#4a2416', trimColor: '#d6a531', sailColor: '#a2402a' }, cost: { gold: 5200, oak: 260, iron: 95, canvas: 130 } },
  { id: 'galleon',    name: 'Galleon',     side: 5,  minSide: 4, maxSide: 10, len: 50, beam: 13.2, depth: 6.0, masts: 4, rig: 'galleon',   speed: 17,   turn: 0.32, hull: 1500, sails: 440, crew: 150, decks: 2, level: 15, look: { hullColor: '#4a2a16', trimColor: '#d4a73a', sailColor: '#ead9ae' }, cost: { gold: 7500, oak: 320, iron: 140, canvas: 150 } },
  { id: 'manowar',    name: 'Man of War',  side: 10, minSide: 8, maxSide: 20, len: 74, beam: 18.5, depth: 9.6, masts: 3, rig: 'line',     speed: 15,   turn: 0.24, hull: 3400, sails: 700, crew: 340, decks: 3, level: 22, look: { hullColor: '#191715', trimColor: '#e2b84a', sailColor: '#f4f0e4' }, cost: { gold: 16000, oak: 600, iron: 300, canvas: 260 } },
  // The Sovereign: a four-decked royal first-rate, gilded from stem to stern. Very expensive; can sail in a fleet.
  { id: 'sovereign',  name: 'Sovereign',   side: 16, minSide: 12, maxSide: 34, sizeGuns: [18, 34], len: 90, beam: 27, depth: 11.5, masts: 3, rig: 'sovereign', speed: 14.5, turn: 0.21, hull: 6400, sails: 1100, crew: 640, decks: 4, level: 30, armor: 0.8, look: { hullColor: '#22407e', trimColor: '#e8bd4a', sailColor: '#f6f1e2' }, cost: { gold: 450000, oak: 14000, iron: 7000, canvas: 5000, powder: 1500 } },
  // The Leviathan: a monstrous, broad five-decked ironclad ship of the line. Flagship only, and ruinously expensive.
  { id: 'leviathan',  name: 'Leviathan',   side: 30, minSide: 24, maxSide: 60, sizeGuns: [30, 60], len: 116, beam: 35, depth: 12.5, masts: 4, rig: 'leviathan', speed: 13.5, turn: 0.17, hull: 11000, sails: 1700, crew: 1100, decks: 5, level: 40, armor: 0.6, flagshipOnly: true, look: { hullColor: '#141210', trimColor: '#c4932e', sailColor: '#ece6d6' }, cost: { gold: 2500000, oak: 45000, iron: 28000, canvas: 16000, powder: 6000 } },
  // The Ghost Ship: a drowned frigate that would not stay down. Only won as a reward card (Wheel of Fortune, or the
  // Phantom that haunts the night seas). Glowing tattered sails, and its hull knits itself back together.
  { id: 'ghost',      name: 'Ghost Ship',  side: 9,  minSide: 7, maxSide: 16, len: 58, beam: 14, depth: 6.4, masts: 3, rig: 'ghost',     speed: 23, turn: 0.4, hull: 3200, sails: 660, crew: 260, decks: 2, level: 1, regen: 0.004, armor: 0.85, cardOnly: true, howToGet: 'Win it on the Wheel of Fortune, or sink the Phantom that haunts the seas at night', look: { hullColor: '#16211d', trimColor: '#4dffc3', sailColor: '#a6f0d6' }, cost: { gold: 0 } },
  // Festival ships: on sale at any Shipwright ONLY while their festival runs (every year, `from`..`to` as MM-DD);
  // once bought they are yours for good, and each comes with its own exclusive wake trail.
  // Harvest Moon (Thanksgiving): a broad, heavily laden harvest galleon — tough, and its carpenters keep it mended.
  { id: 'harvest',    name: 'Harvest Moon', side: 12, minSide: 9, maxSide: 22, len: 64, beam: 17, depth: 8, masts: 3, rig: 'harvest', speed: 19.5, turn: 0.31, hull: 4400, sails: 860, crew: 440, decks: 2, level: 15, armor: 0.84, regen: 0.0015, limited: { from: '11-19', to: '12-02', fest: 'Thanksgiving', trail: 'autumn' }, look: { hullColor: '#5a2a12', trimColor: '#e3a02a', sailColor: '#ee8f34' }, cost: { gold: 60000, oak: 1600, iron: 700, canvas: 600, powder: 150 } },
  // Yuletide (Christmas): an evergreen-hulled frigate-of-the-line, fast and frosted, strung with fairy lights.
  { id: 'yule',       name: 'Yuletide',     side: 14, minSide: 10, maxSide: 26, len: 70, beam: 18, depth: 8.4, masts: 3, rig: 'yule', speed: 21.5, turn: 0.33, hull: 5200, sails: 940, crew: 500, decks: 2, level: 18, armor: 0.8, regen: 0.0015, limited: { from: '12-12', to: '12-28', fest: 'Christmas', trail: 'frost' }, look: { hullColor: '#123a24', trimColor: '#d9b04a', sailColor: '#f7f9ff' }, cost: { gold: 90000, oak: 2200, iron: 1000, canvas: 800, powder: 250 } },
  // Stroke of Midnight (New Year): black and gold, three gun decks, a clock tower aft and fireworks on deck.
  { id: 'midnight',   name: 'Stroke of Midnight', side: 16, minSide: 12, maxSide: 30, len: 78, beam: 20, depth: 9, masts: 3, rig: 'midnight', speed: 22, turn: 0.31, hull: 6200, sails: 1050, crew: 600, decks: 3, level: 20, armor: 0.76, regen: 0.0015, limited: { from: '12-29', to: '01-08', fest: 'New Year', trail: 'fireworks' }, look: { hullColor: '#0d0d16', trimColor: '#f2c14e', sailColor: '#1d2a5a' }, cost: { gold: 120000, oak: 2800, iron: 1400, canvas: 1000, powder: 400 } },
  // The Collector's Ark: a floating museum — a turning carousel of display cases holding a miniature of every
  // major game. Ultra-rare, collectors only: the final door of the Games Month Advent calendar. Still sails and
  // fights like a solid frigate.
  { id: 'collector',  name: "Collector's Ark", side: 10, minSide: 8, maxSide: 18, len: 62, beam: 22, depth: 6.6, masts: 2, rig: 'collector', speed: 20, turn: 0.34, hull: 4000, sails: 720, crew: 320, decks: 1, level: 1, armor: 0.82, regen: 0.002, cardOnly: true, howToGet: 'Open all 14 doors of the Games Month Advent calendar (Rewards tab, every November)', look: { hullColor: '#2b2342', trimColor: '#ffd34d', sailColor: '#6a3bb5' }, cost: { gold: 0 } },
  // The Titan: cannot be bought with gold — only won (Wheel of Fortune, Holiday Tides event) as a reward card.
  // 150 m, six gun decks, black sails; bigger than 100% only with a Titan Size card.
  { id: 'titan',      name: 'Titan',       side: 120, minSide: 100, maxSide: 150, sizeGuns: [100, 150], len: 150, beam: 46, depth: 14, masts: 5, rig: 'titan', speed: 16, turn: 0.26, hull: 26000, sails: 3200, crew: 2200, decks: 6, level: 1, armor: 0.5, reload: 4, cardOnly: true, flagshipOnly: true, look: { hullColor: '#0b0a0c', trimColor: '#b3201c', sailColor: '#2a1515' }, cost: { gold: 0 } },
];
/** Highest tier index an AI captain (or a fleet ship) may sail: everything up to the Man of War. */
export const AI_TOP_TIER = TIERS.findIndex((t) => t.id === 'manowar');
/** Tiers that can be bought or built with gold (the Titan only comes as a reward card). */
export const shopTiers = () => TIERS.filter((t) => !t.cardOnly);

// ------------------------------------------------------------------ rewards: Wheel of Fortune, daily event, cards
/** Reward cards: a won ship is a card you redeem at any Shipwright (standard hull) or in the custom shipyard. */
export const TITAN_SIZE_PRICE = 4000000; // a Titan Size card from the Shipwright: lets a Titan be built above 100%
export const WHEEL = {
  cost: 20000,
  // chance of each slice (they add up to 1); ships and the size card come as reward cards
  prizes: [
    { id: 'titan', kind: 'ship', tier: 'titan', p: 0.001, label: 'TITAN', color: '#b3201c' },
    { id: 'leviathan', kind: 'ship', tier: 'leviathan', p: 0.005, label: 'Leviathan', color: '#2b2622' },
    { id: 'sovereign', kind: 'ship', tier: 'sovereign', p: 0.007, label: 'Sovereign', color: '#22407e' },
    { id: 'manowar', kind: 'ship', tier: 'manowar', p: 0.01, label: 'Man of War', color: '#4a4036' },
    { id: 'ghost', kind: 'ship', tier: 'ghost', p: 0.004, label: 'Ghost Ship', color: '#14584a' },
    { id: 'galleon', kind: 'ship', tier: 'galleon', p: 0.02, label: 'Galleon', color: '#7a4a24' },
    { id: 'tsize', kind: 'titanSize', p: 0.002, label: 'Titan Size', color: '#8a1a5a' },
    { id: 'g100k', kind: 'gold', n: 100000, p: 0.01, label: '100k gold', color: '#c9a227' },
    { id: 'g25k', kind: 'gold', n: 25000, p: 0.06, label: '25k gold', color: '#d9b84a' },
    { id: 'g8k', kind: 'gold', n: 8000, p: 0.2, label: '8k gold', color: '#e6cc72' },
    { id: 'mats', kind: 'res', items: { oak: 300, iron: 150, canvas: 150 }, p: 0.2, label: 'Materials', color: '#6b8a3a' },
    { id: 'shot', kind: 'res', items: { powder: 80, chain: 40, grape: 40, explosive: 20 }, p: 0.15, label: 'Powder + shot', color: '#5a5a6a' },
    { id: 'g3k', kind: 'gold', n: 3000, p: 0.331, label: '3k gold', color: '#efe0a8' },
  ],
};
/** Holiday Tides: claim a gift every day; claim EVERY day through New Year's Day for a Titan card. */
// Treasure maps: dropped by sunk pirates (or bought from the Free Port tavern); sail to the X and dig (E).
export const TREASURE = { price: 2500, max: 3, drop: 0.14, range: 95 };
// Boarding: come alongside a crippled ship (hull or crew broken) and send your crew across. Capture it into
// your fleet or strip it bare. Odds follow the crews; flagships, wanted men and phantoms can only be plundered.
export const BOARD = { hull: 0.35, crew: 0.3, gap: 14, relSpeed: 7, cd: 20, fleetMax: 30 };
// Voyages: charter passage from a harbour to the Free Port or one of your own islands. Gold per metre travelled.
export const VOYAGE = { base: 250, perM: 0.35 };
// Bounty hunts: a wanted captain sails somewhere on the map; sinking them pays the bounty plus a wheel spin.
export const BOUNTY_NAMES = ['"Mad" Jack Morrow', 'Esmé Blackwater', 'Silas Vane', 'Captain Gristle', 'Old Ironjaw', 'Red Annie Kell', 'The Drowned Duke', 'Marrow Teach', 'Hollis Grimm', 'Lady Cinder'];
export const HOLIDAY = { name: 'Holiday Tides', start: '2026-11-09', end: '2027-01-01', sizeDay: '2026-12-25' };
/** Is a festival ship on sale today? (`now` in ms; windows are local MM-DD and may wrap past New Year) */
export function limitedOpen(T, now) {
  if (typeof T === 'string') T = tierById(T);
  if (!T.limited) return true;
  const d = new Date(now), md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const { from, to } = T.limited;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}
/** International Games Month advent calendar: 14 doors, one opens per day from 12 November; the event stays open to
 *  the 30th so a few missed days can be caught up (still one door a day). Door 7 = Titan, door 14 = Collector's Ark. */
export const ADVENT = { name: 'Games Month Advent', month: 11, startDay: 12, endDay: 30, doors: 14 };
export const tierById = (id) => TIERS.find((t) => t.id === id) || TIERS[0];
/** Most cannons per side a hull of this tier can carry at a given size (85%..120%). Bigger hulls fit more:
 *  a Leviathan carries 30 a side at 85% and 60 at 120%; other tiers scale their limit with size. */
export function maxSideFor(T, size = 1) {
  if (typeof T === 'string') T = tierById(T);
  if (T.sizeGuns) { const [lo, hi] = T.sizeGuns; return Math.round(lo + (hi - lo) * Math.max(0, Math.min(1, (size - 0.85) / 0.35))); }
  return Math.max(T.minSide, Math.round(T.maxSide * size));
}
export const tierIndex = (id) => Math.max(0, TIERS.findIndex((t) => t.id === id));
/** Power rank of a tier (classic ladder 0..8; the side-branch ships slot in between). Drives range, loot, AI nerve. */
const RANK = { sloop: 0, schooner: 1, brigantine: 2, xebec: 2.5, frigate: 3, junk: 3.5, galleon: 4, collector: 4.5, manowar: 5, ghost: 5, harvest: 5.2, yule: 5.4, midnight: 5.6, sovereign: 6, leviathan: 7, titan: 8 };
export const tierRank = (id) => RANK[id] ?? tierIndex(id);

// Upgrades bought with level points. Lots of ranks so points stay useful all the way to level 200
// (≈230 ranks in total). `per` is the effect per rank (see economy.shipStats).
export const UPGRADES = {
  side:     { name: 'Extra Broadside',  desc: '+1 cannon per side per rank (up to the hull\'s limit, which grows with hull size — a Man of War carries 20, a 120% Leviathan 60).', max: 30, per: 1, cat: 'Guns' },
  bow:      { name: 'Bow Chasers',      desc: '+1 forward-firing cannon per rank.', max: 4, per: 1, cat: 'Guns' },
  stern:    { name: 'Stern Chasers',    desc: '+1 rear-firing cannon per rank.', max: 4, per: 1, cat: 'Guns' },
  reload:   { name: 'Drilled Gunners',  desc: '+4% firing rate per rank.', max: 20, per: 0.04, cat: 'Guns' },
  range:    { name: 'Long Guns',        desc: '+3% cannon range per rank.', max: 15, per: 0.03, cat: 'Guns' },
  damage:   { name: 'Heavy Shot',       desc: '+3% cannonball damage per rank.', max: 20, per: 0.03, cat: 'Guns' },
  accuracy: { name: 'Gun Captains',     desc: '-6% shot spread per rank.', max: 10, per: 0.06, cat: 'Guns' },
  speed:    { name: 'Copper Bottom',    desc: '+2.4% top speed per rank.', max: 25, per: 0.024, cat: 'Sailing' },
  turn:     { name: 'Balanced Rudder',  desc: '+3% turn rate per rank.', max: 20, per: 0.03, cat: 'Sailing' },
  sails:    { name: 'Storm Canvas',     desc: '+6% sail strength per rank.', max: 15, per: 0.06, cat: 'Sailing' },
  hull:     { name: 'Oak Plating',      desc: '+5% hull strength per rank.', max: 30, per: 0.05, cat: 'Defence' },
  armor:    { name: 'Iron Bands',       desc: '-2% damage taken per rank.', max: 15, per: 0.02, cat: 'Defence' },
  crew:     { name: 'Bigger Crew',      desc: '+5% crew per rank (more hands to lose before you slow down).', max: 15, per: 0.05, cat: 'Defence' },
  repair:   { name: 'Ship\'s Carpenters', desc: 'Repair hull at sea out of combat (+0.08%/s per rank).', max: 10, per: 0.0008, cat: 'Defence' },
  harvest:  { name: 'Foragers',         desc: '+15% harvest yield per rank.', max: 10, per: 0.15, cat: 'Plunder' },
  plunder:  { name: 'Plunderers',       desc: '+8% gold from sunk ships and conquest per rank.', max: 10, per: 0.08, cat: 'Plunder' },
  fleet:    { name: 'Commodore',        desc: '+1 fleet ship you can deploy at once per rank.', max: 6, per: 1, cat: 'Plunder' },
};
export const UPGRADE_TOTAL = Object.values(UPGRADES).reduce((a, u) => a + u.max, 0);

export const XP_PER_LEVEL = (lvl) => Math.round(110 * Math.pow(lvl, 1.25));
export const MAX_LEVEL = 200;

// Gunnery
export const GRAVITY = 9.81;
export const MUZZLE = 78;               // m/s
export const MAX_ELEV = 0.26;           // rad (~15 deg) => ~300 m max at muzzle speed (Long Guns raise muzzle speed)
export const SECTOR_HALF = 0.62;        // rad, half-width of the broadside sector
export const CHASE_HALF = 0.32;         // rad, half-width of bow/stern chaser sectors
export const BASE_RELOAD = 3.2;         // s, at full crew
export const MIN_RANGE = 18;

export const rangeFor = (tier) => {
  const v = MUZZLE;
  return Math.min((v * v * Math.sin(2 * MAX_ELEV)) / GRAVITY, 240 + tierRank(tier) * 14);
};

// Buildings. `slot`: 'land' building ring, 'shore' for cannons, 'sea' for forts.
export const BUILDINGS = {
  keep:       { name: 'Captain\'s Keep', desc: 'The heart of the base. Destroy it to conquer the island.', slot: 'core', cost: {}, hp: 1500, unique: true },
  camp:       { name: 'Squatter Stockade', desc: 'Wild islands are held by squatters. Destroy the stockade and hold position to claim the island.', slot: 'core', cost: {}, hp: 600, unique: true, gun: { range: 190, dmg: 22, reload: 4.5 } },
  dock:       { name: 'Docks',          desc: 'Lets you dock, repair and trade here. Extends the pier.', slot: 'land', cost: { gold: 300, oak: 40 }, hp: 500, unique: true },
  shipyard:   { name: 'Shipyard',       desc: 'Build custom ships from oak, iron and canvas.', slot: 'land', cost: { gold: 1200, oak: 120, iron: 40 }, hp: 700, unique: true, needs: 'dock' },
  watchtower: { name: 'Watchtower',     desc: 'Spots ships far away and fires a light cannon.', slot: 'land', cost: { gold: 500, oak: 60, iron: 10 }, hp: 450, gun: { range: 260, dmg: 30, reload: 4 } },
  warehouse:  { name: 'Warehouse',      desc: '+50% passive production at this base.', slot: 'land', cost: { gold: 600, oak: 80 }, hp: 500, unique: true },
  lumber:     { name: 'Lumber Mill',    desc: 'Produces oak over time.', slot: 'land', cost: { gold: 250, iron: 5 }, hp: 350, prod: { oak: 6 } },
  mine:       { name: 'Iron Mine',      desc: 'Produces iron over time.', slot: 'land', cost: { gold: 400, oak: 30 }, hp: 350, prod: { iron: 3 } },
  loft:       { name: 'Sail Loft',      desc: 'Weaves canvas over time.', slot: 'land', cost: { gold: 350, oak: 25 }, hp: 350, prod: { canvas: 3 } },
  powderhouse:{ name: 'Powder House',   desc: 'Mixes gunpowder over time.', slot: 'land', cost: { gold: 700, oak: 40, iron: 20 }, hp: 300, prod: { powder: 2 } },
  cannon:     { name: 'Shore Cannon',   desc: 'Position anywhere on the shoreline. Fires on hostiles.', slot: 'shore', cost: { gold: 400, iron: 30 }, hp: 300, gun: { range: 240, dmg: 42, reload: 3.2 } },
  fort:       { name: 'Sea Fort',       desc: 'Stone bastion in the shallows with 4 heavy guns.', slot: 'sea', cost: { gold: 2500, oak: 60, iron: 160 }, hp: 1600, gun: { range: 300, dmg: 55, reload: 1.6 }, needs: 'watchtower' },
};
export const LAND_SLOTS = 10;
export const PROD_PERIOD = 60; // seconds of game time per production tick

export const MARKET_TAX = 0.05;
export const MARKET_ITEMS = ['oak', 'iron', 'canvas', 'powder', 'chain', 'grape', 'explosive'];

// Treaties
export const TREATY_TYPES = { peace: 'Peace (no attacks)', trade: 'Trade (no entry fees)', alliance: 'Alliance (shared havens)' };

// Island/world
export const WORLD_R = 12000; // v2.5: doubled (4× the sea); older 6000 m worlds gain the outer ring on load
export const HAVEN_R = 340;

// Fleet + claiming
export const FLEET_BASE = 2;              // ships deployable at once before Commodore ranks
// At-sea repairs (R): carpenters patch the hull with oak from your hold.
export const FIELD_REPAIR = { frac: 0.14, sails: 0.1, oakPer: 9, minOak: 3, cd: 7 };

// Wake trails: cosmetic colours bought with gold (Chandlery). `null` colour = plain white foam.
export const TRAILS = {
  foam:    { name: 'Sea Foam',      color: null,      cost: 0 },
  gold:    { name: 'Gilded Wake',   color: '#ffcf3a', cost: 1500 },
  ember:   { name: 'Ember Wake',    color: '#ff5a1f', cost: 2500 },
  crimson: { name: 'Blood Tide',    color: '#e0182e', cost: 3500 },
  emerald: { name: 'Emerald Spray', color: '#28e07a', cost: 3500 },
  azure:   { name: 'Azure Glow',    color: '#2fa8ff', cost: 3500 },
  violet:  { name: 'Ghost Violet',  color: '#b25cff', cost: 6000 },
  ghost:   { name: 'Phantom Mist',  color: '#9fffe8', cost: 9000 },
  rainbow: { name: 'Rainbow Wake',  color: 'rainbow', cost: 20000 },
  // exclusives: never sold — they come with a festival ship or from the advent calendar
  autumn:    { name: 'Falling Leaves', color: '#e8742a', cost: 0, style: 'autumn',    exclusive: 'Comes with the Harvest Moon' },
  frost:     { name: 'Frostwake',      color: '#bfe9ff', cost: 0, style: 'frost',     exclusive: 'Comes with the Yuletide' },
  fireworks: { name: 'Fireworks Wake', color: '#ffd34d', cost: 0, style: 'fireworks', exclusive: 'Comes with the Stroke of Midnight' },
  arcade:    { name: 'Arcade Wake',    color: '#ff4fd8', cost: 0, style: 'arcade',    exclusive: 'Games Month Advent, door 5' },
};
export const claimFee = (owned) => Math.round(300 * Math.pow(Math.max(1, owned), 1.6));
// AI pirate clans (each holds a fortress and upgrades it over time)
export const CLAN_NAMES = ['Blackfang Clan', 'Red Tide Brotherhood', 'Skullcrag Raiders', 'Iron Gull Corsairs', 'The Widowmakers', 'Salt Wraiths', 'Kraken\'s Teeth', 'Ember Fleet', 'Bone Harbour Band', 'Crimson Gulls', 'Storm Jackals', 'Gilded Knives', 'Rotten Anchors', 'Deadlight Company', 'Black Lantern Gang', 'Hangman\'s Crew', 'Sunken Crown Syndicate', 'Rook Brothers', 'Maw Reavers', 'Stormwall Corsairs'];
export const CLAN_PLAN = ['cannon', 'watchtower', 'cannon', 'lumber', 'dock', 'cannon', 'mine', 'warehouse', 'fort', 'cannon', 'powderhouse', 'cannon', 'fort', 'loft', 'cannon', 'cannon', 'fort', 'cannon', 'cannon', 'cannon'];

// Lookup tables are indexed by ids that arrive from peers: give them no prototype, so 'constructor',
// '__proto__' and friends are simply unknown ids instead of Object built-ins.
for (const t of [RES_LABEL, RES_ICON, AMMO, RECIPES, UPGRADES, BUILDINGS, TREATY_TYPES, TRAILS]) Object.setPrototypeOf(t, null);
