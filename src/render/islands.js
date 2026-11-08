// Islands: vibrant stylised terrain (sand, grass, rock), palms + trees, the Free Port town, resource
// islets, and player/AI bases whose 3D model grows and changes as buildings are added.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../worldgen.js';
import { islandShape } from '../islandshape.js';
import { buildingPos, baseRadius, dockAngle, baseShape } from '../basegeo.js';
import { BUILDINGS, HAVEN_R } from '../config.js';
import { stone, planks, flagTex } from './textures.js';
import { shielded } from '../economy.js';

const C = (h) => new THREE.Color(h);
let MAT = null;
function mats() {
  if (MAT) return MAT;
  const st = stone();
  MAT = {
    terrain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }),
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    vcGlow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: 0xffaa44, emissiveIntensity: 0.5 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xc9c2b4, map: st, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a5a33, map: planks().map, roughness: 0.85 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xb2452e, roughness: 0.8 }),
    roof2: new THREE.MeshStandardMaterial({ color: 0x4f6d8a, roughness: 0.8 }),
    plaster: new THREE.MeshStandardMaterial({ color: 0xf0e2c4, roughness: 0.9 }),
    iron: new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.5, metalness: 0.7 }),
    canvas: new THREE.MeshStandardMaterial({ color: 0xf2ead2, roughness: 0.95, side: THREE.DoubleSide }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 2 }),
    dmg: new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 }),
    buoyR: new THREE.MeshStandardMaterial({ color: 0xd23a2a, roughness: 0.6 }),
    buoyW: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  };
  return MAT;
}

// ------------------------------------------------------------------ terrain
/** Terrain mesh for a pure island shape (islandshape.js): beaches, cove, sea cliffs, hills. */
export function terrainFromShape(S, kind = 'green', seed = 1) {
  const r = rng(seed * 3 + 1);
  const R = S.R;
  const rings = 46, seg = 150;
  const pos = [], col = [], idx = [];
  const sand = C('#d9b56c'), wetSand = C('#a8854c'), under = C('#2f8f86');
  const grass = C(kind === 'sulphur' ? '#c8a52a' : kind === 'rock' ? '#5f7a3a' : '#3c9a2a'), grass2 = C(kind === 'sulphur' ? '#8a7a2a' : '#1c6322');
  const rock = C(kind === 'sulphur' ? '#c9a630' : '#6a5848'), rock2 = C(kind === 'sulphur' ? '#8a6a14' : '#3e332a'), dirt = C('#8a6a45');
  const c = new THREE.Color();
  const n = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.13 + seed) * Math.sin(z * 0.11 + seed * 0.7) * 0.8 + 0.1 * Math.sin(x * 0.41 - z * 0.37);
  const highRock = S.arche === 2 ? S.H * 1.6 : S.H * 0.85;
  pos.push(0, S.hAt(0, 0), 0); c.copy(grass2); col.push(c.r, c.g, c.b);
  for (let i = 1; i <= rings; i++) {
    const f = i / rings;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const e = S.edge(a);
      // rings hug the shoreline (denser near the coast so cliffs stay crisp)
      const d = f < 0.8 ? e * Math.pow(f / 0.8, 1.05) * 0.86 : e * (0.86 + (f - 0.8) / 0.2 * 0.42);
      const h = S.hAt(d, a);
      pos.push(Math.cos(a) * d, h, Math.sin(a) * d);
      const k = d / e, cl = S.cliff(a);
      if (h < -0.2) c.copy(under).lerp(wetSand, Math.max(0, 1 + h / 3));
      else if (cl > 0.35 && k > 0.78 && h > 1.2) c.copy(rock).lerp(rock2, 0.5 + 0.5 * Math.sin(h * 1.4 + a * 3));
      else if (k > 0.83 || h < 1.9) c.copy(k > 0.97 ? wetSand : sand);
      else if (kind === 'rock' || h > highRock) c.copy(rock).lerp(grass2, kind === 'rock' ? 0.15 : 0.3);
      else c.copy(grass).lerp(grass2, n(Math.cos(a) * d, Math.sin(a) * d) * 0.75).lerp(dirt, (kind === 'res' ? 0 : 0.08) * r());
      col.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * seg, b0 = 1 + i * seg;
    for (let j = 0; j < seg; j++) { const j1 = (j + 1) % seg; idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // steep faces are bare rock whatever the biome
  const nr = g.attributes.normal, cc = g.attributes.color, pp = g.attributes.position;
  for (let i = 0; i < nr.count; i++) {
    const ny = nr.getY(i), y = pp.getY(i);
    if (ny < 0.68 && y > 0.6) { const t = Math.min(1, (0.68 - ny) / 0.3); c.setRGB(cc.getX(i), cc.getY(i), cc.getZ(i)).lerp(Math.sin(y * 1.7) > 0 ? rock : rock2, t); cc.setXYZ(i, c.r, c.g, c.b); }
  }
  return { geo: g, hAt: S.hAt, shore: S.shore, R, S };
}

// ------------------------------------------------------------------ props (vertex coloured, merged)
function colorize(g, hex) { g = g.index ? g.toNonIndexed() : g; const c = C(hex); const a = new Float32Array(g.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); return g; }
const T4 = (g, x, y, z, ry = 0, s = 1) => { g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s))); return g; };

