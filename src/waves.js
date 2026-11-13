// Gerstner wave field shared by the GPU ocean shader and CPU buoyancy, so ships ride the exact
// surface that is drawn. Pure math, no three.js.

// A natural, irregular sea: a dominant swell from the wind direction made of near-equal wavelengths (they beat
// against each other, so the swell comes in sets), wind sea spread ±70° around it, and a little cross-sea.
// Wavelengths are deliberately non-harmonic and every wave has its own phase, so no pattern ever lines up or
// repeats symmetrically. [dirX, dirZ, wavelength, steepness] — built from (angle offset, wavelength, steepness).
const WIND = 0.32;
const SPEC = [
  [0.0, 118, 0.072], [0.21, 101, 0.066], [-0.34, 79, 0.058], [0.63, 61.5, 0.05],
  [-0.88, 47.3, 0.044], [1.22, 37.1, 0.038], [-0.13, 28.9, 0.034], [0.47, 22.4, 0.03],
  [-1.36, 17.2, 0.027], [2.24, 13.1, 0.022], [-0.61, 9.8, 0.019], [0.97, 7.4, 0.015],
];
export const WAVES = SPEC.map(([da, L, st]) => [Math.cos(WIND + da), Math.sin(WIND + da), L, st]);
/** Per-wave phase offset (golden-angle sequence) — the ocean + foam shaders use the same formula. */
export const PHASE = (i) => i * 2.39996;
export const G = 9.81;
export let SEA = 0.8; // global wave scale (calm..storm), dev-tweakable

function norm(w) { const l = Math.hypot(w[0], w[1]); return [w[0] / l, w[1] / l, w[2], w[3]]; }
export const WAVES_N = WAVES.map(norm);
export const setSea = (v) => { SEA = v; };

// Calm water in the lee of islands: wave amplitude fades from 100% in open sea to CALM_MIN at the
// shore. The same factor is applied in the ocean shader (uCalm) so ships ride what is drawn.
export const CALM_MIN = 0.22, CALM_W = 190;
let calmList = [];
let calmGrid = null;
const CELL = 400;
/** islands: [{x, z, r}] — shorelines that calm the sea. */
export function setCalm(list) {
  calmList = list.map((i) => ({ x: i.x, z: i.z, r: i.r }));
  calmGrid = new Map();
  for (const c of calmList) {
    const reach = c.r * 0.9 + CALM_W;
    for (let gx = Math.floor((c.x - reach) / CELL); gx <= Math.floor((c.x + reach) / CELL); gx++)
      for (let gz = Math.floor((c.z - reach) / CELL); gz <= Math.floor((c.z + reach) / CELL); gz++) {
        const k = gx * 65536 + gz; let a = calmGrid.get(k); if (!a) calmGrid.set(k, (a = [])); a.push(c);
      }
  }
}
export const calmIslands = () => calmList;
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** 0..1 wave amplitude multiplier at (x,z). */
export function calmAt(x, z) {
  if (!calmGrid) return 1;
  const a = calmGrid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL));
  if (!a) return 1;
  let f = 1;
  for (const c of a) {
    const d = Math.hypot(x - c.x, z - c.z), r0 = c.r * 0.9;
    f = Math.min(f, sstep(r0, r0 + CALM_W, d));
  }
  return CALM_MIN + (1 - CALM_MIN) * f;
}

// per-wave constants, precomputed (the CPU samples the sea thousands of times a frame)
const NW = WAVES_N.length;
const KX = new Float64Array(NW), KZ = new Float64Array(NW), KC = new Float64Array(NW), AK = new Float64Array(NW), UX = new Float64Array(NW), UZ = new Float64Array(NW), PH = new Float64Array(NW);
WAVES_N.forEach(([ux, uz, L, st], i) => { const k = (2 * Math.PI) / L; KX[i] = ux * k; KZ[i] = uz * k; KC[i] = k * Math.sqrt(G / k); AK[i] = st / k; UX[i] = ux; UZ[i] = uz; PH[i] = i * 2.39996; });
function disp(x, z, t, amp, out) {
  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < NW; i++) {
    const f = KX[i] * x + KZ[i] * z - KC[i] * t + PH[i], a = AK[i] * amp, cf = Math.cos(f);
    dx += UX[i] * a * cf; dz += UZ[i] * a * cf; dy += a * Math.sin(f);
  }
  out[0] = dx; out[1] = dy; out[2] = dz;
  return out;
}
/** Displacement of the undisturbed grid point (x,z) at time t: returns [dx, dy, dz]. */
export function displace(x, z, t, out = [0, 0, 0]) { return disp(x, z, t, SEA * calmAt(x, z), out); }

const tmp = [0, 0, 0];
/** Water height at world (x,z): invert the horizontal displacement with a few fixed-point steps. The calm factor
 *  barely changes over a few metres, so it is looked up once. */
export function heightAt(x, z, t) {
  const amp = SEA * calmAt(x, z);
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) { disp(px, pz, t, amp, tmp); px = x - tmp[0]; pz = z - tmp[2]; }
  disp(px, pz, t, amp, tmp);
  return tmp[1];
}

/** Surface velocity (vertical) used for splashes etc. */
export function slopeAt(x, z, t, e = 1.5) {
  const hx = heightAt(x + e, z, t) - heightAt(x - e, z, t);
  const hz = heightAt(x, z + e, t) - heightAt(x, z - e, t);
  return [hx / (2 * e), hz / (2 * e)];
}
