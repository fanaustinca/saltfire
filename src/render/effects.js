// Particles (smoke, spray, fire, ink, dust), flat foam decals (wakes, splashes), flying debris,
// cannonball meshes and floating loot crates.
import * as THREE from 'three';
import { puff } from './textures.js';
import { heightAt, CALM_MIN, CALM_W } from '../waves.js';
import { TRAILS } from '../config.js';

const trailCache = new Map();
/** Colour of a wake trail id (null = plain foam, 'rainbow' cycles through hues). */
function trailCol(id) {
  if (!id || !TRAILS[id] || !TRAILS[id].color) return null;
  if (TRAILS[id].color === 'rainbow') return 'rainbow';
  if (!trailCache.has(id)) trailCache.set(id, new THREE.Color(TRAILS[id].color));
  return trailCache.get(id);
}

const MAXP = 6000;
const MC1 = new THREE.Color(0xeeeeee), MC2 = new THREE.Color(0x9a9a9a), MFL = new THREE.Color(1, 0.65, 0.25);
const TMPC = new THREE.Color();
const K_1__0_6__0_15 = new THREE.Color(1, 0.6, 0.15);
const K_1__0_65__0_25 = new THREE.Color(1, 0.65, 0.25);
const K_0_8__0_15__0_02 = new THREE.Color(0.8, 0.15, 0.02);
const K_0xdddddd = new THREE.Color(0xdddddd);
const K_0x221d18 = new THREE.Color(0x221d18);
const K_1__0_5__0_2 = new THREE.Color(1, 0.5, 0.2);
const K_0xf4fbff = new THREE.Color(0xf4fbff);
const K_1__0_7__0_3 = new THREE.Color(1, 0.7, 0.3);
const K_0xffffff = new THREE.Color(0xffffff);
const K_0xeeeeee = new THREE.Color(0xeeeeee);
const K_1__0_75__0_3 = new THREE.Color(1, 0.75, 0.3);
const K_0x2c2620 = new THREE.Color(0x2c2620);
const K_0x9a9a9a = new THREE.Color(0x9a9a9a);
const K_0_9__0_2__0_05 = new THREE.Color(0.9, 0.2, 0.05);
const K_0x4a4038 = new THREE.Color(0x4a4038);
const pvert = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vA; varying vec3 vC;
void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (900.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const pfrag = `
uniform sampler2D uTex; uniform float uLight; varying float vA; varying vec3 vC;
void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC * uLight, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`;

class PointPool {
  constructor(scene, blending) {
    this.n = 0;
    this.p = []; // particle structs
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXP * 3); this.size = new Float32Array(MAXP); this.alpha = new Float32Array(MAXP); this.col = new Float32Array(MAXP * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    const m = new THREE.ShaderMaterial({ vertexShader: pvert, fragmentShader: pfrag, uniforms: { uTex: { value: puff() }, uLight: { value: 1 } }, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  add(o) { if (this.p.length >= MAXP) { this.p[this.over = ((this.over || 0) + 1) % MAXP] = o; return; } this.p.push(o); }
  update(dt) {
    // compact in place (no new arrays, no colour clones: battles spawn thousands of puffs)
    const P = this.p;
    let w = 0, i = 0;
    for (let r = 0; r < P.length; r++) {
      const q = P[r];
      q.age += dt;
      if (q.age >= q.life) continue;
      if (q.g) q.vy -= q.g * dt;
      const drag = Math.exp(-(q.drag ?? 1) * dt);
      q.vx *= drag; q.vy *= drag; q.vz *= drag;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      P[w++] = q;
      const k = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * k;
      this.alpha[i] = q.a * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
      const c = q.c, c1 = q.c1;
      if (c1) { this.col[i * 3] = c.r + (c1.r - c.r) * k; this.col[i * 3 + 1] = c.g + (c1.g - c.g) * k; this.col[i * 3 + 2] = c.b + (c1.b - c.b) * k; }
      else { this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b; }
      i++;
    }
    P.length = w;
    this.geo.setDrawRange(0, i);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[k].needsUpdate = true;
  }
}

/** Flat additive foam decals that ride the water surface. Everything after `add` happens on the GPU: each decal
 *  is one instance in a ring buffer (centre, birth time, life, size, alpha, yaw, stretch, tint), and the vertex
 *  shader ages it and drapes every corner on the same Gerstner field (calm + distance fade) as the ocean mesh. */
const FOAM_VERT = /* glsl */`
attribute vec4 iA; // x, z, birth, life
attribute vec4 iB; // s0, s1, alpha, yaw
attribute vec4 iC; // stretch, r, g, b
uniform float uTime; uniform float uSea; uniform vec4 uWaves[5]; uniform vec3 uCalm[32]; uniform int uCalmCount;
varying vec3 vFoamCol;
float foamCalm(vec2 p) {
  float cf = 1.0;
  for (int i = 0; i < 32; i++) { if (i >= uCalmCount) break; vec3 c = uCalm[i]; float r0 = c.z * 0.9; cf = min(cf, smoothstep(r0, r0 + CALM_W, length(p - c.xy))); }
  return CALM_MIN + (1.0 - CALM_MIN) * cf;
}
vec3 foamDisp(vec2 p, float fade) {
  vec3 d = vec3(0.0); float calm = foamCalm(p);
  for (int i = 0; i < 5; i++) {
    vec4 w = uWaves[i]; float k = 6.2831853 / w.z; float c = sqrt(9.81 / k);
    float a = w.w * uSea * calm * (i > 2 ? fade * 0.6 + 0.4 : fade) / k;
    float f = k * (dot(w.xy, p) - c * uTime);
    d.x += w.x * a * cos(f); d.z += w.y * a * cos(f); d.y += a * sin(f);
  }
  return d;
}
`;
class Foam {
  constructor(scene, ocean) {
    const MAX = 5000;
    this.max = MAX; this.w = 0; this.adds = 0; this.now = 0;
    const base = new THREE.PlaneGeometry(1, 1); base.rotateX(-Math.PI / 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.setAttribute('position', base.attributes.position); geo.setAttribute('uv', base.attributes.uv);
    this.A = new Float32Array(MAX * 4); this.B = new Float32Array(MAX * 4); this.C = new Float32Array(MAX * 4);
    for (let i = 0; i < MAX; i++) { this.A[i * 4 + 2] = -1e9; this.A[i * 4 + 3] = 1; }
    this.attrs = [['iA', this.A], ['iB', this.B], ['iC', this.C]].map(([k, arr]) => { const at = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, at); return at; });
    geo.instanceCount = MAX;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.MeshBasicMaterial({ map: puff(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    const U = ocean.uniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: U.uTime, uSea: U.uSea, uWaves: U.uWaves, uCalm: U.uCalm, uCalmCount: U.uCalmCount });
      sh.vertexShader = `#define CALM_MIN ${CALM_MIN.toFixed(3)}\n#define CALM_W ${CALM_W.toFixed(1)}\n` + FOAM_VERT + sh.vertexShader.replace('#include <begin_vertex>', `
        float fAge = uTime - iA.z, fK = fAge / max(iA.w, 1e-3);
        vec3 transformed = vec3(0.0, -1e5, 0.0);
        vFoamCol = vec3(0.0);
        if (fK >= 0.0 && fK < 1.0) {
          float s = iB.x + (iB.y - iB.x) * sqrt(fK);
          vec2 l = vec2(position.x * s, position.z * s * iC.x);
          float cy = cos(iB.w), sy = sin(iB.w);
          vec2 wp = iA.xy + vec2(l.x * cy + l.y * sy, -l.x * sy + l.y * cy);
          float fade = 1.0 - smoothstep(900.0, 2400.0, length(wp - cameraPosition.xz));
          vec2 q = wp; vec3 d;
          for (int it = 0; it < 3; it++) { d = foamDisp(q, fade); q = wp - d.xz; }
          d = foamDisp(q, fade);
          transformed = vec3(wp.x, d.y + 0.12, wp.y);
          vFoamCol = iC.yzw * iB.z * (1.0 - fK) * (fK < 0.08 ? fK / 0.08 : 1.0);
        }`);
      sh.fragmentShader = 'varying vec3 vFoamCol;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= vFoamCol;');
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  get count() { let n = 0; for (let i = 0; i < this.max; i++) if (this.now - this.A[i * 4 + 2] < this.A[i * 4 + 3]) n++; return n; }
  add(x, z, s0, s1, life, a = 0.5, yaw = 0, stretch = 1, col = null) {
    const i = this.w, o = i * 4;
    this.w = (this.w + 1) % this.max; this.adds++;
    this.A[o] = x; this.A[o + 1] = z; this.A[o + 2] = this.now; this.A[o + 3] = life;
    this.B[o] = s0; this.B[o + 1] = s1; this.B[o + 2] = a; this.B[o + 3] = yaw;
    this.C[o] = stretch; this.C[o + 1] = col ? col.r : 1; this.C[o + 2] = col ? col.g : 1; this.C[o + 3] = col ? col.b : 1;
  }
  update(dt, t) {
    this.now = t;
    if (!this.adds) return;
    const n = Math.min(this.adds, this.max), start = (this.w - n + this.max) % this.max;
    for (const at of this.attrs) {
      at.clearUpdateRanges();
      if (start + n <= this.max) at.addUpdateRange(start * 4, n * 4);
      else { at.addUpdateRange(start * 4, (this.max - start) * 4); at.addUpdateRange(0, (start + n - this.max) * 4); }
      at.needsUpdate = true;
    }
    this.adds = 0;
  }
}

export class Effects {
  constructor(scene, ocean) {
    this.scene = scene;
    this.smoke = new PointPool(scene, THREE.NormalBlending);
    this.glow = new PointPool(scene, THREE.AdditiveBlending);
    this.foam = new Foam(scene, ocean);
    // debris chunks
    const dg = new THREE.BoxGeometry(0.5, 0.25, 1.4);
    this.debris = new THREE.InstancedMesh(dg, new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }), 600);
    this.debris.frustumCulled = false; this.debris.castShadow = true;
    scene.add(this.debris);
    this.chunks = [];
    // cannonballs
    this.ballMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 10, 8), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.6, roughness: 0.4 }), 800);
    this.ballMesh.frustumCulled = false;
    this.ballMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3);
    scene.add(this.ballMesh);
    this.crates = new Map();
    this.m4 = new THREE.Matrix4();
    this.tmpC = new THREE.Color();
    this.lights = [];
    // a few pooled point lights for muzzle flashes / explosions
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa55, 0, 60, 2); scene.add(l); this.lights.push({ l, t: 0 }); }
  }
  /** Ambient light level for smoke + foam (1 = noon; night and storms darken them; glows stay bright). */
  setLight(k) { this.smoke.points.material.uniforms.uLight.value = k; this.foam.mesh.material.color.setScalar(k); }
  flash(x, y, z, k = 1) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y, z); L.l.intensity = 2500 * k; L.t = 0.12;
  }
  muzzle(x, y, z, dx, dz, n = 1, k = 1) {
    const C1 = MC1, C2 = MC2;
    const cnt = Math.max(3, Math.round(14 * k));
    for (let i = 0; i < cnt; i++) {
      const sp = 2 + Math.random() * 14;
      this.smoke.add({ x, y, z, vx: dx * sp + (Math.random() - 0.5) * 2.5, vy: Math.random() * 2 + 0.4, vz: dz * sp + (Math.random() - 0.5) * 2.5, age: 0, life: 3 + Math.random() * 3.5, s0: 3, s1: 14 + Math.random() * 8, a: 0.7, c: C1, c1: C2, drag: 1.1, g: -0.35 });
    }
    for (let i = 0; i < (k < 0.6 ? 2 : 4); i++) this.glow.add({ x, y, z, vx: dx * (8 + Math.random() * 10), vy: Math.random(), vz: dz * (8 + Math.random() * 10), age: 0, life: 0.18, s0: 3, s1: 1, a: 1, c: MFL, drag: 3 });
    if (n) this.flash(x + dx * 2, y, z + dz * 2, 0.6);
  }
  splash(x, z, big = 1, t = 0) {
    const y = heightAt(x, z, t);
    const W = K_0xf4fbff;
    for (let i = 0; i < 18 * big; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
      this.smoke.add({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, vx: Math.cos(a) * (1 + Math.random() * 3), vy: 6 + Math.random() * 9 * big, vz: Math.sin(a) * (1 + Math.random() * 3), age: 0, life: 0.9 + Math.random() * 0.6, s0: 1.2, s1: 3.2, a: 0.85, c: W, g: 14, drag: 0.6 });
    }
    this.foam.add(x, z, 2, 9 * big, 4, 0.7);
  }
  hit(x, y, z, rig, ammo) {
    const n = rig ? 6 : 14;
    for (let i = 0; i < n; i++) this.addChunk(x, y, z, rig);
    const dark = K_0x4a4038;
    for (let i = 0; i < 6; i++) this.smoke.add({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, age: 0, life: 1.5 + Math.random(), s0: 1.5, s1: 6, a: 0.6, c: dark, drag: 1.2, g: -0.6 });
    if (ammo === 'explosive') this.explosion(x, y, z, 0.8);
    else for (let i = 0; i < 6; i++) this.glow.add({ x, y, z, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 8, vz: (Math.random() - 0.5) * 14, age: 0, life: 0.35, s0: 0.8, s1: 0.2, a: 1, c: K_1__0_7__0_3, g: 9 });
  }
  explosion(x, y, z, k = 1) {
    for (let i = 0; i < 26 * k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = 6 + Math.random() * 16;
      this.glow.add({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, age: 0, life: 0.5 + Math.random() * 0.4, s0: 5 * k, s1: 1, a: 1, c: K_1__0_75__0_3, c1: K_0_9__0_2__0_05, drag: 2.5 });
    }
    for (let i = 0; i < 14 * k; i++) this.smoke.add({ x, y, z, vx: (Math.random() - 0.5) * 8, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 8, age: 0, life: 3 + Math.random() * 2, s0: 4, s1: 16 * k, a: 0.6, c: K_0x2c2620, drag: 1, g: -0.5 });
    this.flash(x, y + 2, z, 1.5 * k);
  }
  fire(x, y, z) {
    this.glow.add({ x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2, vx: 0, vy: 3 + Math.random() * 2, vz: 0, age: 0, life: 0.7 + Math.random() * 0.4, s0: 3, s1: 0.5, a: 0.9, c: K_1__0_6__0_15, c1: K_0_8__0_15__0_02, drag: 0.5 });
    if (Math.random() < 0.4) this.smoke.add({ x, y: y + 2, z, vx: 0.5, vy: 3, vz: 0.3, age: 0, life: 4, s0: 3, s1: 12, a: 0.5, c: K_0x221d18, drag: 0.4 });
  }
  dustPuff(x, y, z, color = 0x8a7a64) {
    for (let i = 0; i < 10; i++) this.smoke.add({ x, y, z, vx: (Math.random() - 0.5) * 6, vy: Math.random() * 4, vz: (Math.random() - 0.5) * 6, age: 0, life: 1.8, s0: 2, s1: 8, a: 0.6, c: new THREE.Color(color), drag: 1.5, g: -0.2 });
  }
  addChunk(x, y, z, small) {
    if (this.chunks.length > 590) this.chunks.shift();
    this.chunks.push({ x, y, z, vx: (Math.random() - 0.5) * 12, vy: 4 + Math.random() * 9, vz: (Math.random() - 0.5) * 12, rx: Math.random() * 6, ry: Math.random() * 6, wx: (Math.random() - 0.5) * 12, wy: (Math.random() - 0.5) * 12, s: small ? 0.4 + Math.random() * 0.4 : 0.6 + Math.random() * 0.9, age: 0, life: 14 });
  }
  wake(s, t, view) {
    // bow wave + stern trail, strength ~ speed
    const sp = s.spd; if (sp < 0.8 || s.sink > 0) return;
    const L = s.stats.len, B = s.stats.beam;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const k = Math.min(1, sp / 12);
    if (Math.random() < 0.5) for (const side of [-1, 1]) {
      const x = s.x + fx * L * 0.42 + rx * side * B * 0.35, z = s.z + fz * L * 0.42 + rz * side * B * 0.35;
      this.foam.add(x, z, B * 0.4, B * (1.4 + k), 2.2 + k * 2, 0.05 * k, s.yaw, 1.8);
    }
    const sx = s.x - fx * L * 0.48, sz = s.z - fz * L * 0.48;
    if (Math.random() < 0.35) this.foam.add(sx + (Math.random() - 0.5) * B * 0.5, sz + (Math.random() - 0.5) * B * 0.5, B * 0.5, B * (1.8 + k * 1.4), 5 + k * 4, 0.03 * k, s.yaw, 1.6);
    // purchased coloured trail: a glowing ribbon of tinted foam + sparks behind the stern
    let tc = trailCol(s.look?.trail);
    if (tc) {
      if (tc === 'rainbow') { tc = (this._rb ||= new THREE.Color()).setHSL((t * 0.35 + s.x * 0.002) % 1, 1, 0.55).clone(); }
      const w = Math.min(9, Math.max(2.5, B * 0.45));
      for (let i = 0; i < 2; i++) { const bx = sx - fx * i * sp * 0.03 + (Math.random() - 0.5) * w * 0.3, bz = sz - fz * i * sp * 0.03 + (Math.random() - 0.5) * w * 0.3; this.smoke.add({ x: bx, y: heightAt(bx, bz, t) + 0.4, z: bz, vx: (Math.random() - 0.5) * 0.6, vy: 0.15, vz: (Math.random() - 0.5) * 0.6, age: 0, life: 4 + k * 3, s0: w * 0.7, s1: w * 1.5, a: 0.5, c: tc, drag: 0.5 }); }
      if (Math.random() < 0.3) this.glow.add({ x: sx + (Math.random() - 0.5) * w, y: heightAt(sx, sz, t) + 0.6, z: sz + (Math.random() - 0.5) * w, vx: -fx * sp * 0.2 + (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2.5, vz: -fz * sp * 0.2 + (Math.random() - 0.5) * 2, age: 0, life: 1.2 + Math.random(), s0: 1.2 + Math.min(1.5, B * 0.05), s1: 0.2, a: 0.45, c: tc, drag: 1.2, g: 1.5 });
    }
    if (Math.random() < k * 0.4) this.smoke.add({ x: s.x + fx * L * 0.45, y: heightAt(s.x, s.z, t) + 0.5, z: s.z + fz * L * 0.45, vx: rx * (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 2, vz: rz * (Math.random() - 0.5) * 5, age: 0, life: 0.7, s0: 1, s1: 2.5, a: 0.5, c: K_0xffffff, g: 9 });
  }
  update(dt, t, balls) {
    this.smoke.update(dt); this.glow.update(dt); this.foam.update(dt, t);
    for (const L of this.lights) { L.t -= dt; L.l.intensity = L.t > 0 ? L.l.intensity * 0.7 : 0; }
    // chunks
    const keep = [];
    let i = 0;
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const c of this.chunks) {
      c.age += dt; if (c.age > c.life) continue;
      const wh = heightAt(c.x, c.z, t);
      if (c.y > wh + 0.1) { c.vy -= 18 * dt; c.rx += c.wx * dt; c.ry += c.wy * dt; }
      else { c.vy = (wh - c.y) * 3; c.vx *= 0.96; c.vz *= 0.96; c.wx *= 0.9; c.wy *= 0.9; }
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      e.set(c.rx, c.ry, 0); q.setFromEuler(e); v.set(c.x, c.y, c.z); sc.setScalar(c.s * Math.min(1, (c.life - c.age) / 2));
      this.m4.compose(v, q, sc); this.debris.setMatrixAt(i++, this.m4);
      keep.push(c);
    }
    this.chunks = keep; this.debris.count = i; this.debris.instanceMatrix.needsUpdate = true;
    // balls
    let n = 0;
    for (const b of balls) {
      if (b.t < 0 || n >= 800) continue;
      this.m4.makeTranslation(b.x, b.y, b.z);
      this.ballMesh.setMatrixAt(n, this.m4);
      this.tmpC.set(b.ammo === 'explosive' ? 0xff5522 : b.ammo === 'chain' ? 0x555555 : b.ammo === 'grape' ? 0x8a8a70 : 0x151515);
      this.ballMesh.setColorAt(n, this.tmpC);
      n++;
      if (b.ammo === 'explosive' && Math.random() < 0.5) this.glow.add({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.3, s0: 1.4, s1: 0.2, a: 0.9, c: K_1__0_5__0_2 });
      else if (Math.random() < 0.25) this.smoke.add({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0.3, vz: 0, age: 0, life: 0.8, s0: 0.6, s1: 2, a: 0.25, c: K_0xdddddd });
    }
    this.ballMesh.count = n; this.ballMesh.instanceMatrix.needsUpdate = true;
    if (this.ballMesh.instanceColor) this.ballMesh.instanceColor.needsUpdate = true;
  }
  // floating loot crates with a glowing beacon
  syncCrates(crates, t) {
    const seen = new Set();
    for (const c of crates) {
      seen.add(c.id);
      let v = this.crates.get(c.id);
      if (!v) {
        v = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.6), new THREE.MeshStandardMaterial({ color: 0x9a6b3a, roughness: 0.8 }));
        v.add(box);
        for (let i = 0; i < (c.big ? 5 : 2); i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 10), new THREE.MeshStandardMaterial({ color: 0x7a4a24 })); b.position.set((i % 3 - 1) * 1.6, -0.1, Math.floor(i / 3) * 1.6 + 1.4); b.rotation.z = Math.PI / 2; v.add(b); }
        if (c.big) { const ch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: 0xd4a73a, metalness: 0.8, roughness: 0.3 })); ch.position.set(0, 0.4, -1.8); v.add(ch); }
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 1.2, 40, 10, 1, true), new THREE.MeshBasicMaterial({ color: c.big ? 0xffd34a : 0x9be7ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
        beam.position.y = 20; v.add(beam);
        this.scene.add(v); this.crates.set(c.id, v);
      }
      v.position.set(c.x, heightAt(c.x, c.z, t) + 0.1, c.z);
      v.rotation.set(Math.sin(t * 1.3 + c.x) * 0.15, t * 0.2, Math.cos(t * 1.1) * 0.12);
    }
    for (const [id, v] of this.crates) if (!seen.has(id)) { this.scene.remove(v); this.crates.delete(id); }
  }
}