let PALM = null, TREE = null, ROCK = null, HOUSE = null;
function palmGeo() {
  if (PALM) return PALM;
  const parts = [];
  const lean = 0.5;
  for (let i = 0; i < 6; i++) { // curved trunk
    const t0 = i / 6, t1 = (i + 1) / 6;
    const p0 = new THREE.Vector3(Math.sin(t0 * lean) * 2.2, t0 * 9, 0), p1 = new THREE.Vector3(Math.sin(t1 * lean) * 2.2, t1 * 9, 0);
    const d = p1.clone().sub(p0); const g = new THREE.CylinderGeometry(0.28 - t1 * 0.1, 0.32 - t0 * 0.1, d.length() + 0.05, 6);
    g.translate(0, d.length() / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())); g.translate(p0.x, p0.y, p0.z);
    parts.push(colorize(g, i % 2 ? '#8a6a45' : '#7a5c3a'));
  }
  const top = new THREE.Vector3(Math.sin(lean) * 2.2, 9, 0);
  for (let k = 0; k < 8; k++) { // drooping fronds
    const a = (k / 8) * Math.PI * 2;
    const g = new THREE.PlaneGeometry(1.4, 5.5, 1, 4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 2.75; p.setY(i, y); p.setZ(i, -Math.pow(y / 5.5, 2) * 2.6); p.setX(i, p.getX(i) * Math.sin((y / 5.5) * Math.PI) * 1.2); }
    g.rotateX(-Math.PI / 2 + 0.35); g.rotateY(a); g.translate(top.x, top.y, top.z);
    parts.push(colorize(g, k % 2 ? '#3f9b3a' : '#4fb444'));
  }
  const nut = new THREE.SphereGeometry(0.35, 5, 4); nut.translate(top.x, top.y - 0.4, top.z + 0.3); parts.push(colorize(nut, '#5a4026'));
  PALM = mergeGeometries(parts);
  return PALM;
}
function treeGeo() {
  if (TREE) return TREE;
  const trunk = colorize(new THREE.CylinderGeometry(0.35, 0.5, 4, 6).translate(0, 2, 0), '#6b4a2e');
  const parts = [trunk];
  for (const [x, y, z, s, c] of [[0, 5.5, 0, 2.8, '#3c8f3a'], [1.2, 4.6, 0.6, 2.0, '#4aa043'], [-1.1, 4.8, -0.4, 2.2, '#357f33'], [0.2, 6.8, 0.3, 1.8, '#56ad4a']]) parts.push(colorize(new THREE.IcosahedronGeometry(s, 1).translate(x, y, z), c));
  TREE = mergeGeometries(parts);
  return TREE;
}
function rockGeo() { if (ROCK) return ROCK; ROCK = colorize(new THREE.IcosahedronGeometry(1, 0), '#8e8a82'); return ROCK; }
function houseGeo() {
  if (HOUSE) return HOUSE;
  const body = colorize(new THREE.BoxGeometry(6, 4.5, 5).translate(0, 2.25, 0), '#efe0c0');
  const roof = colorize(new THREE.ConeGeometry(4.9, 3, 4).rotateY(Math.PI / 4).scale(1.0, 1, 0.85).translate(0, 6, 0), '#c2553a');
  const door = colorize(new THREE.BoxGeometry(1.2, 2, 0.1).translate(0, 1, 2.55), '#5a3a22');
  const win = colorize(new THREE.BoxGeometry(1, 1, 0.1).translate(1.8, 2.8, 2.55), '#3a4c58');
  const win2 = colorize(new THREE.BoxGeometry(1, 1, 0.1).translate(-1.8, 2.8, 2.55), '#3a4c58');
  HOUSE = mergeGeometries([body, roof, door, win, win2]);
  return HOUSE;
}
function instanced(geo, list, mat) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const M4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  list.forEach((p, i) => { e.set(p.rx || 0, p.ry || 0, p.rz || 0); q.setFromEuler(e); M4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.sx || p.s, p.sy || p.s, p.sz || p.s)); m.setMatrixAt(i, M4); });
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Scatter vegetation on a terrain. */
function vegetation(T, r, { palms = 20, trees = 0, rocks = 6, avoid = [] } = {}) {
  const P = [], Tr = [], Rk = [];
  const ok = (x, z, rad) => avoid.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + rad);
  for (let i = 0; i < palms * 4 && P.length < palms; i++) {
    const a = r() * Math.PI * 2, d = T.R * (0.55 + r() * 0.35) * T.shore(a);
    const x = Math.cos(a) * d, z = Math.sin(a) * d; if (!ok(x, z, 3)) continue;
    P.push({ x, y: T.hAt(d, a) - 0.2, z, s: 0.8 + r() * 0.5, ry: a + Math.PI + (r() - 0.5) });
  }
  for (let i = 0; i < trees * 4 && Tr.length < trees; i++) {
    const a = r() * Math.PI * 2, d = T.R * r() * 0.7 * T.shore(a);
    const x = Math.cos(a) * d, z = Math.sin(a) * d; if (!ok(x, z, 4)) continue;
    Tr.push({ x, y: T.hAt(d, a) - 0.3, z, s: 0.8 + r() * 0.7, ry: r() * 6 });
  }
  for (let i = 0; i < rocks; i++) {
    const a = r() * Math.PI * 2, d = T.R * (0.8 + r() * 0.35) * T.shore(a);
    Rk.push({ x: Math.cos(a) * d, y: T.hAt(d, a), z: Math.sin(a) * d, s: 1 + r() * 2.5, sy: 0.6 + r(), rx: r(), ry: r() * 6 });
  }
  const g = new THREE.Group();
  for (const [geo, list] of [[palmGeo(), P], [treeGeo(), Tr], [rockGeo(), Rk]]) { const m = instanced(geo, list, mats().vc); if (m) g.add(m); }
  return g;
}

