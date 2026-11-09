// Pure placement of base buildings around an island (used by sim hit-tests and the renderer).
// Each base island has a sheltered cove (bay) facing its dock angle; the docks sit inside the cove.
import { BUILDINGS, LAND_SLOTS } from './config.js';
import { baseGrowth } from './economy.js';
import { islandShape } from './islandshape.js';

export const dockAngle = (b) => ((b.seed || 0) % 628) / 100;
export const baseRadius = (b) => b.r * baseGrowth(b);
export const baseShape = (b) => islandShape({ seed: b.seed || 3, R: baseRadius(b), bayA: dockAngle(b), kind: b.hold ? 'hold' : 'base' });

const ground = (S, dx, dz) => Math.max(1.4, S.hWorld(dx, dz));

/** World position + footprint radius + height of a building (y = ground level). */
export function buildingPos(b, bd) {
  const S = baseShape(b), R = S.R;
  const B = BUILDINGS[bd.type];
  const da = dockAngle(b);
  const at = (a, d, rad, h, extra = {}) => { const dx = Math.cos(a) * d, dz = Math.sin(a) * d; return { x: b.x + dx, z: b.z + dz, y: ground(S, dx, dz), rad, h, ang: a, ...extra }; };
  if (bd.type === 'keep' || bd.type === 'camp') {
    // the keep stands on the slope behind the cove, looking out over the harbour
    const a = da + Math.PI, d = R * 0.12;
    return at(a, d, bd.type === 'keep' ? 11 : 9, bd.type === 'keep' ? 22 : 9, { ang: da });
  }
  if (bd.type === 'dock') { const e = S.edge(da) - 5; const dx = Math.cos(da) * e, dz = Math.sin(da) * e; return { x: b.x + dx, z: b.z + dz, y: 1, rad: 9, h: 4, ang: da }; }
  if (B.slot === 'land') {
    const a = da + 0.75 + (bd.slot / Math.max(1, LAND_SLOTS - 1)) * (Math.PI * 2 - 1.5);
    const d = S.edge(a) * (bd.slot % 2 ? 0.62 : 0.42);
    return at(a, d, bd.type === 'watchtower' ? 5 : 8, bd.type === 'watchtower' ? 24 : 10);
  }
  if (B.slot === 'shore') { const a = bd.slot; return at(a, S.edge(a) * 0.86, 4, 5); }
  if (B.slot === 'sea') { const a = bd.slot; const d = S.edge(a) + 48; return { x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d, y: 0, rad: 15, h: 18, ang: a }; }
  return at(0, 0, 6, 6);
}
/** Where a ship ties up at a base: out on the cove's axis, bow to the sea, alongside the pier. */
export function harborPoint(b, len = 30) {
  const S = baseShape(b), a = dockAngle(b);
  const d = S.edge(a) + 30 + len * 0.45;
  const off = 5 + len * 0.16; // alongside the pier, which widens/lengthens with the owner's ship
  const px = -Math.sin(a) * off, pz = Math.cos(a) * off;
  return { x: b.x + Math.cos(a) * d + px, z: b.z + Math.sin(a) * d + pz, yaw: Math.atan2(Math.cos(a), Math.sin(a)) };
}
/** Pier length/width for a dock serving a ship of length `len` (reaches past its bow). */
export const pierSize = (len = 30) => ({ len: 38 + len * 0.95, w: 6 + len * 0.04, head: 14 + len * 0.25 });
