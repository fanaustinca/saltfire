// Festival + collector ships: the extra set-dressing that makes each one unmistakable.
//  Harvest Moon (Thanksgiving): pumpkins on the rails, wheat sheaves, autumn-leaf garlands in the rigging, a
//      cornucopia figurehead spilling fruit, a carved turkey-tail fan over the stern and glowing harvest moons.
//  Yuletide (Christmas): snow on the rails and yards, icicles, twinkling fairy lights strung through the rig,
//      a decorated tree on the forecastle, presents, wreaths, candy-cane masts and a great star on the main.
//  Stroke of Midnight (New Year): a gilt clock tower over the stern that keeps real local time, a spinning
//      mirror ball at the main truck, gold-and-silver bunting, firework mortars (game.js lights them).
//  The Collector's Ark (International Games Month): a floating museum — a slowly turning carousel of glass
//      display cases, each holding a miniature of a game, round a hologram, under a scrolling marquee.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sheer, deckY, hullX } from '../layout.js';

const V3 = THREE.Vector3;
export const FESTIVE = ['harvest', 'yule', 'midnight', 'collector'];
export const isFestive = (id) => FESTIVE.includes(id);

// ------------------------------------------------------------------ helpers
function place(g, pos, rot = null, scale = null) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0])));
  m.compose(new V3(...pos), q, new V3(...(scale || [1, 1, 1])));
  g.applyMatrix4(m);
  return g;
}
const box = (w, h, d, pos, rot, sc) => place(new THREE.BoxGeometry(w, h, d), pos, rot, sc);
const cyl = (r0, r1, h, seg = 10, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
const sph = (r, pos, sc = null, ws = 12, hs = 8) => place(new THREE.SphereGeometry(r, ws, hs), pos, null, sc);
function span(a, b, r0, r1 = r0, seg = 6) {
  const d = new V3().subVectors(b, a), L = d.length();
  const g = cyl(r0, r1, L, seg); g.translate(0, L / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new V3(0, 1, 0), d.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}
const TMPC = new THREE.Color();
/** Non-indexed copy with exactly position/normal/uv/color so anything merges with anything. */
function paint(g, hex) {
  if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  TMPC.set(hex);
  const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = TMPC.r; c[i * 3 + 1] = TMPC.g; c[i * 3 + 2] = TMPC.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return g;
}
function plain(g) {
  if (g.index) { const n = g.toNonIndexed(); g.dispose(); g = n; }
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
function meshOf(list, mat, shadow = false) {
  if (!list.length) return null;
  const g = mergeGeometries(list); list.forEach((x) => x.dispose());
  const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = !mat.transparent;
  return m;
}
/** Points along a sagging line from a to b (rigging garlands, light strings). */
function sagPoints(a, b, n, sag) {
  const out = [];
  for (let k = 1; k < n; k++) { const t = k / n, p = new V3().lerpVectors(a, b, t); p.y -= Math.sin(Math.PI * t) * sag; out.push(p); }
  return out;
}

// ------------------------------------------------------------------ shared materials + textures
let MT = null, glowK = 0;
/** Night (0..1) makes the fairy lights, bulbs, beams and clock face burn brighter. */
export function setFestiveGlow(k) { glowK = k; }
function canvasTex(w, h, draw) {
  // Draw on a 2D canvas, then copy the pixels out into a DataTexture straight away: a detached canvas can be reset
  // by the browser before the texture's first upload (it then uploads blank), a pixel copy can't.
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  draw(g, w, h);
  const src = g.getImageData(0, 0, w, h).data, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4); // canvas rows run top-down
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
const TW = ['#ff3b3b', '#3bff6a', '#ffd23b', '#3bb4ff'];
function mats() {
  if (MT) return MT;
  const em = (c, k = 1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.4 });
  MT = {
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide }),
    vcMetal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.75 }),
    vcGlow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    ice: new THREE.MeshStandardMaterial({ color: 0xd8f3ff, transparent: true, opacity: 0.8, roughness: 0.08, metalness: 0.2, emissive: 0x5a9ac0, emissiveIntensity: 0.35 }),
    snow: new THREE.MeshStandardMaterial({ color: 0xf6faff, roughness: 0.9, emissive: 0x9ab4d0, emissiveIntensity: 0.12 }),
    vitrine: new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.15, roughness: 0.04, metalness: 0.4, depthWrite: false }),
    twinkle: TW.map((c) => em(c, 2)),
    bulbA: em('#ffe9a8', 2.2), bulbB: em('#ffe9a8', 0.25),
    moon: em('#ffb04a', 1.6),
    star: em('#ffd84a', 2.4),
    beam: new THREE.MeshBasicMaterial({ color: 0xfff1c8, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    holo: new THREE.MeshBasicMaterial({ color: 0x5ff6ff, wireframe: true, transparent: true, opacity: 0.85 }),
    holoCore: new THREE.MeshBasicMaterial({ color: 0x9ffcff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 1, roughness: 0.12, flatShading: true, emissive: 0x30303c }),
  };
  MT.clock = new THREE.MeshStandardMaterial({ map: clockTex(), emissive: 0xffffff, emissiveMap: clockTex(), emissiveIntensity: 0.35, roughness: 0.5 });
  MT.hand = new THREE.MeshStandardMaterial({ color: 0x15100a, roughness: 0.4, metalness: 0.6 });
  const mq = marqueeTex(); MT.marquee = new THREE.MeshBasicMaterial({ map: mq, side: THREE.FrontSide });
  MT.plaque = new THREE.MeshBasicMaterial({ map: plaqueTex() });
  return MT;
}
let CLOCK = null;
function clockTex() {
  return (CLOCK ||= canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    const gr = g.createRadialGradient(c, c, 20, c, c, c); gr.addColorStop(0, '#fffbe9'); gr.addColorStop(1, '#efe0b4');
    g.fillStyle = gr; g.beginPath(); g.arc(c, c, c - 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#b8892a'; g.lineWidth = 22; g.beginPath(); g.arc(c, c, c - 14, 0, Math.PI * 2); g.stroke();
    const R = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    g.fillStyle = '#20160a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = 'bold 54px Georgia, serif';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.save(); g.translate(c + Math.sin(a) * (c - 86), c - Math.cos(a) * (c - 86)); g.rotate(a); g.fillText(R[i], 0, 0); g.restore(); }
    for (let i = 0; i < 60; i++) { const a = (i / 60) * Math.PI * 2, r0 = c - 40, r1 = c - (i % 5 ? 50 : 60); g.lineWidth = i % 5 ? 3 : 7; g.strokeStyle = '#20160a'; g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); g.stroke(); }
    g.font = 'italic bold 30px Georgia, serif'; g.fillStyle = '#9a6c12'; g.fillText('Happy New Year', c, c + 110);
  }));
}
const MARQUEE = "★  THE COLLECTOR'S ARK  ★  HALL OF GAMES  ★  INTERNATIONAL GAMES MONTH  ★  ";
function marqueeTex() {
  const t = canvasTex(2048, 128, (g, w, h) => {
    g.fillStyle = '#1a0f2e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd34d'; g.fillRect(0, 0, w, 8); g.fillRect(0, h - 8, w, 8);
    for (let x = 12; x < w; x += 32) { g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(x, 4, 4, 0, 7); g.arc(x, h - 4, 4, 0, 7); g.fill(); }
    g.font = 'bold 66px "Trebuchet MS", sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#ffe27a';
    g.shadowColor = '#ff8a00'; g.shadowBlur = 18;
    const tw = g.measureText(MARQUEE).width; for (let x = 0; x < w; x += tw) g.fillText(MARQUEE, x, h / 2 + 3);
  });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(2, 1);
  return t;
}
/** The twelve exhibits: [plaque, builder]. Each miniature is built ~2.2 m across, base at y = 0, facing +z. */
export const EXHIBITS = ['SALTFIRE', 'BLACKSITE', 'IRONCROWN', 'STARHOPPER', 'CARTASTROPHE', 'PANIC ON THE PLATES', 'BEEP BOP BAND', 'SHATTERED CROWN', 'TABOVERLOAD', 'VERTEX FORGE', 'BIOBUZZ', 'UNBOUND'];
function plaqueTex() {
  return canvasTex(2048, 512, (g) => {
    EXHIBITS.forEach((name, i) => {
      const x = (i % 4) * 512, y = Math.floor(i / 4) * 128;
      g.fillStyle = '#20140a'; g.fillRect(x, y, 512, 128);
      g.strokeStyle = '#e0b34a'; g.lineWidth = 10; g.strokeRect(x + 8, y + 8, 496, 112);
      g.fillStyle = '#ffdf86'; g.textAlign = 'center'; g.textBaseline = 'middle';
      let fs = 60; g.font = `bold ${fs}px Georgia, serif`; while (g.measureText(name).width > 460 && fs > 20) { fs -= 2; g.font = `bold ${fs}px Georgia, serif`; }
      g.fillText(name, x + 256, y + 66);
    });
  });
}
// sail decals (drawn over the canvas in sail UV space)
const DECALS = {};
export function festiveDecal(id) {
  if (!isFestive(id)) return null;
  if (DECALS[id]) return DECALS[id];
  const star = (g, x, y, r, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fill(); };
  const t = canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    if (id === 'harvest') {
      // a great maple leaf in deep russet, with an inner vein pattern
      const P = [[0, -200], [38, -112], [96, -142], [82, -48], [176, -84], [150, -12], [196, 20], [96, 64], [112, 132], [22, 96], [8, 196], [-8, 196], [-22, 96], [-112, 132], [-96, 64], [-196, 20], [-150, -12], [-176, -84], [-82, -48], [-96, -142], [-38, -112]];
      g.fillStyle = 'rgba(132,26,14,0.9)'; g.beginPath(); P.forEach(([x, y]) => g.lineTo(c + x, c + y)); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,196,90,0.75)'; g.lineWidth = 6; for (const [x, y] of [[0, -170], [150, -60], [-150, -60], [90, 110], [-90, 110]]) { g.beginPath(); g.moveTo(c, c + 60); g.lineTo(c + x * 0.85, c + y * 0.85); g.stroke(); }
      g.fillStyle = 'rgba(120,40,10,0.8)'; g.fillRect(0, 0, w, 14); g.fillRect(0, w - 14, w, 14);
    } else if (id === 'yule') {
      g.strokeStyle = 'rgba(70,150,230,0.92)'; g.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        g.save(); g.translate(c, c); g.rotate((i / 6) * Math.PI * 2);
        g.lineWidth = 16; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -190); g.stroke();
        g.lineWidth = 10; for (const [y, l] of [[-70, 50], [-120, 44], [-160, 30]]) { g.beginPath(); g.moveTo(0, y); g.lineTo(-l, y - l); g.moveTo(0, y); g.lineTo(l, y - l); g.stroke(); }
        g.restore();
      }
      g.fillStyle = 'rgba(70,150,230,0.92)'; g.beginPath(); g.arc(c, c, 26, 0, 7); g.fill();
      for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(200,24,40,0.95)'; g.fillRect(x, 0, 32, 18); g.fillRect(x + 32, w - 18, 32, 18); g.fillStyle = 'rgba(255,255,255,0.95)'; g.fillRect(x + 32, 0, 32, 18); g.fillRect(x, w - 18, 32, 18); }
    } else if (id === 'midnight') {
      let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 46; i++) star(g, r() * w, r() * w, 6 + r() * 12, `rgba(255,${200 + Math.floor(r() * 40)},90,0.95)`);
      g.fillStyle = 'rgba(255,214,110,0.95)'; g.beginPath(); g.arc(c, c, 96, 0, 7); g.fill();
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(c + 44, c - 26, 86, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
      star(g, c + 40, c + 6, 26, 'rgba(255,240,170,1)');
      g.fillStyle = 'rgba(240,190,70,0.95)'; g.fillRect(0, 0, w, 10); g.fillRect(0, w - 10, w, 10);
    } else {
      // a gilt gamepad emblem ringed with stars
      g.fillStyle = 'rgba(255,205,70,0.95)';
      const rr = (x, y, ww, hh, rad) => { g.beginPath(); g.moveTo(x + rad, y); g.arcTo(x + ww, y, x + ww, y + hh, rad); g.arcTo(x + ww, y + hh, x, y + hh, rad); g.arcTo(x, y + hh, x, y, rad); g.arcTo(x, y, x + ww, y, rad); g.fill(); };
      rr(c - 150, c - 62, 300, 124, 60); g.beginPath(); g.arc(c - 104, c + 50, 58, 0, 7); g.arc(c + 104, c + 50, 58, 0, 7); g.fill();
      g.fillStyle = 'rgba(60,24,96,0.95)'; g.fillRect(c - 122, c - 12, 64, 22); g.fillRect(c - 101, c - 33, 22, 64);
      for (const [x, y] of [[96, -18], [124, 6], [96, 30], [68, 6]]) { g.beginPath(); g.arc(c + x, c + y, 12, 0, 7); g.fill(); }
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; star(g, c + Math.cos(a) * 200, c + Math.sin(a) * 200, 18, 'rgba(255,225,120,0.95)'); }
    }
  });
  return (DECALS[id] = t);
}