/** Storm rain: streaks in a box that follows the camera. Each drop's position comes from a fixed seed, the
 *  time and the camera in the vertex shader, so the CPU does nothing per frame and drops stay put in the world
 *  as the camera moves through them. */
export class Rain {
  constructor(scene) {
    const N = 5000, R = 75, HH = 64;
    const seed = new Float32Array(N * 2 * 4), pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * 2 * R, y = Math.random() * HH, z = Math.random() * 2 * R, ln = 0.9 + Math.random() * 1.1;
      for (let e = 0; e < 2; e++) { const o = (i * 2 + e) * 4; seed[o] = x; seed[o + 1] = y; seed[o + 2] = z; seed[o + 3] = e * ln; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uK: { value: 0 }, uWind: { value: new THREE.Vector2(0.35, 0.15) } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 aSeed; uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; varying float vE;
        void main() {
          float x = uCam.x + mod(aSeed.x - uCam.x, ${(2 * R).toFixed(1)}) - ${R.toFixed(1)};
          float z = uCam.z + mod(aSeed.z - uCam.z, ${(2 * R).toFixed(1)}) - ${R.toFixed(1)};
          float y = uCam.y - ${(HH * 0.45).toFixed(1)} + mod(aSeed.y - uTime * 26.0, ${HH.toFixed(1)});
          vec3 p = vec3(x, y, z) + vec3(uWind.x, 1.0, uWind.y) * aSeed.w * 1.6;
          vE = aSeed.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uK; varying float vE; void main() { gl_FragColor = vec4(0.78, 0.83, 0.9, uK * (0.18 + 0.22 * clamp(vE, 0.0, 1.0))); }`,
    });
    this.mesh = new THREE.LineSegments(g, m);
    this.mesh.frustumCulled = false; this.mesh.visible = false; this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  update(k, t, cam) {
    this.uniforms.uK.value = k; this.uniforms.uTime.value = t; this.uniforms.uCam.value.copy(cam);
    this.mesh.visible = k > 0.02;
  }
}

/** A forked lightning bolt that flickers for a moment somewhere out on the horizon. */
export class Lightning {
  constructor(scene) {
    this.mat = new THREE.LineBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.LineSegments(new THREE.BufferGeometry(), this.mat);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    scene.add(this.mesh);
    this.t = 0;
  }
  strike(x, z, top = 520) {
    const pts = [];
    const fork = (x0, y0, z0, len, depth) => {
      let px = x0, py = y0, pz = z0;
      const steps = 10 + Math.floor(Math.random() * 6), dy = len / steps;
      for (let i = 0; i < steps && py > 0; i++) {
        const nx = px + (Math.random() - 0.5) * 34, ny = py - dy * (0.7 + Math.random() * 0.6), nz = pz + (Math.random() - 0.5) * 34;
        pts.push(px, py, pz, nx, Math.max(0, ny), nz);
        if (depth < 2 && Math.random() < 0.18) fork(nx, ny, nz, len * 0.45, depth + 1);
        px = nx; py = ny; pz = nz;
      }
    };
    fork(x, top, z, top, 0);
    this.mesh.geometry.dispose();
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.mesh.geometry = g;
    this.t = 0.32; this.mesh.visible = true;
  }
  update(dt) {
    if (this.t <= 0) { this.mesh.visible = false; return; }
    this.t -= dt;
    this.mat.opacity = this.t > 0.22 ? 1 : this.t > 0.14 ? 0.15 : this.t > 0.08 ? 0.9 : Math.max(0, this.t / 0.08);
  }
}

/** Seagulls wheeling over the islands nearest the camera (daytime only). One instanced mesh; a flap is just the
 *  V of the wings squashed and flipped through its vertical scale. */
export class Birds {
  constructor(scene) {
    const g = new THREE.BufferGeometry();
    // two wings meeting at the body: tips out at ±x and up a little
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, -1.25, 0.35, -0.15, 0, 0, -0.3, 0, 0, 0.35, 0, 0, -0.3, 1.25, 0.35, -0.15], 3));
    g.computeVertexNormals();
    this.N = 36;
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: 0xf2f2ee, side: THREE.DoubleSide }), this.N);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    scene.add(this.mesh);
    this.b = Array.from({ length: this.N }, (_, i) => ({ r: 30 + Math.random() * 90, h: 18 + Math.random() * 40, w: (0.12 + Math.random() * 0.18) * (Math.random() < 0.5 ? -1 : 1), ph: Math.random() * 6.28, f: 6 + Math.random() * 4, s: 1.5 + Math.random() * 0.7, isl: i % 4 }));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.sc = new THREE.Vector3();
  }
  /** `isles`: nearest few islands [{x, z, r}] ; `k` 0..1 daylight */
  update(t, isles, k, cam) {
    if (k < 0.05 || !isles.length) { this.mesh.count = 0; return; }
    let n = 0;
    for (const b of this.b) {
      const I = isles[b.isl % isles.length]; if (!I) continue;
      if (Math.hypot(I.x - cam.x, I.z - cam.z) > 1200) continue;
      const a = b.ph + t * b.w, R = I.r * 0.5 + b.r;
      this.v.set(I.x + Math.cos(a) * R, b.h + Math.sin(t * 0.3 + b.ph) * 6, I.z + Math.sin(a) * R);
      // face along the circle (tangent), banked into the turn
      this.e.set(0, -a + (b.w > 0 ? 0 : Math.PI), b.w > 0 ? 0.35 : -0.35, 'YXZ'); this.q.setFromEuler(this.e);
      const flap = Math.sin(t * b.f + b.ph);
      this.sc.set(b.s * 1.3, b.s * 1.6 * (flap > -0.2 ? flap : -0.2 + (flap + 0.2) * 0.3), b.s * 1.3);
      this.m.compose(this.v, this.q, this.sc); this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
  }
}