// ------------------------------------------------------------------ static islands
export function buildIsland(isl) {
  const g = new THREE.Group();
  g.position.set(isl.x, 0, isl.z);
  const r = rng(isl.seed || 7);
  if (isl.kind === 'rock') {
    // sea stacks and reefs: tall weathered pillars with a scrap of green on top
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(rockGeo(), mats().vc);
      const tall = i === 0 && r() < 0.6;
      m.position.set((r() - 0.5) * isl.r, -1, (r() - 0.5) * isl.r);
      m.scale.set(isl.r * (0.25 + r() * 0.35), isl.r * (tall ? 1.1 + r() * 0.9 : 0.3 + r() * 0.5), isl.r * (0.25 + r() * 0.35));
      m.rotation.set(r() * 0.3, r() * 6, r() * 0.3); m.castShadow = true; g.add(m);
    }
    return g;
  }
  const kind = isl.kind === 'res' ? (isl.res === 'iron' ? 'rock' : isl.res === 'powder' ? 'sulphur' : 'res') : 'green';
  const S = islandShape({ seed: isl.seed || 7, R: isl.r, bayA: null, kind: isl.kind });
  const T = terrainFromShape(S, kind, isl.seed || 7);
  const land = new THREE.Mesh(T.geo, mats().terrain); land.receiveShadow = true; land.castShadow = false;
  g.add(land);
  if (isl.kind === 'port') g.add(portTown(isl, T, r));
  else if (isl.res === 'oak') g.add(vegetation(T, r, { palms: 8, trees: 30, rocks: 4 }));
  else if (isl.res === 'canvas') { g.add(vegetation(T, r, { palms: 10, rocks: 3 })); g.add(hempField(T, r)); }
  else if (isl.res === 'iron') { g.add(vegetation(T, r, { palms: 3, rocks: 16 })); g.add(mineProp(T)); }
  else if (isl.res === 'powder') { g.add(vegetation(T, r, { palms: 2, rocks: 10 })); }
  if (isl.kind === 'res') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 5), mats().wood); pole.position.set(0, T.hAt(0, 0) + 5, 0); g.add(pole);
    const col = { oak: '#4caf50', iron: '#9e9e9e', canvas: '#f5f0dc', powder: '#ffca28' }[isl.res];
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide })); fl.position.set(1.5, T.hAt(0, 0) + 9, 0); g.add(fl);
  }
  g.add(seaStacks(S, r, 2));
  g.userData.T = T;
  return g;
}
/** Tall rock pillars just off the cliffs. */
function seaStacks(S, r, n) {
  const list = [];
  for (let i = 0; i < 40 && list.length < n; i++) {
    const a = r() * Math.PI * 2;
    if (S.cliff(a) < 0.5) continue;
    const d = S.edge(a) + 6 + r() * 14;
    const s = 3 + r() * 4;
    list.push({ x: Math.cos(a) * d, y: -2, z: Math.sin(a) * d, sx: s, sy: 6 + r() * S.H * 0.5, sz: s * (0.7 + r() * 0.5), ry: r() * 6, rx: (r() - 0.5) * 0.2 });
  }
  return instanced(rockGeo(), list, mats().vc) || new THREE.Group();
}
function hempField(T, r) {
  const rows = [];
  for (let i = 0; i < 160; i++) { const a = r() * Math.PI * 2, d = T.R * r() * 0.55; rows.push({ x: Math.cos(a) * d, y: T.hAt(d, a), z: Math.sin(a) * d, s: 1, sy: 1 + r() * 0.6, ry: r() * 6 }); }
  const geo = colorize(new THREE.ConeGeometry(0.6, 2.4, 5).translate(0, 1.2, 0), '#a7c84a');
  return instanced(geo, rows, mats().vc);
}
function mineProp(T) {
  const g = new THREE.Group();
  const y = T.hAt(T.R * 0.3, 0);
  const frame = new THREE.Mesh(mergeGeometries([colorize(new THREE.BoxGeometry(0.6, 5, 0.6).translate(-2, 2.5, 0), '#5a3a22'), colorize(new THREE.BoxGeometry(0.6, 5, 0.6).translate(2, 2.5, 0), '#5a3a22'), colorize(new THREE.BoxGeometry(5, 0.6, 0.8).translate(0, 5, 0), '#5a3a22'), colorize(new THREE.BoxGeometry(3.6, 4.2, 0.4).translate(0, 2.1, -0.4), '#111')]), mats().vc);
  frame.position.set(T.R * 0.3, y, 0); frame.rotation.y = -Math.PI / 2; g.add(frame);
  return g;
}
function portTown(isl, T, r) {
  const g = new THREE.Group();
  const houses = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2, d = T.R * (0.2 + r() * 0.55);
    houses.push({ x: Math.cos(a) * d, y: T.hAt(d, a) - 0.3, z: Math.sin(a) * d, s: 0.8 + r() * 0.6, sy: 0.8 + r() * 0.9, ry: Math.round(a / (Math.PI / 2)) * (Math.PI / 2) + (r() - 0.5) * 0.3 });
  }
  g.add(instanced(houseGeo(), houses, mats().vc));
  g.add(vegetation(T, r, { palms: 24, rocks: 6, avoid: houses.map((h) => ({ ...h, r: 5 })) }));
  // lighthouse
  const lh = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.2, 26, 12), mats().plaster); tower.position.y = 13; lh.add(tower);
  for (let i = 0; i < 3; i++) { const band = new THREE.Mesh(new THREE.CylinderGeometry(3.6 - i * 0.35, 3.75 - i * 0.35, 2.6, 12), mats().roof); band.position.y = 5 + i * 8; lh.add(band); }
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 8), mats().glow); lamp.position.y = 27.5; lh.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3, 3, 8), mats().roof); cap.position.y = 30.5; lh.add(cap);
  const la = 2.4, ld = T.R * 0.86; lh.position.set(Math.cos(la) * ld, T.hAt(ld, la), Math.sin(la) * ld);
  lh.traverse((o) => { o.castShadow = true; });
  g.add(lh);
  // piers all around
  for (let k = 0; k < 4; k++) { const a = k * (Math.PI / 2) + 0.4; g.add(pier(Math.cos(a) * T.R * 0.95, Math.sin(a) * T.R * 0.95, a, 40)); }
  // market stalls + flags
  const stalls = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, d = T.R * 0.12; stalls.push({ x: Math.cos(a) * d, y: T.hAt(d, a), z: Math.sin(a) * d, s: 1, ry: -a }); }
  const stallGeo = mergeGeometries([colorize(new THREE.BoxGeometry(3, 2, 2).translate(0, 1, 0), '#8a5a33'), colorize(new THREE.ConeGeometry(2.4, 1.4, 4).rotateY(Math.PI / 4).translate(0, 2.7, 0), '#e8c84a')]);
  g.add(instanced(stallGeo, stalls, mats().vc));
  g.add(havenBuoys(HAVEN_R, 28));
  return g;
}
function pier(x, z, a, len) {
  const parts = [];
  const deck = colorize(new THREE.BoxGeometry(len, 0.6, 5).translate(len / 2, 1.6, 0), '#9a7048');
  parts.push(deck);
  for (let i = 0; i <= len; i += 5) for (const s of [-2.2, 2.2]) parts.push(colorize(new THREE.CylinderGeometry(0.3, 0.35, 6, 6).translate(i, -1.2, s), '#5a3e26'));
  const m = new THREE.Mesh(mergeGeometries(parts), mats().vc);
  m.position.set(x, 0, z); m.rotation.y = -a; m.castShadow = true; m.receiveShadow = true;
  return m;
}
function havenBuoys(R, n) {
  const list = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; list.push({ x: Math.cos(a) * R, y: 0.2, z: Math.sin(a) * R, s: 1 }); }
  const geo = mergeGeometries([colorize(new THREE.CylinderGeometry(0.8, 1.1, 1.6, 8).translate(0, 0.4, 0), '#d23a2a'), colorize(new THREE.CylinderGeometry(0.5, 0.8, 1.2, 8).translate(0, 1.8, 0), '#f2f2f2'), colorize(new THREE.ConeGeometry(0.4, 0.8, 6).translate(0, 2.8, 0), '#d23a2a')]);
  const m = instanced(geo, list, mats().vc);
  m.userData.buoys = list;
  return m;
}

