// Procedural, period-styled sailing ships — every class has its own design, not a scaled copy:
//  Sloop: a plain little single-master — gaff main and one jib, flush open deck, tiller.
//  Schooner: narrow racer, clipper bow, two raked gaff masts with topsails, deckhouse.
//  Brigantine: square-rigged fore, gaff main, quarterdeck, figurehead.
//  Frigate: full-rigged three-master (four sail tiers), black "chequer" hull, flush deck, boats.
//  Galleon: towering painted stern castle + forecastle, beakhead, lateen mizzens, gilding.
//  Man of War: three gun decks bristling with cannon, triple stern galleries, studding sails,
//              iron-banded waterline, gilt lion figurehead, admiral's pennants. It looks unbeatable.
//  Leviathan: a five-decked ironclad ship of the line — sheer black walls bristling with cannon,
//             an armoured belt and iron ram, armoured fighting tops, pivot guns, a towering stern
//             with five tiers of galleries and four towering masts with five tiers of sail.
// Damage: charred hull, splintered shot-holes where balls struck, topmasts shot away, torn sails.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hullShape, planW, sheer, keelY, sectionW, hullX, deckY, gunLayout, deckGap, sternTaper } from '../layout.js';
import { tierById } from '../config.js';
import { planks, deck as deckTex, sailcloth, noiseTex, flagTex } from './textures.js';
import { buildFestive, festiveDecal, setFestiveGlow, isFestive, festiveTrim, dropFestiveTrim } from './festive.js';

