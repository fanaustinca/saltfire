// Procedural, period-styled sailing ships — every class has its own design, not a scaled copy:
//  Sloop: pirate sloop — single mast with gaff main + square topsails, raised quarterdeck + cabin,
//         painted gunport strake, swivel guns on the rail, long boom over a windowed transom.
//  Schooner: narrow racer, clipper bow, two raked gaff masts with topsails, deckhouse.
//  Brigantine: square-rigged fore, gaff main, quarterdeck, figurehead.
//  Frigate: full-rigged three-master (four sail tiers), black "chequer" hull, flush deck, boats.
//  Galleon: towering painted stern castle + forecastle, beakhead, lateen mizzens, gilding.
//  Man of War: three gun decks bristling with cannon, triple stern galleries, studding sails,
//              iron-banded waterline, gilt lion figurehead, admiral's pennants. It looks unbeatable.
//  Leviathan: a floating palace — four gun decks, an iron-clad waterline, a three-storey marble palace
//             with a golden dome and onion-domed towers, a forward pavilion, four masts of royal canvas.
// Damage: charred hull, splintered shot-holes where balls struck, topmasts shot away, torn sails.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hullShape, planW, sheer, keelY, sectionW, hullX, deckY, gunLayout, deckGap } from '../layout.js';
import { planks, deck as deckTex, sailcloth, noiseTex, flagTex } from './textures.js';

const V3 = THREE.Vector3;
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ shared materials
let M = null;
function mats() {
  if (M) return M;
  const pl = planks();
  M = {
    darkwood: new THREE.MeshStandardMaterial({ color: 0x3b2614, roughness: 0.8 }),
    spar: new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.7 }),
    deck: new THREE.MeshStandardMaterial({ color: 0xc8a57a, roughness: 0.9, map: deckTex(), side: THREE.DoubleSide }),
    iron: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.45, metalness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a73a, roughness: 0.35, metalness: 0.85 }),
    port: new THREE.MeshStandardMaterial({ color: 0x120a05, roughness: 1 }),
    red: new THREE.MeshStandardMaterial({ color: 0x9c2218, roughness: 0.7 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.8 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a3a40, roughness: 0.15, metalness: 0.6, emissive: 0x332200, emissiveIntensity: 0.4 }),
    lantern: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffaa33, emissiveIntensity: 1.6 }),
    rope: new THREE.LineBasicMaterial({ color: 0x2a2016, transparent: true, opacity: 0.85 }),
    hole: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    stump: new THREE.MeshStandardMaterial({ color: 0x5a3c22, roughness: 0.9 }),
    marble: new THREE.MeshStandardMaterial({ color: 0xece4d2, roughness: 0.55 }),
    royal: new THREE.MeshStandardMaterial({ color: 0x4a1a6a, roughness: 0.7 }),
    pl,
  };
  return M;
}

/** Hull material is per ship (owner colours) and multiplies vertex-painted strakes; chars with damage. */
function hullMat() {
  const pl = planks();
  const m = new THREE.MeshStandardMaterial({ map: pl.map, bumpMap: pl.bump, bumpScale: 0.6, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide });
  m.userData.dmg = { value: 0 };
  const nz = noiseTex();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDmg = m.userData.dmg; sh.uniforms.uNoise = { value: nz };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDmg;\nuniform sampler2D uNoise;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float n = texture2D(uNoise, vMapUv * 0.23).r * 0.65 + texture2D(uNoise, vMapUv * 0.9 + 0.4).r * 0.35;
          float th = 1.0 - uDmg * 0.8;
          float ch = smoothstep(th, th + 0.06, n);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.12 + vec3(0.03, 0.02, 0.015), ch * 0.92); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float n = texture2D(uNoise, vMapUv * 0.23).r * 0.65 + texture2D(uNoise, vMapUv * 0.9 + 0.4).r * 0.35;
          float th = 1.0 - uDmg * 0.8;
          float edge = smoothstep(th + 0.02, th + 0.05, n) * (1.0 - smoothstep(th + 0.05, th + 0.12, n));
          totalEmissiveRadiance += vec3(1.0, 0.35, 0.05) * edge * smoothstep(0.6, 0.95, uDmg) * 0.6; }`);
  };
  m.customProgramCacheKey = () => 'hull-dmg';
  return m;
}
function sailMat(color) {
  const m = new THREE.MeshStandardMaterial({ color, map: sailcloth(), roughness: 0.95, side: THREE.DoubleSide, emissive: color.clone().multiplyScalar(0.32), emissiveMap: sailcloth() });
  m.userData.damage = { value: 0 };
  const nz = noiseTex();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDamage = m.userData.damage;
    sh.uniforms.uNoise = { value: nz };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDamage;\nuniform sampler2D uNoise;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float n = texture2D(uNoise, vMapUv * 1.7).r * 0.7 + texture2D(uNoise, vMapUv * 4.3 + 0.3).r * 0.3;
          if (n < uDamage * 0.75 - 0.05) discard;
          float burn = smoothstep(uDamage * 0.75 - 0.05, uDamage * 0.75 + 0.03, n);
          diffuseColor.rgb *= mix(0.25, 1.0, burn); }`);
  };
  m.customProgramCacheKey = () => 'sail-dmg';
  return m;
}