// ------------------------------------------------------------------ bases (grow with buildings)
export class BaseView {
  constructor(scene) { this.scene = scene; this.group = null; this.sig = ''; }
  update(base, W, players) {
    const sig = JSON.stringify([base.owner, base.buildings.map((b) => [b.type, typeof b.slot === 'number' ? b.slot.toFixed(2) : b.slot, b.hp > 0]), base.haven?.safe, shielded(W, base.owner), players[base.owner]?.color]);
    if (sig === this.sig) return;
    this.sig = sig;
    if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); }); }
    this.group = buildBase(base, W, players);
    this.scene.add(this.group);
  }
  dispose() { if (this.group) this.scene.remove(this.group); }
}

function buildBase(base, W, players) {
  const g = new THREE.Group();
  const S = baseShape(base);
  const R = S.R;
  const r = rng(base.seed || 3);
  const owner = base.owner;
  const fac = owner && owner.startsWith('ai:') ? owner.split(':')[1] : null;
  const T = terrainFromShape(S, 'green', base.seed || 3);
  const land = new THREE.Mesh(T.geo, mats().terrain); land.receiveShadow = true; land.castShadow = false;
  land.position.set(base.x, 0, base.z);
  g.add(land);
  const hAtW = (x, z) => Math.max(1.4, S.hWorld(x - base.x, z - base.z));
  const avoid = [];
  const pcol = owner && players[owner] ? new THREE.Color().setHSL(players[owner].color / 360, 0.7, 0.5) : fac === 'clan' ? new THREE.Color().setHSL((W.ai?.[owner]?.color || 0) / 360, 0.7, 0.42) : null;
  for (const bd of base.buildings) {
    const p = buildingPos(base, bd);
    const m = buildingModel(bd.type, bd.hp > 0, pcol, base, r);
    m.position.set(p.x, bd.type === 'fort' || bd.type === 'dock' ? 0 : p.y - 0.3, p.z);
    m.rotation.y = bd.type === 'dock' ? -p.ang : -p.ang + Math.PI / 2;
    m.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.add(m);
    avoid.push({ x: p.x - base.x, z: p.z - base.z, r: p.rad + 4 });
  }
  // flag on the keep / stockade (owner colours; black for clans; tattered grey for squatters)
  const core = base.buildings.find((b) => b.type === 'keep' || b.type === 'camp');
  const fg = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 16, 6), mats().wood); pole.position.y = 8; fg.add(pole);
  const flagMap = !owner ? null : fac === 'wild' ? flagTex(7, '#6b6355', '#d8cfb8') : fac ? flagTex(0, '#0c0c0c', '#' + (pcol || C('#ddd')).getHexString()) : flagTex(6, '#' + (pcol || C('#888')).getHexString(), '#f4ecd8');
  const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, map: flagMap, color: owner ? 0xffffff : 0xf4f4f4 });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), fmat); flag.position.set(2.5, 14, 0); fg.add(flag);
  if (core) { const p = buildingPos(base, core); fg.position.set(p.x, p.y + (core.type === 'keep' ? 21.5 : 8), p.z); }
  else fg.position.set(base.x, hAtW(base.x, base.z), base.z);
  g.add(fg);
  // the pirate cove village: shacks on the slopes, stilt huts and a boardwalk round the bay
  const vg = village(base, S, r, fac, avoid);
  vg.position.set(base.x, 0, base.z); g.add(vg);
  // vegetation thins out as the settlement grows
  const nb = base.buildings.length;
  const veg = vegetation(T, r, { palms: Math.max(8, 22 - nb), trees: Math.max(2, 12 - nb), rocks: 6, avoid });
  veg.position.set(base.x, 0, base.z); g.add(veg);
  const st = seaStacks(S, r, 3); st.position.set(base.x, 0, base.z); g.add(st);
  // safe-haven buoys / offline shield dome
  if (base.haven?.safe && owner && !fac) { const b = havenBuoys(HAVEN_R * 0.75, 20); b.position.set(base.x, 0, base.z); g.add(b); }
  if (shielded(W, owner)) g.add(shieldDome(base.x, base.z, R + 60));
  g.userData.T = T;
  return g;
}

