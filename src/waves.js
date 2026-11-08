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

/** Displacement of the undisturbed grid point (x,z) at time t: returns [dx, dy, dz]. */
export function displace(x, z, t, out = [0, 0, 0]) {
  let dx = 0, dy = 0, dz = 0;
  for (const [ux, uz, L, st] of WAVES_N) {
    const k = (2 * Math.PI) / L, c = Math.sqrt(G / k), a = (st * SEA) / k;
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