// ------------------------------------------------------------------ geometry helpers
function cyl(r0, r1, h, seg = 8) { return new THREE.CylinderGeometry(r1, r0, h, seg, 1); }
function place(g, pos, rot = null, scale = null) {
  const m = new THREE.Matrix4();
  const q = rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
  m.compose(new V3(...pos), q, new V3(...(scale || [1, 1, 1])));
  g.applyMatrix4(m);
  return g;
}
const box = (w, h, d, pos, rot) => place(new THREE.BoxGeometry(w, h, d), pos, rot);
/** Cylinder spanning two points. */
function span(a, b, r0, r1 = r0, seg = 6) {
  const d = new V3().subVectors(b, a), L = d.length();
  const g = cyl(r0, r1, L, seg);
  g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
function strip(g) { // keep only position/normal/uv so geometries merge
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g.index ? g.toNonIndexed() : g;
}
function merged(list, mat, shadow = true) {
  if (!list.length) return null;
  const m = new THREE.Mesh(mergeGeometries(list.map(strip)), mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ hull
/** Stem/stern overhang: clipper bows lean forward, counter sterns lean aft. */
function overhang(H, u, v) {
  const D = H.D;
  let dz = 0;
  if (D.bow === 'clipper') dz += sm(0.86, 1, u) * Math.pow(v, 1.3) * H.len * 0.075;
  else if (D.bow === 'raked') dz += sm(0.88, 1, u) * Math.pow(v, 1.2) * H.len * 0.05;
  else dz += sm(0.9, 1, u) * Math.pow(v, 1.5) * H.len * 0.02;
  if (D.stern === 'counter') dz -= sm(0.12, 0, u) * Math.pow(v, 1.4) * H.len * 0.05;
  return dz;
}
function hullGeometry(H, colors, paint) {
  const NU = H.len > 100 ? 110 : H.len > 40 ? 72 : 52, NV = Math.max(30, Math.round(H.depth * 6));
  const pos = [], col = [], uv = [], idx = [];
  const c = new THREE.Color();
  const wl = 0.12;
  const dY = deckY(H, 0.5);
  const deckSpacing = deckGap(H);
  const strakeColor = (y, u, i) => {
    if (y < wl) return colors.bottom;
    if (y < wl + 0.25) return colors.boot;
    if (paint.ironBand && y < wl + 0.25 + H.depth * 0.08) return colors.iron;
    const s = sheer(H, u);
    if (y > s - 0.22) return colors.rail;
    // painted gun-deck bands (chequer on warships) and wales between them
    for (let d = 0; d < (paint.stripe ? 0 : Math.max(1, H.decks)); d++) {
      const gy = dY - d * deckSpacing + 0.55;
      if (Math.abs(y - gy) < (paint.band || 0.34)) return colors.band;
      if (paint.wales && Math.abs(y - (gy - (paint.band || 0.34) - 0.12)) < 0.12) return colors.wale;
    }
    if (Math.abs(y - (dY + H.bulwark * 0.55)) < 0.14) return colors.wale;
    // galleon castle decoration: vertical stripes of trim + hull colour on the upper works
    if (paint.castle && y > dY + 0.4 && (u < 0.3 || u > 0.82)) return (i % 4 < 2) ? colors.band : colors.castle;
    if (paint.stripe && Math.abs(y - (s - 0.55)) < 0.16) return colors.band;
    return colors.hull;
  };
  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? 1 : -1;
    const base = pos.length / 3;
    for (let i = 0; i <= NU; i++) {
      const u = i / NU;
      const k = keelY(H, u), s = sheer(H, u);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const y = k + (s - k) * v;
        let x = (H.beam / 2) * planW(H, u) * sectionW(v, H);
        if (u > 0.985) x *= (1 - u) / 0.015 * 0.3;
        const z = (u - 0.5) * H.len + overhang(H, u, v);
        pos.push(x * sx, y, z);
        c.copy(strakeColor(y, u, i)); col.push(c.r, c.g, c.b);
        uv.push(z / 7, y / 4.2);
      }
    }
    for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
      const a = base + i * (NV + 1) + j, b = a + NV + 1;
      if (sx > 0) idx.push(a, b, a + 1, b, b + 1, a + 1); else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  // transom (flat stern) between the two sides at u = 0
  const tb = pos.length / 3;
  for (let j = 0; j <= NV; j++) {
    const v = j / NV, k = keelY(H, 0), s = sheer(H, 0);
    const y = k + (s - k) * v, x = (H.beam / 2) * planW(H, 0) * sectionW(v, H), z = -H.len / 2 + overhang(H, 0, v);
    pos.push(x, y, z, -x, y, z);
    c.copy(y < wl ? colors.bottom : y > s - 0.25 ? colors.rail : colors.stern); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    uv.push(x / 7, y / 4.2, -x / 7, y / 4.2);
  }
  for (let j = 0; j < NV; j++) { const a = tb + j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function deckGeometry(H) {
  const NU = 40, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, y = deckY(H, u);
    const x = hullX(H, u, y) * 0.98 * (u > 0.985 ? 0 : 1);
    const z = (u - 0.5) * H.len;
    pos.push(x, y, z, -x, y, z); uv.push(x / 6, z / 6, -x / 6, z / 6);
  }
  for (let i = 0; i < NU; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ sails
/** Square sail between two yards, billowing toward +Z. Pivot at the top yard. */
function squareSail(wTop, wBot, h, belly) {
  const NX = 8, NY = 8, pos = [], uv = [], idx = [];
  for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
    const v = j / NY, u = i / NX;
    const w = wTop + (wBot - wTop) * v;
    const x = (u - 0.5) * w;
    const bz = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.05 + 0.02)) * belly;
    pos.push(x, -v * h, bz); uv.push(u, 1 - v);
  }
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i; idx.push(a, a + NX + 1, a + 1, a + 1, a + NX + 1, a + NX + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** Generic 3- or 4-corner sail patch with belly along `dir` (fore-aft sails billow sideways). */
function patchSail(corners, belly, dir = new V3(1, 0, 0)) {
  const N = 8, pos = [], uv = [], idx = [];
  const [a, b, c, d] = corners.length === 4 ? corners : [corners[0], corners[1], corners[2], corners[2]];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
    const u = i / N, v = j / N;
    const p = new V3().copy(a).multiplyScalar((1 - u) * (1 - v)).addScaledVector(b, u * (1 - v)).addScaledVector(d, (1 - u) * v).addScaledVector(c, u * v);
    p.addScaledVector(dir, Math.sin(Math.PI * u) * Math.sin(Math.PI * v) * belly);
    pos.push(p.x, p.y, p.z); uv.push(u, 1 - v);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = j * (N + 1) + i; idx.push(q, q + N + 1, q + 1, q + 1, q + N + 1, q + N + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function holeGeometry() {
  const parts = [];
  let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tint = (g, r, gg, b) => { const c = new Float32Array(g.attributes.position.count * 3); for (let k = 0; k < c.length; k += 3) { c[k] = r; c[k + 1] = gg; c[k + 2] = b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); for (const k of ['uv', 'normal']) if (g.attributes[k]) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g; };
  // scorched halo, then a jagged black hole punched through the planking
  const N = 13, mk = (r0, r1, z) => { const pos = [0, 0, z]; const idx = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, rr = r0 + rnd() * (r1 - r0); pos.push(Math.cos(a) * rr * 1.25, Math.sin(a) * rr * 0.85, z); } for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; };
  parts.push(tint(mk(0.55, 0.85, -0.004), 0.1, 0.075, 0.06));
  parts.push(tint(mk(0.22, 0.42, 0), 0.015, 0.01, 0.008));
  // a few broken plank ends sticking out of the rim (horizontal, like real splintered strakes)
  for (let i = 0; i < 4; i++) {
    const len = 0.25 + rnd() * 0.35, side = i % 2 ? 1 : -1;
    const sp = new THREE.PlaneGeometry(len, 0.07 + rnd() * 0.05);
    sp.rotateZ((rnd() - 0.5) * 0.7);
    sp.translate(side * (0.3 + len * 0.4), (rnd() - 0.5) * 0.5, 0.01);
    parts.push(tint(sp, 0.66, 0.5, 0.32));
  }
  const out = mergeGeometries(parts); out.computeVertexNormals();
  return out;
}
let HOLE = null;

// ------------------------------------------------------------------ per-design rig plans
// mast: u position, h = height factor, sq = square sail tiers, gaff, lateen, topsail (gaff topsail),
// spanker, stud (studding sails), main (flag), lean (rake)
function rigPlan(id) {
  switch (id) {
    case 'sloop': return { mastH: 1.2, bs: [0.36, 0.2], jibs: 2, masts: [{ u: 0.6, h: 1, gaff: true, sq: 2, sqStart: 1, main: true, boom: 0.6 }] };
    case 'schooner': return { mastH: 1.12, bs: [0.5, 0.16], jibs: 3, masts: [{ u: 0.3, h: 1, gaff: true, topsail: true, main: true, boom: 0.42 }, { u: 0.62, h: 0.93, gaff: true, topsail: true, sq: 1, sqStart: 1, boom: 0.3 }] };
    case 'brigantine': return { mastH: 0.98, bs: [0.4, 0.3], jibs: 3, masts: [{ u: 0.36, h: 1, gaff: true, sq: 2, sqStart: 1, main: true, boom: 0.4 }, { u: 0.68, h: 0.92, sq: 3 }] };
    case 'frigate': return { mastH: 0.98, bs: [0.37, 0.32], jibs: 3, masts: [{ u: 0.24, h: 0.76, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, main: true }, { u: 0.73, h: 0.9, sq: 4 }] };
    case 'galleon': return { mastH: 0.8, bs: [0.38, 0.46], jibs: 1, sprit: true, masts: [{ u: 0.1, h: 0.5, lateen: true }, { u: 0.28, h: 0.66, lateen: true }, { u: 0.54, h: 1, sq: 3, main: true }, { u: 0.78, h: 0.84, sq: 2 }] };
    case 'manowar': return { mastH: 0.95, bs: [0.4, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.25, h: 0.8, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, stud: true, main: true }, { u: 0.74, h: 0.92, sq: 4, stud: true }] };
    case 'leviathan': return { mastH: 0.66, bs: [0.3, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.45, h: 0.86, sq: 4, stud: true }, { u: 0.585, h: 1, sq: 4, stud: true, main: true }, { u: 0.715, h: 0.96, sq: 4, stud: true }, { u: 0.835, h: 0.84, sq: 4 }] };
    default: return rigPlan('sloop');
  }
}
export const mastUs = (id) => rigPlan(id).masts.map((m) => m.u);

// ------------------------------------------------------------------ the ship
/**
 * Build a ship model.
 * @param stats  derived ship stats (tier, len, beam, depth, side, bow, stern)
 * @param look   { hullColor, trimColor, sailColor, emblem, flagBg, flagFg }
 */
export function buildShip(stats, look = {}) {
  const m = mats();
  const H = hullShape(stats.tier, stats.len, stats.beam, stats.depth);
  const D = H.D, id = H.id;
  const L = H.len, B = H.beam;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const lev = id === 'leviathan';
  const big = id === 'manowar' || lev, war = id === 'frigate' || big;

  const hullCol = new THREE.Color(look.hullColor || (lev ? '#1d1a2a' : war ? '#1f1b18' : '#5a3a22'));
  const trim = new THREE.Color(look.trimColor || (war ? '#c99a2e' : '#c9a227'));
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.45, metalness: 0.5 });
  const colors = {
    bottom: H.decks > 1 || war ? new THREE.Color(0xb8743f) : new THREE.Color(0x8a8270),
    boot: new THREE.Color(0x1a1410), wale: new THREE.Color(0x15110d), iron: new THREE.Color(0x2c2f33),
    band: trim, rail: hullCol.clone().multiplyScalar(0.7), hull: hullCol, stern: hullCol.clone().multiplyScalar(0.85),
    castle: new THREE.Color(0x7a1d18),
  };
  const paint = {
    band: war ? 0.42 : 0.34, wales: big || id === 'galleon', castle: id === 'galleon', stripe: id === 'schooner', ironBand: big,
  };
  const hull = new THREE.Mesh(hullGeometry(H, colors, paint), hullMat());
  hull.castShadow = true; hull.receiveShadow = true;
  body.add(hull);
  const deckMesh = new THREE.Mesh(deckGeometry(H), m.deck); deckMesh.receiveShadow = true; body.add(deckMesh);

  const dark = [], spar = [], iron = [], gold = [], ports = [], glass = [], lamps = [], red = [], white = [], trimL = [], marble = [];
  const dY = deckY(H, 0.5);
  const gs = Math.min(1.3, 0.6 + L / 70);

  // keel
  dark.push(box(0.35, 0.5, L * 0.86, [0, keelY(H, 0.45) - 0.1, -L * 0.03]));
  // cap rail along the sheer
  for (let i = 0; i < 28; i++) {
    const u0 = i / 28, u1 = (i + 1) / 28;
    for (const sx of [1, -1]) {
      const a = new V3(sx * hullX(H, u0, sheer(H, u0)), sheer(H, u0) + 0.06, (u0 - 0.5) * L + overhang(H, u0, 1));
      const b = new V3(sx * hullX(H, u1, sheer(H, u1)), sheer(H, u1) + 0.06, (u1 - 0.5) * L + overhang(H, u1, 1));
      dark.push(span(a, b, 0.13 * gs, 0.13 * gs, 4));
    }
  }

  // painted sheer stripe as real geometry (crisp, no vertex-colour wobble)
  if (paint.stripe) for (let i = 0; i < 40; i++) {
    const u0 = 0.02 + i * 0.024, u1 = u0 + 0.024;
    for (const sx of [1, -1]) {
      const y0 = sheer(H, u0) - 0.55, y1 = sheer(H, u1) - 0.55;
      trimL.push(span(new V3(sx * (hullX(H, u0, y0) + 0.02), y0, (u0 - 0.5) * L + overhang(H, u0, 0.9)), new V3(sx * (hullX(H, u1, y1) + 0.02), y1, (u1 - 0.5) * L + overhang(H, u1, 0.9)), 0.13, 0.13, 4));
    }
  }
  // ---------------------------------------------------------------- superstructure per design
  const zU = (u) => (u - 0.5) * L;
  if (id === 'sloop') {
    // raised quarterdeck over a little great cabin, with a rail and a tiller
    const qy = deckY(H, 0.1) + 0.55, qx = hullX(H, 0.14, qy) * 0.97, qL = L * 0.26;
    dark.push(box(qx * 2, 0.18, qL, [0, qy, -L / 2 + qL / 2 + 0.2]));
    dark.push(box(qx * 2, 1.0, 0.16, [0, qy - 0.45, -L / 2 + qL + 0.2]));                    // cabin front bulkhead
    for (const sx of [-1, 1]) glass.push(box(0.4, 0.38, 0.08, [sx * qx * 0.45, qy - 0.4, -L / 2 + qL + 0.3]));
    red.push(box(0.6, 0.85, 0.08, [0, qy - 0.45, -L / 2 + qL + 0.3]));                       // cabin door
    for (let i = 0; i < 7; i++) dark.push(box(0.09, 0.7, 0.09, [-qx + (2 * qx * i) / 6, qy + 0.42, -L / 2 + qL + 0.2]));
    dark.push(box(qx * 2, 0.08, 0.12, [0, qy + 0.78, -L / 2 + qL + 0.2]));
    for (const sx of [-1, 1]) dark.push(box(0.1, 0.08, qL, [sx * qx, qy + 0.78, -L / 2 + qL / 2 + 0.2]));
    dark.push(box(0.12, 0.12, 2.0, [0, qy + 0.55, -L / 2 + 1.4], [0.18, 0, 0]));              // tiller
    // main deck: hatch grating, water casks, swivel guns on the rail
    dark.push(box(B * 0.32, 0.3, L * 0.09, [0, dY + 0.15, zU(0.48)]));
    for (let i = 0; i < 3; i++) dark.push(place(cyl(0.32, 0.32, 0.75, 10), [B * 0.22, dY + 0.38, zU(0.4 + i * 0.045)]));
    for (const u of [0.35, 0.78]) for (const sx of [-1, 1]) {
      const y = sheer(H, u) + 0.2, x = hullX(H, u, sheer(H, u)) - 0.05;
      iron.push(place(cyl(0.05, 0.05, 0.5, 4), [sx * x, y - 0.2, zU(u)]));
      const br = cyl(0.09, 0.06, 0.8, 6); br.rotateZ(sx * -Math.PI / 2); iron.push(place(br, [sx * (x + 0.2), y + 0.08, zU(u)]));
    }
  } else if (id === 'schooner') {
    dark.push(box(B * 0.38, 1.0, L * 0.14, [0, dY + 0.5, zU(0.46)]));                      // deckhouse
    white.push(box(B * 0.4, 0.12, L * 0.15, [0, dY + 1.05, zU(0.46)]));
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) glass.push(box(0.06, 0.32, 0.45, [sx * B * 0.19, dY + 0.6, zU(0.42 + i * 0.04)]));
    dark.push(box(B * 0.3, 0.3, L * 0.07, [0, dY + 0.15, zU(0.22)]));
  } else if (id === 'brigantine') {
    const qy = deckY(H, 0.08);
    const x = hullX(H, 0.14, qy) * 0.95;
    dark.push(box(x * 2, 0.25, L * 0.22, [0, qy - 0.12, -L / 2 + L * 0.11]));
    dark.push(box(x * 2, 0.9, 0.18, [0, qy + 0.35, -L / 2 + L * 0.22]));
    for (let i = 0; i < 9; i++) dark.push(box(0.12, 0.8, 0.12, [-x + (2 * x * i) / 8, qy + 0.45, -L / 2 + L * 0.22]));
    dark.push(box(B * 0.28, 0.3, L * 0.08, [0, dY + 0.15, zU(0.52)]));
  } else if (war) {
    // flush spar deck: hatch gratings, boats on skid beams, quarterdeck carronades
    for (const u of [0.38, 0.6]) dark.push(box(B * 0.3, 0.35, L * 0.06, [0, dY + 0.17, zU(u)]));
    const boats = big ? 3 : 2;
    for (let i = 0; i < boats; i++) {
      const bz = zU(0.44 + (i - (boats - 1) / 2) * 0.08), by = dY + 1.4;
      white.push(place(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), [0, by, bz], [0, 0, 0], [B * 0.12, B * 0.08, L * 0.05]));
      dark.push(box(B * 0.7, 0.18, 0.25, [0, by - 0.2, bz]));
    }
    for (const sx of [-1, 1]) for (let i = 0; i < (lev ? 0 : big ? 6 : 4); i++) {
      const u = 0.06 + i * 0.045, y = deckY(H, u) + 0.55, x = hullX(H, u, y) - 0.5;
      const bar = cyl(0.12 * gs, 0.1 * gs, 1.0 * gs, 8); bar.rotateZ(sx * -Math.PI / 2);
      iron.push(place(bar, [sx * x, y, zU(u)]));
    }
    // poop / quarterdeck break
    const qy = deckY(H, 0.06), x = hullX(H, 0.15, qy) * 0.95;
    if (!lev) dark.push(box(x * 2, 0.9, 0.18, [0, qy + 0.35, -L / 2 + L * 0.25]));
    if (big && !lev) { // a fourth deck aft: the poop, plus gilt carving along the sheer
      dark.push(box(x * 1.7, 2.2, L * 0.12, [0, qy + 1.1, -L / 2 + L * 0.07]));
      for (let i = 0; i < 6; i++) glass.push(box(0.08, 0.7, 0.9, [x * 0.86, qy + 1.2, -L / 2 + L * (0.03 + i * 0.018)])), glass.push(box(0.08, 0.7, 0.9, [-x * 0.86, qy + 1.2, -L / 2 + L * (0.03 + i * 0.018)]));
      for (let i = 0; i < 40; i++) { const u = 0.04 + i * 0.024; for (const sx of [-1, 1]) gold.push(box(0.1, 0.18, L * 0.012, [sx * (hullX(H, u, sheer(H, u) - 0.4) + 0.02), sheer(H, u) - 0.4, zU(u)])); }
    }
  } else if (id === 'galleon') {
    // stern castle in stepped, painted tiers + forecastle castle
    const tiers = 3;
    for (let t = 0; t < tiers; t++) {
      const u1 = 0.3 - t * 0.075, y0 = deckY(H, 0.1) + t * 2.1;
      const w = hullX(H, 0.12, deckY(H, 0.12)) * (1.0 - t * 0.1);
      const cz = -L / 2 + (L * u1) / 2;
      red.push(box(w * 2, 2.0, L * u1, [0, y0 + 1.0, cz]));
      dark.push(box(w * 2 + 0.2, 0.22, L * u1 + 0.2, [0, y0 + 2.05, cz]));
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4 - t; i++) { glass.push(box(0.08, 0.8, 0.9, [sx * (w + 0.02), y0 + 1.0, -L / 2 + L * (0.04 + i * 0.06)])); gold.push(box(0.1, 1.05, 0.12, [sx * (w + 0.03), y0 + 1.0, -L / 2 + L * (0.04 + i * 0.06) + 0.55])); }
        gold.push(box(0.12, 0.14, L * u1, [sx * (w + 0.04), y0 + 0.05, cz]));
        gold.push(box(0.12, 0.14, L * u1, [sx * (w + 0.04), y0 + 1.95, cz]));
      }
      gold.push(box(w * 2.05, 0.14, 0.14, [0, y0 + 1.95, -L / 2 + L * u1 + 0.02]));
      for (let i = 0; i < 9; i++) dark.push(box(0.1, 0.7, 0.1, [-w + (2 * w * i) / 8, y0 + 2.5, -L / 2 + L * u1]));
      for (let i = 0; i < 3 - t; i++) glass.push(box(w * 0.4, 0.8, 0.08, [-w * 0.6 + i * w * 0.6, y0 + 1.0, -L / 2 - 0.02])); // castle stern windows
    }
    const fy = deckY(H, 0.9);
    const fw = hullX(H, 0.86, fy) * 0.95;
    red.push(box(fw * 2, 1.6, L * 0.14, [0, fy + 0.8, zU(0.87)]));
    dark.push(box(fw * 2 + 0.2, 0.22, L * 0.15, [0, fy + 1.65, zU(0.87)]));
    for (const sx of [-1, 1]) { gold.push(box(0.12, 0.14, L * 0.14, [sx * (fw + 0.04), fy + 1.55, zU(0.87)])); for (let i = 0; i < 3; i++) gold.push(box(0.08, 0.5, 0.5, [sx * (fw + 0.03), fy + 0.8, zU(0.82 + i * 0.045)])); }
    for (let i = 0; i < 8; i++) dark.push(box(0.1, 0.8, 0.1, [-fw + (2 * fw * i) / 7, fy + 2.05, zU(0.8)]));
  }
  if (lev) buildPalace();
  // ship's wheel (not on the sloop: it steers with a tiller)
  if (id !== 'sloop' && !lev) {
    const wu = id === 'galleon' ? 0.2 : 0.12;
    const wheelY = deckY(H, wu) + (id === 'galleon' ? 7.3 : big ? 3.2 : 1.0);
    dark.push(place(new THREE.TorusGeometry(0.55, 0.05, 6, 16), [0, wheelY, zU(wu)]));
    for (let i = 0; i < 8; i++) dark.push(place(cyl(0.03, 0.03, 1.3, 4), [0, wheelY, zU(wu)], [0, 0, (i / 8) * Math.PI * 2]));
  }
  dark.push(place(cyl(0.45, 0.35, 0.9, 10), [0, dY + 0.45, zU(0.3)])); // capstan

  // ---------------------------------------------------------------- stern
  {
    const sy1 = sheer(H, 0) - 0.35, sy0 = Math.max(1.0, Math.min(deckY(H, 0) - 0.4, sy1 * (D.stern === 'counter' ? 0.75 : 0.42)));
    const zS = -L / 2 + overhang(H, 0, 0.8);
    const wx = (B / 2) * planW(H, 0) * 0.8;
    const rows = lev ? 4 : D.stern === 'galleries3' ? 3 : D.stern === 'castle' ? 3 : D.stern === 'gallery' ? 2 : 1;
    const nW = Math.max(3, Math.round(wx * 1.6));
    for (let r = 0; r < rows; r++) {
      const y = sy0 + ((sy1 - sy0) * (r + 0.5)) / rows;
      for (let i = 0; i < nW; i++) {
        const x = -wx + ((2 * wx) * (i + 0.5)) / nW;
        glass.push(box((2 * wx) / nW * 0.62, Math.min(1.1, (sy1 - sy0) / rows * 0.5), 0.08, [x, y, zS - 0.03]));
      }
      gold.push(box(wx * 2.05, 0.12, 0.14, [0, y - 0.45, zS - 0.05]));
      gold.push(box(wx * 2.05, 0.12, 0.14, [0, y + 0.45, zS - 0.05]));
      if (rows > 1) { // balconies
        dark.push(box(wx * 2.1, 0.12, 1.0, [0, y - 0.55, zS - 0.5]));
        for (let i = 0; i <= 10; i++) gold.push(place(cyl(0.04, 0.04, 0.7, 4), [-wx + (2 * wx * i) / 10, y - 0.15, zS - 0.95]));
        gold.push(box(wx * 2.1, 0.08, 0.08, [0, y + 0.2, zS - 0.97]));
      }
    }
    // quarter galleries (bulging side towers at the stern) on the big ships
    if (rows > 1) for (const sx of [-1, 1]) {
      const qx = hullX(H, 0.06, (sy0 + sy1) / 2) + 0.3;
      dark.push(box(0.9, (sy1 - sy0) * 0.9, L * 0.06, [sx * qx, (sy0 + sy1) / 2, zU(0.05)]));
      for (let r = 0; r < rows; r++) glass.push(box(0.1, 0.6, L * 0.04, [sx * (qx + 0.46), sy0 + ((sy1 - sy0) * (r + 0.5)) / rows, zU(0.05)]));
      gold.push(place(new THREE.ConeGeometry(0.8, 1.6, 8), [sx * qx, sy1 + 0.6, zU(0.05)]));
    }
    // stern lanterns
    const nl = big ? [-1, 0, 1] : L < 30 ? [0] : [-1, 1];
    for (const sx of nl) {
      const lx = sx * wx * 0.9, ly = sheer(H, 0) + 0.9 + (sx === 0 ? 0.6 : 0) + (D.stern === 'castle' ? 6.3 : 0);
      const ls = big ? 1.8 : 1;
      iron.push(place(cyl(0.04, 0.04, 0.9 * ls, 4), [lx, ly - 0.6 * ls, zS - 0.2]));
      lamps.push(place(new THREE.CylinderGeometry(0.22 * ls, 0.16 * ls, 0.55 * ls, 6), [lx, ly, zS - 0.2]));
      gold.push(place(new THREE.ConeGeometry(0.26 * ls, 0.3 * ls, 6), [lx, ly + 0.42 * ls, zS - 0.2]));
    }
    if (D.stern === 'counter') white.push(box(wx * 1.6, 0.1, 0.08, [0, sy1 - 0.05, zS - 0.02]));
    if (id === 'sloop') { gold.push(box(wx * 1.9, 0.5, 0.1, [0, sy1 + 0.05, zS - 0.04])); }
  }

  // ---------------------------------------------------------------- guns + ports
  const guns = gunLayout(stats);
  const addPort = (sx, x, y, z, barrel = true) => {
    ports.push(box(0.12, 0.72 * gs, 0.8 * gs, [x, y, z]));
    const lid = new THREE.BoxGeometry(0.06, 0.62 * gs, 0.7 * gs); lid.translate(0, 0.31 * gs, 0);
    red.push(place(lid, [x + sx * 0.04, y + 0.3 * gs, z], [0, 0, sx * -1.1]));
    if (!barrel) return;
    const br = cyl(0.13 * gs, 0.09 * gs, 1.5 * gs, 8); br.rotateZ(sx * -Math.PI / 2);
    iron.push(place(br, [x + sx * 0.45 * gs, y - 0.02, z]));
    iron.push(place(new THREE.TorusGeometry(0.11 * gs, 0.035 * gs, 4, 8), [x + sx * 1.18 * gs, y - 0.02, z], [0, Math.PI / 2, 0]));
  };
  for (const g of guns) {
    if (g.side === 'L' || g.side === 'R') addPort(g.side === 'L' ? 1 : -1, g.x, g.y, g.z);
    else {
      const fwd = g.side === 'bow' ? 1 : -1;
      const br = cyl(0.13 * gs, 0.09 * gs, 1.5 * gs, 8); br.rotateX(fwd * Math.PI / 2);
      iron.push(place(br, [g.x, g.y, g.z + fwd * 0.4]));
      dark.push(box(0.6 * gs, 0.35 * gs, 1.0 * gs, [g.x, g.y - 0.3, g.z - fwd * 0.2]));
    }
  }
  // warships show a full tier of gunports on every deck, whatever their current battery
  {
    const decks = Math.max(1, H.decks);
    const per = lev ? 22 : big ? 15 : id === 'galleon' ? 9 : id === 'frigate' ? 12 : id === 'brigantine' ? 7 : id === 'schooner' ? 5 : 4;
    for (let d = 0; d < decks; d++) {
      const y = Math.max(0.6, deckY(H, 0.5) - d * deckGap(H) + 0.55);
      const u0 = 0.17 + d * 0.025, u1 = 0.8 - d * 0.03;
      for (let i = 0; i < per; i++) {
        const u = u0 + ((u1 - u0) * i) / (per - 1), z = zU(u);
        if (guns.some((g) => g.deck === d && Math.abs(g.z - z) < 1.6 * gs)) continue;
        for (const sx of [1, -1]) addPort(sx, sx * (hullX(H, u, y) + 0.05), y, z, big);
      }
    }
  }
  // channels (chainwales) for the shrouds
  const plan = rigPlan(id);
  for (const mm of plan.masts) for (const sx of [1, -1]) {
    const y = sheer(H, mm.u) - 0.5, x = hullX(H, mm.u, y);
    dark.push(box(0.7, 0.14, Math.max(2.2, L * 0.07), [sx * (x + 0.3), y, zU(mm.u)]));
  }

  // ---------------------------------------------------------------- bow: bowsprit, figurehead, beakhead, anchors
  const stemY = sheer(H, 1) - 0.2, stemZ = L / 2 + overhang(H, 1, 1);
  const [bsK, bsAng] = plan.bs;
  const bsA = new V3(0, stemY - 0.2, stemZ - L * 0.12), bsDir = new V3(0, Math.sin(bsAng), Math.cos(bsAng));
  const bsLen = L * bsK;
  const bsTip = bsA.clone().addScaledVector(bsDir, bsLen);
  spar.push(span(bsA, bsTip, 0.28 * gs, 0.12 * gs, 8));
  if (D.bow === 'clipper' || D.bow === 'raked') { gold.push(box(0.12, 0.5, L * 0.07, [0.02, stemY - 0.7, stemZ - L * 0.04], [0.15, 0, 0])); }
  if (D.bow === 'figure' || D.bow === 'head') {
    const fs = lev ? 3.2 : big ? 2.2 : 1;
    gold.push(place(new THREE.SphereGeometry(0.42 * gs * fs, 10, 8), [0, stemY - 0.6, stemZ + 0.25 * fs], null, [0.7, 1, 1.3]));
    if (big) { gold.push(place(new THREE.TorusGeometry(0.9 * gs, 0.35 * gs, 6, 12), [0, stemY - 0.4, stemZ + 0.5], [0, Math.PI / 2, 0])); for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) gold.push(span(new V3(sx * 0.3, stemY - 1.8 + i * 0.5, stemZ - 3), new V3(sx * (hullX(H, 0.85, stemY - 1.8 + i * 0.5) + 0.1), stemY - 1.8 + i * 0.5, zU(0.85)), 0.09, 0.09, 4)); }
    if (war) dark.push(box(0.5, 0.5, 2.6 * (big ? 1.6 : 1), [0, stemY - 1.1, stemZ + 0.6], [0.3, 0, 0]));
  }
  if (D.bow === 'beak') { // galleon beakhead: long projecting platform under the bowsprit
    dark.push(box(B * 0.32, 0.3, L * 0.12, [0, stemY - 1.3, stemZ + L * 0.04], [0.1, 0, 0]));
    gold.push(box(B * 0.34, 0.1, L * 0.12, [0, stemY - 1.05, stemZ + L * 0.04], [0.1, 0, 0]));
    gold.push(place(new THREE.SphereGeometry(0.6 * gs, 8, 6), [0, stemY - 1.4, stemZ + L * 0.1], null, [0.7, 1, 1.6]));
  }
  if (war || id === 'galleon') for (const sx of [-1, 1]) { // catheads + anchors
    const ay = sheer(H, 0.9) - 0.6, ax = sx * (hullX(H, 0.9, ay) + 0.3);
    dark.push(box(0.4, 0.4, 1.4, [ax, ay + 0.4, zU(0.9)]));
    iron.push(box(0.18, 2.6 * gs, 0.18, [ax + sx * 0.2, ay - 1.2 * gs, zU(0.9)]));
    iron.push(place(new THREE.TorusGeometry(0.8 * gs, 0.1, 4, 10, Math.PI), [ax + sx * 0.2, ay - 2.4 * gs, zU(0.9)], [0, Math.PI / 2, Math.PI]));
  }

  // ---------------------------------------------------------------- masts, tops, yards, sails
  const sails = [];
  const smat = sailMat(new THREE.Color(look.sailColor || (big ? '#f3efe2' : '#efe6cf')));
  const mastTops = [];
  const mastH = L * plan.mastH;
  const rigLines = [];
  const pushLine = (a, b) => { rigLines.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  const mastGroups = [];
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex(look.emblem ?? 0, look.flagBg || '#111', look.flagFg || '#eee'), side: THREE.DoubleSide, roughness: 0.9 });
  const fh = Math.max(1.3, L * 0.07);
  const flagGeo = new THREE.PlaneGeometry(fh * 1.6, fh, 10, 4); flagGeo.translate(-fh * 0.8, 0, 0); flagGeo.rotateY(Math.PI / 2);
  const flags = [];
  const pennantGeo = new THREE.PlaneGeometry(fh * 4, fh * 0.35, 16, 1); pennantGeo.translate(-fh * 2, 0, 0); pennantGeo.rotateY(Math.PI / 2);
  const pennantMat = new THREE.MeshStandardMaterial({ color: look.flagBg ? new THREE.Color(look.flagBg) : 0xb01818, side: THREE.DoubleSide, roughness: 0.9 });
  plan.masts.forEach((mm, mi) => {
    const h = mastH * mm.h;
    const base = deckY(H, mm.u) + (id === 'galleon' && mm.u < 0.3 ? 4 : 0), z = zU(mm.u);
    const r0 = Math.max(0.22, B * (big ? 0.05 : 0.045));
    const lowerH = h * 0.52;
    const rake = D.rake;
    const at = (y) => new V3(0, base + y, z - y * rake); // raked mast line
    const top = at(h);
    const upper = new THREE.Group(); body.add(upper);
    const upperSpar = [], upLines = [];
    const pushUp = (a, b) => { upLines.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    spar.push(span(at(-0.4), at(lowerH), r0, r0 * 0.78, 10));
    upperSpar.push(span(at(lowerH - 1.2), at(h * 0.82), r0 * 0.6, r0 * 0.42, 8));
    upperSpar.push(span(at(h * 0.8), top, r0 * 0.36, r0 * 0.2, 6));
    const square = (mm.sq || 0) > 0;
    if (square || h > 20) {
      dark.push(place(cyl(B * 0.16, B * 0.16, 0.25, 10), [0, at(lowerH).y, at(lowerH).z]));
      upperSpar.push(box(B * 0.22, 0.12, 0.25, [0, at(h * 0.8).y, at(h * 0.8).z]));
      if (big) { dark.push(box(B * 0.3, 0.9, 0.08, [0, at(lowerH).y + 0.5, at(lowerH).z + B * 0.15])); }
    }
    gold.push(place(new THREE.SphereGeometry(r0 * 0.4, 6, 4), [top.x, top.y + 0.1, top.z]));
    mastTops.push(top.clone());
    // stump left behind when the topmast is shot away
    const stump = new THREE.Mesh(new THREE.ConeGeometry(r0 * 0.75, 1.6, 7, 1, false), m.stump);
    stump.position.copy(at(lowerH + 0.6)); stump.scale.set(1, 1, 1); stump.rotation.z = 0.3; stump.visible = false; body.add(stump);
    // shrouds + ratlines to the channels
    const chY = sheer(H, mm.u) - 0.5, chX = hullX(H, mm.u, chY) + 0.55;
    const nShroud = Math.max(3, Math.round(L / 10));
    for (const sx of [1, -1]) {
      const hook = at(lowerH);
      const ends = [];
      for (let s = 0; s < nShroud; s++) {
        const e = new V3(sx * chX, chY, z + (s - (nShroud - 1) / 2) * 0.7);
        pushLine(new V3(sx * r0, hook.y, hook.z), e); ends.push(e);
      }
      for (let k = 1; k < 9; k++) {
        const t = k / 10;
        for (let s = 0; s < ends.length - 1; s++) pushLine(new V3().lerpVectors(ends[s], new V3(sx * r0, hook.y, hook.z), t), new V3().lerpVectors(ends[s + 1], new V3(sx * r0, hook.y, hook.z), t));
      }
      pushUp(new V3(sx * B * 0.15, hook.y, hook.z), new V3(sx * r0 * 0.5, base + h * 0.82, at(h * 0.82).z));
    }
    for (const sx of [1, -1]) pushUp(at(h * 0.83), new V3(sx * (hullX(H, mm.u - 0.08, chY) + 0.4), chY, z - L * 0.08));
    // --- square sails: course, topsail, topgallant, royal
    if (square) {
      const tiers = [[0.1, 0.5], [0.53, 0.75], [0.77, 0.89], [0.9, 0.985]];
      const wMax = B * (lev ? 1.55 : big ? 1.95 : id === 'galleon' ? 1.85 : id === 'sloop' ? 1.5 : 1.75) * (mm.main ? 1 : 0.9);
      const start = mm.sqStart || 0;
      for (let li = start; li < start + mm.sq && li < 4; li++) {
        const [a, b2] = tiers[li];
        const yTop = h * b2, yBot = h * a + 0.6;
        const wT = wMax * (1 - li * 0.2) * 0.92, wB = wMax * (1 - li * 0.2 + 0.1);
        const tgt = li === 0 ? spar : upperSpar;
        const pT = at(yTop), pB = at(yBot);
        tgt.push(span(new V3(-wT / 2 - 0.4, pT.y, pT.z + 0.4), new V3(wT / 2 + 0.4, pT.y, pT.z + 0.4), 0.16 * gs, 0.16 * gs, 6));
        if (li === start) tgt.push(span(new V3(-wB / 2 - 0.4, pB.y, pB.z + 0.4), new V3(wB / 2 + 0.4, pB.y, pB.z + 0.4), 0.18 * gs, 0.18 * gs, 6));
        const sail = new THREE.Mesh(squareSail(wT, wB, yTop - yBot, (yTop - yBot) * 0.22), smat); sail.castShadow = true;
        sail.position.set(0, pT.y - 0.15, pT.z + 0.55);
        (li === 0 ? body : upper).add(sail);
        sails.push({ mesh: sail, kind: 'square', h: yTop - yBot });
        // studding sails hung outboard of the course and topsail yards
        if (mm.stud && li < 2) for (const sx of [-1, 1]) {
          const sw = wT * 0.22, sh2 = (yTop - yBot) * 0.9;
          tgt.push(span(new V3(sx * (wT / 2 + 0.2), pT.y, pT.z + 0.45), new V3(sx * (wT / 2 + sw + 0.6), pT.y, pT.z + 0.45), 0.08, 0.08, 4));
          const st = new THREE.Mesh(squareSail(sw, sw, sh2, sh2 * 0.15), smat);
          st.position.set(sx * (wT / 2 + sw / 2 + 0.4), pT.y - 0.15, pT.z + 0.5);
          (li === 0 ? body : upper).add(st); sails.push({ mesh: st, kind: 'square', h: sh2 });
        }
        (li === 0 ? pushLine : pushUp)(new V3(wT / 2, pT.y, pT.z + 0.4), at(h * Math.min(1, b2 + 0.06)));
        (li === 0 ? pushLine : pushUp)(new V3(-wT / 2, pT.y, pT.z + 0.4), at(h * Math.min(1, b2 + 0.06)));
      }
    }
    // --- fore-and-aft: gaff (sloop/schooner/brig main), spanker (mizzen), lateen (galleon)
    if (mm.gaff || mm.spanker) {
      const boomL = Math.min(L * (mm.boom || 0.4), (mm.u + 0.02) * L);
      const lowY = base + 1.6, hiY = base + h * (mm.spanker ? 0.5 : 0.68);
      const zl = (y) => z - (y - base) * rake;
      const boomEnd = new V3(0, lowY + 0.4, zl(lowY) - boomL), gaffEnd = new V3(0, hiY + boomL * 0.45, zl(hiY) - boomL * 0.85);
      spar.push(span(new V3(0, lowY, zl(lowY)), boomEnd, 0.17 * gs, 0.12 * gs, 6));
      spar.push(span(new V3(0, hiY, zl(hiY)), gaffEnd, 0.15 * gs, 0.1 * gs, 6));
      const sail = new THREE.Mesh(patchSail([new V3(0, hiY, zl(hiY) - 0.3), gaffEnd, boomEnd, new V3(0, lowY + 0.2, zl(lowY) - 0.3)], boomL * 0.12), smat); sail.castShadow = true; body.add(sail);
      sails.push({ mesh: sail, kind: 'fore-aft' });
      pushUp(gaffEnd, at(h * 0.95));
      if (mm.topsail) {
        const s2 = new THREE.Mesh(patchSail([at(h * 0.95).add(new V3(0, 0, -0.2)), gaffEnd.clone(), new V3(0, hiY + 0.2, zl(hiY) - 0.2)], boomL * 0.06), smat);
        upper.add(s2); sails.push({ mesh: s2, kind: 'fore-aft' });
      }
    }
    if (mm.lateen) {
      const yA = new V3(0, base + 1.4, z + h * 0.35), yB = new V3(0, base + h * 0.95, z - h * 0.42);
      spar.push(span(yA, yB, 0.15 * gs, 0.1 * gs, 6));
      const sail = new THREE.Mesh(patchSail([yA.clone(), yB.clone(), new V3(0, base + 1.6, z - h * 0.3)], h * 0.08), smat); body.add(sail); sails.push({ mesh: sail, kind: 'fore-aft' });
    }
    // flags: the main masthead flies the captain's colours; a Man of War flies pennants from every mast
    if (mm.main || big) {
      const f = new THREE.Mesh(mm.main ? flagGeo : pennantGeo.clone(), mm.main ? flagMat : pennantMat);
      f.position.set(0, top.y - (mm.main ? fh * 0.6 : 0.3), top.z);
      upper.add(f); flags.push({ mesh: f, base: f.geometry.attributes.position.array.slice(), len: mm.main ? fh * 1.6 : fh * 4 });
    }
    upper.add(merged(upperSpar, m.spar));
    mastGroups.push({ upper, stump, u: mm.u, main: !!mm.main, lowY: at(lowerH).y, upLines });
  });
  // forestays + jibs from the foremast to the bowsprit
  const foreIdx = plan.masts.reduce((bi, mm, i) => (mm.u > plan.masts[bi].u ? i : bi), 0);
  const fore = mastTops[foreIdx];
  const foreZ = fore.z;
  for (let j = 0; j < plan.jibs; j++) {
    const fy = deckY(H, 0.75);
    const head = new V3(0, fy + (fore.y - fy) * (plan.masts.length === 1 ? 0.78 - j * 0.12 : 0.34 + j * 0.1), foreZ + 0.3);
    const tack = bsA.clone().addScaledVector(bsDir, bsLen * Math.min(1, 0.3 + j * 0.24));
    const hi = head.y > mastGroups[foreIdx].lowY;
    (hi ? (a, b) => mastGroups[foreIdx].upLines.push(a.x, a.y, a.z, b.x, b.y, b.z) : pushLine)(head, tack);
    const clew = new V3(0, Math.max(fy + 1.6, tack.y - 1.5) + j * 0.4, foreZ + (tack.z - foreZ) * (0.42 + j * 0.1));
    const sail = new THREE.Mesh(patchSail([head.clone().add(new V3(0, -0.3, 0.2)), tack.clone().add(new V3(0, 0.15, 0)), clew], 0.9 + j * 0.2), smat);
    (hi ? mastGroups[foreIdx].upper : body).add(sail); sails.push({ mesh: sail, kind: 'jib' });
  }
  if (plan.sprit) { // spritsail under the bowsprit
    const sy = bsA.clone().addScaledVector(bsDir, bsLen * 0.7);
    spar.push(span(new V3(-B * 0.45, sy.y - 0.3, sy.z), new V3(B * 0.45, sy.y - 0.3, sy.z), 0.12, 0.12, 6));
    const s = new THREE.Mesh(squareSail(B * 0.88, B * 0.95, B * 0.45, 0.8), smat); s.position.set(0, sy.y - 0.35, sy.z + 0.3); body.add(s); sails.push({ mesh: s, kind: 'square', h: B * 0.45 });
  }
  for (let i = 0; i < mastTops.length - 1; i++) { const a = mastTops[i].clone().add(new V3(0, -mastH * 0.15, 0)), b = new V3(0, deckY(H, plan.masts[i + 1].u) + 0.5, mastTops[i + 1].z); mastGroups[i].upLines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  { const a = fore.clone(), b = bsTip.clone(); mastGroups[foreIdx].upLines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  for (const g of mastGroups) { if (!g.upLines.length) continue; const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(g.upLines, 3)); g.upper.add(new THREE.LineSegments(lg, m.rope)); }
  pushLine(bsTip, new V3(0, 0.4, L / 2 - 0.4));

  // stern ensign
  const flag2 = new THREE.Mesh(flagGeo.clone(), flagMat);
  flag2.scale.setScalar(lev ? 0.9 : big ? 1.3 : 0.8);
  const ensY = sheer(H, 0) + 2.2 + (D.stern === 'castle' ? 6.3 : 0);
  flag2.position.set(0, ensY, -L / 2 - 0.6);
  iron.push(place(cyl(0.05, 0.05, 2.8, 4), [0, ensY - 0.8, -L / 2 - 0.6]));
  body.add(flag2);
  flags.push({ mesh: flag2, base: flag2.geometry.attributes.position.array.slice(), len: fh * 1.6 });


  // ---------------------------------------------------------------- the Leviathan's palace
  function buildPalace() {
    const u0 = 0.035, u1 = 0.36, uc = (u0 + u1) / 2;
    const py = Math.max(deckY(H, u0 + 0.02), deckY(H, u1)) - 0.1;
    const w = hullX(H, uc, py) * 0.86, Lp = (u1 - u0) * L, zc = zU(uc);
    const prism = (wd, ht, dp, pos) => { const g = cyl(1, 1, dp, 3); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.translate(0, 0.5, 0); return place(g, pos, null, [wd / 1.732, ht / 1.5, 1]); };
    // storeys, stepping in as they rise: marble walls, rows of tall windows, gilt pilasters + cornices
    const storeys = [[1, 1, 7, 11], [0.8, 0.76, 6.2, 8], [0.58, 0.52, 5.4, 6]];
    let y = py;
    const tops = [];
    storeys.forEach(([kw, kl, h, nW], si) => {
      const ww = w * kw, ll = Lp * kl, cz = zc - (Lp - ll) * 0.25;
      marble.push(box(ww * 2, h, ll, [0, y + h / 2, cz]));
      gold.push(box(ww * 2 + 0.7, 0.5, ll + 0.7, [0, y + h - 0.1, cz]));               // cornice
      gold.push(box(ww * 2 + 0.3, 0.25, ll + 0.3, [0, y + 0.15, cz]));                // plinth
      for (const sx of [-1, 1]) {
        for (let i = 0; i < nW; i++) {
          const z = cz - ll / 2 + (ll * (i + 0.5)) / nW;
          glass.push(box(0.12, h * 0.5, Math.min(1.8, ll / nW * 0.45), [sx * (ww + 0.03), y + h * 0.47, z]));
          gold.push(place(new THREE.SphereGeometry(Math.min(0.9, ll / nW * 0.23), 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), [sx * (ww + 0.03), y + h * 0.72, z], null, [0.25, 1, 1]));
          if (i < nW) gold.push(box(0.3, h * 0.92, 0.45, [sx * (ww + 0.12), y + h * 0.5, cz - ll / 2 + (ll * i) / nW]));
        }
        gold.push(box(0.3, h * 0.92, 0.45, [sx * (ww + 0.12), y + h * 0.5, cz + ll / 2]));
      }
      // windows on the forward façade
      const nf = Math.max(2, Math.round(ww / 2.4));
      for (let i = 0; i < nf; i++) glass.push(box(Math.min(1.6, (2 * ww) / nf * 0.4), h * 0.5, 0.12, [-ww + (2 * ww * (i + 0.5)) / nf, y + h * 0.47, cz + ll / 2 + 0.03]));
      // rooftop balustrade
      const posts = Math.round(ll / 1.6);
      for (const sx of [-1, 1]) { for (let i = 0; i <= posts; i++) marble.push(box(0.25, 0.9, 0.25, [sx * (ww - 0.2), y + h + 0.6, cz - ll / 2 + (ll * i) / posts])); gold.push(box(0.22, 0.14, ll, [sx * (ww - 0.2), y + h + 1.1, cz])); }
      const pf = Math.round(ww / 0.8);
      for (let i = 0; i <= pf; i++) marble.push(box(0.25, 0.9, 0.25, [-ww + 0.2 + ((2 * ww - 0.4) * i) / pf, y + h + 0.6, cz + ll / 2 - 0.2]));
      gold.push(box(ww * 2, 0.14, 0.22, [0, y + h + 1.1, cz + ll / 2 - 0.2]));
      tops.push({ y: y + h, ww, ll, cz });
      if (si === 0) {
        // grand portico with columns + pediment facing the bow
        const pz = cz + ll / 2 + 2.2, nc = 8;
        marble.push(box(ww * 1.3, 0.5, 4.8, [0, y + 0.25, pz - 0.2]));
        for (let i = 0; i < nc; i++) { const x = -ww * 0.6 + (1.2 * ww * i) / (nc - 1); marble.push(place(cyl(0.5, 0.42, h - 0.6, 10), [x, y + 0.5 + (h - 0.6) / 2, pz + 1.4])); gold.push(box(1.2, 0.3, 1.2, [x, y + h - 0.05, pz + 1.4])); }
        marble.push(box(ww * 1.35, 0.7, 5.4, [0, y + h + 0.3, pz]));
        marble.push(prism(ww * 1.35, 3.0, 5.2, [0, y + h + 0.6, pz]));
        gold.push(prism(ww * 0.5, 1.15, 5.3, [0, y + h + 0.95, pz]));
        // royal banners between the windows
        for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { const z = cz - ll * 0.3 + i * ll * 0.3; red.push(box(0.14, h * 0.7, 1.4, [sx * (ww + 0.25), y + h * 0.55, z])); gold.push(box(0.16, 0.25, 1.5, [sx * (ww + 0.26), y + h * 0.9, z])); }
      }
      y += h;
    });
    // corner towers with gilded onion domes
    const t0 = tops[0];
    for (const sx of [-1, 1]) for (const fz of [-1, 1]) {
      const tx = sx * (t0.ww - 1.2), tz = t0.cz + fz * (t0.ll / 2 - 1.2), th = 21;
      marble.push(place(cyl(2.0, 1.8, th, 14), [tx, py + th / 2, tz]));
      gold.push(place(cyl(2.3, 2.3, 0.5, 14), [tx, py + th, tz]));
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; glass.push(place(new THREE.BoxGeometry(0.6, 1.6, 0.12), [tx + Math.sin(a) * 1.92, py + 4 + r * 3.6, tz + Math.cos(a) * 1.92], [0, a, 0])); }
      const onion = new THREE.SphereGeometry(2.5, 16, 10); onion.scale(1, 1.25, 1);
      gold.push(place(onion, [tx, py + th + 2.4, tz]));
      gold.push(place(new THREE.ConeGeometry(0.9, 3.4, 10), [tx, py + th + 5.4, tz]));
      gold.push(place(new THREE.SphereGeometry(0.35, 8, 6), [tx, py + th + 7.3, tz]));
      lamps.push(place(new THREE.CylinderGeometry(0.5, 0.4, 0.9, 6), [tx + sx * 2.1, py + th - 1.6, tz]));
    }
    // central drum + great golden dome + lantern + spire
    const t2 = tops[2], dr = Math.min(t2.ww, t2.ll / 2) * 0.82;
    marble.push(place(cyl(dr, dr, 3.2, 24), [0, t2.y + 1.6, t2.cz]));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; glass.push(place(new THREE.BoxGeometry(0.9, 1.8, 0.12), [Math.sin(a) * (dr + 0.02), t2.y + 1.6, t2.cz + Math.cos(a) * (dr + 0.02)], [0, a, 0])); gold.push(place(new THREE.BoxGeometry(0.3, 3.2, 0.3), [Math.sin(a + 0.26) * (dr + 0.1), t2.y + 1.6, t2.cz + Math.cos(a + 0.26) * (dr + 0.1)], [0, a, 0])); }
    gold.push(place(cyl(dr + 0.4, dr + 0.4, 0.5, 24), [0, t2.y + 3.3, t2.cz]));
    gold.push(place(new THREE.SphereGeometry(dr * 1.02, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), [0, t2.y + 3.4, t2.cz], null, [1, 1.15, 1]));
    marble.push(place(cyl(dr * 0.22, dr * 0.22, 2.2, 12), [0, t2.y + 3.4 + dr * 1.15 + 1, t2.cz]));
    gold.push(place(new THREE.ConeGeometry(dr * 0.28, 4.5, 12), [0, t2.y + 3.4 + dr * 1.15 + 4.3, t2.cz]));
    gold.push(place(new THREE.SphereGeometry(0.6, 10, 8), [0, t2.y + 3.4 + dr * 1.15 + 6.8, t2.cz]));
    // forward pavilion on the forecastle: arcade + small dome, flanked by two little towers
    {
      const fu = 0.905, fy = deckY(H, fu) - 0.1, fw = hullX(H, fu, fy) * 0.62, fl = L * 0.06, fz = zU(fu), fh = 4.2;
      marble.push(box(fw * 2, fh, fl, [0, fy + fh / 2, fz]));
      gold.push(box(fw * 2 + 0.5, 0.45, fl + 0.5, [0, fy + fh, fz]));
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) glass.push(box(0.12, fh * 0.5, 1.2, [sx * (fw + 0.03), fy + fh * 0.5, fz - fl * 0.3 + i * fl * 0.3]));
      gold.push(place(new THREE.SphereGeometry(fw * 0.62, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, fy + fh + 0.2, fz], null, [1, 1.2, 1]));
      gold.push(place(new THREE.ConeGeometry(0.5, 2.6, 8), [0, fy + fh + fw * 0.75 + 1.2, fz]));
      for (const sx of [-1, 1]) { marble.push(place(cyl(1.1, 1.0, 8, 10), [sx * (fw + 0.4), fy + 4, fz - fl / 2])); const o = new THREE.SphereGeometry(1.4, 12, 8); o.scale(1, 1.3, 1); gold.push(place(o, [sx * (fw + 0.4), fy + 9.2, fz - fl / 2])); gold.push(place(new THREE.ConeGeometry(0.5, 2, 8), [sx * (fw + 0.4), fy + 11, fz - fl / 2])); }
    }
    // gilt balustrade + lantern posts along the open spar deck
    for (let i = 0; i <= 31; i++) { const u = 0.38 + i * 0.016; for (const sx of [-1, 1]) { const yy = sheer(H, u), xx = hullX(H, u, yy) - 0.25; gold.push(box(0.22, 1.0, 0.22, [sx * xx, yy + 0.55, zU(u)])); if (i % 6 === 0) { gold.push(place(cyl(0.08, 0.08, 2.6, 5), [sx * xx, yy + 1.3, zU(u)])); lamps.push(place(new THREE.CylinderGeometry(0.42, 0.32, 0.8, 6), [sx * xx, yy + 2.9, zU(u)])); } } }
    for (const sx of [-1, 1]) gold.push(span(new V3(sx * (hullX(H, 0.38, sheer(H, 0.38)) - 0.25), sheer(H, 0.38) + 1.05, zU(0.38)), new V3(sx * (hullX(H, 0.88, sheer(H, 0.88)) - 0.25), sheer(H, 0.88) + 1.05, zU(0.88)), 0.12, 0.12, 4));
    // gilt carving along the sheer + a band of iron plates at the waterline
    for (let i = 0; i < 60; i++) { const u = 0.03 + i * 0.016; for (const sx of [-1, 1]) gold.push(box(0.12, 0.3, L * 0.009, [sx * (hullX(H, u, sheer(H, u) - 0.6) + 0.03), sheer(H, u) - 0.6, zU(u)])); }
    for (let i = 0; i < 44; i++) { const u = 0.05 + i * 0.021; for (const sx of [-1, 1]) { const yy = 0.9; iron.push(place(new THREE.BoxGeometry(0.2, 1.6, L * 0.019), [sx * (hullX(H, u, yy) + 0.06), yy, zU(u)], [0, 0, sx * 0.08])); } }
  }

  // assemble merged static meshes
  for (const [list, mat] of [[dark, m.darkwood], [spar, m.spar], [iron, m.iron], [gold, m.gold], [ports, m.port], [glass, m.glass], [lamps, m.lantern], [red, m.red], [white, m.white], [trimL, trimMat], [marble, m.marble]]) {
    const mesh = merged(list, mat); if (mesh) body.add(mesh);
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rigLines, 3));
  const rig = new THREE.LineSegments(rg, m.rope); body.add(rig);

  // shot holes (instanced decals placed where cannonballs actually struck)
  HOLE ||= holeGeometry();
  const MAXH = 40;
  const holes = new THREE.InstancedMesh(HOLE, m.hole, MAXH); holes.count = 0; holes.frustumCulled = false;
  body.add(holes);
  let holeN = 0;
  const hm = new THREE.Matrix4(), hq = new THREE.Quaternion(), hs = new V3(), hp = new V3();

  // ---------------------------------------------------------------- animation API
  const api = {
    root, body, sails, flag: flags[0]?.mesh, flag2, guns, H, sailMat: smat, rig, holes,
    sailLevel: 1, damage: 0, hullDamage: 0,
    setSailLevel(l) { this.sailLevel = l; },
    /** sail damage 0..1: holes in the canvas, and topmasts shot away as it gets worse. */
    setDamage(d) {
      smat.userData.damage.value = d; this.damage = d;
      // aft masts go first, the mainmast last
      const order = mastGroups.map((g, i) => i).sort((a, b) => (mastGroups[a].main - mastGroups[b].main) || mastGroups[a].u - mastGroups[b].u);
      order.forEach((gi, k) => { const broken = d > 0.55 + k * 0.12; mastGroups[gi].upper.visible = !broken; mastGroups[gi].stump.visible = broken; });
    },
    /** hull damage 0..1: scorched, splintered planking with glowing embers when badly hit. */
    setHullDamage(d) { hull.material.userData.dmg.value = d; this.hullDamage = d; },
    addHole(lx, ly, lz) {
      const u = Math.max(0.03, Math.min(0.97, lz / L + 0.5));
      const y = Math.max(keelY(H, u) * 0.3 + 0.2, Math.min(sheer(H, u) - 0.3, ly));
      const sx = lx >= 0 ? 1 : -1;
      const x = sx * (hullX(H, u, y) + 0.03);
      hp.set(x, y, (u - 0.5) * L + overhang(H, u, 0.6));
      hq.setFromEuler(new THREE.Euler(0, sx * Math.PI / 2, (holeN * 2.4) % 6.28));
      const sc = (0.55 + ((holeN * 0.37) % 0.45)) * Math.min(1.4, 0.55 + L / 70);
      hs.set(sc, sc, sc);
      hm.compose(hp, hq, hs);
      holes.setMatrixAt(holeN % MAXH, hm);
      holeN++;
      holes.count = Math.min(MAXH, holeN);
      holes.instanceMatrix.needsUpdate = true;
    },
    clearHoles() { holeN = 0; holes.count = 0; },
    /** Carpenters plug a share of the shot-holes. */
    patchHoles(frac) { holeN = Math.floor(Math.min(holeN, MAXH) * (1 - frac)); holes.count = holeN; },
    update(t, wind = 1) {
      const lvl = this.sailLevel;
      for (const s of sails) {
        if (s.kind === 'square') { s.mesh.scale.set(1, Math.max(0.04, lvl), 0.4 + 0.6 * lvl * wind + Math.sin(t * 1.7 + s.h) * 0.04); }
        else if (s.kind === 'jib') { s.mesh.visible = lvl > 0.05; }
        else { s.mesh.visible = lvl > 0.05; s.mesh.scale.set(0.6 + 0.4 * lvl, 1, 1); }
      }
      for (const f of flags) {
        if (!f.mesh.visible || (f.mesh.parent && !f.mesh.parent.visible)) continue;
        const p = f.mesh.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const zf = f.base[i * 3 + 2];
          const k = Math.abs(zf) / f.len;
          p.array[i * 3] = f.base[i * 3] + Math.sin(t * 6 - zf * 2.2) * 0.22 * k * fh;
          p.array[i * 3 + 1] = f.base[i * 3 + 1] - k * k * 0.15 * fh;
        }
        p.needsUpdate = true;
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry && o.geometry !== HOLE) o.geometry.dispose(); });
      hull.material.dispose(); smat.dispose(); flagMat.dispose(); pennantMat.dispose(); trimMat.dispose();
    },
  };
  return api;
}
