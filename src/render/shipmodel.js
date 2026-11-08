// Procedural, period-styled sailing ships: lofted planked hull with painted strakes and wales,
// gun decks with open ports + run-out cannons, stern gallery, bowsprit, tapered masts with tops,
// yards, billowing square / gaff / lateen / jib sails, standing rigging with ratlines, flags.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hullShape, planW, sheer, keelY, sectionW, hullX, deckY, gunLayout } from '../layout.js';
import { planks, deck as deckTex, sailcloth, noiseTex, flagTex } from './textures.js';

const V3 = THREE.Vector3;

// ------------------------------------------------------------------ shared materials
let M = null;
function mats() {
  if (M) return M;
  const pl = planks();
  M = {
    wood: new THREE.MeshStandardMaterial({ color: 0x6a4527, roughness: 0.85, map: pl.map }),
    darkwood: new THREE.MeshStandardMaterial({ color: 0x3b2614, roughness: 0.8 }),
    spar: new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.7 }),
    deck: new THREE.MeshStandardMaterial({ color: 0xc8a57a, roughness: 0.9, map: deckTex() }),
    iron: new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.45, metalness: 0.8 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a73a, roughness: 0.35, metalness: 0.85 }),
    port: new THREE.MeshStandardMaterial({ color: 0x120a05, roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x2a3a40, roughness: 0.15, metalness: 0.6, emissive: 0x332200, emissiveIntensity: 0.4 }),
    lantern: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffaa33, emissiveIntensity: 1.6 }),
    rope: new THREE.LineBasicMaterial({ color: 0x2a2016, transparent: true, opacity: 0.85 }),
    ropeMesh: new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 1 }),
  };
  return M;
}

