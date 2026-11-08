// Pure island shapes shared by the renderer (terrain mesh), the sim (collisions, cannonball impacts)
// and base layout: wobbly shorelines, a sheltered cove/bay where the docks go, sea cliffs, hills.
// Archetypes: 0 cove (bay + back cliffs + peak), 1 twin peaks, 2 mesa (cliffs all round),
// 3 crescent (huge bay, ridge along the back).

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const TAU = Math.PI * 2;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
/** Smooth angular window: 1 at centre, 0 beyond `half`. */
const win = (a, c, half) => { if (!(half > 0)) return 0; const x = Math.abs(wrapA(a - c)) / half; return x >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * x); };
function vnoise(r) { const v = Array.from({ length: 64 }, () => r()); return (a) => { const x = ((a / TAU) * 64 + 6400) % 64, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return v[i % 64] * (1 - s) + v[(i + 1) % 64] * s; }; }

const cache = new Map();

/**
 * @param o { seed, R, bayA (angle of the cove, or null), kind: 'base'|'hold'|'res'|'port'|'wild', arche? }
 * @returns { R, arche, bayA, bayHalf, shore(a), cliff(a), hAt(d, a), hWorld(dx, dz), top }
 */
export function islandShape(o) {
  const key = `${o.seed}|${o.R.toFixed(1)}|${o.bayA ?? 'n'}|${o.kind}|${o.arche ?? ''}`;
  let S = cache.get(key);
  if (S) return S;
  if (cache.size > 600) cache.clear();
  const r = rng(o.seed * 7 + 13);
  const n1 = vnoise(r), n2 = vnoise(r), n3 = vnoise(r);
  const R = o.R;
  const arche = o.arche ?? (o.kind === 'res' ? [0, 1, 2, 1][o.seed % 4] : o.kind === 'port' ? 0 : o.seed % 4);
  const hasBay = o.bayA != null;
  const bayA = hasBay ? o.bayA : 0;
  const bayHalf = hasBay ? (arche === 3 ? 0.78 : 0.5) : 0;
  const bayDepth = hasBay ? (arche === 3 ? 0.6 : 0.44) : 0;
  const cliffA = bayA + Math.PI + (r() - 0.5) * 1.2;
  const cliffHalf = arche === 2 ? 0 : 0.7 + r() * 0.7;
  const big = o.kind === 'res' ? 0.75 : 1;
  const H = (o.kind === 'port' ? 14 : R * (0.22 + r() * 0.1) + 5) * big;
  const cliffH = Math.max(6, R * 0.1 + 4) * big;
  // hills: [x, z, height, width] in island-local metres
  const peaks = [];
  const back = (off, d) => [Math.cos(bayA + Math.PI + off) * R * d, Math.sin(bayA + Math.PI + off) * R * d];
  if (arche === 0) { const [x, z] = back((r() - 0.5) * 0.8, 0.3); peaks.push([x, z, H * 1.15, 0.42]); peaks.push([...back(1.4, 0.45), H * 0.5, 0.3]); }
  else if (arche === 1) { peaks.push([...back(0.75, 0.38), H * 1.2, 0.3]); peaks.push([...back(-0.75, 0.38), H, 0.3]); }
  else if (arche === 2) { peaks.push([0, 0, H * 0.35, 0.7]); }
  else { for (let i = -2; i <= 2; i++) peaks.push([...back(i * 0.55, 0.55), H * (1 - Math.abs(i) * 0.15), 0.26]); }
  const mesaH = arche === 2 ? H * 0.75 + 4 : 0;

  const shore = (a) => 1 + (n1(a) - 0.5) * 0.24 + (n2(a * 2) - 0.5) * 0.08 - bayDepth * Math.pow(win(a, bayA, bayHalf), 0.7);
  const cliff = (a) => {
    if (o.kind === 'port') return 0;
    if (arche === 2) return (1 - win(a, bayA, Math.max(0.9, bayHalf * 2.2))) * (0.6 + 0.4 * n3(a));
    return win(a, cliffA, cliffHalf) * (0.7 + 0.3 * n3(a));
  };
  const hill = (x, z) => {
    let h = 0;
    for (const [px, pz, ph, pw] of peaks) { const q = Math.hypot(x - px, z - pz) / (pw * R); h += ph * Math.exp(-q * q); }
    return h;
  };
  /** Terrain height (y) at radius d, angle a, relative to the island centre. */
  const hAt = (d, a) => {
    const sh = shore(a);
    const k = d / (R * sh);
    const c0 = cliff(a);
    const c = c0 * sstep(0.4, 0.8, k);
    if (k > 1) return -Math.min(7 + c0 * 6, (k - 1) * (24 + c0 * 70));
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const taper = sstep(1.0, 0.62, k);
    const hl = hill(x, z) * taper;
    const beach = k > 0.8 ? 1.6 * (1 - k) / 0.2 : 1.6;
    let land = beach + hl;
    if (mesaH) land = Math.max(land, mesaH * sstep(0.98, 0.84, k) + hl * 0.4);
    if (c <= 0.01) return land;
    const top = cliffH + hl * 0.6 + mesaH * 0.6;
    const cp = k < 0.965 ? top : top * Math.max(0, 1 - (k - 0.965) / 0.035);
    return land + (cp - land) * c;
  };
  S = {
    R, arche, bayA, bayHalf, bayDepth, hasBay, shore, cliff, hAt, H,
    hWorld: (dx, dz) => hAt(Math.hypot(dx, dz), Math.atan2(dz, dx)),
    /** Distance from centre to the waterline along angle a. */
    edge: (a) => R * shore(a),
  };
  cache.set(key, S);
  return S;
}
