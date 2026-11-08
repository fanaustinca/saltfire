// Pure hull shape + gun layout, shared by the renderer (ship models) and the host sim (muzzles).
// Ship-local frame: +Z = bow, +Y = up, waterline at y = 0, +X = port ("L"), -X = starboard ("R").
import { tierById } from './config.js';

const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Hull proportions per tier. */
export function hullShape(tier, len, beam, depth) {
  const T = tierById(tier);
  const big = ['galleon', 'manowar', 'frigate'].includes(T.id);
  return {
    len, beam, depth,
    draft: depth * 0.48,
    transom: T.id === 'galleon' ? 0.74 : big ? 0.64 : 0.46,   // stern width fraction
    sternRise: T.id === 'galleon' ? 0.95 : T.id === 'manowar' ? 0.42 : T.id === 'frigate' ? 0.3 : 0.16, // aft castle, x depth
    bowRise: T.id === 'galleon' ? 0.45 : 0.2,
    bulwark: 0.9 + depth * 0.06,
    decks: T.decks,
    rig: T.rig, masts: T.masts,
  };
}

/** Half-breadth in plan view at u in [0 stern, 1 bow] (fraction of max beam/2). */
export function planW(H, u) {
  if (u < 0.45) return H.transom + (1 - H.transom) * sm(0, 0.42, u) ** 0.7;
  const k = (u - 0.45) / 0.55;
  return Math.pow(Math.max(0, 1 - Math.pow(k, 2.1)), 0.62);
}
/** Deck-edge (sheer) height above the waterline at u. */
export function sheer(H, u) {
  const base = H.depth * (0.42 + 0.13 * H.decks);
  return base + H.depth * H.sternRise * sm(0.32, 0.0, u) * 1.0 + H.depth * H.bowRise * sm(0.78, 1.0, u) + H.depth * 0.08 * (u - 0.5) ** 2 * 4;
}
/** Keel depth (negative y) at u — forefoot rises toward the stem. */
export function keelY(H, u) { return -H.draft * (1 - 0.85 * sm(0.82, 1.0, u)) * (1 - 0.25 * sm(0.12, 0.0, u)); }
/** Section half-width profile at vertical fraction v in [0 keel, 1 sheer]. Tumblehome above 0.7. */
export function sectionW(v) {
  const below = Math.pow(Math.max(0, 1 - Math.pow(1 - Math.min(v / 0.6, 1), 2.4)), 0.55);
  return below * (1 - 0.1 * sm(0.62, 1.0, v));
}
/** Hull surface half-width (metres) at u and height y. */
export function hullX(H, u, y) {
  const k = keelY(H, u), s = sheer(H, u);
  const v = (y - k) / (s - k);
  return (H.beam / 2) * planW(H, u) * sectionW(Math.max(0, Math.min(1, v)));
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