// ------------------------------------------------------------------ pirate cove village
let SHACKS = null;
function shackGeos() {
  if (SHACKS) return SHACKS;
  const plankWall = '#e8dcc6', roofA = '#7a5236', roofB = '#9a7a4a', post = '#4a3220', dark = '#2a1c12', win = '#ffcf7a';
  // A: lean-to shack with a slanted plank roof
  const A = mergeGeometries([
    colorize(new THREE.BoxGeometry(4.2, 3, 4).translate(0, 1.5, 0), plankWall),
    colorize(new THREE.BoxGeometry(5, 0.3, 5).rotateX(0.28).translate(0, 3.5, 0), roofA),
    colorize(new THREE.BoxGeometry(1, 1.9, 0.1).translate(0.8, 0.95, 2.03), dark),
    colorize(new THREE.BoxGeometry(0.7, 0.6, 0.1).translate(-1, 1.8, 2.03), win),
  ]);
  // B: tall narrow house with a balcony and a pointed roof
  const B = mergeGeometries([
    colorize(new THREE.BoxGeometry(3.6, 6, 3.6).translate(0, 3, 0), plankWall),
    colorize(new THREE.ConeGeometry(3.1, 2.6, 4).rotateY(Math.PI / 4).translate(0, 7.3, 0), roofB),
    colorize(new THREE.BoxGeometry(3.8, 0.2, 1.4).translate(0, 3.4, 2.4), post),
    colorize(new THREE.BoxGeometry(3.8, 0.7, 0.1).translate(0, 3.9, 3.1), post),
    colorize(new THREE.BoxGeometry(0.8, 0.8, 0.1).translate(0.8, 4.6, 1.83), win),
    colorize(new THREE.BoxGeometry(0.8, 0.8, 0.1).translate(-0.8, 1.6, 1.83), win),
    colorize(new THREE.BoxGeometry(0.4, 1.4, 0.4).translate(1.1, 8.0, -0.6), '#5b5048'),
  ]);
  // C: the tavern — long, gabled, with a hanging sign and barrels
  const roof = new THREE.CylinderGeometry(3.6, 3.6, 9, 3, 1); roof.rotateZ(Math.PI / 2); roof.scale(1, 0.55, 1);
  const C3 = mergeGeometries([
    colorize(new THREE.BoxGeometry(8.6, 4, 6).translate(0, 2, 0), plankWall),
    colorize(roof.translate(0, 4.9, 0), roofA),
    colorize(new THREE.BoxGeometry(1.6, 2.4, 0.1).translate(0, 1.2, 3.03), dark),
    ...[-3, -1.6, 1.6, 3].map((x) => colorize(new THREE.BoxGeometry(0.9, 0.8, 0.1).translate(x, 2.2, 3.03), win)),
    colorize(new THREE.BoxGeometry(0.15, 0.15, 1.6).translate(2.4, 3.3, 3.8), post),
    colorize(new THREE.BoxGeometry(1.4, 0.9, 0.12).translate(2.4, 2.7, 4.5), '#c9a227'),
    ...[[-3.6, 3.6], [-2.6, 3.8], [3.8, -2.5]].map(([x, z]) => colorize(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8).translate(x, 0.55, z), '#7a4f2a')),
  ]);
  // D: stilt hut over the water with a thatched roof
  const legs = [];
  for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) legs.push(colorize(new THREE.CylinderGeometry(0.18, 0.22, 7, 5).translate(x, -0.5, z), post));
  const Dg = mergeGeometries([
    ...legs,
    colorize(new THREE.BoxGeometry(4.6, 0.3, 4.6).translate(0, 3, 0), '#8a6440'),
    colorize(new THREE.BoxGeometry(3.6, 2.6, 3.6).translate(0, 4.4, 0), '#d8c49a'),
    colorize(new THREE.ConeGeometry(3.4, 2.4, 6).translate(0, 6.9, 0), '#b89a52'),
    colorize(new THREE.BoxGeometry(0.9, 1.7, 0.1).translate(0, 4, 1.83), dark),
  ]);
  SHACKS = { A, B, C: C3, D: Dg };
  return SHACKS;
}
const WALL_TINTS = ['#ffffff', '#f2c9a0', '#bcd6e8', '#e9b3a8', '#cfe3b5', '#e8d38f', '#c9b6d9', '#a8c8c0'];