const V3 = THREE.Vector3;
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ shared materials
let M = null;
/** Night makes lanterns, stern lights and glowing ports burn brighter (k 0..1). */
export function setShipGlow(k) { setFestiveGlow(k); const m = mats(); m.lantern.emissiveIntensity = 1.6 * (1 + k * 1.6); m.ghostLamp.emissiveIntensity = 2.2 * (1 + k); m.glass.emissive.setRGB(0.2 + k * 0.8, 0.13 + k * 0.45, k * 0.12); m.glass.emissiveIntensity = 0.4 + k * 1.4; } // cabin windows light up after dark
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
    plate: new THREE.MeshStandardMaterial({ color: 0x353940, roughness: 0.4, metalness: 0.75 }),
    armour: new THREE.MeshStandardMaterial({ color: 0x50555c, roughness: 0.55, metalness: 0.4 }),
    ember: new THREE.MeshStandardMaterial({ color: 0xff4020, emissive: 0xff2a00, emissiveIntensity: 2.4 }),
    ghostLamp: new THREE.MeshStandardMaterial({ color: 0x6affd0, emissive: 0x2affb0, emissiveIntensity: 2.2 }),
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
// Sails are batched: every sail hanging from the same spar group is one mesh. Per-vertex `aPivot` (where the sail
// hangs) and `aSail` (kind, height) let the vertex shader furl/fill each sail from the ship-wide uniforms, so a
// 30-sail Titan costs a handful of draw calls instead of thirty (and the shadow pass matches via the depth material).
const SAIL_VERT_PARS = `
uniform float uLvl; uniform float uWind; uniform float uSailT;
attribute vec3 aPivot; attribute vec2 aSail;
vec3 sailScale() {
  if (aSail.x < 0.5) return vec3(1.0, max(0.04, uLvl), 0.4 + 0.6 * uLvl * uWind + sin(uSailT * 1.7 + aSail.y) * 0.04);
  if (uLvl <= 0.05) return vec3(0.0);
  return aSail.x < 1.5 ? vec3(0.6 + 0.4 * uLvl, 1.0, 1.0) : vec3(1.0);
}`;
function sailVertex(sh, U) {
  Object.assign(sh.uniforms, { uLvl: U.lvl, uWind: U.wind, uSailT: U.t });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\n' + SAIL_VERT_PARS)
    .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ vec3 sc = sailScale(); objectNormal = normalize(objectNormal / max(sc, vec3(0.04))); }')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = aPivot + (position - aPivot) * sailScale();');
}
function sailMat(color, share = null, decal = null) {
  const m = new THREE.MeshStandardMaterial({ color, map: sailcloth(), roughness: 0.95, side: THREE.DoubleSide, emissive: color.clone().multiplyScalar(0.32), emissiveMap: sailcloth() });
  // `share`: furl together with another sail material (e.g. a junk's dark battens with its canvas)
  m.userData.damage = share ? share.userData.damage : { value: 0 };
  const U = m.userData.sail = share ? share.userData.sail : { lvl: { value: 1 }, wind: { value: 1 }, t: { value: 0 } };
  const nz = noiseTex();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDamage = m.userData.damage;
    sh.uniforms.uNoise = { value: nz };
    sailVertex(sh, U);
    if (decal) {
      sh.uniforms.uDecal = { value: decal };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSailUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSailUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDecal;\nvarying vec2 vSailUv;')
        .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 sDecal = texture2D(uDecal, vSailUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, sDecal.rgb, sDecal.a);')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = mix(totalEmissiveRadiance, sDecal.rgb * 0.45, sDecal.a);');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDamage;\nuniform sampler2D uNoise;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        { float n = texture2D(uNoise, vMapUv * 1.7).r * 0.7 + texture2D(uNoise, vMapUv * 4.3 + 0.3).r * 0.3;
          if (n < uDamage * 0.75 - 0.05) discard;
          float burn = smoothstep(uDamage * 0.75 - 0.05, uDamage * 0.75 + 0.03, n);
          diffuseColor.rgb *= mix(0.25, 1.0, burn); }`);
  };
  m.customProgramCacheKey = () => (decal ? 'sail-dmg-batch-decal' : 'sail-dmg-batch');
  // shadow pass: same furling, so a furled ship doesn't cast full-sail shadows
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  d.onBeforeCompile = (sh) => sailVertex(sh, U);
  d.customProgramCacheKey = () => 'sail-depth-batch';
  m.userData.depth = d;
  return m;
}
/** Merge the sails under each parent into one mesh carrying the per-vertex pivot/kind attributes. */
function batchSails(sails, smat) {
  const byParent = new Map();
  for (const sl of sails) { const par = sl.mesh.parent; if (!par) continue; const key = par.uuid + sl.mesh.material.uuid; if (!byParent.has(key)) byParent.set(key, []); byParent.get(key).push(sl); }
  const out = [];
  for (const list of byParent.values()) {
    const par = list[0].mesh.parent, mat = list[0].mesh.material;
    const geos = list.map((sl) => {
      const g = strip(sl.mesh.geometry.clone());
      const pv = sl.mesh.position, n = g.attributes.position.count;
      g.translate(pv.x, pv.y, pv.z);
      const piv = new Float32Array(n * 3), ks = new Float32Array(n * 2), kind = sl.kind === 'square' ? 0 : sl.kind === 'fore-aft' ? 1 : 2;
      for (let i = 0; i < n; i++) { piv[i * 3] = pv.x; piv[i * 3 + 1] = pv.y; piv[i * 3 + 2] = pv.z; ks[i * 2] = kind; ks[i * 2 + 1] = sl.h || 0; }
      g.setAttribute('aPivot', new THREE.Float32BufferAttribute(piv, 3));
      g.setAttribute('aSail', new THREE.Float32BufferAttribute(ks, 2));
      return g;
    });
    for (const sl of list) { par.remove(sl.mesh); sl.mesh.geometry.dispose(); }
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    geos.forEach((g) => g.dispose());
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = mat.userData.depth;
    par.add(mesh);
    out.push(mesh);
  }
  return out;
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
    if (paint.ironBand && y < wl + 0.25 + H.depth * (H.decks >= 5 ? 0.2 : 0.08)) return colors.iron;
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
        let x = (H.beam / 2) * planW(H, u) * sectionW(v, H) * sternTaper(H, u, y);
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
    const y = k + (s - k) * v, x = (H.beam / 2) * planW(H, 0) * sectionW(v, H) * sternTaper(H, 0, y), z = -H.len / 2 + overhang(H, 0, v);
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
  // irregular disc in the XY plane (facing +Z) with a ragged edge
  const N = 18;
  const blob = (r0, r1, z, stretch = 1.15) => { const pos = [0, 0, z], idx = []; for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2, rr = r0 + rnd() * (r1 - r0); pos.push(Math.cos(a) * rr * stretch, Math.sin(a) * rr, z); } for (let i = 0; i < N; i++) idx.push(0, 1 + i, 1 + ((i + 1) % N)); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; };
  parts.push(tint(blob(0.42, 0.85, 0), 0.06, 0.045, 0.032));         // soot scorch, very ragged
  parts.push(tint(blob(0.3, 0.48, 0.006), 0.11, 0.07, 0.04));        // charred, torn planking
  parts.push(tint(blob(0.16, 0.36, 0.012), 0.008, 0.006, 0.005));    // the hole itself
  // splinters: thin wedges of pale broken plank bent into the hole, along the grain
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.9, r0 = 0.4 + rnd() * 0.12, r1 = 0.14 + rnd() * 0.08, w = 0.035 + rnd() * 0.03;
    const ca = Math.cos(a), sa = Math.sin(a);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([ca * r0 * 1.15 - sa * w, sa * r0 + ca * w, 0.016, ca * r0 * 1.15 + sa * w, sa * r0 - ca * w, 0.016, ca * r1 * 1.15, sa * r1, 0.03], 3));
    g.setIndex([0, 1, 2]);
    parts.push(tint(g, 0.3 + rnd() * 0.1, 0.2, 0.11));
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
    case 'sloop': return { mastH: 1.05, bs: [0.3, 0.16], jibs: 1, masts: [{ u: 0.6, h: 1, gaff: true, main: true, boom: 0.56 }] };
    case 'schooner': return { mastH: 1.15, bs: [0.5, 0.14], jibs: 3, masts: [{ u: 0.3, h: 1, gaff: true, topsail: true, main: true, boom: 0.42 }, { u: 0.63, h: 0.92, gaff: true, topsail: true, boom: 0.3 }] };
    case 'brigantine': return { mastH: 0.98, bs: [0.4, 0.3], jibs: 3, masts: [{ u: 0.36, h: 1, gaff: true, sq: 2, sqStart: 1, main: true, boom: 0.4 }, { u: 0.68, h: 0.92, sq: 3 }] };
    case 'xebec': return { mastH: 0.98, bs: [0.34, 0.2], jibs: 1, masts: [{ u: 0.2, h: 0.72, lateen: true }, { u: 0.5, h: 1, lateen: true, main: true }, { u: 0.8, h: 0.86, lateen: true }] };
    case 'junk': return { mastH: 0.8, bs: [0.08, 0.12], jibs: 0, masts: [{ u: 0.19, h: 0.62, junk: true }, { u: 0.5, h: 1, junk: true, main: true }, { u: 0.8, h: 0.8, junk: true }] };
    case 'ghost': return { mastH: 0.96, bs: [0.36, 0.3], jibs: 2, masts: [{ u: 0.24, h: 0.78, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, main: true }, { u: 0.74, h: 0.88, sq: 3 }] };
    case 'frigate': return { mastH: 0.98, bs: [0.37, 0.32], jibs: 3, masts: [{ u: 0.24, h: 0.76, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, main: true }, { u: 0.73, h: 0.9, sq: 4 }] };
    case 'galleon': return { mastH: 0.8, bs: [0.38, 0.46], jibs: 1, sprit: true, masts: [{ u: 0.1, h: 0.5, lateen: true }, { u: 0.28, h: 0.66, lateen: true }, { u: 0.54, h: 1, sq: 3, main: true }, { u: 0.78, h: 0.84, sq: 2 }] };
    case 'manowar': return { mastH: 0.95, bs: [0.4, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.25, h: 0.8, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, stud: true, main: true }, { u: 0.74, h: 0.92, sq: 4, stud: true }] };
    case 'sovereign': return { mastH: 0.88, bs: [0.42, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.24, h: 0.8, sq: 4, spanker: true }, { u: 0.5, h: 1, sq: 5, stud: true, main: true }, { u: 0.75, h: 0.93, sq: 5, stud: true }] };
    case 'leviathan': return { mastH: 0.7, bs: [0.3, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.2, h: 0.84, sq: 5, spanker: true }, { u: 0.42, h: 1, sq: 5, stud: true, main: true }, { u: 0.61, h: 0.98, sq: 5, stud: true }, { u: 0.8, h: 0.9, sq: 5, stud: true }] };
    case 'titan': return { mastH: 0.6, bs: [0.28, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.16, h: 0.8, sq: 5, spanker: true }, { u: 0.33, h: 0.95, sq: 5, stud: true }, { u: 0.5, h: 1, sq: 5, stud: true, main: true }, { u: 0.66, h: 0.96, sq: 5, stud: true }, { u: 0.82, h: 0.86, sq: 5, stud: true }] };
    case 'harvest': return { mastH: 0.9, bs: [0.4, 0.3], jibs: 3, sprit: true, masts: [{ u: 0.23, h: 0.8, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, stud: true, main: true }, { u: 0.75, h: 0.9, sq: 4 }] };
    case 'yule': return { mastH: 0.95, bs: [0.4, 0.3], jibs: 3, masts: [{ u: 0.24, h: 0.8, sq: 3, spanker: true }, { u: 0.5, h: 1, sq: 4, main: true }, { u: 0.74, h: 0.9, sq: 4 }] };
    case 'midnight': return { mastH: 0.93, bs: [0.42, 0.3], jibs: 4, sprit: true, masts: [{ u: 0.25, h: 0.82, sq: 4 }, { u: 0.5, h: 1, sq: 4, stud: true, main: true }, { u: 0.74, h: 0.92, sq: 4, stud: true }] };
    case 'collector': return { mastH: 0.78, bs: [0.34, 0.26], jibs: 2, masts: [{ u: 0.17, h: 0.86, sq: 3, spanker: true }, { u: 0.86, h: 1, sq: 3, main: true }] };
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
  const titan = id === 'titan', lev = id === 'leviathan' || titan, sov = id === 'sovereign';
  const ghost = id === 'ghost', junk = id === 'junk', xebec = id === 'xebec';
  const festive = isFestive(id), yule = id === 'yule', grand = festive && id !== 'collector';
  const big = id === 'manowar' || sov || lev || grand, war = id === 'frigate' || ghost || big;

  const TL = tierById(id).look || {};
  const generic = !look.hullColor || (look.hullColor === '#5a3a22' && (!look.trimColor || look.trimColor === '#c9a227'));
  const hullCol = new THREE.Color(generic ? TL.hullColor || '#5a3a22' : look.hullColor);
  const trim = new THREE.Color(generic ? TL.trimColor || '#c9a227' : look.trimColor);
  if (generic && TL.sailColor && (!look.sailColor || look.sailColor === '#efe6cf')) look = { ...look, sailColor: TL.sailColor };
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.45, metalness: 0.5 });
  const colors = {
    bottom: ghost ? new THREE.Color(0x2b3a33) : junk ? new THREE.Color(0x3a2a20) : H.decks > 1 || war ? new THREE.Color(0xb8743f) : new THREE.Color(0x8a8270),
    boot: new THREE.Color(0x1a1410), wale: new THREE.Color(0x15110d), iron: new THREE.Color(0x2c2f33),
    band: trim, rail: hullCol.clone().multiplyScalar(0.7), hull: hullCol, stern: hullCol.clone().multiplyScalar(0.85),
    castle: new THREE.Color(0x7a1d18),
  };
  const paint = {
    band: lev ? 0.5 : war ? 0.42 : 0.34, wales: big || id === 'galleon', castle: id === 'galleon', stripe: id === 'schooner' || id === 'sloop' || xebec, ironBand: big,
  };
  const hull = new THREE.Mesh(hullGeometry(H, colors, paint), hullMat());
  hull.castShadow = true; hull.receiveShadow = true;
  if (ghost) { hull.material.emissive.set(0x0c3a2c); trimMat.emissive.set(0x1aff9c); trimMat.emissiveIntensity = 0.9; }
  if (festive) festiveTrim(id, trimMat); // festival + collector trim glows after dark
  body.add(hull);
  const deckMesh = new THREE.Mesh(deckGeometry(H), m.deck); deckMesh.receiveShadow = true; body.add(deckMesh);

  const dark = [], spar = [], iron = [], gold = [], ports = [], glass = [], lamps = [], red = [], white = [], trimL = [], marble = [], plate = [], ember = [], armour = [];
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
  // stepped stern castle for the galleon: tiers are as wide as the hull at the transom (so nothing
  // overhangs the stern) and step inward/upward like a real sterncastle
  const CAST = id === 'galleon' ? [0.3, 0.215, 0.135].map((u1, t) => {
    const y0 = deckY(H, u1) + t * 2.2, y1 = y0 + 2.2;
    const w = Math.min(hullX(H, 0.004, Math.min(y1, sheer(H, 0) - 0.05)), hullX(H, u1, deckY(H, u1))) * (0.97 - t * 0.07);
    return { u1, y0, y1, w };
  }) : [];
  const castleTop = (u) => { let y = deckY(H, u); for (const c of CAST) if (u <= c.u1) y = c.y1; return y; };
  if (id === 'sloop') {
    // plain open deck: a hatch, a couple of casks, a low stern rail and the tiller
    dark.push(box(B * 0.3, 0.28, L * 0.1, [0, dY + 0.14, zU(0.42)]));
    for (let i = 0; i < 2; i++) dark.push(place(cyl(0.3, 0.3, 0.7, 10), [B * 0.2, dY + 0.35, zU(0.3 + i * 0.06)]));
    dark.push(box(0.12, 0.12, 1.9, [0, deckY(H, 0.05) + 0.6, zU(0.07)], [0.2, 0, 0]));
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
  } else if (xebec) {
    // low quarterdeck with a striped awning on posts, oar ports along the waist, a beak under the bowsprit
    const qy = deckY(H, 0.1), x = hullX(H, 0.14, qy) * 0.95;
    dark.push(box(x * 2, 0.25, L * 0.2, [0, qy + 0.3, -L / 2 + L * 0.12]));
    for (const sx of [-1, 1]) for (const u of [0.04, 0.12, 0.2]) dark.push(box(0.12, 2.2, 0.12, [sx * x * 0.9, qy + 1.5, zU(u)]));
    for (let i = 0; i < 5; i++) (i % 2 ? red : white).push(box(x * 1.95, 0.08, L * 0.04, [0, qy + 2.62 + Math.sin(i) * 0.02, zU(0.04 + i * 0.04)], [0.06, 0, 0]));
    for (let i = 0; i < 12; i++) for (const sx of [-1, 1]) { const u = 0.25 + i * 0.045, y = sheer(H, u) - 0.75; ports.push(box(0.1, 0.22, 0.3, [sx * (hullX(H, u, y) + 0.04), y, zU(u)])); }
    dark.push(box(B * 0.22, 0.3, L * 0.07, [0, dY + 0.15, zU(0.6)]));
  } else if (junk) {
    // towering stern house with a pavilion, upturned eaves and lanterns; a raised foredeck
    const py = deckY(H, 0.1), pw = hullX(H, 0.13, py) * 0.96, pL = L * 0.24;
    red.push(box(pw * 2, 2.5, pL, [0, py + 1.25, zU(0.12)]));
    dark.push(box(pw * 2 + 0.4, 0.26, pL + 0.4, [0, py + 2.55, zU(0.12)]));
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 11; i++) gold.push(box(0.1, 0.8, 0.1, [sx * pw, py + 3.05, zU(0.005 + i * 0.023)]));
      gold.push(box(0.12, 0.12, pL, [sx * pw, py + 3.45, zU(0.12)]));
      for (let i = 0; i < 3; i++) glass.push(box(0.08, 0.8, 1.0, [sx * (pw + 0.02), py + 1.3, zU(0.05 + i * 0.07)]));
    }
    red.push(box(pw * 1.2, 1.7, pL * 0.42, [0, py + 3.5, zU(0.075)]));
    dark.push(box(pw * 1.55, 0.28, pL * 0.6, [0, py + 4.45, zU(0.075)]));
    dark.push(box(pw * 1.1, 0.22, pL * 0.45, [0, py + 4.7, zU(0.075)]));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) gold.push(place(new THREE.ConeGeometry(0.18, 0.9, 5), [sx * pw * 0.78, py + 4.75, zU(0.075) + sz * pL * 0.3], [0, 0, -sx * 0.9]));
    for (const sx of [-1, 1]) { iron.push(place(cyl(0.04, 0.04, 1.2, 4), [sx * pw * 0.8, py + 3.9, zU(0.2)])); lamps.push(place(new THREE.SphereGeometry(0.42, 10, 8), [sx * pw * 0.8, py + 4.6, zU(0.2)], null, [1, 1.25, 1])); red.push(place(new THREE.SphereGeometry(0.46, 10, 8), [sx * pw * 0.8, py + 4.6, zU(0.2)], null, [1, 1.15, 1])); }
    const fy = deckY(H, 0.9), fw = hullX(H, 0.88, fy) * 0.95;
    dark.push(box(fw * 2, 0.9, L * 0.12, [0, fy + 0.45, zU(0.93)]));
    for (let i = 0; i < 8; i++) gold.push(box(0.1, 0.7, 0.1, [-fw + (2 * fw * i) / 7, fy + 1.25, zU(0.875)]));
    // the painted eyes that let a junk see its way
    for (const sx of [-1, 1]) {
      const ey = sheer(H, 0.93) - 0.9, ex = sx * (hullX(H, 0.93, ey) + 0.06), rot = [0, sx * Math.PI / 2 + sx * 0.35, 0];
      white.push(place(new THREE.CircleGeometry(1.05, 20), [ex, ey, zU(0.93)], rot));
      ports.push(place(new THREE.CircleGeometry(0.5, 16), [ex + sx * 0.03, ey, zU(0.93) + 0.04], rot));
    }
    // great rudder hung below the transom
    dark.push(box(0.5, H.depth * 1.1, L * 0.07, [0, keelY(H, 0.02) * 0.4 + 0.6, -L / 2 - L * 0.02]));
    for (let i = 0; i < 3; i++) dark.push(box(B * 0.24, 0.32, L * 0.06, [0, dY + 0.16, zU(0.36 + i * 0.12)]));
  } else if (war && !lev) {
    // flush spar deck: hatch gratings, boats on skid beams, quarterdeck carronades
    if (!big) for (const u of [0.38, 0.6]) dark.push(box(B * 0.3, 0.35, L * 0.06, [0, dY + 0.17, zU(u)]));
    const boats = big ? 0 : 2;
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
    if (big && !lev && id !== 'midnight') { // a fourth deck aft: the poop, plus gilt carving along the sheer
      dark.push(box(x * 1.7, 2.2, L * 0.12, [0, qy + 1.1, -L / 2 + L * 0.07]));
      for (let i = 0; i < 6; i++) glass.push(box(0.08, 0.7, 0.9, [x * 0.86, qy + 1.2, -L / 2 + L * (0.03 + i * 0.018)])), glass.push(box(0.08, 0.7, 0.9, [-x * 0.86, qy + 1.2, -L / 2 + L * (0.03 + i * 0.018)]));
      for (let i = 0; i < 40; i++) { const u = 0.04 + i * 0.024; for (const sx of [-1, 1]) gold.push(box(0.1, 0.18, L * 0.012, [sx * (hullX(H, u, sheer(H, u) - 0.4) + 0.02), sheer(H, u) - 0.4, zU(u)])); }
    }
  } else if (id === 'galleon') {
    for (const [t, c] of CAST.entries()) {
      const zA = -L / 2 + 0.06, zB = zU(c.u1), cz = (zA + zB) / 2, ll = zB - zA;
      red.push(box(c.w * 2, c.y1 - c.y0, ll, [0, (c.y0 + c.y1) / 2, cz]));
      dark.push(box(c.w * 2 + 0.25, 0.22, ll + 0.25, [0, c.y1 + 0.05, cz]));
      dark.push(box(c.w * 2 + 0.25, 0.22, 0.25, [0, c.y0 + 0.05, zB]));
      for (const sx of [-1, 1]) {
        const nW = Math.max(1, Math.round(ll / 3.2));
        for (let i = 0; i < nW; i++) { const z = zA + (ll * (i + 0.5)) / nW; glass.push(box(0.08, 0.85, 0.9, [sx * (c.w + 0.02), (c.y0 + c.y1) / 2, z])); gold.push(box(0.1, 1.15, 0.12, [sx * (c.w + 0.03), (c.y0 + c.y1) / 2, z + 0.58])); }
        gold.push(box(0.12, 0.14, ll, [sx * (c.w + 0.04), c.y1 - 0.08, cz]));
      }
      // rail round the top of each tier + windows on its forward face
      for (let i = 0; i < 9; i++) dark.push(box(0.1, 0.75, 0.1, [-c.w + (2 * c.w * i) / 8, c.y1 + 0.5, zB]));
      dark.push(box(c.w * 2, 0.1, 0.1, [0, c.y1 + 0.88, zB]));
      for (let i = 0; i < 2; i++) glass.push(box(0.8, 0.8, 0.08, [(i ? 1 : -1) * c.w * 0.5, (c.y0 + c.y1) / 2, zB + 0.03]));
      red.push(box(0.9, 1.6, 0.08, [0, c.y0 + 0.8, zB + 0.04]));
      // stern face of the tier: windows + gilt frame
      for (let i = 0; i < 3; i++) glass.push(box(c.w * 0.38, 0.85, 0.08, [-c.w * 0.62 + i * c.w * 0.62, (c.y0 + c.y1) / 2, zA - 0.04]));
      gold.push(box(c.w * 2.04, 0.14, 0.12, [0, c.y1 - 0.08, zA - 0.05]));
      if (t === CAST.length - 1) for (const sx of [-1, 1]) gold.push(place(new THREE.ConeGeometry(0.6, 1.4, 8), [sx * c.w * 0.9, c.y1 + 0.75, zA + 0.6]));
    }
    // forecastle: raised deck over the bow with a rail and the belfry
    const fu = 0.86, fy = deckY(H, fu) + 2.0, fw = hullX(H, 0.82, fy - 1) * 0.96, fL = L * 0.16;
    red.push(box(fw * 2, 2.0, fL, [0, fy - 1.0, zU(fu)]));
    dark.push(box(fw * 2 + 0.2, 0.22, fL + 0.2, [0, fy + 0.05, zU(fu)]));
    for (const sx of [-1, 1]) { gold.push(box(0.12, 0.14, fL, [sx * (fw + 0.04), fy - 0.1, zU(fu)])); for (let i = 0; i < 3; i++) glass.push(box(0.08, 0.6, 0.6, [sx * (fw + 0.02), fy - 1.0, zU(fu - 0.05 + i * 0.05)])); }
    for (let i = 0; i < 8; i++) dark.push(box(0.1, 0.75, 0.1, [-fw + (2 * fw * i) / 7, fy + 0.5, zU(fu) - fL / 2]));
    dark.push(box(fw * 2, 0.1, 0.1, [0, fy + 0.88, zU(fu) - fL / 2]));
  } else if (lev) buildLeviathan();
  deckWorks();
  // ship's wheel (not on the sloop: it steers with a tiller)
  if (id !== 'sloop' && !lev) {
    const wu = id === 'galleon' ? 0.2 : 0.12;
    const wheelY = (id === 'galleon' ? castleTop(wu) : deckY(H, wu)) + (big ? 3.2 : 1.0);
    dark.push(place(new THREE.TorusGeometry(0.55, 0.05, 6, 16), [0, wheelY, zU(wu)]));
    for (let i = 0; i < 8; i++) dark.push(place(cyl(0.03, 0.03, 1.3, 4), [0, wheelY, zU(wu)], [0, 0, (i / 8) * Math.PI * 2]));
  }
  dark.push(place(cyl(0.45, 0.35, 0.9, 10), [0, dY + 0.45, zU(0.3)])); // capstan

  // ---------------------------------------------------------------- stern
  {
    const sy1 = sheer(H, 0) - 0.35, sy0 = Math.max(1.0, Math.min(deckY(H, 0) - 0.4, sy1 * (D.stern === 'counter' ? 0.75 : 0.42)));
    const zS = -L / 2 + overhang(H, 0, 0.8);
    const wx = (B / 2) * planW(H, 0) * 0.8;
    const rows = D.stern === 'citadel' ? 0 : D.stern === 'crown' ? 4 : D.stern === 'galleries5' ? 5 : D.stern === 'galleries3' ? 3 : D.stern === 'castle' ? 3 : D.stern === 'gallery' ? 2 : 1;
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
    if (rows > 1 && D.stern !== 'castle') for (const sx of [-1, 1]) {
      const qx = hullX(H, 0.06, (sy0 + sy1) / 2) + 0.3;
      dark.push(box(0.9, (sy1 - sy0) * 0.9, L * 0.06, [sx * qx, (sy0 + sy1) / 2, zU(0.05)]));
      for (let r = 0; r < rows; r++) glass.push(box(0.1, 0.6, L * 0.04, [sx * (qx + 0.46), sy0 + ((sy1 - sy0) * (r + 0.5)) / rows, zU(0.05)]));
      gold.push(place(new THREE.ConeGeometry(0.8, 1.6, 8), [sx * qx, sy1 + 0.6, zU(0.05)]));
    }
    // stern lanterns
    const nl = lev ? [] : id === 'midnight' ? [-1, 1] : big ? [-1, 0, 1] : L < 30 ? [0] : [-1, 1];
    for (const sx of nl) {
      const lx = sx * wx * 0.9, ly = (D.stern === 'castle' ? castleTop(0.02) : sheer(H, 0)) + 0.9 + (sx === 0 ? 0.6 : 0);
      const ls = big ? 1.8 : 1;
      iron.push(place(cyl(0.04, 0.04, 0.9 * ls, 4), [lx, ly - 0.6 * ls, zS - 0.2]));
      lamps.push(place(new THREE.CylinderGeometry(0.22 * ls, 0.16 * ls, 0.55 * ls, 6), [lx, ly, zS - 0.2]));
      gold.push(place(new THREE.ConeGeometry(0.26 * ls, 0.3 * ls, 6), [lx, ly + 0.42 * ls, zS - 0.2]));
    }
    if (D.stern === 'counter') white.push(box(wx * 1.6, 0.1, 0.08, [0, sy1 - 0.05, zS - 0.02]));
    if (id === 'sloop') { gold.push(box(wx * 1.9, 0.5, 0.1, [0, sy1 + 0.05, zS - 0.04])); }
    if (D.stern === 'crown') crownStern(sy0, sy1, zS, wx);
    if (D.stern === 'citadel') citadelStern(sy0, sy1, zS, wx);
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
    const per = titan ? 32 : lev ? 26 : sov ? 20 : big ? 15 : id === 'galleon' ? 9 : id === 'frigate' || ghost ? 12 : id === 'midnight' ? 20 : id === 'yule' ? 19 : id === 'harvest' ? 19 : id === 'collector' ? 15 : junk ? 8 : xebec ? 5 : id === 'brigantine' ? 7 : id === 'schooner' ? 4 : 0;
    for (let d = 0; d < decks; d++) {
      const y = Math.max(0.6, deckY(H, 0.5) - d * deckGap(H) + 0.55);
      const u0 = (lev ? 0.1 : 0.17) + d * 0.025, u1 = (lev ? 0.88 : 0.8) - d * 0.03;
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
    const fs = lev ? 3.2 : sov ? 2.8 : big ? 2.2 : 1;
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
  let battenMat = null;
  const smat = sailMat(new THREE.Color(look.sailColor || (big ? '#f3efe2' : '#efe6cf')), null, festiveDecal(id));
  // ghost canvas: see-through, glowing, and permanently in tatters
  if (ghost) { smat.transparent = true; smat.opacity = 0.72; smat.depthWrite = false; smat.emissive.set(0x2affb4).multiplyScalar(0.5); smat.userData.tatter = 0.34; }
  const mastTops = [];
  const mastH = L * plan.mastH;
  const rigLines = [];
  const pushLine = (a, b) => { rigLines.push(a.x, a.y, a.z, b.x, b.y, b.z); };
  const mastGroups = [], mastInfo = [];
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex(look.emblem ?? 0, look.flagBg || '#111', look.flagFg || '#eee'), side: THREE.DoubleSide, roughness: 0.9 });
  const fh = Math.max(1.3, L * 0.07);
  const flagGeo = new THREE.PlaneGeometry(fh * 1.6, fh, 10, 4); flagGeo.translate(-fh * 0.8, 0, 0); flagGeo.rotateY(Math.PI / 2);
  const flags = [];
  const pennantGeo = new THREE.PlaneGeometry(fh * 4, fh * 0.35, 16, 1); pennantGeo.translate(-fh * 2, 0, 0); pennantGeo.rotateY(Math.PI / 2);
  const pennantMat = new THREE.MeshStandardMaterial({ color: look.flagBg ? new THREE.Color(look.flagBg) : 0xb01818, side: THREE.DoubleSide, roughness: 0.9 });
  plan.masts.forEach((mm, mi) => {
    const h = mastH * mm.h;
    const base = id === 'galleon' ? castleTop(mm.u) : deckY(H, mm.u), z = zU(mm.u);
    const r0 = Math.max(0.22, B * (big ? 0.05 : 0.045));
    const lowerH = h * 0.52;
    const rake = D.rake;
    const at = (y) => new V3(0, base + y, z - y * rake); // raked mast line
    const top = at(h);
    const upper = new THREE.Group(); body.add(upper);
    const upperSpar = [], upLines = [], upperSnow = [];
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
      const tiers = mm.sq === 5 ? [[0.08, 0.4], [0.42, 0.6], [0.62, 0.76], [0.78, 0.88], [0.895, 0.975]] : [[0.1, 0.5], [0.53, 0.75], [0.77, 0.89], [0.9, 0.985]];
      const shrink = mm.sq === 5 ? 0.15 : 0.2;
      const wMax = B * (lev ? 1.3 : big ? 1.95 : id === 'galleon' ? 1.85 : id === 'sloop' ? 1.5 : 1.75) * (mm.main ? 1 : 0.9);
      const start = mm.sqStart || 0;
      for (let li = start; li < start + mm.sq && li < tiers.length; li++) {
        const [a, b2] = tiers[li];
        const yTop = h * b2, yBot = h * a + 0.6;
        const wT = wMax * (1 - li * shrink) * 0.92, wB = wMax * (1 - li * shrink + 0.1);
        const tgt = li === 0 ? spar : upperSpar;
        const pT = at(yTop), pB = at(yBot);
        tgt.push(span(new V3(-wT / 2 - 0.4, pT.y, pT.z + 0.4), new V3(wT / 2 + 0.4, pT.y, pT.z + 0.4), 0.16 * gs, 0.16 * gs, 6));
        if (li === start) tgt.push(span(new V3(-wB / 2 - 0.4, pB.y, pB.z + 0.4), new V3(wB / 2 + 0.4, pB.y, pB.z + 0.4), 0.18 * gs, 0.18 * gs, 6));
        if (yule) (li === 0 ? white : upperSnow).push(place(new THREE.CylinderGeometry(0.3 * gs, 0.3 * gs, wT + 0.6, 8, 1, false, 0, Math.PI), [0, pT.y + 0.12, pT.z + 0.4], [0, 0, Math.PI / 2]));
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
    if (mm.junk) {
      // (battenMat is shared by every junk mast; created on first use)
      // battened lug sail: luff a little ahead of the mast, a fan-shaped leech well aft, bamboo battens across
      const y0 = base + 1.9, y1 = base + h * 0.97, hh = y1 - y0, fw = h * 0.12, aw = h * 0.36;
      const fb = new V3(0, y0, z + fw), ab = new V3(0, y0 + hh * 0.06, z - aw), ft = new V3(0, y1 - hh * 0.1, z + fw * 0.5), atp = new V3(0, y1 + hh * 0.02, z - aw * 1.55);
      const sail = new THREE.Mesh(patchSail([ft.clone(), atp.clone(), ab.clone(), fb.clone()], hh * 0.04), smat); body.add(sail); sails.push({ mesh: sail, kind: 'fore-aft' });
      spar.push(span(ft, atp, 0.14 * gs, 0.1 * gs, 6)); spar.push(span(fb, ab, 0.14 * gs, 0.1 * gs, 6));
      const nb = Math.max(4, Math.round(hh / 2.6));
      for (let k = 1; k < nb; k++) {
        const t = k / nb, a = new V3().lerpVectors(fb, ft, t), b2 = new V3().lerpVectors(ab, atp, t);
        // the batten follows the sail's belly (patchSail bulges along +x by sin(pi u) sin(pi v))
        battenMat ||= sailMat(new THREE.Color('#2a1a10'), smat);
        const segs = [], NB = 6, pt = (u) => new V3(Math.sin(Math.PI * u) * Math.sin(Math.PI * t) * hh * 0.04, a.y + (b2.y - a.y) * u, a.z + (b2.z - a.z) * u);
        for (let q = 0; q < NB; q++) segs.push(span(pt(q / NB), pt((q + 1) / NB), 0.13, 0.13, 5));
        const bt = new THREE.Mesh(mergeGeometries(segs.map(strip)), battenMat); body.add(bt); sails.push({ mesh: bt, kind: 'fore-aft' });
        pushLine(b2, new V3(0, deckY(H, Math.max(0.02, mm.u - 0.12)) + 0.9, z - aw * 1.35));
      }
    }
    // flags: the main masthead flies the captain's colours; a Man of War flies pennants from every mast
    if (mm.main || big) {
      const f = new THREE.Mesh(mm.main ? flagGeo : pennantGeo.clone(), mm.main ? flagMat : pennantMat);
      f.position.set(0, top.y - (mm.main ? fh * 0.6 : 0.3), top.z);
      upper.add(f); flags.push({ mesh: f, base: f.geometry.attributes.position.array.slice(), len: mm.main ? fh * 1.6 : fh * 4 });
    }
    upper.add(merged(upperSpar, m.spar));
    if (upperSnow.length) upper.add(merged(upperSnow, m.white));
    mastInfo.push({ z, base, h, top: top.clone(), upper, main: !!mm.main });
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
  // festival + collector ships: their decorations, displays and moving parts
  const fest = festive ? buildFestive(id, { H, L, B, body, zU, gs, goldMat: m.gold, lists: { gold, white, red, lamps, dark, iron, glass, ember, spar }, mastInfo, bsTip, stemY, stemZ }) : null;

  // stern ensign
  const flag2 = new THREE.Mesh(flagGeo.clone(), flagMat);
  flag2.scale.setScalar(lev ? 0.9 : big ? 1.3 : 0.8);
  const ensY = (D.stern === 'castle' ? castleTop(0.02) : sheer(H, 0)) + 2.2;
  flag2.position.set(0, ensY, -L / 2 - 0.6);
  const ensX = id === 'midnight' ? B * 0.3 : 0; // Midnight's New Year sign takes the middle of the taffrail
  flag2.position.x = ensX;
  iron.push(place(cyl(0.05, 0.05, 2.8, 4), [ensX, ensY - 0.8, -L / 2 - 0.6]));
  body.add(flag2);
  flags.push({ mesh: flag2, base: flag2.geometry.attributes.position.array.slice(), len: fh * 1.6 });


  // ---------------------------------------------------------------- Sovereign: the crowned stern
  function crownStern(sy0, sy1, zS, wx) {
    // gilt pilasters between the gallery windows, a carved royal crest and a great crown on the taffrail
    for (const sx of [-1, 1]) gold.push(box(0.4, sy1 - sy0, 0.3, [sx * wx * 1.02, (sy0 + sy1) / 2, zS - 0.1]));
    const cy = sy1 + 1.6, cr = wx * 0.42;
    gold.push(place(cyl(cr * 0.5, cr * 0.5, 0.5, 20), [0, cy + 0.6, zS - 0.15], [Math.PI / 2, 0, 0]));   // crest medallion
    red.push(place(cyl(cr * 0.38, cr * 0.38, 0.6, 20), [0, cy + 0.6, zS - 0.2], [Math.PI / 2, 0, 0]));
    gold.push(box(cr * 0.9, cr * 0.14, 0.3, [0, cy + 0.6, zS - 0.5]));
    gold.push(box(cr * 0.14, cr * 0.6, 0.3, [0, cy + 0.6, zS - 0.5]));
    // the crown: a band with five spiked points and pearls
    const by = cy + cr * 0.6 + 0.4;
    gold.push(box(cr * 0.9, 0.5, 0.5, [0, by, zS - 0.2]));
    for (let i = 0; i < 5; i++) { const x = (-2 + i) * cr * 0.21; gold.push(place(new THREE.ConeGeometry(0.28, 1.2 + (i === 2 ? 0.6 : 0), 6), [x, by + 0.8 + (i === 2 ? 0.3 : 0), zS - 0.2])); gold.push(place(new THREE.SphereGeometry(0.18, 6, 4), [x, by + 1.5 + (i === 2 ? 0.6 : 0), zS - 0.2])); }
    red.push(box(cr * 0.88, 0.28, 0.55, [0, by - 0.05, zS - 0.22]));
    // gilt lions rampant either side of the crest
    for (const sx of [-1, 1]) {
      gold.push(place(new THREE.SphereGeometry(0.9, 8, 6), [sx * cr * 1.0, cy + 0.2, zS - 0.3], null, [0.8, 1.3, 0.7]));
      gold.push(place(new THREE.SphereGeometry(0.55, 8, 6), [sx * cr * 0.95, cy + 1.6, zS - 0.4]));
      gold.push(place(new THREE.ConeGeometry(0.5, 1.6, 6), [sx * wx * 0.98, sy1 + 0.6, zS + 0.3]));
    }
    // three tall poop lanterns
    for (const sx of [-1, 0, 1]) { const lx = sx * wx * 0.75, ly = sy1 + (sx ? 3 : 4.6); iron.push(place(cyl(0.07, 0.07, 2.4, 4), [lx, ly - 1.6, zS + 0.6])); lamps.push(place(new THREE.CylinderGeometry(0.55, 0.4, 1.3, 6), [lx, ly, zS + 0.6])); gold.push(place(new THREE.ConeGeometry(0.6, 0.8, 6), [lx, ly + 1.05, zS + 0.6])); }
    // gilt scrollwork along the whole sheer
    for (let i = 0; i < 48; i++) { const u = 0.03 + i * 0.02; for (const sx of [-1, 1]) gold.push(box(0.12, 0.3, L * 0.01, [sx * (hullX(H, u, sheer(H, u) - 0.5) + 0.03), sheer(H, u) - 0.5, zU(u)])); }
  }

  // ---------------------------------------------------------------- Leviathan/Titan: the armoured citadel stern
  function citadelStern(sy0, sy1, zS, wx) {
    // An armoured ship-of-the-line stern: an iron belt with chase guns below, then tiers of lit galleries that step
    // out over the water, quarter galleries tapering to gilt pendants, and a gilt skull crest between great lanterns.
    const yb = 0.5, yt = sy1, H0 = yt - yb;
    const yA = yb + H0 * 0.42;                          // top of the armour belt
    const halfW = (y) => Math.max(1, hullX(H, 0.004, Math.min(y, yt - 0.05)) * 0.98);
    // --- armour belt: two courses of big riveted plates with gilt seams
    for (let r = 0; r < 2; r++) {
      const y0 = yb + ((yA - yb) * r) / 2, y1 = yb + ((yA - yb) * (r + 1)) / 2, ym = (y0 + y1) / 2, w = halfW(ym), cols = 5;
      for (let c = 0; c < cols; c++) { const x = -w + (2 * w * (c + 0.5)) / cols; plate.push(box((2 * w) / cols - 0.25, y1 - y0 - 0.25, 0.35, [x, ym, zS - 0.15])); }
      gold.push(box(w * 2 + 0.3, 0.16, 0.42, [0, y1, zS - 0.18]));
    }
    // chase guns run out through the belt
    for (let r = 0; r < 2; r++) {
      const y = yb + ((yA - yb) * (r + 0.5)) / 2, w = halfW(y), n = r ? 4 : 5;
      for (let i = 0; i < n; i++) {
        const x = -w * 0.78 + (w * 1.56 * (i + 0.5)) / n;
        ports.push(box(1.05 * gs, 0.9 * gs, 0.4, [x, y, zS - 0.35]));
        gold.push(box(1.35 * gs, 1.2 * gs, 0.3, [x, y, zS - 0.26]));
        const br = cyl(0.2 * gs, 0.14 * gs, 2.2 * gs, 10); br.rotateX(Math.PI / 2); iron.push(place(br, [x, y, zS - 1.3]));
        iron.push(place(new THREE.TorusGeometry(0.17 * gs, 0.06 * gs, 5, 10), [x, y, zS - 2.4]));
      }
    }
    // --- gallery tiers, each overhanging the one below
    const tiers = titan ? 3 : 2, tH = (yt - 1.2 - yA) / tiers;
    for (let t = 0; t < tiers; t++) {
      const y0 = yA + t * tH, y1 = y0 + tH, ym = (y0 + y1) / 2, w = halfW(ym) * (0.96 - t * 0.02), out = 0.6 + t * 0.7, z = zS - out;
      dark.push(box(w * 2, tH, out * 2, [0, ym, zS]));                                  // the tier's body
      plate.push(box(w * 2 + 0.2, 0.35, out * 2 + 0.3, [0, y0 + 0.17, zS - 0.05]));       // iron sill
      const nW = Math.max(5, Math.round(w / 1.6));
      for (let i = 0; i < nW; i++) {
        const x = -w + (2 * w * (i + 0.5)) / nW, ww = (2 * w) / nW;
        lamps.push(box(ww * 0.56, tH * 0.5, 0.1, [x, ym + 0.1, z - 0.02]));            // lit stern windows
        gold.push(box(ww * 0.7, 0.14, 0.14, [x, ym + tH * 0.3, z - 0.06]));
        gold.push(place(new THREE.SphereGeometry(0.18, 6, 4), [x, ym + tH * 0.36, z - 0.08], null, [1.6, 1, 1]));
      }
      for (let i = 0; i <= nW; i++) gold.push(box(0.2, tH * 0.85, 0.18, [-w + (2 * w * i) / nW, ym, z - 0.05]));
      // balcony: iron walkway with a gilt rail
      iron.push(box(w * 2 + 0.6, 0.18, 1.3, [0, y0 + 0.4, z - 0.65]));
      for (let i = 0; i <= 14; i++) gold.push(box(0.07, 0.85, 0.07, [-w - 0.25 + ((2 * w + 0.5) * i) / 14, y0 + 0.9, z - 1.25]));
      gold.push(box(w * 2 + 0.6, 0.1, 0.12, [0, y0 + 1.33, z - 1.25]));
      for (const sx of [-1, 1]) gold.push(place(new THREE.ConeGeometry(0.3, 0.9, 6), [sx * (w + 0.3), y0 - 0.1, z - 1.0], [Math.PI, 0, 0]));
    }
    const yTop = yA + tiers * tH, wT = halfW(yt) * 0.95, zT = zS - 0.6 - tiers * 0.7;
    // taffrail: heavy gilt cornice across the top
    gold.push(box(wT * 2 + 0.8, 0.5, 0.9, [0, yTop + 0.2, zT + 0.3]));
    dark.push(box(wT * 2, yt + 1.2 - yTop, 1.6, [0, (yTop + yt + 1.2) / 2, zS - 0.4]));
    gold.push(box(wT * 2 + 0.8, 0.35, 0.6, [0, yt + 1.25, zS - 0.5]));
    // --- quarter galleries: faceted bays on each quarter, tapering down to a gilt pendant
    const qr = Math.max(1.6, B * 0.055);
    for (const sx of [-1, 1]) {
      const qx = sx * (halfW((yA + yt) / 2) - qr * 0.2), qz = zS + qr * 0.9, qy0 = yA - 0.6, qy1 = yt + 0.8;
      dark.push(place(new THREE.CylinderGeometry(qr, qr, qy1 - qy0, 8), [qx, (qy0 + qy1) / 2, qz]));
      for (let t = 0; t < tiers; t++) {
        const y = yA + (t + 0.5) * tH;
        for (const a of [-0.7, 0, 0.7]) { const ang = (sx > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.PI + a * sx; lamps.push(place(new THREE.BoxGeometry(qr * 0.55, tH * 0.45, 0.1), [qx + Math.sin(ang) * qr * 0.96, y, qz + Math.cos(ang) * qr * 0.96], [0, ang, 0])); }
        gold.push(place(cyl(qr * 1.05, qr * 1.05, 0.18, 8), [qx, yA + t * tH, qz]));
      }
      gold.push(place(new THREE.ConeGeometry(qr * 1.02, qr * 2.6, 8), [qx, qy0 - qr * 1.3, qz], [Math.PI, 0, 0]));   // pendant
      gold.push(place(new THREE.SphereGeometry(qr * 0.3, 8, 6), [qx, qy0 - qr * 2.7, qz]));
      gold.push(place(new THREE.SphereGeometry(qr * 1.02, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), [qx, qy1, qz]));    // cupola
      gold.push(place(new THREE.ConeGeometry(0.25, 1.4, 6), [qx, qy1 + qr + 0.6, qz]));
    }
    // --- crest: a great gilt skull and crossed bones above the taffrail, flanked by sea-serpent scrolls
    const cy = yt + 1.4 + B * 0.11, cr = Math.min(wT * 0.42, B * 0.13), cz = zS - 0.9;
    for (const sx of [-1, 1]) {
      const bone = cyl(cr * 0.11, cr * 0.11, cr * 2.6, 8); bone.rotateZ(sx * 0.8); marble.push(place(bone, [0, cy - cr * 0.15, cz + 0.3]));
      for (const e of [-1, 1]) marble.push(place(new THREE.SphereGeometry(cr * 0.17, 8, 6), [-Math.sin(sx * 0.8) * cr * 1.3 * e, cy - cr * 0.15 + Math.cos(sx * 0.8) * cr * 1.3 * e, cz + 0.3]));
      const scroll = new THREE.TorusGeometry(cr * 0.7, cr * 0.11, 6, 16, Math.PI * 1.2); scroll.rotateZ(-0.5); if (sx < 0) scroll.rotateY(Math.PI);
      gold.push(place(scroll, [sx * cr * 1.75, cy - cr * 0.55, cz + 0.4]));
      gold.push(place(new THREE.SphereGeometry(cr * 0.18, 8, 6), [sx * cr * (1.75 + 0.7 * Math.cos(-0.5)), cy - cr * 0.55 + cr * 0.7 * Math.sin(-0.5), cz + 0.4]));
    }
    marble.push(place(new THREE.SphereGeometry(cr * 0.62, 16, 12), [0, cy + cr * 0.12, cz], null, [1, 0.95, 0.75]));
    marble.push(box(cr * 0.72, cr * 0.36, cr * 0.5, [0, cy - cr * 0.42, cz - 0.05]));
    for (const sx of [-1, 1]) { ports.push(place(new THREE.SphereGeometry(cr * 0.18, 10, 8), [sx * cr * 0.25, cy + cr * 0.08, cz - cr * 0.36], null, [1, 0.85, 0.6])); ember.push(place(new THREE.SphereGeometry(cr * 0.08, 8, 6), [sx * cr * 0.25, cy + cr * 0.08, cz - cr * 0.47])); }
    ports.push(place(new THREE.ConeGeometry(cr * 0.1, cr * 0.18, 3), [0, cy - cr * 0.12, cz - cr * 0.44], [-Math.PI / 2, 0, 0]));
    for (let i = 0; i < 5; i++) ports.push(box(cr * 0.06, cr * 0.24, 0.1, [(-2 + i) * cr * 0.13, cy - cr * 0.44, cz - cr * 0.31]));
    // three great stern lanterns on iron brackets
    for (const sx of [-1, 0, 1]) {
      const lx = sx * wT * 0.78, ly = yt + 2.8 + (sx ? 0 : B * 0.24), lz = zS - 1.4;
      iron.push(place(cyl(0.1, 0.1, 2.6, 5), [lx, ly - 1.7, lz]));
      lamps.push(place(new THREE.CylinderGeometry(0.75, 0.55, 1.7, 8), [lx, ly, lz]));
      gold.push(place(new THREE.ConeGeometry(0.85, 1.0, 8), [lx, ly + 1.35, lz]));
      gold.push(place(cyl(0.6, 0.8, 0.3, 8), [lx, ly - 0.95, lz]));
    }
    // the rudder, iron-banded
    dark.push(box(1.0, yA + H.draft, B * 0.06, [0, (yA - H.draft) / 2, zS - 0.5]));
    for (let i = 0; i < 4; i++) plate.push(box(1.15, 0.35, B * 0.065, [0, -H.draft * 0.8 + i * (yA + H.draft * 0.8) / 3.5, zS - 0.5]));
  }

  // ---------------------------------------------------------------- the Leviathan
  // ---------------------------------------------------------------- deck works for the great ships: companionways
  // down to the gun decks, a forecastle bulkhead, a midships deckhouse (timber on the liners, armoured on the ironclads)
  function door(x, y, z, f, w = 1.15, h = 2.05, frame = gold) {
    // an open doorway (dark) with its door leaf swung back, a frame and a step
    ports.push(box(w, h, 0.1, [x, y + h / 2, z + f * 0.03]));
    frame.push(box(w + 0.3, 0.16, 0.16, [x, y + h + 0.08, z + f * 0.06]));
    for (const s of [-1, 1]) frame.push(box(0.14, h, 0.16, [x + s * (w / 2 + 0.07), y + h / 2, z + f * 0.06]));
    const leaf = new THREE.BoxGeometry(w * 0.95, h * 0.96, 0.09); leaf.translate(w * 0.475, 0, 0);
    dark.push(place(leaf, [x - w / 2, y + h * 0.49, z + f * 0.1], [0, f * -1.9, 0]));
    dark.push(box(w + 0.2, 0.2, 0.6, [x, y + 0.1, z + f * 0.35]));
  }
  function companion(u, w, d, h, ironclad) {
    // a hooded companionway over the ladder below: doors fore and aft, a sliding hatch on the roof, gilt lamps
    const y = deckY(H, u), z = zU(u), wall = ironclad ? armour : dark, cap = ironclad ? armour : spar;
    wall.push(box(w, h, d, [0, y + h / 2, z]));
    cap.push(box(w + 0.4, 0.22, d + 0.4, [0, y + h + 0.11, z]));
    cap.push(box(w * 0.6, 0.3, d * 0.55, [0, y + h + 0.37, z - d * 0.12]));
    for (const s of [-1, 1]) cap.push(box(0.12, 0.16, d * 0.9, [s * w * 0.32, y + h + 0.3, z]));
    for (const f of [-1, 1]) door(0, y, z + f * d / 2, f, Math.min(1.2, w * 0.45), Math.min(2.05, h - 0.35), ironclad ? iron : gold);
    for (const s of [-1, 1]) {
      if (d > 2.6) glass.push(box(0.08, 0.6, d * 0.35, [s * (w / 2 + 0.02), y + h * 0.62, z]));
      lamps.push(place(new THREE.CylinderGeometry(0.16, 0.12, 0.38, 6), [s * (w / 2 + 0.22), y + h * 0.78, z + d / 2 - 0.25]));
    }
    if (ironclad) for (let i = 0; i < 4; i++) for (const s of [-1, 1]) iron.push(box(0.08, h * 0.9, 0.08, [s * (w / 2 + 0.03), y + h * 0.45, z - d / 2 + (d * (i + 0.5)) / 4]));
  }
  function deckhouse(u0, u1, w, h, o = {}) {
    // a long house between the masts: windows, doors at both ends, a skylight and the galley chimney on the roof
    const y = deckY(H, (u0 + u1) / 2), z0 = zU(u0), z1 = zU(u1), z = (z0 + z1) / 2, d = z1 - z0;
    const wall = o.iron ? armour : dark, cap = o.iron ? armour : spar;
    wall.push(box(w, h, d, [0, y + h / 2, z]));
    cap.push(box(w + 0.6, 0.28, d + 0.6, [0, y + h + 0.14, z]));
    (o.iron ? gold : white).push(box(w + 0.66, 0.12, d + 0.66, [0, y + h - 0.02, z]));
    const nW = Math.max(2, Math.round(d / 2.6));
    for (const s of [-1, 1]) for (let i = 0; i < nW; i++) {
      const zz = z0 + (d * (i + 0.5)) / nW;
      if (o.iron) { ports.push(box(0.1, 0.42, 1.3, [s * (w / 2 + 0.03), y + h * 0.6, zz])); iron.push(box(0.14, 0.12, 1.6, [s * (w / 2 + 0.05), y + h * 0.6 + 0.3, zz])); }
      else { glass.push(box(0.08, 0.9, 1.05, [s * (w / 2 + 0.02), y + h * 0.58, zz])); gold.push(box(0.1, 1.15, 0.12, [s * (w / 2 + 0.04), y + h * 0.58, zz + 0.62])); }
    }
    for (const f of [-1, 1]) { const zf = f > 0 ? z1 : z0; door(-w * 0.22, y, zf, f, 1.15, Math.min(2.05, h - 0.3), o.iron ? iron : gold); door(w * 0.22, y, zf, f, 1.15, Math.min(2.05, h - 0.3), o.iron ? iron : gold); }
    // pitched skylight
    const sl = d * 0.4, sw = Math.min(2.4, w * 0.4);
    for (const s of [-1, 1]) glass.push(place(new THREE.BoxGeometry(sw * 0.55, 0.08, sl), [s * sw * 0.24, y + h + 0.55, z - d * 0.12], [0, 0, s * -0.55]));
    cap.push(box(0.14, 0.14, sl + 0.2, [0, y + h + 0.72, z - d * 0.12]));
    for (const s of [-1, 1]) cap.push(box(0.1, 0.5, sl, [s * sw * 0.5, y + h + 0.36, z - d * 0.12]));
    if (o.chimney !== false) { const cx = w * 0.3, cz = z + d * 0.3; iron.push(place(cyl(0.38, 0.3, 2.2, 10), [cx, y + h + 1.2, cz])); iron.push(place(cyl(0.48, 0.48, 0.25, 10), [cx, y + h + 2.3, cz])); }
    if (o.boat) { // the launch stowed on the roof on chocks
      const bz = z + (o.chimney === false ? 0 : -d * 0.05);
      white.push(place(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), [-w * 0.12, y + h + 1.35, bz], null, [Math.min(w * 0.22, 1.9), 0.95, Math.min(d * 0.4, 4.5)]));
      dark.push(box(Math.min(w * 0.44, 3.8), 0.12, Math.min(d * 0.8, 9), [-w * 0.12, y + h + 1.36, bz]));
      for (const f of [-1, 1]) dark.push(box(w * 0.5, 0.45, 0.35, [-w * 0.12, y + h + 0.5, bz + f * Math.min(d * 0.25, 2.8)]));
    }
    // a rail round the roof so it doubles as a lookout
    for (let i = 0; i <= 8; i++) for (const s of [-1, 1]) cap.push(box(0.08, 0.8, 0.08, [s * (w / 2 + 0.2), y + h + 0.6, z0 - 0.2 + ((d + 0.4) * i) / 8]));
    for (const s of [-1, 1]) cap.push(box(0.08, 0.08, d + 0.4, [s * (w / 2 + 0.2), y + h + 1.0, z]));
    return { y: y + h + 0.28, z, d };
  }
  function bulkhead(u, h, faces, ironclad) {
    // a breast-wall across the deck under a raised forecastle / poop, with doorways leading below; f = side it faces
    const y = deckY(H, u), z = zU(u), w = hullX(H, u, y + h) * 1.96;
    (ironclad ? armour : dark).push(box(w, h, 0.4, [0, y + h / 2, z]));
    const nd = w > 18 ? 3 : 2;
    for (let i = 0; i < nd; i++) door(-w * 0.3 + (w * 0.6 * i) / (nd - 1), y, z + faces * 0.2, faces, 1.2, Math.min(2.1, h - 0.3), ironclad ? iron : gold);
    for (let i = 0; i < 2; i++) for (const s of [-1, 1]) glass.push(box(0.9, 0.7, 0.08, [s * w * (0.14 + i * 0.29), y + h * 0.62, z + faces * 0.22]));
    gold.push(box(w, 0.14, 0.12, [0, y + h - 0.1, z + faces * 0.22]));
    // rail along the break
    for (let i = 0; i <= 16; i++) (ironclad ? iron : dark).push(box(0.1, 0.85, 0.1, [-w / 2 + (w * i) / 16, y + h + 0.42, z]));
    (ironclad ? iron : dark).push(box(w, 0.1, 0.12, [0, y + h + 0.85, z]));
  }
  function forecastle(u0, h, ironclad) {
    // raised deck from the break forward, slabs following the hull's taper so nothing pokes out of the side
    const n = 8;
    for (let i = 0; i < n; i++) {
      const ua = u0 + ((0.985 - u0) * i) / n, ub = u0 + ((0.985 - u0) * (i + 1)) / n, um = (ua + ub) / 2;
      const y = deckY(H, um) + h, w = hullX(H, ub, y) * 0.98;
      if (w < 0.8) break;
      dark.push(box(w * 2, 0.3, zU(ub) - zU(ua) + 0.05, [0, y - 0.15, zU(um)]));
    }
    bulkhead(u0, h, -1, ironclad);
    // the belfry at the break
    const by = deckY(H, u0) + h, bz = zU(u0) + 1.2;
    for (const s of [-1, 1]) dark.push(box(0.22, 2.2, 0.22, [s * 0.9, by + 1.1, bz]));
    dark.push(box(2.3, 0.3, 0.6, [0, by + 2.3, bz]));
    gold.push(place(new THREE.CylinderGeometry(0.2, 0.45, 0.65, 10), [0, by + 1.75, bz]));
  }
  function conningTower(x, y, z, r, h) {
    armour.push(place(cyl(r, r * 1.08, h, 12), [x, y + h / 2, z]));
    glass.push(place(cyl(r * 1.01, r * 1.01, 0.32, 12), [x, y + h * 0.78, z]));
    iron.push(place(cyl(r * 1.15, r * 1.15, 0.3, 12), [x, y + h + 0.15, z]));
    iron.push(place(new THREE.SphereGeometry(r * 0.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), [x, y + h + 0.3, z]));
    lamps.push(place(new THREE.SphereGeometry(0.28, 8, 6), [x, y + h + 0.3 + r * 0.7 + 0.2, z]));
  }
  function bridge(y, z, w) {
    // a flying bridge across the beam with wings out over the rails
    armour.push(box(w, 0.25, 2.2, [0, y, z]));
    for (let i = 0; i <= 20; i++) for (const f of [-1, 1]) iron.push(box(0.09, 0.9, 0.09, [-w / 2 + (w * i) / 20, y + 0.55, z + f * 1.05]));
    for (const f of [-1, 1]) gold.push(box(w, 0.1, 0.12, [0, y + 1.0, z + f * 1.05]));
    for (const s of [-1, 1]) { iron.push(box(0.3, y - deckY(H, 0.5), 0.3, [s * w * 0.48, (y + deckY(H, 0.5)) / 2, z])); lamps.push(place(new THREE.CylinderGeometry(0.3, 0.22, 0.6, 8), [s * (w / 2 + 0.2), y + 1.4, z])); }
  }
  function deckWorks() {
    if (id === 'manowar' || sov) {
      const k = sov ? 1.25 : 1;
      companion(0.4, 2.8 * k, 2.6 * k, 2.5, false);
      deckhouse(sov ? 0.535 : 0.555, sov ? 0.685 : 0.69, B * 0.36, 2.6 * k, { boat: true });
      forecastle(sov ? 0.83 : 0.84, Math.max(2.4, H.bulwark + 1), false);
      // doors into the admiral's cabin under the poop
      const qy = deckY(H, 0.06), x = hullX(H, 0.15, qy) * 0.95, zf = -L / 2 + L * 0.13;
      for (const s of [-1, 1]) door(s * x * 0.35, qy, zf, 1, 1.2, 2.0);
      for (let i = 0; i < 9; i++) dark.push(box(0.1, 0.8, 0.1, [-x * 0.85 + (x * 1.7 * i) / 8, qy + 2.6, zf]));
      dark.push(box(x * 1.7, 0.1, 0.1, [0, qy + 3.0, zf]));
    } else if (lev) {
      const hw = hullX(H, 0.5, deckY(H, 0.5));
      const cw = hw * 2 - 7.5;                                   // clear of the carronade rows
      // armoured citadel deckhouse between the main and mizzen, with a conning tower and a flying bridge
      const c = titan ? deckhouse(0.53, 0.635, cw * 0.62, 5.2, { iron: true, chimney: false }) : deckhouse(0.46, 0.575, cw * 0.6, 4.6, { iron: true, chimney: false });
      conningTower(0, c.y, c.z + c.d * 0.15, titan ? 3.2 : 2.6, titan ? 4.6 : 3.8);
      bridge(c.y + 0.05, c.z - c.d * 0.3, hw * 2 - 1.4);
      if (titan) deckhouse(0.365, 0.465, cw * 0.5, 4.2, { iron: true, boat: true });
      for (const u of titan ? [0.245, 0.74] : [0.31, 0.71]) companion(u, 3.8, 3.6, 3.0, true);
      // doorways in the forecastle breastwork and under the poop
      const fz = zU(0.79) - 0.2, fy = deckY(H, 0.79);
      for (const s of [-1, 0, 1]) door(s * hw * 0.35, fy, fz, -1, 1.3, 2.1, iron);
      const py = deckY(H, 0.085), pz = -L / 2 + L * 0.15 + 0.6, pw = hullX(H, 0.05, sheer(H, 0.05)) * 0.94;
      for (const s of [-1, 1]) door(s * pw * 0.52, py, pz, 1, 1.3, 2.2);
    }
  }
  function buildLeviathan() {
    // armoured belt: two courses of riveted iron plates along the waterline, plates on the bow
    for (const yy of [0.2, 2.1, 4.0]) for (let i = 0; i < 52; i++) {
      const u = 0.04 + i * 0.0182;
      for (const sx of [-1, 1]) { const x = hullX(H, u, yy); if (x < 1) continue; iron.push(place(new THREE.BoxGeometry(0.22, 1.75, L * 0.0172), [sx * (x + 0.08), yy, zU(u)], [0, sx * -Math.atan2(hullX(H, Math.min(1, u + 0.01), yy) - x, L * 0.01), 0])); }
    }
    for (let i = 0; i < 70; i++) { const u = 0.03 + i * 0.0137; for (const sx of [-1, 1]) gold.push(box(0.14, 0.32, L * 0.0085, [sx * (hullX(H, u, sheer(H, u) - 0.7) + 0.04), sheer(H, u) - 0.7, zU(u)])); }
    // iron ram at the waterline + an armoured beak
    const ram = new THREE.ConeGeometry(2.4, 11, 8); ram.rotateX(Math.PI / 2); iron.push(place(ram, [0, 0.4, L / 2 + overhang(H, 1, 0.2) + 3.5], null, [0.75, 1, 1]));
    for (const sx of [-1, 1]) iron.push(place(new THREE.BoxGeometry(0.3, 5, L * 0.08), [sx * (hullX(H, 0.93, 2.5) + 0.1), 2.5, zU(0.93)], [0, sx * -0.42, 0]));
    // spar deck: a row of carronades along each rail, boats amidships
    for (const sx of [-1, 1]) for (let i = 0; i < 18; i++) {
      const u = 0.17 + i * 0.037, y = deckY(H, u) + 0.7, x = hullX(H, u, sheer(H, u)) - 1.0;
      dark.push(box(1.0, 0.6, 1.6, [sx * x, y - 0.35, zU(u)]));
      const b = cyl(0.32, 0.26, 2.4, 8); b.rotateZ(sx * -Math.PI / 2); iron.push(place(b, [sx * (x + 0.9), y + 0.05, zU(u)]));
    }
    // two great pivot guns on turntables, fore and aft on the centreline
    for (const [u, dir] of [[0.9, 1], [0.13, -1]]) {
      const y = deckY(H, u) + 0.1;
      iron.push(place(cyl(2.6, 2.8, 0.7, 18), [0, y + 0.35, zU(u)]));
      dark.push(box(2.6, 1.4, 3.2, [0, y + 1.3, zU(u)]));
      const b = cyl(0.75, 0.55, 7, 12); b.rotateX(dir * Math.PI / 2); iron.push(place(b, [0, y + 1.9, zU(u) + dir * 3.2]));
      iron.push(place(new THREE.TorusGeometry(0.62, 0.18, 6, 12), [0, y + 1.9, zU(u) + dir * 6.6]));
      for (const sx of [-1, 1]) iron.push(box(0.25, 2.2, 3.6, [sx * 1.45, y + 1.4, zU(u)]));
    }
    // armoured forecastle bulwark
    { const fu = 0.86, fy = deckY(H, fu), fw = hullX(H, fu, sheer(H, fu)) * 0.98; for (const sx of [-1, 1]) iron.push(box(0.35, 2.0, L * 0.14, [sx * fw, fy + 1.6, zU(fu)])); iron.push(box(fw * 2, 2.0, 0.35, [0, fy + 1.6, zU(0.79)])); }
    // towering poop: the admiral's cabin under the quarterdeck, with a gallery of lit windows
    { const pu = 0.085, py = deckY(H, pu), pw = hullX(H, 0.05, sheer(H, 0.05)) * 0.94, pL = L * 0.15, ph = 3.4;
      dark.push(box(pw * 2, ph, pL, [0, py + ph / 2, -L / 2 + pL / 2 + 0.5]));
      dark.push(box(pw * 2 + 0.4, 0.3, pL + 0.4, [0, py + ph, -L / 2 + pL / 2 + 0.5]));
      for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) { glass.push(box(0.1, 1.3, 1.1, [sx * (pw + 0.03), py + ph * 0.55, -L / 2 + 1.6 + i * (pL / 6.2)])); gold.push(box(0.12, 1.6, 0.18, [sx * (pw + 0.05), py + ph * 0.55, -L / 2 + 2.3 + i * (pL / 6.2)])); }
      for (let i = 0; i < 5; i++) glass.push(box(1.2, 1.3, 0.1, [-pw * 0.7 + i * pw * 0.35, py + ph * 0.55, -L / 2 + pL + 0.55]));
      for (let i = 0; i < 13; i++) iron.push(box(0.15, 1.1, 0.15, [-pw + (2 * pw * i) / 12, py + ph + 0.7, -L / 2 + pL + 0.5]));
      iron.push(box(pw * 2, 0.12, 0.12, [0, py + ph + 1.25, -L / 2 + pL + 0.5]));
      // wheel on the quarterdeck
      const wy = py + ph + 1.4, wz = -L / 2 + pL * 0.7;
      dark.push(place(new THREE.TorusGeometry(1.0, 0.08, 6, 18), [0, wy, wz]));
      for (let i = 0; i < 10; i++) dark.push(place(cyl(0.05, 0.05, 2.4, 4), [0, wy, wz], [0, 0, (i / 10) * Math.PI * 2]));
      // three great stern lanterns
      for (const sx of [-1, 0, 1]) { const lx = sx * pw * 0.8, ly = py + ph + 3.2 + (sx ? 0 : 1); iron.push(place(cyl(0.08, 0.08, 2.4, 4), [lx, ly - 1.6, -L / 2 + 1])); lamps.push(place(new THREE.CylinderGeometry(0.6, 0.45, 1.4, 6), [lx, ly, -L / 2 + 1])); gold.push(place(new THREE.ConeGeometry(0.7, 0.8, 6), [lx, ly + 1.1, -L / 2 + 1])); }
    }
  }

  const sailMeshes = batchSails(sails, smat);
  // assemble merged static meshes
  // LOD: `near` details vanish first (mid range), `small` ones far away; hull, deck, spars and sails always stay
  const lodNear = [], lodFar = [];
  for (const [list, mat, lod] of [[dark, m.darkwood, 0], [spar, m.spar, 0], [iron, m.iron, 2], [gold, m.gold, 2], [ports, m.port, 2], [glass, m.glass, 1], [lamps, ghost ? m.ghostLamp : m.lantern, 2], [red, m.red, 2], [white, m.white, 2], [trimL, trimMat, 2], [marble, m.marble, 2], [plate, m.plate, 2], [armour, m.armour, 0], [ember, m.ember, 1]]) {
    const mesh = merged(list, mat); if (!mesh) continue;
    body.add(mesh);
    if (lod === 1) lodNear.push(mesh); else if (lod === 2) lodFar.push(mesh);
  }
  if (fest) { lodNear.push(...fest.near); lodFar.push(...fest.far); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rigLines, 3));
  const rig = new THREE.LineSegments(rg, m.rope); body.add(rig);
  lodNear.push(rig);

  // shot holes (instanced decals placed where cannonballs actually struck)
  HOLE ||= holeGeometry();
  const MAXH = 40;
  const holes = new THREE.InstancedMesh(HOLE, m.hole, MAXH); holes.count = 0; holes.frustumCulled = false;
  body.add(holes);
  let holeN = 0;
  const hm = new THREE.Matrix4(), hq = new THREE.Quaternion(), hq2 = new THREE.Quaternion(), hs = new V3(), hp = new V3(), hn = new V3(), ZAX = new V3(0, 0, 1);

  // ---------------------------------------------------------------- animation API
  const api = {
    root, body, sails: sailMeshes, fest, flag: flags[0]?.mesh, flag2, guns, H, sailMat: smat, rig, holes,
    sailLevel: 1, damage: 0, hullDamage: 0,
    setSailLevel(l) { this.sailLevel = l; },
    /** sail damage 0..1: holes in the canvas, and topmasts shot away as it gets worse. */
    setDamage(d) {
      smat.userData.damage.value = Math.max(d, smat.userData.tatter || 0); this.damage = d;
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
      // hull normal from the local slope of the surface (tumblehome + flare), so the decal lies flush
      const e = 0.05, dxdy = (hullX(H, u, y + e) - hullX(H, u, y - e)) / (2 * e), dxdz = (hullX(H, Math.min(1, u + 0.01), y) - hullX(H, Math.max(0, u - 0.01), y)) / (0.02 * L);
      hn.set(sx, -dxdy * sx, -dxdz * sx).normalize();
      hq.setFromUnitVectors(ZAX, hn); hq2.setFromAxisAngle(ZAX, (holeN * 2.4) % 6.28); hq.multiply(hq2);
      hp.addScaledVector(hn, 0.04);
      const sc = (0.7 + ((holeN * 0.37) % 0.4)) * Math.min(1.5, 0.6 + L / 80);
      hs.set(sc, sc, sc);
      hm.compose(hp, hq, hs);
      holes.setMatrixAt(holeN % MAXH, hm);
      holeN++;
      holes.count = Math.min(MAXH, holeN);
      holes.instanceMatrix.needsUpdate = true;
    },
    clearHoles() { holeN = 0; holes.count = 0; },
    lod: 0,
    /** 0 = full detail, 1 = no rigging lines/glass/holes/flag animation, 2 = silhouette only (hull, spars, sails), no shadows. */
    setLOD(l) {
      if (l === this.lod) return;
      this.lod = l;
      for (const o of lodNear) o.visible = l < 1;
      for (const o of lodFar) o.visible = l < 2;
      holes.visible = l < 1;
      for (const g of mastGroups) g.upper.traverse((o) => { if (o.isLineSegments) o.visible = l < 1; });
      root.traverse((o) => { if (o.isMesh) { o.userData.cs0 ??= o.castShadow; o.castShadow = l < 2 && o.userData.cs0 && o !== holes; } });
    },
    /** Carpenters plug a share of the shot-holes. */
    patchHoles(frac) { holeN = Math.floor(Math.min(holeN, MAXH) * (1 - frac)); holes.count = holeN; },
    update(t, wind = 1) {
      const U = smat.userData.sail;
      U.lvl.value = this.sailLevel; U.wind.value = wind; U.t.value = t;
      if (fest) fest.update(t);
      if (this.lod > 0) return; // flags only ripple up close
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
      dropFestiveTrim(trimMat); if (fest) { fest.disposeTex?.dispose(); fest.ownMats.forEach((x) => x.dispose()); } hull.material.dispose(); smat.dispose(); smat.userData.depth.dispose(); if (battenMat) { battenMat.dispose(); battenMat.userData.depth.dispose(); } flagMat.dispose(); pennantMat.dispose(); trimMat.dispose();
    },
  };
  return api;
}