/** Hull material is per ship (owner colours) and multiplies vertex-painted strakes. */
function hullMat() {
  const pl = planks();
  return new THREE.MeshStandardMaterial({ map: pl.map, bumpMap: pl.bump, bumpScale: 0.6, vertexColors: true, roughness: 0.78, side: THREE.DoubleSide });
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
/** Cylinder spanning two points. */
function span(a, b, r0, r1 = r0, seg = 6) {
  const d = new V3().subVectors(b, a), L = d.length();
  const g = cyl(r0, r1, L, seg);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize());
  g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
  return g;
}
function strip(g) { // keep only position/normal/uv so geometries merge
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g.index ? g.toNonIndexed() : g;
}
function merged(list, mat) {
  if (!list.length) return null;
  const m = new THREE.Mesh(mergeGeometries(list.map(strip)), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ hull
function hullGeometry(H, colors) {
  const NU = 48, NV = 26;
  const pos = [], col = [], uv = [], idx = [];
  const c = new THREE.Color();
  const wl = 0.12;
  const wales = [deckY(H, 0.5) - 0.25, deckY(H, 0.5) + H.bulwark * 0.55];
  const strakeColor = (y, u) => {
    if (y < wl) return colors.bottom;
    if (y < wl + 0.22) return colors.boot;
    for (const w of wales) if (Math.abs(y - w + (sheer(H, u) - sheer(H, 0.5)) * 0.0) < 0.16) return colors.wale;
    // painted gun-deck bands on big ships
    if (H.decks > 1) { for (let d = 0; d < H.decks; d++) { const gy = deckY(H, 0.5) - d * Math.max(1.7, H.depth * 0.28) + 0.55; if (Math.abs(y - gy) < 0.36) return colors.band; } }
    else { const gy = deckY(H, 0.5) + 0.55; if (Math.abs(y - gy) < 0.34) return colors.band; }
    if (y > sheer(H, u) - 0.22) return colors.rail;
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
        let x = (H.beam / 2) * planW(H, u) * sectionW(v);
        if (u > 0.985) x *= (1 - u) / 0.015 * 0.3 + 0.0; // sharp stem
        const z = (u - 0.5) * H.len;
        pos.push(x * sx, y, z);
        c.set(strakeColor(y, u)); col.push(c.r, c.g, c.b);
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
    const y = k + (s - k) * v, x = (H.beam / 2) * planW(H, 0) * sectionW(v);
    pos.push(x, y, -H.len / 2, -x, y, -H.len / 2);
    c.set(y < wl ? colors.bottom : y > s - 0.25 ? colors.rail : colors.stern); col.push(c.r, c.g, c.b, c.r, c.g, c.b);
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
  for (let i = 0; i < NU; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
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
/** Generic 3- or 4-corner sail patch with belly along +X (fore-aft sails billow sideways). */
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

// ------------------------------------------------------------------ the ship
/**
 * Build a ship model.
 * @param stats  derived ship stats (tier, len, beam, depth, side, bow, stern)
 * @param look   { hullColor, trimColor, sailColor, emblem, flagBg, flagFg }
 */
export function buildShip(stats, look = {}) {
  const m = mats();
  const H = hullShape(stats.tier, stats.len, stats.beam, stats.depth);
  const L = H.len, B = H.beam;
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);

  const hullCol = new THREE.Color(look.hullColor || '#5a3a22');
  const trim = new THREE.Color(look.trimColor || '#c9a227');
  const colors = {
    bottom: H.decks > 1 || stats.tier === 'frigate' ? new THREE.Color(0xb8743f) /* copper */ : new THREE.Color(0x8a8270) /* white stuff */,
    boot: new THREE.Color(0x1a1410), wale: new THREE.Color(0x15110d),
    band: trim, rail: hullCol.clone().multiplyScalar(0.7), hull: hullCol, stern: hullCol.clone().multiplyScalar(0.85),
  };
  const hull = new THREE.Mesh(hullGeometry(H, colors), hullMat());
  hull.castShadow = true; hull.receiveShadow = true;
  body.add(hull);
  const deckMesh = new THREE.Mesh(deckGeometry(H), m.deck); deckMesh.receiveShadow = true; body.add(deckMesh);

  const dark = [], spar = [], iron = [], gold = [], ports = [], glass = [], lamps = [];

  // keel + stem + sternpost
  dark.push(place(new THREE.BoxGeometry(0.35, 0.5, L * 0.86), [0, keelY(H, 0.45) - 0.1, -L * 0.03]));
  // rails along the sheer (cap rail)
  for (let i = 0; i < 24; i++) {
    const u0 = i / 24, u1 = (i + 1) / 24;
    for (const sx of [1, -1]) {
      const a = new V3(sx * hullX(H, u0, sheer(H, u0)), sheer(H, u0) + 0.06, (u0 - 0.5) * L);
      const b = new V3(sx * hullX(H, u1, sheer(H, u1)), sheer(H, u1) + 0.06, (u1 - 0.5) * L);
      dark.push(span(a, b, 0.13, 0.13, 4));
    }
  }
  // raised quarterdeck / forecastle platforms on castled ships
  if (H.sternRise > 0.25) {
    const u1 = 0.26, y = deckY(H, 0.04);
    const x = hullX(H, 0.12, y) * 0.95;
    dark.push(place(new THREE.BoxGeometry(x * 2, 0.25, L * u1), [0, y - 0.12, -L / 2 + (L * u1) / 2]));
    // break-of-deck rail + stairs hint
    dark.push(place(new THREE.BoxGeometry(x * 2, 0.9, 0.18), [0, y + 0.35, -L / 2 + L * u1]));
  }
  // deck furniture: hatches, capstan, wheel
  const dY = deckY(H, 0.5);
  dark.push(place(new THREE.BoxGeometry(B * 0.28, 0.3, L * 0.08), [0, dY + 0.15, L * 0.08]));
  dark.push(place(new THREE.BoxGeometry(B * 0.22, 0.3, L * 0.06), [0, dY + 0.15, -L * 0.1]));
  dark.push(place(cyl(0.45, 0.35, 0.9, 10), [0, dY + 0.45, -L * 0.2]));
  const wheelY = deckY(H, 0.12) + 1.0;
  const wheel = new THREE.TorusGeometry(0.55, 0.05, 6, 16);
  dark.push(place(wheel, [0, wheelY, -L * 0.36]));
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; dark.push(place(cyl(0.03, 0.03, 1.3, 4), [0, wheelY, -L * 0.36], [0, 0, a])); }

  // stern gallery: windows + gilded frames + lanterns
  {
    const sy0 = Math.max(deckY(H, 0) - 0.4, 1.0), sy1 = sheer(H, 0) - 0.35;
    const wx = (B / 2) * planW(H, 0) * 0.8;
    const rows = H.sternRise > 0.5 ? 2 : 1;
    const nW = Math.max(3, Math.round(wx * 1.6));
    for (let r = 0; r < rows; r++) {
      const y = sy0 + ((sy1 - sy0) * (r + 0.5)) / rows;
      for (let i = 0; i < nW; i++) {
        const x = -wx + ((2 * wx) * (i + 0.5)) / nW;
        glass.push(place(new THREE.BoxGeometry((2 * wx) / nW * 0.62, 0.6, 0.08), [x, y, -L / 2 - 0.03]));
      }
      gold.push(place(new THREE.BoxGeometry(wx * 2.05, 0.12, 0.14), [0, y - 0.4, -L / 2 - 0.05]));
      gold.push(place(new THREE.BoxGeometry(wx * 2.05, 0.12, 0.14), [0, y + 0.4, -L / 2 - 0.05]));
    }
    if (rows > 1 || H.decks > 1) { // stern balcony
      dark.push(place(new THREE.BoxGeometry(wx * 2.1, 0.12, 1.0), [0, sy0 - 0.5, -L / 2 - 0.5]));
      for (let i = 0; i <= 8; i++) dark.push(place(cyl(0.04, 0.04, 0.8, 4), [-wx + (2 * wx * i) / 8, sy0 - 0.05, -L / 2 - 0.95]));
    }
    for (const sx of [-1, 0, 1]) {
      if (sx === 0 && L < 30) continue;
      const lx = sx * wx * 0.9, ly = sheer(H, 0) + 0.9 + (sx === 0 ? 0.6 : 0);
      iron.push(place(cyl(0.04, 0.04, 0.9, 4), [lx, ly - 0.6, -L / 2 - 0.2]));
      lamps.push(place(new THREE.CylinderGeometry(0.22, 0.16, 0.55, 6), [lx, ly, -L / 2 - 0.2]));
      gold.push(place(new THREE.ConeGeometry(0.26, 0.3, 6), [lx, ly + 0.42, -L / 2 - 0.2]));
    }
  }
  // gunports + cannons (match the real gun layout so muzzles line up)
  const guns = gunLayout(stats);
  const gs = Math.min(1.25, 0.6 + L / 70);
  for (const g of guns) {
    if (g.side === 'L' || g.side === 'R') {
      const sx = g.side === 'L' ? 1 : -1;
      ports.push(place(new THREE.BoxGeometry(0.12, 0.72 * gs, 0.8 * gs), [g.x + sx * 0.0, g.y, g.z]));
      // hinged port lid swung up, painted red inside
      const lid = new THREE.BoxGeometry(0.06, 0.62 * gs, 0.7 * gs); lid.translate(0, 0.31 * gs, 0);
      ports.push(place(lid, [g.x + sx * 0.04, g.y + 0.3 * gs, g.z], [0, 0, sx * -1.1]));
      const barrel = cyl(0.13 * gs, 0.09 * gs, 1.5 * gs, 8); barrel.rotateZ(sx * -Math.PI / 2);
      iron.push(place(barrel, [g.x + sx * 0.45 * gs, g.y - 0.02, g.z]));
      iron.push(place(new THREE.TorusGeometry(0.11 * gs, 0.035 * gs, 4, 8), [g.x + sx * 1.18 * gs, g.y - 0.02, g.z], [0, Math.PI / 2, 0]));
    } else {
      const fwd = g.side === 'bow' ? 1 : -1;
      const barrel = cyl(0.13 * gs, 0.09 * gs, 1.5 * gs, 8); barrel.rotateX(fwd * Math.PI / 2);
      iron.push(place(barrel, [g.x, g.y, g.z + fwd * 0.4]));
      dark.push(place(new THREE.BoxGeometry(0.6 * gs, 0.35 * gs, 1.0 * gs), [g.x, g.y - 0.3, g.z - fwd * 0.2]));
    }
  }
  // channels (chainwales) for the shrouds
  const mastU = H.rig === 'gaff' && H.masts === 1 ? [0.6] : H.masts === 2 ? (H.rig === 'brig' ? [0.38, 0.66] : [0.36, 0.66]) : [0.24, 0.5, 0.73];
  for (const u of mastU) for (const sx of [1, -1]) {
    const y = sheer(H, u) - 0.5, x = hullX(H, u, y);
    dark.push(place(new THREE.BoxGeometry(0.7, 0.14, Math.max(2.2, L * 0.07)), [sx * (x + 0.3), y, (u - 0.5) * L]));
  }

  // bowsprit + jibboom + figurehead + beakhead
  const stemY = sheer(H, 1) - 0.2, stemZ = L / 2;
  const bsA = new V3(0, stemY - 0.2, stemZ - L * 0.12), bsDir = new V3(0, Math.sin(0.32), Math.cos(0.32));
  const bsLen = L * (H.rig === 'gaff' ? 0.42 : 0.36);
  const bsTip = bsA.clone().addScaledVector(bsDir, bsLen);
  spar.push(span(bsA, bsTip, 0.28 * gs, 0.12 * gs, 8));
  gold.push(place(new THREE.SphereGeometry(0.42 * gs, 8, 6), [0, stemY - 0.6, stemZ + 0.25], null, [0.7, 1, 1.3]));
  if (H.decks > 1 || stats.tier === 'frigate') dark.push(place(new THREE.BoxGeometry(0.4, 0.4, 2.2), [0, stemY - 1.0, stemZ + 0.4], [0.3, 0, 0]));

  // masts, tops, yards, sails
  const sails = [];
  const sm = sailMat(new THREE.Color(look.sailColor || '#efe6cf'));
  const mastTops = [];
  const mastH = L * (H.rig === 'gaff' ? 1.05 : 0.95);
  const rigLines = [];
  const pushLine = (a, b) => { rigLines.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  mastU.forEach((u, mi) => {
    const isMain = mastU.length === 1 || (mastU.length === 2 ? mi === (H.rig === 'brig' ? 0 : 1) : mi === 1);
    const isMizzen = mastU.length === 3 && mi === 0;
    const h = mastH * (isMain ? 1 : isMizzen ? 0.74 : 0.88);
    const base = deckY(H, u), z = (u - 0.5) * L;
    const r0 = Math.max(0.22, B * 0.045);
    const foot = new V3(0, base, z), top = new V3(0, base + h, z);
    const lowerH = h * 0.55;
    spar.push(span(new V3(0, base - 0.4, z), new V3(0, base + lowerH, z), r0, r0 * 0.78, 10));
    spar.push(span(new V3(0, base + lowerH - 1.2, z), new V3(0, base + h * 0.85, z), r0 * 0.6, r0 * 0.42, 8));
    spar.push(span(new V3(0, base + h * 0.82, z), top, r0 * 0.36, r0 * 0.2, 6));
    // fighting top + crosstrees
    const square = H.rig === 'square' || H.rig === 'galleon' || (H.rig === 'brig' && mi === 1);
    if (square || h > 20) {
      dark.push(place(cyl(B * 0.16, B * 0.16, 0.25, 10), [0, base + lowerH, z]));
      dark.push(place(new THREE.BoxGeometry(B * 0.22, 0.12, 0.25), [0, base + h * 0.83, z]));
    }
    gold.push(place(new THREE.SphereGeometry(r0 * 0.4, 6, 4), [top.x, top.y + 0.1, top.z]));
    mastTops.push(top.clone());

    // shrouds + ratlines to the channels
    const chY = sheer(H, u) - 0.5, chX = hullX(H, u, chY) + 0.55;
    const nShroud = Math.max(3, Math.round(L / 10));
    for (const sx of [1, -1]) {
      const hook = new V3(0, base + lowerH, z);
      const ends = [];
      for (let s = 0; s < nShroud; s++) {
        const e = new V3(sx * chX, chY, z + (s - (nShroud - 1) / 2) * 0.7);
        pushLine(new V3(sx * r0, hook.y, z), e); ends.push(e);
      }
      // ratlines
      for (let k = 1; k < 9; k++) {
        const t = k / 10;
        for (let s = 0; s < ends.length - 1; s++) {
          const a = new V3().lerpVectors(ends[s], new V3(sx * r0, hook.y, z), t);
          const b = new V3().lerpVectors(ends[s + 1], new V3(sx * r0, hook.y, z), t);
          pushLine(a, b);
        }
      }
      // topmast shrouds to the top's rim
      pushLine(new V3(sx * B * 0.15, base + lowerH, z), new V3(sx * r0 * 0.5, base + h * 0.82, z));
    }
    // backstays
    for (const sx of [1, -1]) pushLine(new V3(0, base + h * 0.83, z), new V3(sx * (hullX(H, u - 0.08, chY) + 0.4), chY, z - L * 0.08));

    // --- sails
    if (square) {
      const levels = H.rig === 'galleon' ? [[0.08, 0.53], [0.56, 0.84]] : [[0.1, 0.53], [0.56, 0.8], [0.82, 0.96]];
      const wMax = B * (H.rig === 'galleon' ? 1.9 : 1.75) * (isMain ? 1 : 0.9);
      levels.forEach(([a, b2], li) => {
        const yTop = base + h * b2, yBot = base + h * a + 0.6;
        const wT = wMax * (1 - li * 0.24) * 0.92, wB = wMax * (1 - li * 0.24 + 0.1);
        // yards (top yard per sail; course also gets the lower yard)
        spar.push(span(new V3(-wT / 2 - 0.4, yTop, z + 0.4), new V3(wT / 2 + 0.4, yTop, z + 0.4), 0.16 * gs, 0.16 * gs, 6));
        if (li === 0) spar.push(span(new V3(-wB / 2 - 0.4, yBot, z + 0.4), new V3(wB / 2 + 0.4, yBot, z + 0.4), 0.18 * gs, 0.18 * gs, 6));
        const geo = squareSail(wT, wB, yTop - yBot, (yTop - yBot) * 0.22);
        const sail = new THREE.Mesh(geo, sm); sail.castShadow = true;
        sail.position.set(0, yTop - 0.15, z + 0.55);
        body.add(sail);
        sails.push({ mesh: sail, kind: 'square', h: yTop - yBot });
        // braces + lifts
        pushLine(new V3(wT / 2, yTop, z + 0.4), new V3(0, base + h * Math.min(1, b2 + 0.06), z));
        pushLine(new V3(-wT / 2, yTop, z + 0.4), new V3(0, base + h * Math.min(1, b2 + 0.06), z));
      });
      // furled sail rolls on yards (visible when sails are up)
    }
    // mizzen lateen (galleon) / spanker (square rig) / gaff (sloop, schooner, brig main)
    if (!square || isMizzen) {
      const gaffy = H.rig !== 'galleon' || !isMizzen;
      const boomL = Math.min(L * (mastU.length === 1 ? 0.62 : 0.4), (u + 0.02) * L);
      const lowY = base + 1.6, hiY = base + h * (square ? 0.5 : 0.68);
      if (gaffy) {
        const boomEnd = new V3(0, lowY + 0.4, z - boomL), gaffEnd = new V3(0, hiY + boomL * 0.45, z - boomL * 0.85);
        spar.push(span(new V3(0, lowY, z), boomEnd, 0.17 * gs, 0.12 * gs, 6));
        spar.push(span(new V3(0, hiY, z), gaffEnd, 0.15 * gs, 0.1 * gs, 6));
        const geo = patchSail([new V3(0, hiY, z - 0.3), gaffEnd, boomEnd, new V3(0, lowY + 0.2, z - 0.3)], boomL * 0.12);
        const sail = new THREE.Mesh(geo, sm); sail.castShadow = true; body.add(sail);
        sails.push({ mesh: sail, kind: 'fore-aft', pivot: z });
        pushLine(gaffEnd, new V3(0, base + h * 0.95, z));
        // gaff topsail on schooners/sloops
        if (!square) {
          const geo2 = patchSail([new V3(0, base + h * 0.95, z - 0.2), gaffEnd.clone(), new V3(0, hiY + 0.2, z - 0.2)], boomL * 0.06);
          const s2 = new THREE.Mesh(geo2, sm); body.add(s2); sails.push({ mesh: s2, kind: 'fore-aft', pivot: z });
        }
      } else {
        // lateen: long diagonal yard, triangular sail
        const yA = new V3(0, base + 1.4, z + h * 0.35), yB = new V3(0, base + h * 0.95, z - h * 0.42);
        spar.push(span(yA, yB, 0.15 * gs, 0.1 * gs, 6));
        const geo = patchSail([yA.clone(), yB.clone(), new V3(0, base + 1.6, z - h * 0.3)], h * 0.08);
        const sail = new THREE.Mesh(geo, sm); body.add(sail); sails.push({ mesh: sail, kind: 'fore-aft', pivot: z });
      }
    }
  });
  // forestays + jibs from the foremast to the bowsprit
  const fore = mastTops[mastTops.length - 1];
  const foreZ = fore.z;
  const nJib = H.rig === 'galleon' ? 1 : mastU.length >= 2 ? 3 : 2;
  for (let j = 0; j < nJib; j++) {
    const fy = deckY(H, 0.75);
    const head = new V3(0, fy + (fore.y - fy) * (mastU.length === 1 ? 0.78 : 0.42 + j * 0.13), foreZ + 0.3);
    const tack = bsA.clone().addScaledVector(bsDir, bsLen * (0.35 + j * 0.3));
    pushLine(head, tack);
    const clew = new V3(0, Math.max(fy + 1.6, tack.y - 1.5) + j * 0.4, foreZ + (tack.z - foreZ) * (0.42 + j * 0.12));
    const geo = patchSail([head.clone().add(new V3(0, -0.3, 0.2)), tack.clone().add(new V3(0, 0.15, 0)), clew], 0.9 + j * 0.2);
    const sail = new THREE.Mesh(geo, sm); body.add(sail); sails.push({ mesh: sail, kind: 'jib' });
  }
  if (H.rig === 'galleon') { // spritsail under the bowsprit
    const sy = bsA.clone().addScaledVector(bsDir, bsLen * 0.7);
    spar.push(span(new V3(-B * 0.45, sy.y - 0.3, sy.z), new V3(B * 0.45, sy.y - 0.3, sy.z), 0.12, 0.12, 6));
    const geo = squareSail(B * 0.88, B * 0.95, B * 0.45, 0.8);
    const s = new THREE.Mesh(geo, sm); s.position.set(0, sy.y - 0.35, sy.z + 0.3); body.add(s); sails.push({ mesh: s, kind: 'square', h: B * 0.45 });
  }
  // stays between masts
  for (let i = 0; i < mastTops.length - 1; i++) pushLine(mastTops[i].clone().add(new V3(0, -mastH * 0.15, 0)), new V3(0, deckY(H, mastU[i + 1]) + 0.5, mastTops[i + 1].z));
  pushLine(fore.clone(), bsTip.clone());
  // bobstay
  pushLine(bsTip, new V3(0, 0.4, L / 2 - 0.4));

  // flags: masthead pennant/ensign + stern ensign
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex(look.emblem ?? 0, look.flagBg || '#111', look.flagFg || '#eee'), side: THREE.DoubleSide, roughness: 0.9 });
  const fh = Math.max(1.3, L * 0.07);
  const flagGeo = new THREE.PlaneGeometry(fh * 1.6, fh, 10, 4); flagGeo.translate(-fh * 0.8, 0, 0); flagGeo.rotateY(Math.PI / 2);
  const flag = new THREE.Mesh(flagGeo, flagMat);
  const mainTop = mastTops.reduce((a, b) => (b.y > a.y ? b : a));
  flag.position.set(0, mainTop.y - fh * 0.6, mainTop.z);
  body.add(flag);
  const flag2 = new THREE.Mesh(flagGeo.clone(), flagMat);
  flag2.scale.setScalar(0.8);
  const ensY = sheer(H, 0) + 2.2;
  flag2.position.set(0, ensY, -L / 2 - 0.6);
  iron.push(place(cyl(0.05, 0.05, 2.8, 4), [0, ensY - 0.8, -L / 2 - 0.6]));
  body.add(flag2);
  const flagBase = flagGeo.attributes.position.array.slice();

  // assemble merged static meshes
  for (const [list, mat] of [[dark, m.darkwood], [spar, m.spar], [iron, m.iron], [gold, m.gold], [ports, m.port], [glass, m.glass], [lamps, m.lantern]]) {
    const mesh = merged(list, mat); if (mesh) body.add(mesh);
  }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rigLines, 3));
  const rig = new THREE.LineSegments(rg, m.rope); body.add(rig);

  // ---------------------------------------------------------------- animation API
  const api = {
    root, body, sails, flag, flag2, guns, H, sailMat: sm,
    sailLevel: 1, damage: 0,
    setSailLevel(l) { this.sailLevel = l; },
    setDamage(d) { sm.userData.damage.value = d; this.damage = d; },
    update(t, wind = 1) {
      const lvl = this.sailLevel;
      for (const s of sails) {
        if (s.kind === 'square') { s.mesh.scale.set(1, Math.max(0.04, lvl), 0.4 + 0.6 * lvl * wind + Math.sin(t * 1.7 + s.h) * 0.04); }
        else if (s.kind === 'jib') { s.mesh.scale.set(1, 1, 1); s.mesh.visible = lvl > 0.05; }
        else { s.mesh.visible = lvl > 0.05; s.mesh.scale.set(0.6 + 0.4 * lvl, 1, 1); }
      }
      // waving flag: travelling sine along the fly
      for (const f of [flag, flag2]) {
        const p = f.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const zf = flagBase[i * 3 + 2]; // fly distance (negative z after rotation)
          const k = Math.abs(zf) / (fh * 1.6);
          p.array[i * 3] = flagBase[i * 3] + Math.sin(t * 6 - zf * 2.2) * 0.22 * k * fh;
          p.array[i * 3 + 1] = flagBase[i * 3 + 1] - k * k * 0.15 * fh;
        }
        p.needsUpdate = true;
      }
    },
    dispose() {
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      hull.material.dispose(); sm.dispose(); flagMat.dispose();
    },
  };
  return api;
}