function village(base, S, r, fac, avoid) {
  const g = new THREE.Group();
  const R = S.R, bay = S.bayA;
  const nb = base.buildings.length;
  const want = fac === 'wild' ? 4 + (base.lvl || 1) : fac === 'clan' ? 16 + nb : !base.owner ? 3 : 7 + nb * 2;
  const lists = { A: [], B: [], C: [], D: [] };
  const used = [...avoid];
  const free = (x, z, rad) => used.every((a) => Math.hypot(a.x - x, a.z - z) > a.r + rad);
  // shacks on gentle ground near the cove
  for (let i = 0; i < want * 12 && lists.A.length + lists.B.length + lists.C.length < want; i++) {
    const a = bay + (r() - 0.5) * (fac === 'clan' ? 4.2 : 3.2);
    const e = S.edge(a), k = 0.38 + r() * 0.5, d = e * k;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = S.hAt(d, a);
    if (h < 1.3 || S.cliff(a) > 0.4) continue;
    if (Math.abs(S.hAt(d + 3, a) - S.hAt(d - 3, a)) > 2.2) continue; // too steep
    const type = lists.C.length < (want > 10 ? 1 : 0) + (fac === 'clan' ? 1 : 0) ? 'C' : r() < 0.55 ? 'A' : 'B';
    const rad = type === 'C' ? 7 : 4;
    if (!free(x, z, rad)) continue;
    used.push({ x, z, r: rad });
    lists[type].push({ x, y: h - 0.4, z, s: 0.85 + r() * 0.35, ry: -a + Math.PI / 2 + (r() - 0.5) * 0.5, tint: WALL_TINTS[Math.floor(r() * WALL_TINTS.length)] });
  }
  // stilt huts along the cove's shoreline, joined by a boardwalk
  const walk = [];
  if (S.hasBay) {
    const nStilt = fac === 'wild' ? 2 : !base.owner ? 1 : Math.min(8, 3 + Math.floor(nb / 2));
    for (let i = 0; i < nStilt; i++) {
      const side = i % 2 ? 1 : -1;
      const a = bay + side * S.bayHalf * (0.45 + Math.floor(i / 2) * 0.22 + r() * 0.08);
      const d = S.edge(a) + 3.5;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!free(x, z, 3)) continue;
      used.push({ x, z, r: 4 });
      lists.D.push({ x, y: 0, z, s: 1, ry: -a + Math.PI / 2, tint: WALL_TINTS[Math.floor(r() * 3)] });
      walk.push([a, d]);
    }
    // boardwalk: planks following the bay shore
    const planks = [];
    for (let k = -1; k <= 1; k += 2) {
      for (let t = 0.12; t < 0.95; t += 0.06) {
        const a = bay + k * S.bayHalf * t;
        const d = S.edge(a) + 1.2;
        planks.push(colorize(new THREE.BoxGeometry(2.4, 0.25, 3.2).rotateY(-a).translate(Math.cos(a) * d, 1.7, Math.sin(a) * d), '#9a7048'));
        if (Math.round(t * 100) % 18 === 0) planks.push(colorize(new THREE.CylinderGeometry(0.2, 0.25, 5, 5).translate(Math.cos(a) * (d + 1.2), -0.6, Math.sin(a) * (d + 1.2)), '#4a3220'));
      }
    }
    if (planks.length) { const m = new THREE.Mesh(mergeGeometries(planks), mats().vc); m.receiveShadow = true; m.castShadow = true; g.add(m); }
  }
  const G = shackGeos();
  for (const k of ['A', 'B', 'C', 'D']) {
    const m = instanced(G[k], lists[k], mats().vc);
    if (!m) continue;
    lists[k].forEach((p, i) => m.setColorAt(i, new THREE.Color(p.tint)));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    g.add(m);
  }
  // lanterns along the waterfront (they glow at dusk and look cosy any time)
  const lamps = [];
  for (const [a, d] of walk) lamps.push({ x: Math.cos(a) * (d - 2), y: 1.6, z: Math.sin(a) * (d - 2), s: 1 });
  for (let i = 0; i < Math.min(6, lists.A.length); i++) lamps.push({ x: lists.A[i].x + 2.6, y: lists.A[i].y, z: lists.A[i].z + 2.6, s: 1 });
  const lampGeo = mergeGeometries([colorize(new THREE.CylinderGeometry(0.08, 0.1, 3.2, 4).translate(0, 1.6, 0), '#2a1c12'), colorize(new THREE.BoxGeometry(0.45, 0.55, 0.45).translate(0, 3.3, 0), '#ffd27a')]);
  const lm = instanced(lampGeo, lamps, mats().vcGlow); if (lm) g.add(lm);
  // campfire, crates and barrels on the beach
  const props = [];
  for (let i = 0; i < 8 + nb; i++) {
    const a = bay + (r() - 0.5) * 2.6, d = S.edge(a) * (0.84 + r() * 0.1), h = S.hAt(d, a);
    if (h < 0.4 || h > 3) continue;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    props.push(r() < 0.5 ? colorize(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 8).translate(x, h + 0.5, z), '#7a4f2a') : colorize(new THREE.BoxGeometry(1.1, 1.1, 1.1).rotateY(r() * 3).translate(x, h + 0.5, z), '#a8854f'));
  }
  if (props.length) g.add(new THREE.Mesh(mergeGeometries(props), mats().vc));
  // a beached wreck on some coves, a skull rock + gallows at clan holds
  if ((base.seed || 0) % 5 < 2) g.add(wreck(S, r));
  if (fac === 'clan') g.add(skullRock(S, r));
  if (fac === 'wild') g.add(squatterCamp(S, r, used));
  return g;
}
function wreck(S, r) {
  const a = S.bayA + (r() < 0.5 ? 1 : -1) * (S.bayHalf + 0.5 + r() * 0.6);
  const d = S.edge(a) * 0.93, h = S.hAt(d, a);
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < 9; i++) { const rib = new THREE.TorusGeometry(3.4 - Math.abs(i - 4) * 0.3, 0.22, 4, 10, Math.PI * 0.9); rib.rotateZ(Math.PI * 1.05); rib.translate(0, 2.4, -8 + i * 2); parts.push(colorize(rib, '#4a3424')); }
  parts.push(colorize(new THREE.BoxGeometry(0.5, 0.6, 18).translate(0, -0.6, 0), '#3a2818'));
  for (let i = 0; i < 4; i++) parts.push(colorize(new THREE.BoxGeometry(0.12, 2.2, 6).rotateZ(1.2).translate(-2.6, 0.6 + i * 0.5, -3 + i * 1.6), '#5a4030'));
  const mast = new THREE.CylinderGeometry(0.3, 0.35, 14, 6); mast.rotateZ(1.05); mast.translate(4, 4, 2); parts.push(colorize(mast, '#5a4030'));
  const m = new THREE.Mesh(mergeGeometries(parts), mats().vc); m.castShadow = true;
  g.add(m);
  g.position.set(Math.cos(a) * d, Math.max(-0.5, h - 1.2), Math.sin(a) * d);
  g.rotation.set(0.12, -a + 0.4, 0.35);
  return g;
}
function skullRock(S, r) {
  const a = S.bayA + (r() < 0.5 ? 1 : -1) * (S.bayHalf + 0.2);
  const d = S.edge(a) + 6;
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xa69d8a, roughness: 0.95, flatShading: true });
  const blk = new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 1 });
  const cran = new THREE.IcosahedronGeometry(10, 2);
  const p = cran.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const j = 1 + (Math.sin(x * 1.3) * Math.sin(y * 1.7) * Math.sin(z * 1.1)) * 0.06; p.setXYZ(i, x * 0.95 * j, y * (y < 0 ? 0.7 : 1) * j, z * 1.05 * j); }
  cran.computeVertexNormals();
  const skull = new THREE.Mesh(cran, bone); skull.position.y = 12; g.add(skull);
  const cheek = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 9, 2, 2, 2), bone); cheek.position.set(0, 4.5, 3.2); g.add(cheek);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 7), bone); jaw.position.set(0, 0.5, 4.2); g.add(jaw);
  for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8), blk); e.position.set(sx * 3.8, 10.5, 9.0); e.scale.set(1, 0.85, 0.45); g.add(e); }
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3, 3), blk); nose.position.set(0, 6.6, 7.9); nose.rotation.x = Math.PI; g.add(nose);
  for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.7), blk); t.position.set(-3.6 + i * 1.45, 2.6, 7.7); g.add(t); }
  for (let i = 0; i < 5; i++) { const t = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 1.2), bone); t.position.set(-3.2 + i * 1.6, 2.4, 7.75); g.add(t); }
  g.position.set(Math.cos(a) * d, -2.5, Math.sin(a) * d);
  g.rotation.y = Math.PI / 2 - a;
  g.traverse((o) => { o.castShadow = true; });
  return g;
}
function squatterCamp(S, r, used) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = S.bayA + Math.PI + (r() - 0.5) * 2, d = S.edge(a) * (0.25 + r() * 0.3), h = S.hAt(d, a);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (!used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + 3)) continue;
    const tent = new THREE.ConeGeometry(2.2, 2.8, 4); tent.rotateY(r() * 3); tent.translate(x, h + 1.2, z);
    parts.push(colorize(tent, ['#c8b48a', '#a89a7a', '#8a7a5a'][i % 3]));
  }
  if (!parts.length) return new THREE.Group();
  const m = new THREE.Mesh(mergeGeometries(parts), mats().vc); m.castShadow = true;
  return m;
}

