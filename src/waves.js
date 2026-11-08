// Gerstner wave field shared by the GPU ocean shader and CPU buoyancy, so ships ride the exact
// surface that is drawn. Pure math, no three.js.

// [dirX, dirZ, wavelength, steepness]
export const WAVES = [
  [1.0, 0.25, 96, 0.11],
  [0.72, -0.62, 57, 0.09],
  [-0.35, 0.92, 33, 0.075],
  [0.95, 0.55, 17, 0.06],
  [-0.8, -0.35, 9.5, 0.045],
];
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

/** Displacement of the undisturbed grid point (x,z) at time t: returns [dx, dy, dz]. */
export function displace(x, z, t, out = [0, 0, 0]) {
  let dx = 0, dy = 0, dz = 0;
  const calm = calmAt(x, z);
  for (const [ux, uz, L, st] of WAVES_N) {
    const k = (2 * Math.PI) / L, c = Math.sqrt(G / k), a = (st * SEA * calm) / k;
    const f = k * (ux * x + uz * z - c * t);
    const cf = Math.cos(f), sf = Math.sin(f);
    dx += ux * a * cf; dz += uz * a * cf; dy += a * sf;
  }
  out[0] = dx; out[1] = dy; out[2] = dz;
  return out;
}

const tmp = [0, 0, 0];
/** Water height at world (x,z): invert the horizontal displacement with a few fixed-point steps. */
export function heightAt(x, z, t) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) { displace(px, pz, t, tmp); px = x - tmp[0]; pz = z - tmp[2]; }
  displace(px, pz, t, tmp);
  return tmp[1];
}

/** Surface velocity (vertical) used for splashes etc. */
export function slopeAt(x, z, t, e = 1.5) {
  const hx = heightAt(x + e, z, t) - heightAt(x - e, z, t);
  const hz = heightAt(x, z + e, t) - heightAt(x, z - e, t);
  return [hx / (2 * e), hz / (2 * e)];
}
