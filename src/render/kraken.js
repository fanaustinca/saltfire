// The Kraken: a mottled head breaching the surface and eight sucker-lined tentacles that rise
// around its prey and slam down. Tentacle tubes are rebuilt each frame from animated spines.
import * as THREE from 'three';
import { heightAt } from '../waves.js';

function skinTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7a1f3a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${40 + Math.random() * 60},${10 + Math.random() * 20},${30 + Math.random() * 40},${0.25 + Math.random() * 0.35})`; g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 9, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class KrakenView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    const skin = skinTex();
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: skin, roughness: 0.45, metalness: 0.05, emissive: 0x220010, emissiveIntensity: 0.3 });
    this.under = new THREE.MeshStandardMaterial({ color: 0xf0c0a8, roughness: 0.6 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(13, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), this.mat);
    head.scale.set(1, 1.5, 1.1);
    this.head = head;
    this.group.add(head);
    const eyeW = new THREE.MeshStandardMaterial({ color: 0xfff4c0, emissive: 0xffd040, emissiveIntensity: 0.8, roughness: 0.2 });
    const pupil = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(2.6, 16, 12), eyeW); e.position.set(s * 7.5, 4, 9); head.add(e);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.2, 0.6), pupil); p.position.set(s * 7.9, 4, 11.4); head.add(p);
    }
    this.tents = [];
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      const suckers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 4), this.under, 14);
      this.group.add(suckers);
      this.tents.push({ mesh, suckers });
    }
    this.group.visible = false;
    scene.add(this.group);
    this.m4 = new THREE.Matrix4();
  }
  update(k, t) {
    if (!k) { this.group.visible = false; return; }
    this.group.visible = true;
    const dead = k.hp <= 0 ? (k.dead || 0) : 0;
    const wh = heightAt(k.x, k.z, t);
    this.group.position.set(k.x, 0, k.z);
    const surf = Math.max(...k.tentacles.map((x) => x.up));
    this.head.position.y = wh - 12 + surf * 9 - dead * 3;
    this.head.rotation.y = Math.sin(t * 0.3) * 0.3;
    k.tentacles.forEach((tn, i) => {
      const a = tn.a + (k.t || t) * 0.15;
      const base = new THREE.Vector3(Math.cos(a) * 30, wh - 2, Math.sin(a) * 30);
      const up = Math.max(0.02, tn.up - dead * 0.2);
      const H = 26 * up;
      const pts = [];
      const slam = tn.slam || 0;
      for (let j = 0; j <= 10; j++) {
        const f = j / 10;
        const curl = Math.sin(t * 1.6 + i * 1.3 + f * 3) * 4 * f;
        // arc inward toward the centre, slamming down when tn.slam > 0
        const inward = f * f * (8 + slam * 22);
        const y = base.y + Math.sin(f * Math.PI * (0.9 - slam * 0.5)) * H * (1 - slam * 0.6) + f * H * 0.25 * (1 - slam);
        pts.push(new THREE.Vector3(base.x - Math.cos(a) * inward + Math.cos(a + 1.57) * curl, y, base.z - Math.sin(a) * inward + Math.sin(a + 1.57) * curl));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const T = this.tents[i];
      T.mesh.geometry.dispose();
      const tube = new THREE.TubeGeometry(curve, 28, 1, 8, false);
      // taper radius along the length
      const p = tube.attributes.position, n = tube.attributes.normal;
      for (let v = 0; v < p.count; v++) {
        const seg = Math.floor(v / 9) / 28;
        const r = 2.4 * (1 - seg) + 0.25;
        const c = curve.getPointAt(Math.min(1, seg));
        p.setXYZ(v, c.x + n.getX(v) * r, c.y + n.getY(v) * r, c.z + n.getZ(v) * r);
      }
      tube.computeVertexNormals();
      T.mesh.geometry = tube;
      for (let s = 0; s < 14; s++) {
        const f = 0.08 + (s / 14) * 0.85;
        const c = curve.getPointAt(f);
        this.m4.makeTranslation(c.x, c.y - (2.2 * (1 - f) + 0.2), c.z);
        T.suckers.setMatrixAt(s, this.m4);
      }
      T.suckers.instanceMatrix.needsUpdate = true;
    });
  }
}
