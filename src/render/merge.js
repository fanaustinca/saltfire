// Static batching: collapse a group's many small meshes into one mesh per material (+ LOD class + shadow flags).
// Bases are built from hundreds of primitives (palisade logs, crenellations, beams…); drawn one by one they cost
// thousands of draw calls. Batched, a whole island costs a few dozen.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const NOOP = THREE.Object3D.prototype.onBeforeRender;
const tmp = new THREE.Matrix4();

/** Bake every plain mesh under `root` into merged meshes (in `root`'s local frame). Instanced meshes, meshes with
 *  onBeforeRender hooks, multi-material meshes and anything `keep(o)` returns true for are left untouched. */
export function mergeStatic(root, keep = null) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material) || o.onBeforeRender !== NOOP) return;
    if (o.morphTargetInfluences || (keep && keep(o))) return;
    if (o.geometry.attributes.position.count > 6000) return; // terrain etc. is already one draw; don't copy it
    // anything hidden (or under a hidden parent) keeps its own visibility switch
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return;
    const key = `${o.material.uuid}|${o.userData.lod || 0}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat: o.material, lod: o.userData.lod || 0, cs: o.castShadow, rs: o.receiveShadow, geos: [] }));
    tmp.multiplyMatrices(inv, o.matrixWorld);
    b.geos.push(bake(o.geometry, tmp, !!o.material.vertexColors));
    victims.push(o);
  });
  let made = 0;
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos, false);
    b.geos.forEach((g) => g.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, b.mat);
    m.castShadow = b.cs; m.receiveShadow = b.rs;
    if (b.lod) m.userData.lod = b.lod;
    m.matrixAutoUpdate = false;
    root.add(m);
    made++;
  }
  if (!made) return root;
  for (const o of victims) {
    o.parent.remove(o);
    if (!o.geometry.userData.shared) o.geometry.dispose();
  }
  // prune groups left empty
  const empty = [];
  root.traverse((o) => { if (o !== root && !o.isMesh && !o.isLine && !o.isPoints && !o.isLight && o.children.length === 0 && o.type === 'Group') empty.push(o); });
  for (const o of empty) o.parent?.remove(o);
  return root;
}

/** Copy of `g` transformed by `m`, indexed, with exactly position/normal/uv (+color when the material uses it). */
function bake(g, m, wantColor) {
  const geo = new THREE.BufferGeometry();
  const src = g.attributes, n = src.position.count;
  geo.setAttribute('position', src.position.clone());
  if (src.normal) geo.setAttribute('normal', src.normal.clone());
  geo.setAttribute('uv', src.uv && src.uv.itemSize === 2 ? src.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (wantColor) {
    const c = src.color;
    if (!c) geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    else if (c.itemSize !== 3 || c.normalized || !(c.array instanceof Float32Array)) {
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
    } else geo.setAttribute('color', c.clone());
  }
  let idx;
  if (g.index) idx = Uint32Array.from(g.index.array);
  else { idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; }
  // honour draw ranges / groups by keeping only the drawn part of the index
  const start = g.drawRange.start, cnt = Math.min(idx.length - start, g.drawRange.count);
  if (start > 0 || cnt < idx.length) idx = idx.slice(start, start + cnt);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.applyMatrix4(m);
  // a mirrored transform flips the winding; swap two corners of every triangle to keep faces pointing out
  if (m.determinant() < 0) for (let t = 0; t + 2 < idx.length; t += 3) { const v = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = v; }
  return geo;
}

/** Free a dropped group's GPU buffers (shared, cached geometries are left alone). */
export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    else if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  });
}
