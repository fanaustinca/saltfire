// Islands: vibrant stylised terrain (sand, grass, rock), palms + trees, the Free Port town, resource
// islets, and player/AI bases whose 3D model grows and changes as buildings are added.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from '../worldgen.js';
import { buildingPos, baseRadius, dockAngle } from '../basegeo.js';
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
function vnoise(r) { const v = Array.from({ length: 64 }, () => r()); return (a) => { const x = ((a / (Math.PI * 2)) * 64 + 640) % 64, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f); return v[i % 64] * (1 - s) + v[(i + 1) % 64] * s; }; }

/** Radial heightfield island. kind: 'green' | 'rock' | 'sulphur' | 'port'. Returns {geo, heightAt(d,a)}. */
export function terrain(R, seed, kind = 'green', peak = null) {
  const r = rng(seed);
  const n1 = vnoise(r), n2 = vnoise(r);
  const H = peak ?? (kind === 'rock' ? R * 0.5 : R * 0.22 + 4);
  const rings = 34, seg = 128;
  const shore = (a) => 1 + (n1(a) - 0.5) * 0.26 + (n2(a * 2) - 0.5) * 0.06;
  const hAt = (d, a) => {
    const k = d / (R * shore(a)); // 1 = waterline
    if (k > 1) return -Math.min(6, (k - 1) * 22);
    const beach = 1.6;
    const inner = Math.max(0, (0.82 - k) / 0.82);
    const hill = H * Math.pow(inner, 1.3) * (0.75 + 0.5 * n2(a + d * 0.05));
    return beach * (1 - k) / 0.18 * (k > 0.82 ? 1 : 0) + (k <= 0.82 ? beach + hill : 0);
  };
  const pos = [], col = [], idx = [];
  const sand = C('#e0bf78'), wetSand = C('#b89558'), grass = C(kind === 'sulphur' ? '#c8a52a' : '#3f9c2c'), grass2 = C(kind === 'sulphur' ? '#8a7a2a' : '#1d6b24'), rock = C(kind === 'sulphur' ? '#d8b83a' : '#7d7a73'), under = C('#2f8f86');
  const c = new THREE.Color();
  pos.push(0, hAt(0, 0), 0); c.copy(kind === 'rock' ? rock : grass2); col.push(c.r, c.g, c.b);
  for (let i = 1; i <= rings; i++) {
    const d = (i / rings) * R * 1.3;
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      const h = hAt(d, a);
      pos.push(Math.cos(a) * d, h, Math.sin(a) * d);
      const k = d / (R * shore(a));
      if (h < -0.2) c.copy(under).lerp(wetSand, Math.max(0, 1 + h / 3));
      else if (k > 0.86 || h < 1.9) c.copy(k > 0.97 ? wetSand : sand);
      else if (kind === 'rock' || h > H * 0.75) c.copy(rock).lerp(grass2, kind === 'rock' ? 0.1 : 0.2);
      else c.copy(grass).lerp(grass2, n1(a * 5 + d * 0.1) * 0.8);
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
  return { geo: g, hAt, shore, R };
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
    for (let i = 0; i < 3 + r() * 3; i++) {
      const m = new THREE.Mesh(rockGeo(), mats().vc);
      m.position.set((r() - 0.5) * isl.r, -1, (r() - 0.5) * isl.r);
      m.scale.set(isl.r * (0.3 + r() * 0.4), isl.r * (0.3 + r() * 0.6), isl.r * (0.3 + r() * 0.4));
      m.rotation.set(r(), r() * 6, r()); m.castShadow = true; g.add(m);
    }
    return g;
  }
  const kind = isl.kind === 'res' ? (isl.res === 'iron' ? 'rock' : isl.res === 'powder' ? 'sulphur' : 'green') : 'green';
  const T = terrain(isl.r, isl.seed || 7, kind, isl.kind === 'port' ? 14 : null);
  const land = new THREE.Mesh(T.geo, mats().terrain); land.receiveShadow = true; land.castShadow = true;
  g.add(land);
  if (isl.kind === 'port') g.add(portTown(isl, T, r));
  else if (isl.res === 'oak') g.add(vegetation(T, r, { palms: 6, trees: 26, rocks: 4 }));
  else if (isl.res === 'canvas') { g.add(vegetation(T, r, { palms: 8, rocks: 3 })); g.add(hempField(T, r)); }
  else if (isl.res === 'iron') { g.add(vegetation(T, r, { palms: 3, rocks: 14 })); g.add(mineProp(T)); }
  else if (isl.res === 'powder') { g.add(vegetation(T, r, { palms: 2, rocks: 10 })); }
  // resource beacon pole with coloured pennant so it's readable at range
  if (isl.kind === 'res') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 10, 5), mats().wood); pole.position.set(0, T.hAt(0, 0) + 5, 0); g.add(pole);
    const col = { oak: '#4caf50', iron: '#9e9e9e', canvas: '#f5f0dc', powder: '#ffca28' }[isl.res];
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.8), new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide })); fl.position.set(1.5, T.hAt(0, 0) + 9, 0); g.add(fl);
  }
  g.userData.T = T;
  return g;
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
  const R = baseRadius(base);
  const r = rng(base.seed || 3);
  const T = terrain(R, base.seed || 3, 'green', R * 0.18 + 3);
  const land = new THREE.Mesh(T.geo, mats().terrain); land.receiveShadow = true; land.castShadow = true;
  land.position.set(base.x, 0, base.z);
  g.add(land);
  const hAtW = (x, z) => { const dx = x - base.x, dz = z - base.z; return Math.max(1.4, T.hAt(Math.hypot(dx, dz), Math.atan2(dz, dx))); };
  const avoid = [];
  const owner = base.owner;
  const pcol = owner && players[owner] ? new THREE.Color().setHSL(players[owner].color / 360, 0.7, 0.5) : null;
  for (const bd of base.buildings) {
    const p = buildingPos(base, bd);
    const m = buildingModel(bd.type, bd.hp > 0, pcol, base, r);
    m.position.set(p.x, bd.type === 'fort' || bd.type === 'dock' ? 0 : hAtW(p.x, p.z) - 0.3, p.z);
    m.rotation.y = -p.ang + (bd.type === 'dock' ? 0 : Math.PI / 2);
    if (bd.type === 'dock') m.rotation.y = -p.ang;
    m.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.add(m);
    avoid.push({ x: p.x - base.x, z: p.z - base.z, r: p.rad + 3 });
  }
  // flag on the keep (owner colour / emblem), white flag when unclaimed
  const fg = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 16, 6), mats().wood); pole.position.y = 8; fg.add(pole);
  const fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, map: owner ? flagTex(owner.startsWith('ai:') ? 0 : 6, owner.startsWith('ai:') ? '#111' : '#' + (pcol || C('#888')).getHexString(), '#f4ecd8') : null, color: owner ? 0xffffff : 0xf4f4f4 });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), fmat); flag.position.set(2.5, 14, 0); fg.add(flag);
  const keepY = hAtW(base.x, base.z);
  fg.position.set(base.x + (base.buildings.some((b) => b.type === 'keep') ? 0 : 3), keepY + (base.buildings.some((b) => b.type === 'keep') ? 22 : 0), base.z);
  g.add(fg);
  // vegetation (fewer as the base grows)
  const veg = vegetation(T, r, { palms: Math.max(6, 18 - base.buildings.length), trees: Math.max(0, 6 - base.buildings.length), rocks: 5, avoid });
  veg.position.set(base.x, 0, base.z); g.add(veg);
  // safe-haven buoys / offline shield dome
  if (base.haven?.safe && owner && !owner.startsWith('ai:')) { const b = havenBuoys(HAVEN_R * 0.75, 20); b.position.set(base.x, 0, base.z); g.add(b); }
  if (shielded(W, owner)) g.add(shieldDome(base.x, base.z, R + 60));
  g.userData.T = T;
  return g;
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
