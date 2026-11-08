// Pure placement of base buildings around an island (used by sim hit-tests and the renderer).
import { BUILDINGS, LAND_SLOTS } from './config.js';
import { baseGrowth } from './economy.js';

export const dockAngle = (b) => ((b.seed || 0) % 628) / 100;
export const baseRadius = (b) => b.r * baseGrowth(b);

/** World position + footprint radius + height of a building. */
export function buildingPos(b, bd) {
  const R = baseRadius(b);
  const B = BUILDINGS[bd.type];
  const da = dockAngle(b);
  if (bd.type === 'keep') return { x: b.x, z: b.z, y: 6, rad: 11, h: 22, ang: 0 };
  if (bd.type === 'dock') { const a = da; return { x: b.x + Math.cos(a) * (R + 8), z: b.z + Math.sin(a) * (R + 8), y: 1, rad: 9, h: 4, ang: a }; }
  if (B.slot === 'land') {
    const a = da + 0.55 + (bd.slot / LAND_SLOTS) * Math.PI * 2 * 0.88;
    const d = R * (bd.slot % 2 ? 0.66 : 0.48);
    return { x: b.x + Math.cos(a) * d, z: b.z + Math.sin(a) * d, y: 3, rad: bd.type === 'watchtower' ? 5 : 8, h: bd.type === 'watchtower' ? 24 : 10, ang: a };
  }
  if (B.slot === 'shore') { const a = bd.slot; return { x: b.x + Math.cos(a) * R * 0.9, z: b.z + Math.sin(a) * R * 0.9, y: 2.5, rad: 4, h: 5, ang: a }; }
  if (B.slot === 'sea') { const a = bd.slot; return { x: b.x + Math.cos(a) * (R + 48), z: b.z + Math.sin(a) * (R + 48), y: 4, rad: 15, h: 14, ang: a }; }
  return { x: b.x, z: b.z, y: 2, rad: 6, h: 6, ang: 0 };
}
/** Where a ship ties up at a base. */
export function harborPoint(b) {
  const a = dockAngle(b), R = baseRadius(b);
  // alongside the pier (offset sideways), bow pointing out to sea
  const px = -Math.sin(a) * 16, pz = Math.cos(a) * 16;
  return { x: b.x + Math.cos(a) * (R + 30) + px, z: b.z + Math.sin(a) * (R + 30) + pz, yaw: Math.atan2(Math.cos(a), Math.sin(a)) };
}