function shieldDome(x, z, R) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 wp = modelMatrix*vec4(position,1.); vP = position; vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition-wp.xyz); gl_Position = projectionMatrix*viewMatrix*wp; }',
    fragmentShader: 'uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(1.0-abs(dot(vN,vV)),2.5); float hex = 0.5+0.5*sin(vP.x*0.4+uTime)*sin(vP.y*0.4-uTime*0.7)*sin(vP.z*0.4); gl_FragColor = vec4(vec3(0.35,0.7,1.0)*(f*0.9+hex*0.08), 1.0); }',
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  m.position.set(x, -2, z);
  m.userData.shield = true;
  m.onBeforeRender = () => { mat.uniforms.uTime.value = performance.now() / 1000; };
  return m;
}

// building models (local frame: +z faces outward from the island centre)
function buildingModel(type, alive, pcol, base, r) {
  const M = mats();
  const g = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0, ry = 0) => { const m = new THREE.Mesh(geo, alive ? mat : M.dmg); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (!alive) { // rubble
    for (let i = 0; i < 7; i++) add(new THREE.DodecahedronGeometry(1 + r() * 1.5, 0), M.dmg, (r() - 0.5) * 8, 0.5, (r() - 0.5) * 8);
    const m = add(box(5, 3, 0.6), M.dmg, 0, 1.5, 0); m.rotation.z = 0.4;
    return g;
  }
  switch (type) {
    case 'camp': {
      // squatters' stockade: a ring of sharpened logs round a lookout hut
      for (let i = 0; i < 22; i++) { const a = (i / 22) * Math.PI * 2; if (Math.abs(Math.sin(a / 2 - 0.2)) < 0.12) continue; const l = add(new THREE.CylinderGeometry(0.4, 0.45, 5 + (i % 3) * 0.6, 6), M.wood, Math.cos(a) * 8, 2.4, Math.sin(a) * 8); add(new THREE.ConeGeometry(0.42, 0.9, 6), M.wood, Math.cos(a) * 8, 5.4 + (i % 3) * 0.3, Math.sin(a) * 8); l.rotation.z = 0.03; }
      add(box(5, 3.2, 4.5), M.wood, 0, 1.6, 0); add(new THREE.ConeGeometry(4.2, 2.6, 4), M.roof, 0, 4.4, 0, Math.PI / 4);
      for (const [x, z] of [[-2.2, -2], [2.2, -2], [-2.2, 2], [2.2, 2]]) add(box(0.4, 7, 0.4), M.wood, x + 4, 3.5, z - 3);
      add(box(5, 0.4, 5), M.wood, 4, 7, -3); add(new THREE.ConeGeometry(3.4, 2, 4), M.roof, 4, 8.6, -3, Math.PI / 4);
      const c = add(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 8), M.iron, 0, 1.2, 8.6); c.rotation.x = Math.PI / 2;
      break;
    }
    case 'keep': {
      add(box(14, 14, 14), M.stone, 0, 7, 0);
      for (const [x, z] of [[-7, -7], [7, -7], [-7, 7], [7, 7]]) { add(new THREE.CylinderGeometry(3, 3.4, 20, 10), M.stone, x, 10, z); add(new THREE.ConeGeometry(3.8, 5, 10), M.roof, x, 22.5, z); }
      for (let i = 0; i < 6; i++) for (const s of [-1, 1]) { add(box(1.6, 1.6, 1.2), M.stone, -6 + i * 2.4, 14.8, s * 7); add(box(1.2, 1.6, 1.6), M.stone, s * 7, 14.8, -6 + i * 2.4); }
      add(box(3, 5, 0.4), M.wood, 0, 2.5, 7.1);
      for (let i = 0; i < 4; i++) { const b = add(new THREE.CylinderGeometry(0.25, 0.3, 2.6, 8), M.iron, -4.5 + i * 3, 9, 7.6); b.rotation.x = Math.PI / 2; }
      break;
    }
    case 'dock': {
      const parts = [];
      const len = 34;
      parts.push(colorize(box(len, 0.7, 6).translate(len / 2 - 6, 1.8, 0), '#9a7048'));
      parts.push(colorize(box(8, 0.7, 14).translate(len - 6, 1.8, 0), '#9a7048'));
      for (let i = -6; i <= len - 2; i += 4.5) for (const s of [-2.6, 2.6]) parts.push(colorize(new THREE.CylinderGeometry(0.32, 0.36, 7, 6).translate(i, -1.2, s), '#5a3e26'));
      for (let i = 0; i < 5; i++) parts.push(colorize(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8).translate(len - 9 + (i % 3) * 1.4, 2.8, -4 + Math.floor(i / 3) * 1.6), '#7a4f2a'));
      parts.push(colorize(new THREE.BoxGeometry(1.4, 1.4, 1.4).translate(len - 4, 2.9, 4), '#a8854f'));
      const m = new THREE.Mesh(mergeGeometries(parts), M.vc); g.add(m);
      // crane
      add(new THREE.CylinderGeometry(0.4, 0.5, 9, 6), M.wood, len - 3, 6, -5);
      const arm = add(box(8, 0.5, 0.5), M.wood, len, 10, -5);
      arm.rotation.z = -0.2;
      g.rotation.y = 0; // handled by caller
      return g;
    }
    case 'shipyard': {
      // slipway with a ship skeleton (ribs) and a gantry
      add(box(10, 0.6, 30), M.wood, 0, 0.6, 6).rotation.x = -0.05;
      for (let i = 0; i < 9; i++) { const rib = add(new THREE.TorusGeometry(3.2 - Math.abs(i - 4) * 0.25, 0.22, 4, 12, Math.PI), M.wood, 0, 3.6, -3 + i * 2.6); rib.rotation.z = Math.PI; }
      add(box(0.5, 0.6, 24), M.wood, 0, 0.9, 7);
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) add(box(0.6, 10, 0.6), M.wood, s * 6, 5, -3 + i * 10);
      for (let i = 0; i < 3; i++) add(box(13, 0.6, 0.6), M.wood, 0, 10, -3 + i * 10);
      add(box(8, 5, 7), M.wood, -11, 2.5, -4); add(new THREE.ConeGeometry(6, 3, 4), M.roof2, -11, 6.5, -4, Math.PI / 4);
      break;
    }
    case 'watchtower': {
      add(new THREE.CylinderGeometry(2.6, 3.4, 18, 10), M.stone, 0, 9, 0);
      add(new THREE.CylinderGeometry(3.6, 3.2, 2, 10), M.stone, 0, 19, 0);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; add(box(1.2, 1.4, 1.2), M.stone, Math.cos(a) * 3.2, 20.6, Math.sin(a) * 3.2); }
      add(new THREE.ConeGeometry(3.4, 4, 10), pcol ? new THREE.MeshStandardMaterial({ color: pcol }) : M.roof, 0, 23.5, 0);
      add(new THREE.SphereGeometry(0.8, 8, 6), M.glow, 0, 21, 0);
      const c = add(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 8), M.iron, 0, 20.2, 3.6); c.rotation.x = Math.PI / 2;
      break;
    }
    case 'warehouse': add(box(14, 7, 9), M.wood, 0, 3.5, 0); add(new THREE.CylinderGeometry(5.2, 5.2, 14, 3, 1), M.roof2, 0, 8.4, 0).rotation.z = Math.PI / 2; add(box(4, 5, 0.3), M.iron, 0, 2.5, 4.6); for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 8), M.wood, -6 + i * 2.2, 0.8, 6.2); break;
    case 'lumber': {
      add(box(9, 5, 7), M.wood, 0, 2.5, 0); add(new THREE.ConeGeometry(6.6, 3, 4), M.roof, 0, 6.5, 0, Math.PI / 4);
      for (let i = 0; i < 9; i++) { const l = add(new THREE.CylinderGeometry(0.5, 0.5, 7, 8), M.wood, 6.5 + (i % 3) * 1.05, 0.55 + Math.floor(i / 3) * 0.95, -2 + (Math.floor(i / 3) % 2) * 0.5); l.rotation.x = Math.PI / 2; }
      const saw = add(new THREE.CylinderGeometry(1.6, 1.6, 0.15, 16), M.iron, -5.5, 2, 3); saw.rotation.x = Math.PI / 2;
      break;
    }
    case 'mine': add(new THREE.DodecahedronGeometry(6, 0), M.stone, 0, 1, 0); add(box(4.5, 4.5, 2), M.wood, 0, 2.2, 5.2); add(box(3.2, 3.6, 0.4), M.dmg, 0, 2, 6.3); for (let i = 0; i < 5; i++) add(new THREE.DodecahedronGeometry(0.8 + r() * 0.5, 0), M.iron, 4 + r() * 3, 0.6, 5 + r() * 2); break;
    case 'loft': add(box(14, 5, 6), M.plaster, 0, 2.5, 0); add(new THREE.CylinderGeometry(4.2, 4.2, 14, 3, 1), M.roof, 0, 6.4, 0).rotation.z = Math.PI / 2; for (let i = 0; i < 3; i++) { add(box(0.3, 5, 0.3), M.wood, -5 + i * 5, 2.5, 6); const c = add(new THREE.PlaneGeometry(4.4, 3.5), M.canvas, -2.5 + i * 5, 3, 6); c.rotation.y = 0.05; } break;
    case 'powderhouse': add(box(7, 4.5, 7), M.stone, 0, 2.25, 0); add(new THREE.ConeGeometry(5.4, 3, 4), M.roof, 0, 6, 0, Math.PI / 4); for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x9a2a1a }), -3 + (i % 3) * 1.5, 0.7, 4.6 + Math.floor(i / 3) * 1.4); break;
    case 'cannon': {
      add(new THREE.CylinderGeometry(3.4, 3.8, 1.6, 10), M.stone, 0, 0.8, 0);
      for (let i = 0; i < 7; i++) { const a = -0.9 + (i / 6) * 1.8; add(box(1.1, 1.2, 1), M.stone, Math.sin(a) * 3.2, 2.2, Math.cos(a) * 3.2, a); }
      add(box(1.6, 0.8, 2.2), M.wood, 0, 2, 0);
      const b = add(new THREE.CylinderGeometry(0.3, 0.42, 3.2, 10), M.iron, 0, 2.6, 1.4); b.rotation.x = Math.PI / 2;
      break;
    }
    case 'fort': {
      add(new THREE.CylinderGeometry(14, 16, 12, 16), M.stone, 0, 3, 0);
      add(new THREE.CylinderGeometry(15, 15, 1.2, 16), M.stone, 0, 9.6, 0);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; add(box(2.2, 1.8, 1.6), M.stone, Math.cos(a) * 14.2, 11, Math.sin(a) * 14.2, -a); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; const c = add(new THREE.CylinderGeometry(0.4, 0.55, 3.6, 10), M.iron, Math.cos(a) * 14, 10.6, Math.sin(a) * 14); c.rotation.z = Math.PI / 2; c.rotation.y = -a; }
      add(new THREE.CylinderGeometry(5, 5.5, 6, 10), M.stone, 0, 12, 0); add(new THREE.ConeGeometry(6, 4, 10), pcol ? new THREE.MeshStandardMaterial({ color: pcol }) : M.roof, 0, 17, 0);
      break;
    }
    default: add(box(6, 4, 6), M.wood, 0, 2, 0);
  }
  return g;
}
