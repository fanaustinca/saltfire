// Game data: ship tiers, upgrades, ammo, resources, buildings, recipes.
// Everything balance-related lives here so logic tests and the dev console can read it.

export const VERSION = '1.0.0';

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

// Ship tiers. `side` = cannons per broadside (spec), `minSide`/`maxSide` = shipyard custom range.
// len/beam in metres, speed m/s at full sail, turn rad/s.
export const TIERS = [
  { id: 'sloop',      name: 'Sloop',       side: 1,  minSide: 1, maxSide: 2,  len: 16, beam: 4.6, depth: 2.4, masts: 1, rig: 'gaff',  speed: 15, turn: 0.62, hull: 260,  sails: 120, crew: 18,  decks: 1, level: 1,  cost: { gold: 0 } },
  { id: 'schooner',   name: 'Schooner',    side: 1,  minSide: 1, maxSide: 3,  len: 22, beam: 5.4, depth: 2.8, masts: 2, rig: 'gaff',  speed: 16, turn: 0.52, hull: 380,  sails: 170, crew: 26,  decks: 1, level: 3,  cost: { gold: 600, oak: 40, iron: 10, canvas: 20 } },
  { id: 'brigantine', name: 'Brigantine',  side: 2,  minSide: 2, maxSide: 4,  len: 28, beam: 7.2, depth: 3.4, masts: 2, rig: 'brig',  speed: 14, turn: 0.44, hull: 560,  sails: 240, crew: 45,  decks: 1, level: 6,  cost: { gold: 1500, oak: 90, iron: 30, canvas: 45 } },
  { id: 'frigate',    name: 'Frigate',     side: 3,  minSide: 3, maxSide: 6,  len: 38, beam: 9.6, depth: 4.4, masts: 3, rig: 'square', speed: 13, turn: 0.36, hull: 900,  sails: 340, crew: 80,  decks: 1, level: 10, cost: { gold: 3600, oak: 180, iron: 70, canvas: 90 } },
  { id: 'galleon',    name: 'Galleon',     side: 5,  minSide: 4, maxSide: 8,  len: 46, beam: 12.4, depth: 5.6, masts: 3, rig: 'galleon', speed: 11, turn: 0.28, hull: 1400, sails: 420, crew: 140, decks: 2, level: 15, cost: { gold: 7500, oak: 320, iron: 140, canvas: 150 } },
  { id: 'manowar',    name: 'Man of War',  side: 10, minSide: 8, maxSide: 12, len: 60, beam: 15.0, depth: 7.0, masts: 3, rig: 'square', speed: 9.5, turn: 0.2, hull: 2400, sails: 560, crew: 260, decks: 3, level: 22, cost: { gold: 16000, oak: 600, iron: 300, canvas: 260 } },
];
export const tierById = (id) => TIERS.find((t) => t.id === id) || TIERS[0];
export const tierIndex = (id) => Math.max(0, TIERS.findIndex((t) => t.id === id));

// Upgrades bought with level points. Each has a max rank.
export const UPGRADES = {
  bow:     { name: 'Bow Chasers',     desc: 'Forward-firing cannons (+1 per rank).', max: 2 },
  stern:   { name: 'Stern Chasers',   desc: 'Rear-firing cannons (+1 per rank).', max: 2 },
  side:    { name: 'Extra Broadside', desc: '+1 cannon per side per rank (up to tier limit).', max: 3 },
  speed:   { name: 'Copper Bottom',   desc: '+6% top speed per rank.', max: 5 },
  hull:    { name: 'Oak Plating',     desc: '+10% hull strength per rank.', max: 5 },
  turn:    { name: 'Balanced Rudder', desc: '+8% turn speed per rank.', max: 5 },
  reload:  { name: 'Drilled Gunners', desc: '-8% reload time per rank.', max: 5 },
};

export const XP_PER_LEVEL = (lvl) => Math.round(120 * Math.pow(lvl, 1.45));
export const MAX_LEVEL = 40;

// Gunnery
export const GRAVITY = 9.81;
export const MUZZLE = 78;               // m/s
export const MAX_ELEV = 0.26;           // rad (~15 deg) => ~300 m max at muzzle speed
export const SECTOR_HALF = 0.62;        // rad, half-width of the broadside sector
export const CHASE_HALF = 0.32;         // rad, half-width of bow/stern chaser sectors
export const BASE_RELOAD = 6.5;         // s, at full crew
export const MIN_RANGE = 18;

export const rangeFor = (tier) => {
  const v = MUZZLE;
  return Math.min((v * v * Math.sin(2 * MAX_ELEV)) / GRAVITY, 240 + tierIndex(tier) * 14);
};

// Buildings. `slot`: 'land' building ring, 'shore' for cannons, 'sea' for forts.
export const BUILDINGS = {
  keep:       { name: 'Captain\'s Keep', desc: 'The heart of the base. Destroy it to conquer the island.', slot: 'core', cost: {}, hp: 1500, unique: true },
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
export const WORLD_R = 2600;
export const HAVEN_R = 340;
