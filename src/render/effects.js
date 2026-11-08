// Particles (smoke, spray, fire, ink, dust), flat foam decals (wakes, splashes), flying debris,
// cannonball meshes and floating loot crates.
import * as THREE from 'three';
import { puff } from './textures.js';
import { heightAt } from '../waves.js';

const MAXP = 6000;
const pvert = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vA; varying vec3 vC;
void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * (900.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const pfrag = `
uniform sampler2D uTex; varying float vA; varying vec3 vC;
void main(){ vec4 t = texture2D(uTex, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`;

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
    const m = new THREE.ShaderMaterial({ vertexShader: pvert, fragmentShader: pfrag, uniforms: { uTex: { value: puff() } }, transparent: true, depthWrite: false, blending });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  add(o) { if (this.p.length >= MAXP) this.p.shift(); this.p.push(o); }
  update(dt) {
    const keep = [];
    for (const q of this.p) {
      q.age += dt;
      if (q.age >= q.life) continue;
      q.vy -= (q.g ?? 0) * dt;
      const drag = Math.exp(-(q.drag ?? 1) * dt);
      q.vx *= drag; q.vy *= drag; q.vz *= drag;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      keep.push(q);
    }
    this.p = keep;
    let i = 0;
    for (const q of keep) {
      const k = q.age / q.life;
      this.pos[i * 3] = q.x; this.pos[i * 3 + 1] = q.y; this.pos[i * 3 + 2] = q.z;
      this.size[i] = q.s0 + (q.s1 - q.s0) * k;
      this.alpha[i] = q.a * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
      const c = q.c1 ? q.c.clone().lerp(q.c1, k) : q.c;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      i++;
    }
    this.geo.setDrawRange(0, i);
    for (const k of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[k].needsUpdate = true;
  }
}

/** Flat additive foam decals on the water surface. */
class Foam {
  constructor(scene) {
    const MAX = 2500;
    this.max = MAX;
    const tex = puff();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff });
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.p = [];
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.c = new THREE.Color();
  }
  add(x, z, s0, s1, life, a = 0.5, yaw = 0, stretch = 1) { if (this.p.length >= this.max) this.p.shift(); this.p.push({ x, z, s0, s1, life, age: 0, a, yaw, stretch }); }
  update(dt, t) {
    this.p = this.p.filter((q) => (q.age += dt) < q.life);
    let i = 0;
    for (const q of this.p) {
      const k = q.age / q.life, s = q.s0 + (q.s1 - q.s0) * Math.sqrt(k);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), q.yaw);
      this.m4.compose(new THREE.Vector3(q.x, heightAt(q.x, q.z, t) + 0.12, q.z), this.q, new THREE.Vector3(s, 1, s * q.stretch));
      this.mesh.setMatrixAt(i, this.m4);
      const a = q.a * (1 - k) * (k < 0.08 ? k / 0.08 : 1);
      this.c.setRGB(a, a, a); this.mesh.setColorAt(i, this.c);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.smoke = new PointPool(scene, THREE.NormalBlending);
    this.glow = new PointPool(scene, THREE.AdditiveBlending);
    this.foam = new Foam(scene);
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
  flash(x, y, z, k = 1) {
    const L = this.lights.reduce((a, b) => (a.t < b.t ? a : b));
    L.l.position.set(x, y, z); L.l.intensity = 2500 * k; L.t = 0.12;
  }
  muzzle(x, y, z, dx, dz, n = 1) {
    const C1 = new THREE.Color(0xeeeeee), C2 = new THREE.Color(0x9a9a9a);
    for (let i = 0; i < 14; i++) {
      const sp = 2 + Math.random() * 14;
      this.smoke.add({ x, y, z, vx: dx * sp + (Math.random() - 0.5) * 2.5, vy: Math.random() * 2 + 0.4, vz: dz * sp + (Math.random() - 0.5) * 2.5, age: 0, life: 3 + Math.random() * 3.5, s0: 3, s1: 14 + Math.random() * 8, a: 0.7, c: C1, c1: C2, drag: 1.1, g: -0.35 });
    }
    for (let i = 0; i < 4; i++) this.glow.add({ x, y, z, vx: dx * (8 + Math.random() * 10), vy: Math.random(), vz: dz * (8 + Math.random() * 10), age: 0, life: 0.18, s0: 3, s1: 1, a: 1, c: new THREE.Color(1, 0.65, 0.25), drag: 3 });
    if (n) this.flash(x + dx * 2, y, z + dz * 2, 0.6);
  }
  splash(x, z, big = 1, t = 0) {
    const y = heightAt(x, z, t);
    const W = new THREE.Color(0xf4fbff);
    for (let i = 0; i < 18 * big; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.2;
      this.smoke.add({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, vx: Math.cos(a) * (1 + Math.random() * 3), vy: 6 + Math.random() * 9 * big, vz: Math.sin(a) * (1 + Math.random() * 3), age: 0, life: 0.9 + Math.random() * 0.6, s0: 1.2, s1: 3.2, a: 0.85, c: W, g: 14, drag: 0.6 });
    }
    this.foam.add(x, z, 2, 9 * big, 4, 0.7);
  }
  hit(x, y, z, rig, ammo) {
    const n = rig ? 6 : 14;
    for (let i = 0; i < n; i++) this.addChunk(x, y, z, rig);
    const dark = new THREE.Color(0x4a4038);
    for (let i = 0; i < 6; i++) this.smoke.add({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, age: 0, life: 1.5 + Math.random(), s0: 1.5, s1: 6, a: 0.6, c: dark, drag: 1.2, g: -0.6 });
    if (ammo === 'explosive') this.explosion(x, y, z, 0.8);
    else for (let i = 0; i < 6; i++) this.glow.add({ x, y, z, vx: (Math.random() - 0.5) * 14, vy: Math.random() * 8, vz: (Math.random() - 0.5) * 14, age: 0, life: 0.35, s0: 0.8, s1: 0.2, a: 1, c: new THREE.Color(1, 0.7, 0.3), g: 9 });
  }
  explosion(x, y, z, k = 1) {
    for (let i = 0; i < 26 * k; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = 6 + Math.random() * 16;
      this.glow.add({ x, y, z, vx: Math.cos(a) * Math.cos(e) * sp, vy: Math.sin(e) * sp, vz: Math.sin(a) * Math.cos(e) * sp, age: 0, life: 0.5 + Math.random() * 0.4, s0: 5 * k, s1: 1, a: 1, c: new THREE.Color(1, 0.75, 0.3), c1: new THREE.Color(0.9, 0.2, 0.05), drag: 2.5 });
    }
    for (let i = 0; i < 14 * k; i++) this.smoke.add({ x, y, z, vx: (Math.random() - 0.5) * 8, vy: 2 + Math.random() * 5, vz: (Math.random() - 0.5) * 8, age: 0, life: 3 + Math.random() * 2, s0: 4, s1: 16 * k, a: 0.6, c: new THREE.Color(0x2c2620), drag: 1, g: -0.5 });
    this.flash(x, y + 2, z, 1.5 * k);
  }
  fire(x, y, z) {
    this.glow.add({ x: x + (Math.random() - 0.5) * 2, y, z: z + (Math.random() - 0.5) * 2, vx: 0, vy: 3 + Math.random() * 2, vz: 0, age: 0, life: 0.7 + Math.random() * 0.4, s0: 3, s1: 0.5, a: 0.9, c: new THREE.Color(1, 0.6, 0.15), c1: new THREE.Color(0.8, 0.15, 0.02), drag: 0.5 });
    if (Math.random() < 0.4) this.smoke.add({ x, y: y + 2, z, vx: 0.5, vy: 3, vz: 0.3, age: 0, life: 4, s0: 3, s1: 12, a: 0.5, c: new THREE.Color(0x221d18), drag: 0.4 });
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
    if (Math.random() < k * 0.4) this.smoke.add({ x: s.x + fx * L * 0.45, y: heightAt(s.x, s.z, t) + 0.5, z: s.z + fz * L * 0.45, vx: rx * (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 2, vz: rz * (Math.random() - 0.5) * 5, age: 0, life: 0.7, s0: 1, s1: 2.5, a: 0.5, c: new THREE.Color(0xffffff), g: 9 });
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
      if (b.ammo === 'explosive' && Math.random() < 0.5) this.glow.add({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0, vz: 0, age: 0, life: 0.3, s0: 1.4, s1: 0.2, a: 0.9, c: new THREE.Color(1, 0.5, 0.2) });
      else if (Math.random() < 0.25) this.smoke.add({ x: b.x, y: b.y, z: b.z, vx: 0, vy: 0.3, vz: 0, age: 0, life: 0.8, s0: 0.6, s1: 2, a: 0.25, c: new THREE.Color(0xdddddd) });
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
