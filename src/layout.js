// Pure hull shape + gun layout, shared by the renderer (ship models) and the host sim (muzzles).
// Ship-local frame: +Z = bow, +Y = up, waterline at y = 0, +X = port ("L"), -X = starboard ("R").
import { tierById } from './config.js';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Per-tier hull designs: every class has its own lines, superstructure and rig. */
export const DESIGN = {
  // fast single-master: low freeboard, raked stem, open deck, tiller
  sloop:      { transom: 0.42, sternRise: 0.05, bowRise: 0.22, entry: 1.25, run: 1.0, deadrise: 0.75, tumble: 0.02, rake: 0.06, bow: 'raked', stern: 'counter' },
  // sleek racer: narrow, sharp clipper bow, sweeping sheer, raked masts
  schooner:   { transom: 0.36, sternRise: 0.06, bowRise: 0.32, entry: 1.45, run: 1.1, deadrise: 0.85, tumble: 0.03, rake: 0.1, bow: 'clipper', stern: 'counter' },
  // workhorse brig: fuller body, small quarterdeck, figurehead
  brigantine: { transom: 0.55, sternRise: 0.24, bowRise: 0.24, entry: 0.95, run: 0.9, deadrise: 0.55, tumble: 0.06, rake: 0.03, bow: 'figure', stern: 'transom' },
  // lean warship: flush spar deck, long run, single gun deck
  frigate:    { transom: 0.6, sternRise: 0.18, bowRise: 0.16, entry: 1.05, run: 1.0, deadrise: 0.45, tumble: 0.09, rake: 0.02, bow: 'head', stern: 'gallery' },
  // treasure galleon: towering stern castle, forecastle, beakhead, heavy tumblehome
  galleon:    { transom: 0.78, sternRise: 1.35, bowRise: 0.62, entry: 0.75, run: 0.8, deadrise: 0.4, tumble: 0.22, rake: 0.0, bow: 'beak', stern: 'castle' },
  // ship of the line: three gun decks, wall-sided, broad stern with triple galleries
  manowar:    { transom: 0.72, sternRise: 0.5, bowRise: 0.22, entry: 0.8, run: 0.85, deadrise: 0.3, tumble: 0.14, rake: 0.0, bow: 'head', stern: 'galleries3' },
};

/** Hull proportions per tier. */
export function hullShape(tier, len, beam, depth) {
  const T = tierById(tier);
  const D = DESIGN[T.id] || DESIGN.sloop;
  return {
    id: T.id, D,
    len, beam, depth,
    draft: depth * 0.48,
    transom: D.transom, sternRise: D.sternRise, bowRise: D.bowRise,
    bulwark: 0.9 + depth * 0.06,
    decks: T.decks,
    rig: T.rig, masts: T.masts,
  };
}

/** Half-breadth in plan view at u in [0 stern, 1 bow] (fraction of max beam/2). */
export function planW(H, u) {
  const D = H.D || DESIGN.sloop;
  if (u < 0.45) return H.transom + (1 - H.transom) * sm(0, 0.42, u) ** (0.7 * D.run);
  const k = (u - 0.45) / 0.55;
  return Math.pow(Math.max(0, 1 - Math.pow(k, 2.1 / D.entry)), 0.62 * D.entry);
}
/** Deck-edge (sheer) height above the waterline at u. */
export function sheer(H, u) {
  const base = H.depth * (0.42 + 0.13 * H.decks);
  return base + H.depth * H.sternRise * sm(0.32, 0.0, u) * 1.0 + H.depth * H.bowRise * sm(0.78, 1.0, u) + H.depth * 0.08 * (u - 0.5) ** 2 * 4;
}
/** Keel depth (negative y) at u — forefoot rises toward the stem. */
export function keelY(H, u) { return -H.draft * (1 - 0.85 * sm(0.82, 1.0, u)) * (1 - 0.25 * sm(0.12, 0.0, u)); }
/** Section half-width profile at vertical fraction v in [0 keel, 1 sheer]. Tumblehome above 0.7. */
export function sectionW(v, H = null) {
  const D = H?.D || DESIGN.sloop;
  const below = Math.pow(Math.max(0, 1 - Math.pow(1 - Math.min(v / 0.6, 1), 1.6 + 1.6 * (1 - D.deadrise))), 0.4 + 0.3 * D.deadrise);
  return below * (1 - D.tumble * 1.1 * sm(0.62, 1.0, v));
}
/** Hull surface half-width (metres) at u and height y. */
export function hullX(H, u, y) {
  const k = keelY(H, u), s = sheer(H, u);
  const v = (y - k) / (s - k);
  return (H.beam / 2) * planW(H, u) * sectionW(Math.max(0, Math.min(1, v)), H);
}
export const deckY = (H, u) => sheer(H, u) - H.bulwark;

/** Gun positions: broadside guns split across decks, plus bow/stern chasers. */
export function gunLayout(stats) {
  const H = hullShape(stats.tier, stats.len, stats.beam, stats.depth);
  const guns = [];
  const n = stats.side;
  const decks = Math.min(H.decks, Math.max(1, Math.ceil(n / 4)));
  // distribute n cannons over decks, lowest deck gets the most
  const per = []; let left = n;
  for (let d = 0; d < decks; d++) { const k = Math.ceil(left / (decks - d)); per.push(k); left -= k; }
  per.reverse(); // the lowest deck carries the most guns
  for (let d = 0; d < decks; d++) {
    const cnt = per[d];
    const y0 = deckY(H, 0.5) - d * Math.max(1.7, H.depth * 0.28) + 0.55;
    const u0 = 0.2 + d * 0.03, u1 = 0.78 - d * 0.04;
    for (let i = 0; i < cnt; i++) {
      const u = cnt === 1 ? 0.5 : u0 + ((u1 - u0) * i) / (cnt - 1);
      const y = Math.max(0.6, y0);
      const x = hullX(H, u, y) + 0.05;
      const z = (u - 0.5) * H.len;
      guns.push({ side: 'L', x, y, z, deck: d, u });
      guns.push({ side: 'R', x: -x, y, z, deck: d, u });
    }
  }
  for (let i = 0; i < stats.bow; i++) { const off = (i - (stats.bow - 1) / 2) * 0.9; guns.push({ side: 'bow', x: off, y: deckY(H, 0.92) + 0.55, z: H.len * 0.43, deck: 0, u: 0.93 }); }
  for (let i = 0; i < stats.stern; i++) { const off = (i - (stats.stern - 1) / 2) * 1.1; guns.push({ side: 'stern', x: off, y: deckY(H, 0.05) + 0.5, z: -H.len * 0.5 + 0.2, deck: 0, u: 0 }); }
  return guns;
}