// ------------------------------------------------------------------ miniatures (the Collector's exhibits)
// o.vc(geo, colour) solid painted part, o.glow(geo, colour) unlit glowing part, o.glass(geo) clear part
const MINI = {
  SALTFIRE(o) { // a ship in a bottle
    for (const z of [-0.55, 0.55]) o.vc(box(0.9, 0.34, 0.16, [0, 0.17, z]), '#6b4423');
    const b = cyl(0.42, 0.42, 1.6, 20); b.rotateX(Math.PI / 2); o.glass(place(b, [0, 0.76, -0.1]));
    const sh = cyl(0.42, 0.15, 0.32, 16); sh.rotateX(Math.PI / 2); o.glass(place(sh, [0, 0.76, 0.86]));
    const nk = cyl(0.15, 0.15, 0.3, 12); nk.rotateX(Math.PI / 2); o.glass(place(nk, [0, 0.76, 1.17]));
    const ck = cyl(0.14, 0.13, 0.18, 10); ck.rotateX(Math.PI / 2); o.vc(place(ck, [0, 0.76, 1.38]), '#b58b5a');
    o.vc(box(0.62, 0.1, 1.5, [0, 0.5, -0.1]), '#2b6f9e');
    o.vc(place(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), [0, 0.64, -0.1], null, [0.16, 0.13, 0.6]), '#5a3a22');
    for (const z of [-0.36, 0.1]) {
      o.vc(box(0.03, 0.6, 0.03, [0, 0.92, z]), '#3b2614');
      o.vc(box(0.34, 0.17, 0.012, [0, 0.83, z + 0.03]), '#f2ead6'); o.vc(box(0.26, 0.14, 0.012, [0, 1.03, z + 0.03]), '#f2ead6');
    }
    o.vc(box(0.012, 0.07, 0.1, [0, 1.2, 0.15]), '#c62828');
  },
  BLACKSITE(o) { // a concrete bunker under red alert
    o.vc(box(2, 0.1, 2, [0, 0.05, 0]), '#34372f');
    o.vc(box(1.5, 0.8, 1.1, [0, 0.5, -0.15]), '#6d6f6a'); o.vc(box(1.62, 0.2, 1.3, [0, 0.96, -0.15], [0.12, 0, 0]), '#55574f');
    o.vc(box(0.62, 0.56, 0.05, [0, 0.38, 0.42]), '#24262a');
    for (let i = 0; i < 7; i++) o.vc(box(0.1, 0.08, 0.04, [-0.3 + i * 0.1, 0.71, 0.43]), i % 2 ? '#111' : '#f2c200');
    o.glow(box(0.5, 0.06, 0.02, [0, 0.84, 0.42]), '#3cff6a');
    for (const x of [-0.5, 0.5]) o.glow(sph(0.07, [x, 0.78, 0.44]), '#ff1a1a');
    o.vc(box(0.03, 0.75, 0.03, [0.56, 1.35, -0.4]), '#222'); o.glow(sph(0.05, [0.56, 1.74, -0.4]), '#ff2a2a');
    o.vc(box(0.3, 0.3, 0.3, [-0.72, 0.25, 0.62]), '#7a6a3a'); o.vc(box(0.24, 0.22, 0.24, [-0.68, 0.51, 0.6], [0, 0.4, 0]), '#6d5e33');
    o.vc(place(cyl(0.14, 0.14, 0.4, 12), [0.74, 0.3, 0.62]), '#a33232');
    for (let i = 0; i < 4; i++) o.vc(sph(0.13, [-0.6 + i * 0.22, 0.17, 0.85], [1.3, 0.55, 0.8]), '#9a8a62');
  },
  IRONCROWN(o) { // a hex map with a castle and a floating crown
    const cols = ['#6aa84f', '#3d85c6', '#c9b27c', '#6aa84f', '#38761d', '#8d8d8d', '#6aa84f'];
    const hs = [0.26, 0.14, 0.2, 0.24, 0.28, 0.34, 0.22];
    for (let k = 0; k < 7; k++) {
      const a = (k - 1) * (Math.PI / 3) + Math.PI / 6, r = k ? 0.74 : 0, x = Math.sin(a) * r, z = Math.cos(a) * r;
      o.vc(place(cyl(0.42, 0.42, hs[k], 6), [x, hs[k] / 2, z]), cols[k]);
      if (cols[k] === '#38761d') for (const [dx, dz] of [[-0.12, 0], [0.12, 0.06], [0, -0.14]]) o.vc(place(new THREE.ConeGeometry(0.1, 0.3, 7), [x + dx, hs[k] + 0.15, z + dz]), '#1f5214');
      if (cols[k] === '#8d8d8d') { o.vc(place(new THREE.ConeGeometry(0.3, 0.5, 7), [x, hs[k] + 0.25, z]), '#7a7a7a'); o.vc(place(new THREE.ConeGeometry(0.11, 0.16, 7), [x, hs[k] + 0.43, z]), '#f4f4f4'); }
    }
    const y = hs[0];
    o.vc(box(0.42, 0.28, 0.42, [0, y + 0.14, 0]), '#b7b0a0');
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { o.vc(place(cyl(0.07, 0.07, 0.46, 8), [dx * 0.21, y + 0.23, dz * 0.21]), '#a8a191'); o.vc(place(new THREE.ConeGeometry(0.09, 0.18, 8), [dx * 0.21, y + 0.55, dz * 0.21]), '#a3302a'); }
    o.vc(place(cyl(0.12, 0.12, 0.6, 10), [0, y + 0.4, 0]), '#c2bba9'); o.vc(place(new THREE.ConeGeometry(0.15, 0.26, 10), [0, y + 0.83, 0]), '#2a4d8f');
    o.vc(place(cyl(0.3, 0.3, 0.16, 18, true), [0, 1.62, 0]), '#f2c037');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; o.vc(place(new THREE.ConeGeometry(0.06, 0.16, 6), [Math.sin(a) * 0.3, 1.78, Math.cos(a) * 0.3]), '#f2c037'); o.glow(sph(0.035, [Math.sin(a) * 0.31, 1.62, Math.cos(a) * 0.31]), i % 2 ? '#e0182e' : '#2fa8ff'); }
  },
  STARHOPPER(o) { // a ringed planet, floating platforms and a hero mid-jump
    o.vc(place(cyl(0.95, 0.95, 0.08, 24), [0, 0.04, 0]), '#1b1f3a');
    o.glass(place(cyl(0.03, 0.03, 0.7, 6), [-0.35, 0.4, -0.25]));
    o.vc(sph(0.42, [-0.35, 1.0, -0.25], null, 18, 12), '#3fa7d6');
    o.vc(place(new THREE.TorusGeometry(0.66, 0.045, 6, 32), [-0.35, 1.0, -0.25], [Math.PI / 2 - 0.45, 0, 0.35]), '#e7c46a');
    for (const [x, y, z] of [[0.35, 0.36, 0.45], [0.62, 0.72, 0.05], [0.25, 1.08, -0.3]]) { o.vc(box(0.42, 0.1, 0.28, [x, y, z]), '#8d5a3b'); o.vc(box(0.44, 0.04, 0.3, [x, y + 0.07, z]), '#6cc04a'); o.glass(place(cyl(0.02, 0.02, y, 5), [x, y / 2, z])); }
    o.vc(place(cyl(0.07, 0.08, 0.18, 10), [0.55, 1.0, 0.18]), '#ff7043'); o.vc(sph(0.08, [0.55, 1.16, 0.18]), '#f5f5f5'); o.glow(box(0.1, 0.04, 0.02, [0.55, 1.17, 0.26]), '#40e0ff');
    for (const [x, y, z] of [[0.7, 1.5, 0.3], [-0.7, 1.6, 0.4], [0.1, 1.75, 0.5], [-0.1, 0.55, 0.6], [0.8, 0.3, -0.5]]) o.glow(place(new THREE.OctahedronGeometry(0.06), [x, y, z]), '#fff6a0');
    const sg = new THREE.ExtrudeGeometry(starShape(0.2), { depth: 0.06, bevelEnabled: false }); o.glow(place(sg, [0.25, 1.55, 0.05], [0, 0.3, 0]), '#ffd84a');
  },
  CARTASTROPHE(o) { // a racing shopping cart on a chequered track
    o.vc(box(2, 0.05, 0.9, [0, 0.025, 0.1]), '#2e2e33');
    for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) o.vc(box(0.11, 0.012, 0.11, [0.62 + j * 0.11, 0.055, -0.28 + i * 0.11]), (i + j) % 2 ? '#111' : '#f4f4f4');
    for (let i = 0; i < 4; i++) o.vc(box(0.22, 0.012, 0.04, [-0.8 + i * 0.4, 0.055, 0.1]), '#f2d22e');
    const W = '#c3c8ce', r = 0.022, c = new V3(-0.1, 0, 0.1);
    const b = [[-0.36, 0.34, -0.22], [0.36, 0.34, -0.22], [0.36, 0.34, 0.22], [-0.36, 0.34, 0.22]].map(([x, y, z]) => new V3(x, y, z).add(c));
    const t = [[-0.46, 0.78, -0.28], [0.46, 0.78, -0.28], [0.46, 0.78, 0.28], [-0.46, 0.78, 0.28]].map(([x, y, z]) => new V3(x, y, z).add(c));
    for (let i = 0; i < 4; i++) { o.vc(span(b[i], b[(i + 1) % 4], r), W); o.vc(span(t[i], t[(i + 1) % 4], r), W); o.vc(span(b[i], t[i], r), W); }
    for (let k = 1; k < 5; k++) { const f = k / 5; for (const [i, j] of [[0, 1], [3, 2]]) o.vc(span(new V3().lerpVectors(b[i], b[j], f), new V3().lerpVectors(t[i], t[j], f), r * 0.7), W); }
    for (const f of [0.33, 0.66]) for (let i = 0; i < 4; i++) o.vc(span(new V3().lerpVectors(b[i], t[i], f), new V3().lerpVectors(b[(i + 1) % 4], t[(i + 1) % 4], f), r * 0.7), W);
    const h0 = t[0].clone().add(new V3(-0.14, 0.14, 0)), h1 = t[3].clone().add(new V3(-0.14, 0.14, 0));
    o.vc(span(t[0], h0, r), W); o.vc(span(t[3], h1, r), W); o.vc(span(h0, h1, 0.04, 0.04, 8), '#d32f2f');
    for (const p of b) { o.vc(span(p, p.clone().setY(0.14), r), W); const wh = cyl(0.08, 0.08, 0.05, 12); wh.rotateX(Math.PI / 2); o.vc(place(wh, [p.x, 0.1, p.z]), '#1c1c1c'); }
    o.vc(box(0.2, 0.26, 0.14, [-0.2, 0.5, 0.06]), '#ffb300'); o.vc(box(0.16, 0.2, 0.2, [0.05, 0.47, 0.18]), '#43a047'); o.vc(sph(0.08, [0.1, 0.48, 0]), '#e53935');
    for (let i = 0; i < 3; i++) o.glow(box(0.3, 0.015, 0.015, [0.55 + i * 0.05, 0.45 + i * 0.12, 0.1]), '#ffffff');
  },
  'PANIC ON THE PLATES'(o) { // a kitchen in full panic: stove ablaze, plates toppling
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) o.vc(box(0.5, 0.05, 0.5, [-0.75 + i * 0.5, 0.025, -0.75 + j * 0.5]), (i + j) % 2 ? '#e9e9e9' : '#2f2f2f');
    o.vc(box(0.9, 0.7, 0.62, [-0.4, 0.4, -0.35]), '#b0b6bd'); o.vc(box(0.92, 0.04, 0.64, [-0.4, 0.77, -0.35]), '#222');
    o.vc(box(0.5, 0.26, 0.02, [-0.4, 0.38, -0.03]), '#202428'); o.glow(box(0.42, 0.18, 0.01, [-0.4, 0.38, -0.02]), '#ff8a2a');
    for (const x of [-0.6, -0.2]) o.glow(place(cyl(0.13, 0.13, 0.02, 16), [x, 0.8, -0.38]), '#ff5a1a');
    o.vc(place(cyl(0.18, 0.2, 0.24, 16), [-0.6, 0.93, -0.38]), '#5d6d7e'); o.vc(place(new THREE.SphereGeometry(0.19, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), [-0.6, 1.05, -0.38], null, [1, 0.35, 1]), '#71808f');
    for (let i = 0; i < 4; i++) o.glow(place(new THREE.ConeGeometry(0.06, 0.28 + (i % 2) * 0.12, 6), [-0.25 + (i - 1.5) * 0.06, 0.95, -0.38]), i % 2 ? '#ffd23b' : '#ff6a1a');
    o.vc(box(0.6, 0.6, 0.5, [0.55, 0.3, -0.45]), '#8a5a33'); o.vc(box(0.36, 0.03, 0.26, [0.5, 0.615, -0.45]), '#d9b38c'); o.vc(sph(0.07, [0.62, 0.66, -0.42]), '#e53935');
    for (let i = 0; i < 6; i++) o.vc(place(cyl(0.2, 0.18, 0.03, 18), [0.45 + i * 0.012, 0.07 + i * 0.035, 0.45 - i * 0.01], [0, 0, i * 0.03]), '#fafafa');
    for (let i = 0; i < 3; i++) o.vc(place(cyl(0.2, 0.18, 0.03, 18), [0.2 - i * 0.16, 0.5 + i * 0.22, 0.45], [0.4 + i * 0.5, 0, 0.9 + i * 0.6]), '#fafafa');
    o.vc(place(cyl(0.12, 0.13, 0.16, 12), [0.0, 0.08, 0.6]), '#fafafa'); o.vc(sph(0.15, [0.0, 0.22, 0.6], [1, 0.75, 1]), '#fafafa');
  },
  'BEEP BOP BAND'(o) { // three little robots jamming
    o.vc(place(cyl(0.95, 0.95, 0.12, 28), [0, 0.06, 0]), '#5e35b1'); o.vc(place(new THREE.TorusGeometry(0.95, 0.03, 6, 40), [0, 0.12, 0], [Math.PI / 2, 0, 0]), '#ffd34d');
    const bot = (x, z, col, ry) => {
      const P = (g) => place(g, [0, 0, 0], [0, ry, 0]);
      const at = (g, p) => { place(g, p); return P(g).translate(x, 0, z); };
      for (const s of [-1, 1]) o.vc(at(new THREE.BoxGeometry(0.08, 0.22, 0.1), [s * 0.08, 0.23, 0]), '#455a64');
      o.vc(at(new THREE.BoxGeometry(0.3, 0.3, 0.22), [0, 0.49, 0]), col);
      o.vc(at(new THREE.BoxGeometry(0.24, 0.2, 0.2), [0, 0.76, 0]), '#cfd8dc');
      for (const s of [-1, 1]) o.glow(at(new THREE.SphereGeometry(0.035, 8, 6), [s * 0.06, 0.78, 0.1]), '#40f0ff');
      o.vc(at(new THREE.BoxGeometry(0.015, 0.16, 0.015), [0, 0.94, 0]), '#333'); o.glow(at(new THREE.SphereGeometry(0.04, 8, 6), [0, 1.03, 0]), '#ff3b3b');
      for (const s of [-1, 1]) o.vc(at(new THREE.BoxGeometry(0.06, 0.24, 0.06), [s * 0.2, 0.5, 0.08]).rotateY(0), '#90a4ae');
    };
    bot(-0.5, 0.05, '#ef5350', 0.4); bot(0, -0.35, '#42a5f5', 0); bot(0.5, 0.05, '#66bb6a', -0.4);
    o.vc(place(cyl(0.18, 0.18, 0.2, 16), [-0.5, 0.3, 0.35]), '#c62828'); o.vc(place(cyl(0.18, 0.18, 0.02, 16), [-0.5, 0.41, 0.35]), '#f5f5f5');
    o.vc(box(0.5, 0.06, 0.18, [0, 0.62, -0.08]), '#111'); for (let i = 0; i < 7; i++) o.vc(box(0.06, 0.02, 0.1, [-0.21 + i * 0.07, 0.66, -0.04]), '#fafafa');
    o.vc(place(new THREE.TorusGeometry(0.14, 0.04, 8, 16), [0.5, 0.55, 0.22], [0, 0.4, 0]), '#e0b34a'); o.vc(place(new THREE.ConeGeometry(0.12, 0.26, 12, 1, true), [0.5, 0.82, 0.22]), '#e0b34a');
    const note = (x, y, z, col) => { o.glow(sph(0.06, [x, y, z], [1.25, 0.9, 0.6]), col); o.glow(box(0.014, 0.22, 0.014, [x + 0.065, y + 0.11, z]), col); };
    note(-0.45, 1.35, 0.2, '#ffd23b'); note(0.1, 1.55, 0, '#3bff6a'); note(0.55, 1.3, 0.25, '#ff4fd8'); note(-0.1, 1.85, 0.3, '#3bb4ff');
  },
  'SHATTERED CROWN'(o) { // a castle on a green hill under a broken crown
    o.vc(place(new THREE.SphereGeometry(0.95, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0, 0], null, [1, 0.5, 1]), '#5b8c3a');
    o.vc(box(0.12, 0.02, 0.6, [0.35, 0.32, 0.45], [-0.5, 0.3, 0]), '#b8a27a');
    const y = 0.45, S = '#9e9a91';
    o.vc(box(0.44, 0.6, 0.44, [0, y + 0.3, 0]), S);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { o.vc(box(0.07, 0.08, 0.07, [-0.17 + i * 0.113, y + 0.64, s * 0.19]), S); o.vc(box(0.07, 0.08, 0.07, [s * 0.19, y + 0.64, -0.17 + i * 0.113]), S); }
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { o.vc(place(cyl(0.1, 0.1, 0.62, 10), [dx * 0.34, y + 0.2, dz * 0.34]), '#8f8b82'); o.vc(place(new THREE.ConeGeometry(0.13, 0.26, 10), [dx * 0.34, y + 0.64, dz * 0.34]), '#3c4f7a'); }
    o.vc(box(0.015, 0.4, 0.015, [0, y + 0.86, 0]), '#333'); o.vc(box(0.18, 0.11, 0.01, [0.09, y + 1.0, 0]), '#b71c1c');
    const shard = (a0, len, pos, rot) => { o.vc(place(new THREE.CylinderGeometry(0.32, 0.32, 0.16, 12, 1, true, a0, len), pos, rot), '#f2c037'); o.vc(place(new THREE.ConeGeometry(0.05, 0.16, 6), [pos[0], pos[1] + 0.15, pos[2]], rot), '#f2c037'); };
    shard(0, 2.1, [-0.12, 1.72, 0], [0.2, 0, 0.25]); shard(2.3, 1.9, [0.14, 1.85, 0.05], [-0.15, 0.4, -0.3]); shard(4.4, 1.7, [0.02, 1.58, -0.1], [0.35, 0, 0.1]);
    for (const [x, yy, z] of [[0.45, 1.6, 0.3], [-0.5, 1.9, 0.1], [0.25, 2.05, -0.2], [-0.3, 1.45, 0.35]]) o.glow(place(new THREE.OctahedronGeometry(0.05), [x, yy, z]), '#c79bff');
  },
  TABOVERLOAD(o) { // a neon runway through a storm of browser tabs
    o.vc(box(2, 0.06, 2, [0, 0.03, 0]), '#0b0b18');
    for (const [x, c] of [[-0.6, '#00e5ff'], [-0.2, '#ff2bd6'], [0.2, '#ff2bd6'], [0.6, '#00e5ff']]) o.glow(box(0.03, 0.02, 1.9, [x, 0.07, 0]), c);
    for (let i = 0; i < 6; i++) o.glow(box(1.2, 0.015, 0.02, [0, 0.07, -0.85 + i * 0.34]), '#5a2aa8');
    o.vc(box(0.2, 0.2, 0.2, [0, 0.2, 0.5]), '#f5f5ff'); o.glow(box(0.16, 0.05, 0.01, [0, 0.24, 0.6]), '#ff2bd6');
    const tab = (x, y, z, ry, rz, bar) => {
      const g = (geo) => place(geo, [0, 0, 0], [0, ry, rz]).translate(x, y, z);
      o.vc(g(new THREE.BoxGeometry(0.7, 0.46, 0.03)), '#1e1e2e'); o.glow(g(new THREE.BoxGeometry(0.7, 0.07, 0.035).translate(0, 0.2, 0)), bar);
      for (let i = 0; i < 3; i++) o.glow(g(new THREE.BoxGeometry(0.5 - i * 0.1, 0.03, 0.035).translate(-0.05 - i * 0.05, 0.08 - i * 0.09, 0)), '#7ccfff');
      for (const [dx, c] of [[-0.3, '#ff5f57'], [-0.25, '#febc2e'], [-0.2, '#28c840']]) o.glow(g(new THREE.SphereGeometry(0.018, 6, 4).translate(dx, 0.2, 0.02)), c);
    };
    tab(-0.55, 0.9, -0.3, 0.4, 0.12, '#ff2bd6'); tab(0.55, 1.15, -0.1, -0.5, -0.1, '#00e5ff'); tab(-0.1, 1.55, -0.5, 0.1, 0.05, '#b04bff'); tab(0.4, 0.55, -0.6, -0.2, 0.2, '#00e5ff');
  },
  'VERTEX FORGE'(o) { // a glowing curve on graph paper, on an easel
    for (const s of [-1, 1]) o.vc(span(new V3(s * 0.7, 0, 0.25), new V3(s * 0.55, 1.75, -0.05), 0.03), '#6b4423');
    o.vc(span(new V3(0, 0, -0.55), new V3(0, 1.6, -0.08), 0.03), '#6b4423');
    o.vc(box(1.7, 1.3, 0.04, [0, 1.05, -0.02], [-0.12, 0, 0]), '#f4f6fb');
    const P = (x, y, z = 0.03) => new V3(x, 1.05 + y * Math.cos(0.12) - z * Math.sin(-0.12) * 0, -0.02 + z - y * Math.sin(0.12));
    for (let i = -4; i <= 4; i++) { o.vc(span(P(i * 0.19, -0.6), P(i * 0.19, 0.6), 0.004, 0.004, 3), '#c5cbe0'); }
    for (let i = -3; i <= 3; i++) { o.vc(span(P(-0.8, i * 0.19), P(0.8, i * 0.19), 0.004, 0.004, 3), '#c5cbe0'); }
    o.vc(span(P(-0.8, 0), P(0.8, 0), 0.012), '#e53935'); o.vc(span(P(0, -0.62), P(0, 0.62), 0.012), '#43a047');
    const pts = []; for (let i = 0; i <= 40; i++) { const x = -0.75 + i * 0.0375; pts.push(P(x, 0.55 * Math.sin(x * 4.2) * Math.exp(-x * x * 0.8), 0.05)); }
    o.glow(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.022, 6), '#00d9ff');
    for (const i of [6, 15, 25, 34]) o.glow(sph(0.045, [pts[i].x, pts[i].y, pts[i].z + 0.01]), '#ff4fd8');
    o.glow(place(new THREE.OctahedronGeometry(0.16, 0), [0.62, 1.95, 0.1]), '#9ff7ff');
  },
  BIOBUZZ(o) { // a robotics competition field with a lifting robot
    o.vc(box(1.9, 0.04, 1.9, [0, 0.02, 0]), '#74777d');
    for (let i = -2; i <= 2; i++) { o.vc(box(0.01, 0.045, 1.9, [i * 0.317 + 0.16, 0.022, 0]), '#5d6066'); o.vc(box(1.9, 0.045, 0.01, [0, 0.022, i * 0.317 + 0.16]), '#5d6066'); }
    for (const [x, z, w, d] of [[0, 0.95, 1.9, 0.02], [0, -0.95, 1.9, 0.02], [0.95, 0, 0.02, 1.9], [-0.95, 0, 0.02, 1.9]]) { o.glass(box(w, 0.22, d, [x, 0.13, z])); o.vc(box(w + 0.02, 0.03, d + 0.02, [x, 0.25, z]), '#b0bec5'); }
    o.vc(box(0.42, 0.1, 0.42, [-0.1, 0.13, 0.1]), '#263238');
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const w = cyl(0.07, 0.07, 0.06, 12); w.rotateZ(Math.PI / 2); o.vc(place(w, [-0.1 + x * 0.24, 0.08, 0.1 + z * 0.15]), '#37474f'); }
    for (const s of [-1, 1]) o.vc(box(0.04, 0.62, 0.04, [-0.1 + s * 0.13, 0.48, -0.05]), '#ff6f00');
    o.vc(box(0.32, 0.04, 0.04, [-0.1, 0.78, -0.05]), '#ff6f00'); o.vc(box(0.2, 0.1, 0.16, [-0.1, 0.72, 0.06]), '#455a64');
    for (const s of [-1, 1]) o.vc(box(0.03, 0.1, 0.12, [-0.1 + s * 0.08, 0.66, 0.14]), '#90a4ae');
    o.vc(box(0.16, 0.06, 0.06, [-0.1, 0.62, 0.14]), '#fdd835');
    o.glow(box(0.18, 0.06, 0.005, [-0.1, 0.2, 0.312]), '#2196f3');
    for (const [x, z, c] of [[0.5, 0.5, '#fdd835'], [0.62, 0.3, '#e53935'], [0.4, -0.4, '#1e88e5'], [-0.6, -0.55, '#fdd835'], [0.65, -0.65, '#e53935']]) o.vc(box(0.1, 0.06, 0.14, [x, 0.07, z], [0, x * 3, 0]), c);
    o.vc(box(0.32, 0.03, 0.32, [0.7, 0.9, -0.7]), '#9e9e9e'); for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) o.vc(box(0.025, 0.9, 0.025, [0.7 + dx * 0.14, 0.45, -0.7 + dz * 0.14]), '#9e9e9e');
  },
  UNBOUND(o) { // a body-tracked player mid-slice, joints glowing
    o.vc(place(cyl(0.85, 0.85, 0.06, 28), [0, 0.03, 0]), '#141824'); o.glow(place(new THREE.TorusGeometry(0.85, 0.025, 6, 40), [0, 0.07, 0], [Math.PI / 2, 0, 0]), '#00e5ff');
    const J = { hip: [0, 0.8, 0], chest: [0.04, 1.2, 0], neck: [0.06, 1.34, 0], head: [0.08, 1.48, 0], le: [-0.26, 1.38, 0.05], lh: [-0.42, 1.66, 0.1], re: [0.34, 1.08, 0.1], rh: [0.56, 1.24, 0.22], lk: [-0.2, 0.46, 0.1], lf: [-0.32, 0.1, 0.05], rk: [0.22, 0.44, -0.05], rf: [0.36, 0.1, 0.06] };
    const v = (k) => new V3(...J[k]);
    for (const [a, b] of [['hip', 'chest'], ['chest', 'neck'], ['neck', 'le'], ['le', 'lh'], ['neck', 're'], ['re', 'rh'], ['hip', 'lk'], ['lk', 'lf'], ['hip', 'rk'], ['rk', 'rf']]) o.vc(span(v(a), v(b), 0.035, 0.035, 6), '#e8eaf6');
    o.vc(sph(0.11, J.head), '#e8eaf6');
    for (const k of ['hip', 'chest', 'neck', 'le', 'lh', 're', 'rh', 'lk', 'lf', 'rk', 'rf']) o.glow(sph(0.05, J[k], null, 8, 6), '#00e5ff');
    o.glow(span(v('rh'), v('rh').add(new V3(0.42, 0.55, 0.1)), 0.025, 0.018, 6), '#ff2bd6');
    o.glow(box(0.2, 0.2, 0.2, [-0.55, 1.05, 0.45], [0.5, 0.6, 0]), '#ff3355'); o.glow(box(0.2, 0.2, 0.2, [0.6, 1.75, 0.3], [0.3, 0.2, 0.4]), '#3366ff');
  },
};
function starShape(r) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r; if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  return s;
}

// ------------------------------------------------------------------ the builder
/**
 * @param id    tier id
 * @param c     { H, L, B, body, zU, gs, lists, goldMat, mastInfo: [{z, base, h, top, upper, main}], bsTip, stemY, stemZ, sternY }
 * @returns {{ near: THREE.Object3D[], far: THREE.Object3D[], update(t:number):void, lights: V3[] }}
 */
export function buildFestive(id, c) {
  const M = mats();
  const { H, L, B, body, zU, lists } = c;
  const vc = [], vcM = [], glowL = [], ice = [], snow = [], tw = [[], [], [], []], bulbA = [], bulbB = [], moon = [], star = [], beams = [], glassL = [];
  const near = [], far = [], spinners = [];
  const add = (parent, list, mat, lod = 1, shadow = false) => { const m = meshOf(list, mat, shadow); if (!m) return null; parent.add(m); (lod === 1 ? near : lod === 2 ? far : []).push(m); return m; };
  const dY = (u) => deckY(H, u);
  const railY = (u) => sheer(H, u) + 0.12;
  const railX = (u) => hullX(H, u, sheer(H, u)) - 0.15;
  const res = { near, far, update: () => {}, lights: [] };
  const anims = [];

  // -- string of lights/leaves/flags along a sagging line, split per parent group (masts can be shot away)
  const strands = new Map();
  const strand = (parent, a, b, step, sag, fn) => {
    const n = Math.max(2, Math.round(a.distanceTo(b) / step));
    if (!strands.has(parent)) strands.set(parent, { tw: [[], [], [], []], vc: [] });
    sagPoints(a, b, n, sag).forEach((p, k) => fn(strands.get(parent), p, k));
  };
  const flushStrands = () => { for (const [par, s] of strands) { s.tw.forEach((l, i) => add(par, l, M.twinkle[i], 1)); add(par, s.vc, M.vc, 1); } };
  const masts = c.mastInfo, fore = masts.reduce((a, m) => (m.z > a.z ? m : a)), aft = masts.reduce((a, m) => (m.z < a.z ? m : a));
  const main = masts.find((m) => m.main) || masts[0];
  const sternZ = -L / 2 + 0.4, sternTop = sheer(H, 0.0);

  if (id === 'harvest') {
    // pumpkins + gourds along both rails
    let k = 0;
    for (let u = 0.12; u < 0.86; u += 0.045) for (const sx of [-1, 1]) {
      k++; if (k % 3 === 0) continue;
      const r = (0.45 + ((k * 37) % 10) * 0.04) * c.gs, x = sx * (railX(u) - r * 0.9), y = dY(u) + r * 0.72, z = zU(u);
      vc.push(paint(sph(r, [x, y, z], [1.15, 0.78, 1.15], 14, 10), k % 5 === 1 ? '#e8c14a' : '#e86f1c'));
      for (let rib = 0; rib < 4; rib++) vc.push(paint(place(new THREE.TorusGeometry(r * 1.0, r * 0.07, 4, 16), [x, y, z], [Math.PI / 2, 0, 0], [1.13, 1.13, 0.76]).rotateY(0), '#c4561a'));
      vc.push(paint(place(cyl(r * 0.12, r * 0.08, r * 0.5, 6), [x, y + r * 0.85, z], [0.3, 0, 0.2]), '#4d6b22'));
    }
    // wheat sheaves at the foot of each mast
    for (const m of masts) for (const sx of [-1, 1]) {
      const bx = sx * B * 0.12, bz = m.z + 1.8, hh = 2.2 * c.gs;
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, lean = 0.16; vc.push(paint(span(new V3(bx + Math.cos(a) * 0.12, m.base, bz + Math.sin(a) * 0.12), new V3(bx + Math.cos(a) * hh * lean, m.base + hh, bz + Math.sin(a) * hh * lean), 0.035, 0.03, 4), '#d9b65a')); vc.push(paint(sph(0.09, [bx + Math.cos(a) * hh * lean, m.base + hh + 0.1, bz + Math.sin(a) * hh * lean], [0.7, 1.6, 0.7], 6, 4), '#c9962f')); }
      vc.push(paint(place(new THREE.TorusGeometry(0.2, 0.06, 4, 10), [bx, m.base + hh * 0.45, bz], [Math.PI / 2, 0, 0]), '#8a2a14'));
    }
    // apple barrels
    for (const [u, sx] of [[0.36, 1], [0.62, -1], [0.66, 1]]) { const x = sx * B * 0.22, y = dY(u); vc.push(paint(place(cyl(0.55, 0.62, 1.1, 12), [x, y + 0.55, zU(u)]), '#7a4a26')); for (let i = 0; i < 9; i++) vc.push(paint(sph(0.17, [x + Math.cos(i * 2.4) * 0.3 * Math.sqrt(i / 9), y + 1.15, zU(u) + Math.sin(i * 2.4) * 0.3 * Math.sqrt(i / 9)]), i % 3 ? '#c62828' : '#9ccc65')); }
    // autumn-leaf garlands strung through the rig
    const LEAF = ['#c0392b', '#e67e22', '#f1c40f', '#a84300', '#d35400'];
    const leaf = (s, p, k) => { const g = new THREE.CircleGeometry(0.42 * c.gs, 5); g.scale(1, 0.7, 1); g.rotateY(k * 1.3); g.rotateX(k * 0.7); g.translate(p.x, p.y, p.z); s.vc.push(paint(g, LEAF[k % 5])); };
    const ordered = [...masts].sort((a, b) => a.z - b.z);
    for (let i = 0; i < ordered.length - 1; i++) strand(ordered[i].upper, ordered[i].top.clone().setY(ordered[i].base + ordered[i].h * 0.62), ordered[i + 1].top.clone().setY(ordered[i + 1].base + ordered[i + 1].h * 0.62), 0.9, 2.2, leaf);
    strand(fore.upper, fore.top.clone().setY(fore.base + fore.h * 0.6), c.bsTip, 0.9, 2.5, leaf);
    // cornucopia figurehead: a wicker horn curling back under the bowsprit, its mouth spilling the harvest
    { // its narrow tip is set into the stem; the horn sweeps down and forward, then curls up to an open mouth
      const R = 2.8 * c.gs, z0 = c.stemZ - 3.2, y0 = c.stemY - 1.8;
      const curve = new THREE.CubicBezierCurve3(new V3(0, y0, z0), new V3(0, y0 - R * 1.1, z0 + R * 0.5), new V3(0, y0 - R * 0.9, z0 + R * 1.5), new V3(0, y0 + R * 0.05, z0 + R * 1.45));
      const pts = curve.getPoints(20);
      for (let i = 0; i < pts.length - 1; i++) { const f = i / (pts.length - 1), r0 = 0.3 + R * 0.4 * f ** 1.4, r1 = 0.3 + R * 0.4 * ((i + 1) / (pts.length - 1)) ** 1.4; vc.push(paint(span(pts[i], pts[i + 1], r0, r1, 12), i % 2 ? '#c8913e' : '#a8732c')); }
      const m0 = pts[pts.length - 1], dir = new V3().subVectors(m0, pts[pts.length - 3]).normalize();
      { const lip = new THREE.TorusGeometry(R * 0.44, 0.1 * c.gs, 6, 18); lip.lookAt(dir); lip.translate(m0.x, m0.y, m0.z); vc.push(paint(lip, '#e3a02a')); } // gilt lip
      // the harvest spilling out: a pumpkin, apples, pears and grape bunches tumbling over the lip
      const fruit = [['#e86f1c', 0.55], ['#c62828', 0.34], ['#f9d342', 0.32], ['#9ccc65', 0.3], ['#c62828', 0.3], ['#e8c14a', 0.36], ['#c62828', 0.26]];
      fruit.forEach(([col, r], i) => { const a = i * 2.1, rr = R * 0.25; vc.push(paint(sph(r * c.gs, [Math.cos(a) * rr, m0.y + Math.sin(a) * rr * 0.6 - (i > 3 ? R * 0.35 : 0), m0.z + dir.z * (0.3 + i * 0.12) * c.gs + (i > 3 ? R * 0.2 : 0)]), col)); });
      for (let i = 0; i < 9; i++) vc.push(paint(sph(0.13 * c.gs, [R * 0.12 + (i % 3) * 0.14 * c.gs, m0.y - R * 0.5 - Math.floor(i / 3) * 0.18 * c.gs, m0.z + R * 0.3]), '#5e1f73'));
    }
    // carved turkey-tail fan over the stern: rank on rank of painted feathers
    { const cx = 0, cy = sternTop + 0.4, cz = sternZ - 0.25, R = B * 0.52, cols = ['#5a2f14', '#8a3a16', '#c4561a', '#e08a2c', '#e8b84a'];
      for (let ring = 0; ring < 3; ring++) {
        const n = 13 - ring * 2, rr = R * (1 - ring * 0.22);
        for (let i = 0; i < n; i++) {
          const a = -Math.PI * 0.46 + (Math.PI * 0.92 * i) / (n - 1), len = rr, w = (rr * 2.6) / n;
          const g = new THREE.CylinderGeometry(w * 0.5, w * 0.18, len, 6, 1); g.scale(1, 1, 0.12); g.translate(0, len / 2, 0); g.rotateZ(-a);
          g.translate(cx, cy, cz - ring * 0.18); vc.push(paint(g, cols[(i + ring) % 5]));
          const tip = new V3(Math.sin(a) * len * 0.92, cy + Math.cos(a) * len * 0.92, cz - ring * 0.18 - 0.08);
          vc.push(paint(sph(w * 0.34, [tip.x, tip.y, tip.z], [1, 1, 0.3], 8, 6), ring ? '#2b1608' : '#f2e6c8'));
        }
      }
      lists.gold.push(plain(place(cyl(B * 0.09, B * 0.09, 0.5, 18), [cx, cy, cz + 0.1], [Math.PI / 2, 0, 0])));
    }
    // two glowing harvest moons on the quarters + one at the main truck
    for (const sx of [-1, 1]) { const x = sx * railX(0.06) * 0.8, y = sternTop + 2.2; lists.iron.push(plain(place(cyl(0.08, 0.08, 2.2, 5), [x, y - 1.2, zU(0.05)]))); moon.push(plain(sph(0.75 * c.gs, [x, y, zU(0.05)], null, 14, 10))); res.lights.push(new V3(x, y, zU(0.05))); }
    { const g = plain(sph(0.9 * c.gs, [main.top.x, main.top.y + 1.2, main.top.z], null, 14, 10)); add(main.upper, [g], M.moon, 2); }
    anims.push((t) => { M.moon.emissiveIntensity = (1.3 + glowK * 1.4) * (0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 3.1)); });
  }

  if (id === 'yule') {
    // snow along the rails and drifts on deck
    for (let i = 0; i < 30; i++) { const u0 = 0.03 + i * 0.032, u1 = u0 + 0.032; for (const sx of [-1, 1]) snow.push(plain(span(new V3(sx * hullX(H, u0, sheer(H, u0)), railY(u0) + 0.08, zU(u0)), new V3(sx * hullX(H, u1, sheer(H, u1)), railY(u1) + 0.08, zU(u1)), 0.22 * c.gs, 0.22 * c.gs, 5))); }
    for (let i = 0; i < 14; i++) { const u = 0.1 + i * 0.058, sx = i % 2 ? 1 : -1; snow.push(plain(sph(0.7 * c.gs, [sx * (hullX(H, u, dY(u)) * 0.62), dY(u) + 0.05, zU(u)], [1.1, 0.28, 1.8], 10, 6))); }
    // icicles under the rail
    for (let i = 0; i < 56; i++) { const u = 0.06 + i * 0.016; for (const sx of [-1, 1]) { const y = sheer(H, u) - 0.15, l = (0.5 + ((i * 7 + (sx > 0 ? 3 : 0)) % 5) * 0.22) * c.gs; ice.push(plain(place(new THREE.ConeGeometry(0.1 * c.gs, l, 5), [sx * (hullX(H, u, y) + 0.06), y - l / 2, zU(u)], [Math.PI, 0, 0]))); } }
    // candy-cane bands up the lower masts
    for (const m of masts) for (let i = 0; i < 9; i++) { const g = place(cyl(Math.max(0.3, B * 0.05), Math.max(0.3, B * 0.05), 0.5, 10), [0, m.base + 1.5 + i * 1.3, m.z]); g.scale(1.06, 1, 1.06); lists.red.push(plain(g)); }
    // fairy lights: masthead to masthead, foremast to the jib-boom, mizzen to the taffrail, and along both rails
    const bulb = (s, p, k) => s.tw[k % 4].push(plain(sph(0.2 * c.gs, [p.x, p.y, p.z], null, 6, 4)));
    const ordered = [...masts].sort((a, b) => a.z - b.z);
    for (let i = 0; i < ordered.length - 1; i++) strand(ordered[i].upper, ordered[i].top, ordered[i + 1].top, 1.4, 2.5, bulb);
    strand(fore.upper, fore.top, c.bsTip, 1.4, 3, bulb);
    strand(aft.upper, aft.top, new V3(0, sternTop + 1, sternZ), 1.4, 3, bulb);
    for (const m of masts) for (const sx of [-1, 1]) strand(m.upper, m.top, new V3(sx * railX(Math.max(0.03, (m.z / L) + 0.5 - 0.06)), railY(0.5) + 0.4, m.z - L * 0.06), 1.5, 1.2, bulb);
    for (const sx of [-1, 1]) { let k = 0; for (let u = 0.05; u < 0.95; u += 0.022) tw[(k++) % 4].push(plain(sph(0.18 * c.gs, [sx * railX(u), railY(u) + 0.45, zU(u)], null, 6, 4))); }
    // great star on the main truck (turns slowly)
    { const g = new THREE.ExtrudeGeometry(starShape(1.6 * c.gs), { depth: 0.35, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 1 }); g.center(); const s = new THREE.Mesh(g, M.star); s.position.set(main.top.x, main.top.y + 2.2 * c.gs, main.top.z); main.upper.add(s); spinners.push([s, 0.6]); far.push(s); }
    // decorated tree on the forecastle, with presents underneath
    { const u = 0.86, x = 0, y = dY(u), z = zU(u), hgt = Math.max(6, B * 0.62);
      vc.push(paint(place(cyl(0.3, 0.3, 0.8, 8), [x, y + 0.4, z]), '#5d3a1a'));
      for (let i = 0; i < 4; i++) { const r = hgt * (0.36 - i * 0.07), hh = hgt * 0.36; vc.push(paint(place(new THREE.ConeGeometry(r, hh, 10), [x, y + 0.8 + i * hgt * 0.19 + hh / 2, z]), i % 2 ? '#1e6b34' : '#175a2b')); }
      for (let i = 0; i < 28; i++) { const t = i / 28, a = i * 2.4, hy = 0.9 + t * hgt * 0.8, rr = hgt * 0.34 * (1 - t * 0.85); (i % 3 ? tw[i % 4] : vcM).push(i % 3 ? plain(sph(0.17 * c.gs, [x + Math.cos(a) * rr, y + hy, z + Math.sin(a) * rr], null, 6, 4)) : paint(sph(0.24 * c.gs, [x + Math.cos(a) * rr, y + hy, z + Math.sin(a) * rr], null, 8, 6), ['#d4a73a', '#c62828', '#c0c0d0'][i % 3])); }
      const ts = new THREE.ExtrudeGeometry(starShape(0.7 * c.gs), { depth: 0.2, bevelEnabled: false }); ts.center(); star.push(plain(ts.translate(x, y + 0.9 + hgt * 0.95, z)));
      const P = [['#c62828', '#f4d03f'], ['#1e8449', '#f4f6f7'], ['#2e86c1', '#f4d03f'], ['#f4f6f7', '#c62828'], ['#7d3c98', '#f4d03f']];
      P.forEach(([bc, rc], i) => { const a = i * 1.26, r = hgt * 0.3, s = (0.7 + (i % 3) * 0.25) * c.gs, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r * 0.8; vc.push(paint(box(s, s * 0.8, s, [px, y + s * 0.4, pz], [0, a, 0]), bc)); vc.push(paint(box(s * 1.02, s * 0.82, s * 0.16, [px, y + s * 0.4, pz], [0, a, 0]), rc)); vc.push(paint(box(s * 0.16, s * 0.82, s * 1.02, [px, y + s * 0.4, pz], [0, a, 0]), rc)); });
    }
    // wreaths: on the stern and on each bow
    const wreath = (pos, rotY) => { vc.push(paint(place(new THREE.TorusGeometry(1.0 * c.gs, 0.32 * c.gs, 8, 18), pos, [0, rotY, 0]), '#1d6b33')); for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; vc.push(paint(sph(0.14 * c.gs, [pos[0] + Math.cos(rotY) * Math.cos(a) * c.gs, pos[1] + Math.sin(a) * c.gs, pos[2] - Math.sin(rotY) * Math.cos(a) * c.gs]), '#c62828')); } vc.push(paint(box(0.7 * c.gs, 0.4 * c.gs, 0.2, [pos[0], pos[1] - 1.0 * c.gs, pos[2]], [0, rotY, 0]), '#c62828')); };
    wreath([0, sternTop - 1.2, sternZ - 0.3], 0);
    for (const sx of [-1, 1]) { const u = 0.9, y = sheer(H, u) - 1.4; wreath([sx * (hullX(H, u, y) + 0.3), y, zU(u)], sx * Math.PI / 2); }
    anims.push((t) => { M.twinkle.forEach((m, i) => { m.emissiveIntensity = (0.5 + glowK * 1.8) * (0.35 + 0.65 * Math.max(0, Math.sin(t * 2.2 + i * 1.57))) + 0.25; }); });
  }

  if (id === 'midnight') {
    // gilt clock tower on the poop deck, its face looking aft (and a twin facing forward), real local time
    { const u = 0.07, y = dY(u), z = zU(u), r = Math.max(2.2, B * 0.17), tw0 = r * 2.5;
      lists.dark.push(plain(box(tw0, r * 1.2, tw0 * 0.55, [0, y + r * 0.6, z])));
      lists.gold.push(plain(box(tw0 + 0.4, 0.4, tw0 * 0.55 + 0.4, [0, y + r * 1.2, z])));
      const cy = y + r * 1.2 + r * 1.15;
      lists.dark.push(plain(box(tw0 * 0.92, r * 2.3, tw0 * 0.45, [0, cy, z])));
      for (const dz of [-1, 1]) { lists.gold.push(plain(place(new THREE.TorusGeometry(r, 0.22, 8, 36), [0, cy, z + dz * tw0 * 0.23]))); for (const sx of [-1, 1]) lists.gold.push(plain(place(cyl(0.22, 0.22, r * 2.3, 10), [sx * tw0 * 0.46, cy, z + dz * tw0 * 0.23]))); }
      lists.gold.push(plain(place(new THREE.ConeGeometry(tw0 * 0.42, r * 1.6, 4), [0, cy + r * 1.15 + r * 0.8, z], [0, Math.PI / 4, 0])));
      lists.gold.push(plain(sph(0.45, [0, cy + r * 2.0 + r * 0.9, z])));
      for (const dz of [-1, 1]) {
        const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.96, 40), M.clock); face.position.set(0, cy, z + dz * (tw0 * 0.23 + 0.02)); if (dz < 0) face.rotation.y = Math.PI; body.add(face); near.push(face);
        const hand = (len, w) => { const g = new THREE.BoxGeometry(w, len, 0.08); g.translate(0, len / 2 - len * 0.12, 0); const m = new THREE.Mesh(g, M.hand); m.position.set(0, cy, z + dz * (tw0 * 0.23 + 0.09)); if (dz < 0) m.rotation.y = Math.PI; body.add(m); near.push(m); return m; };
        const hh = hand(r * 0.55, 0.22), mh = hand(r * 0.85, 0.14), sh = hand(r * 0.9, 0.05);
        anims.push(() => { const d = new Date(), s = d.getSeconds() + d.getMilliseconds() / 1000, mi = d.getMinutes() + s / 60, h = (d.getHours() % 12) + mi / 60; hh.rotation.z = -(h / 12) * Math.PI * 2; mh.rotation.z = -(mi / 60) * Math.PI * 2; sh.rotation.z = -(s / 60) * Math.PI * 2; });
      }
    }
    // mirror ball at the main truck
    { const g = new THREE.IcosahedronGeometry(1.6 * c.gs, 2); const ball = new THREE.Mesh(g, M.mirror); ball.position.set(main.top.x, main.top.y + 2.0 * c.gs, main.top.z); main.upper.add(ball); spinners.push([ball, 0.9]); far.push(ball); }
    // gold + silver bunting from every masthead
    const FL = ['#f2c14e', '#e8e8f0', '#f2c14e', '#1d2a5a'];
    const pennant = (s, p, k) => { const g = new THREE.BufferGeometry(); const w = 0.55 * c.gs, h = 0.9 * c.gs; g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, 0, -h, 0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); g.rotateY(Math.PI / 2 + (k % 2) * 0.3); g.translate(p.x, p.y, p.z); s.vc.push(paint(g, FL[k % 4])); };
    const ordered = [...masts].sort((a, b) => a.z - b.z);
    for (let i = 0; i < ordered.length - 1; i++) strand(ordered[i].upper, ordered[i].top, ordered[i + 1].top, 1.2, 2.2, pennant);
    strand(fore.upper, fore.top, c.bsTip, 1.2, 2.6, pennant);
    strand(aft.upper, aft.top, new V3(0, sternTop + 1, sternZ), 1.2, 2.6, pennant);
    // firework mortars on the waist (game.js fires them)
    for (const [u, sx] of [[0.32, 1], [0.32, -1], [0.66, 1], [0.66, -1]]) { const x = sx * B * 0.26, y = dY(u); lists.iron.push(plain(place(cyl(0.45, 0.4, 1.8, 10), [x, y + 0.9, zU(u)], [0, 0, -sx * 0.18]))); lists.gold.push(plain(place(new THREE.TorusGeometry(0.42, 0.08, 6, 12), [x + sx * 0.16, y + 1.8, zU(u)], [Math.PI / 2, 0, 0]))); vcM.push(paint(place(cyl(0.7, 0.7, 0.3, 10), [x, y + 0.15, zU(u)]), '#2a2a33')); }
    // gilt stern lanterns all along the rails
    for (let u = 0.1; u < 0.92; u += 0.07) for (const sx of [-1, 1]) lists.lamps.push(plain(sph(0.22 * c.gs, [sx * railX(u), railY(u) + 0.55, zU(u)], [1, 1.3, 1], 6, 4)));
    anims.push((t) => { M.mirror.emissiveIntensity = 0.6 + glowK * 0.9 + 0.3 * Math.sin(t * 9); });
  }

  if (id === 'collector') {
    // ---- the carousel: a gilded dais, a turning ring of display cases, a hologram, a marquee and spotlights
    const zc = zU(0.5), y0 = dY(0.5), Rd = B * 0.45, Rv = B * 0.345, N = EXHIBITS.length;
    lists.gold.push(plain(place(cyl(Rd + 0.3, Rd + 0.3, 0.25, 40), [0, y0 + 0.12, zc])));
    vcM.push(paint(place(cyl(Rd, Rd, 0.7, 40), [0, y0 + 0.5, zc]), '#2c1b47'));
    for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2; (i % 2 ? bulbA : bulbB).push(plain(sph(0.16, [Math.sin(a) * (Rd + 0.02), y0 + 0.62, zc + Math.cos(a) * (Rd + 0.02)], null, 6, 4))); }
    const spin = new THREE.Group(); spin.name = 'carousel'; spin.position.set(0, y0 + 0.85, zc); body.add(spin); spinners.push([spin, 0.12]);
    const sV = [], sG = [], sGl = [], sM = [], sGold = [], pq = [];
    const Wv = Math.min(3.4, ((2 * Math.PI * Rv) / N) * 0.82), Hp = 0.9, Hv = Wv * 1.05, sc = Wv / 2.35;
    EXHIBITS.forEach((name, i) => {
      const a = (i / N) * Math.PI * 2, px = Math.sin(a) * Rv, pz = Math.cos(a) * Rv;
      const T = (g) => { g.rotateY(a); g.translate(px, 0, pz); return g; };
      sM.push(paint(T(box(Wv, Hp, Wv, [0, Hp / 2, 0])), '#1a1028'));
      sGold.push(plain(T(box(Wv + 0.12, 0.1, Wv + 0.12, [0, Hp, 0]))));
      for (const [dx, dz, w, d] of [[0, -1, Wv + 0.12, 0.1], [0, 1, Wv + 0.12, 0.1], [-1, 0, 0.1, Wv + 0.12], [1, 0, 0.1, Wv + 0.12]]) sGold.push(plain(T(box(w, 0.1, d, [dx * Wv / 2, Hp + Hv, dz * Wv / 2]))));
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) sGold.push(plain(T(box(0.07, Hv, 0.07, [dx * Wv / 2, Hp + Hv / 2, dz * Wv / 2]))));
      sG.push(plain(T(box(Wv, Hv, Wv, [0, Hp + Hv / 2, 0]))));
      for (const sx2 of [-1, 1]) sGl.push(paint(T(box(0.06, 0.05, Wv * 0.8, [sx2 * Wv * 0.42, Hp + Hv - 0.08, 0])), '#fff4d6'));
      // the plaque, from the label atlas
      const pg = new THREE.PlaneGeometry(Wv * 0.9, Wv * 0.22); const uv = pg.attributes.uv, cx = (i % 4) / 4, cy = 1 - (Math.floor(i / 4) + 1) / 4;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, cx + uv.getX(k) * 0.25, cy + uv.getY(k) * 0.25);
      pg.translate(0, Hp * 0.55, Wv / 2 + 0.02); pq.push(plain(T(pg)));
      // the exhibit itself
      const o = {
        vc: (g, col) => sV.push(paint(T(g.scale(sc, sc, sc).translate(0, Hp + 0.06, 0)), col)),
        glow: (g, col) => sGl.push(paint(T(g.scale(sc, sc, sc).translate(0, Hp + 0.06, 0)), col)),
        glass: (g) => sG.push(plain(T(g.scale(sc, sc, sc).translate(0, Hp + 0.06, 0)))),
      };
      MINI[name](o);
    });
    // centre column + hologram + trophy
    const colH = Hp + Hv + 0.6;
    sM.push(paint(place(cyl(1.0, 0.8, colH, 16), [0, colH / 2, 0]), '#2c1b47'));
    sGold.push(plain(place(cyl(1.15, 1.15, 0.2, 16), [0, colH, 0])));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; sGold.push(plain(place(cyl(0.06, 0.06, colH, 5), [Math.sin(a) * 1.02, colH / 2, Math.cos(a) * 1.02]))); }
    add(spin, sV, M.vc, 1); add(spin, sM, M.vc, 0, true); add(spin, sGl, M.vcGlow, 1); add(spin, sGold, c.goldMat, 2); add(spin, sG, M.vitrine, 1); add(spin, pq, M.plaque, 1);
    // marquee ring above the cases (its own slow counter-turn comes from scrolling the texture)
    { const rM = Rv + Wv * 0.5 + 0.25, hM = 0.8 * c.gs + 0.25, yM = 0.85 + Hp + Hv + 0.9;
      const g = new THREE.CylinderGeometry(rM, rM, hM, 64, 1, true); const mq = new THREE.Mesh(g, M.marquee); mq.renderOrder = 2; mq.position.set(0, y0 + yM, zc); body.add(mq); near.push(mq);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.26; lists.gold.push(plain(place(cyl(0.1, 0.1, yM + hM / 2 - 0.5, 6), [Math.sin(a) * rM, y0 + 0.5 + (yM + hM / 2 - 0.5) / 2, zc + Math.cos(a) * rM]))); }
      anims.push((t) => { M.marquee.map.offset.x = (t * 0.02) % 1; });
    }
    { const hy = y0 + 0.85 + colH + 2.3, hr = 1.7 * c.gs;
      const holo = new THREE.Mesh(new THREE.IcosahedronGeometry(hr, 1), M.holo); holo.position.set(0, hy, zc); body.add(holo); spinners.push([holo, -0.5]); near.push(holo);
      const core = new THREE.Mesh(new THREE.SphereGeometry(hr * 0.9, 18, 12), M.holoCore); core.position.copy(holo.position); body.add(core); near.push(core);
      const tg = new THREE.ExtrudeGeometry(starShape(hr * 0.55), { depth: 0.3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 1 }); tg.center();
      const trophy = new THREE.Mesh(tg, M.star); trophy.position.copy(holo.position); body.add(trophy); spinners.push([trophy, 1.1]); far.push(trophy);
      res.lights.push(holo.position.clone());
      // spotlights from the dais up into the hologram
      for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4, from = new V3(Math.sin(a) * (Rd - 0.4), y0 + 0.8, zc + Math.cos(a) * (Rd - 0.4)), to = new V3(0, hy, zc); const g = span(to, from, 0.25, hr * 0.9, 16); beams.push(plain(g)); lists.iron.push(plain(place(cyl(0.35, 0.3, 0.5, 10), [from.x, from.y, from.z]))); }
      anims.push((t) => { M.beam.opacity = 0.03 + glowK * 0.14; M.holoCore.opacity = 0.22 + 0.1 * Math.sin(t * 2.7); });
    }
    // chase bulbs along both rails, a carnival arch over the gangway
    for (const sx of [-1, 1]) { let k = 0; for (let u = 0.05; u < 0.95; u += 0.016) (k++ % 2 ? bulbA : bulbB).push(plain(sph(0.15, [sx * railX(u), railY(u) + 0.3, zU(u)], null, 6, 4))); }
    { const zA = zU(0.74), w = B * 0.3, hA = 5.5 * c.gs; for (const sx of [-1, 1]) lists.gold.push(plain(place(cyl(0.2, 0.2, hA, 8), [sx * w, dY(0.74) + hA / 2, zA])));
      const arc = new THREE.TorusGeometry(w, 0.22, 6, 24, Math.PI); lists.gold.push(plain(place(arc, [0, dY(0.74) + hA, zA])));
      for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI; (i % 2 ? bulbA : bulbB).push(plain(sph(0.2, [Math.cos(a) * w, dY(0.74) + hA + Math.sin(a) * w + 0.2, zA + 0.25], null, 6, 4))); }
    }
    // ---- the classics, as giant deck sculptures: chessmen on a board aft, a pair of dice and a fan of cards forward
    { const u = 0.265, z = zU(u), y = dY(u) + 0.2, S = Math.min(B * 0.44, 9.5), n = 6, cs = S / n;
      lists.gold.push(plain(box(S + 0.5, 0.3, S + 0.5, [0, y - 0.05, z])));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) vc.push(paint(box(cs, 0.12, cs, [-S / 2 + cs * (i + 0.5), y + 0.16, z - S / 2 + cs * (j + 0.5)]), (i + j) % 2 ? '#1d1a22' : '#efe6d2'));
      const at = (i, j) => [-S / 2 + cs * (i + 0.5), y + 0.22, z - S / 2 + cs * (j + 0.5)];
      const k = cs * 0.42;
      const lathe = (prof, pos, col) => vcM.push(paint(place(new THREE.LatheGeometry(prof.map(([r, h]) => new THREE.Vector2(r * k, h * k)), 20), pos), col));
      const KING = [[0, 0], [1.1, 0], [1.1, 0.35], [0.8, 0.55], [0.5, 1.6], [0.42, 3.0], [0.8, 3.2], [0.5, 3.4], [0.66, 3.9], [0, 4.1]];
      const ROOK = [[0, 0], [1.05, 0], [1.05, 0.35], [0.75, 0.55], [0.6, 2.2], [0.85, 2.4], [0.85, 3.0], [0, 3.0]];
      const PAWN = [[0, 0], [0.95, 0], [0.95, 0.3], [0.65, 0.5], [0.38, 1.6], [0.7, 1.75], [0.3, 1.9], [0.55, 2.2], [0.55, 2.5], [0.3, 2.85], [0, 2.95]];
      const [kx, ky, kz] = at(1, 4); lathe(KING, [kx, ky, kz], '#f4ecd8'); vcM.push(paint(box(0.18 * k, 1.0 * k, 0.18 * k, [kx, ky + 4.55 * k, kz]), '#d4a73a'), paint(box(0.65 * k, 0.18 * k, 0.18 * k, [kx, ky + 4.65 * k, kz]), '#d4a73a'));
      const [rx, ry, rz] = at(4, 4); lathe(ROOK, [rx, ry, rz], '#f4ecd8'); for (let q = 0; q < 5; q++) { const a = (q / 5) * Math.PI * 2; vcM.push(paint(box(0.32 * k, 0.4 * k, 0.32 * k, [rx + Math.sin(a) * 0.62 * k, ry + 3.2 * k, rz + Math.cos(a) * 0.62 * k], [0, a, 0]), '#f4ecd8')); }
      for (const [i, j] of [[2, 1], [3, 2]]) lathe(PAWN, at(i, j), '#2a2530');
      // the black knight: a carved horse's head on a turned base
      { const [x, yy, zz] = at(4, 1); lathe([[0, 0], [1.1, 0], [1.1, 0.35], [0.8, 0.55], [0.75, 1.0], [0, 1.0]], [x, yy, zz], '#2a2530');
        const nk = box(0.9 * k, 2.2 * k, 1.1 * k, [0, 1.0 * k, 0], [0.35, 0, 0]); nk.translate(x, yy + 0.9 * k, zz); vcM.push(paint(nk, '#2a2530'));
        const hd = box(0.85 * k, 0.85 * k, 1.9 * k, [0, 0, 0.55 * k], [-0.25, 0, 0]); hd.translate(x, yy + 2.75 * k, zz + 0.25 * k); vcM.push(paint(hd, '#2a2530'));
        for (const sx2 of [-1, 1]) vcM.push(paint(place(new THREE.ConeGeometry(0.16 * k, 0.6 * k, 6), [x + sx2 * 0.28 * k, yy + 3.35 * k, zz - 0.15 * k]), '#2a2530'));
        vcM.push(paint(box(0.25 * k, 1.7 * k, 0.5 * k, [x, yy + 2.0 * k, zz - 0.75 * k], [0.4, 0, 0]), '#3d3546')); }
    }
    { // a pair of giant dice, mid-tumble
      const die = (cx, cy, cz, ry, rx, sz) => {
        const m = new THREE.Matrix4().compose(new V3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new V3(1, 1, 1));
        vc.push(paint(new THREE.BoxGeometry(sz, sz, sz, 1, 1, 1).applyMatrix4(m), '#f7f3ea'));
        const P = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
        const faces = [[new V3(0, 1, 0), 1], [new V3(0, -1, 0), 6], [new V3(1, 0, 0), 3], [new V3(-1, 0, 0), 4], [new V3(0, 0, 1), 2], [new V3(0, 0, -1), 5]];
        for (const [nrm, val] of faces) {
          const a = Math.abs(nrm.y) > 0.5 ? new V3(1, 0, 0) : new V3(0, 1, 0), b = new V3().crossVectors(nrm, a);
          for (const [pa, pb] of P[val]) { const p = nrm.clone().multiplyScalar(sz / 2).addScaledVector(a, pa * sz * 0.27).addScaledVector(b, pb * sz * 0.27); const g = new THREE.SphereGeometry(sz * 0.085, 10, 6); g.scale(1, 1, 1); g.translate(p.x, p.y, p.z); g.applyMatrix4(m); vc.push(paint(g, val === 1 ? '#c62828' : '#16141a')); }
        }
      };
      const u = 0.8, y = dY(u), sz = Math.min(2.6, B * 0.12);
      die(B * 0.22, y + sz / 2, zU(u) - 1.2, 0.5, 0, sz); die(B * 0.31, y + sz * 0.62, zU(u) + 1.4, 1.1, 0.42, sz * 0.9);
    }
    { // a fan of giant playing cards on a gilt stand
      const u = 0.8, y = dY(u), cx = -B * 0.25, cz = zU(u), cw = Math.min(2.2, B * 0.1), ch = cw * 1.4;
      lists.gold.push(plain(place(cyl(cw * 0.7, cw * 0.8, 0.5, 14), [cx, y + 0.25, cz])));
      const suits = [['#c62828', 'heart'], ['#16141a', 'spade'], ['#c62828', 'diamond'], ['#16141a', 'club'], ['#c62828', 'heart']];
      suits.forEach(([col, kind], i) => {
        const a = (i - 2) * 0.32, m = new THREE.Matrix4().compose(new V3(cx, y + 0.5, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, -a)), new V3(1, 1, 1));
        const card = new THREE.BoxGeometry(cw, ch, 0.06); card.translate(0, ch / 2 + 0.2, i * 0.07); vc.push(paint(card.applyMatrix4(m), '#fbf8f0'));
        const sym = []; const cy0 = ch * 0.62 + 0.2, zf = i * 0.07 + 0.05, r = cw * 0.16;
        if (kind === 'diamond') sym.push(box(r * 1.5, r * 1.5, 0.04, [0, cy0, zf], [0, 0, Math.PI / 4], [0.75, 1.15, 1]));
        if (kind === 'heart') { sym.push(sph(r * 0.62, [-r * 0.45, cy0 + r * 0.3, zf], [1, 1, 0.2])); sym.push(sph(r * 0.62, [r * 0.45, cy0 + r * 0.3, zf], [1, 1, 0.2])); sym.push(box(r * 1.08, r * 1.08, 0.04, [0, cy0 - r * 0.25, zf], [0, 0, Math.PI / 4])); }
        if (kind === 'spade') { sym.push(sph(r * 0.6, [-r * 0.42, cy0 - r * 0.15, zf], [1, 1, 0.2])); sym.push(sph(r * 0.6, [r * 0.42, cy0 - r * 0.15, zf], [1, 1, 0.2])); sym.push(box(r * 1.05, r * 1.05, 0.04, [0, cy0 + r * 0.25, zf], [0, 0, Math.PI / 4])); sym.push(box(r * 0.22, r * 0.9, 0.04, [0, cy0 - r * 0.7, zf])); }
        if (kind === 'club') { for (const [dx, dy] of [[0, 0.5], [-0.5, -0.1], [0.5, -0.1]]) sym.push(sph(r * 0.48, [dx * r, cy0 + dy * r, zf], [1, 1, 0.2])); sym.push(box(r * 0.22, r * 0.9, 0.04, [0, cy0 - r * 0.6, zf])); }
        for (const g of sym) vc.push(paint(g.applyMatrix4(m), col));
        for (const [dx, dy] of [[-0.36, 0.42], [0.36, -0.42]]) vc.push(paint(box(cw * 0.1, cw * 0.14, 0.04, [dx * cw, ch / 2 + 0.2 + dy * ch, zf]).applyMatrix4(m), col));
      });
    }
    anims.push((t) => { const on = Math.floor(t * 5) % 2 === 0, hi = 1.6 + glowK * 1.6; M.bulbA.emissiveIntensity = on ? hi : 0.2; M.bulbB.emissiveIntensity = on ? 0.2 : hi; });
  }

  // ---- assemble
  add(body, vc, M.vc, 1, true);
  add(body, vcM, M.vcMetal, 2, true);
  add(body, glowL, M.vcGlow, 1);
  add(body, ice, M.ice, 1);
  add(body, snow, M.snow, 2, true);
  tw.forEach((l, i) => add(body, l, M.twinkle[i], 1));
  add(body, bulbA, M.bulbA, 1); add(body, bulbB, M.bulbB, 1);
  add(body, moon, M.moon, 2);
  add(body, star, M.star, 2);
  add(body, beams, M.beam, 1);
  add(body, glassL, M.vitrine, 1);
  flushStrands();
  res.update = (t) => { for (const [o, w] of spinners) o.rotation.y = t * w; for (const a of anims) a(t); };
  return res;
}
