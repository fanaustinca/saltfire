// Procedural canvas textures (wood planking, deck, sail canvas, stone, sand) — cached.
import * as THREE from 'three';

const cache = new Map();
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d', { willReadFrequently: true })]; }
function rnd(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function tex(c, rep = [1, 1], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]);
  t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

/** Horizontal hull planking: greyscale so the hull colour tints it. Returns {map, bump}. */
export function planks() {
  return memo('planks', () => {
    const W = 512, H = 512, [c, g] = canvas(W, H), [cb, gb] = canvas(W, H);
    const r = rnd(7);
    const rows = 16, ph = H / rows;
    for (let y = 0; y < rows; y++) {
      let x = -r() * 200;
      while (x < W) {
        const len = 160 + r() * 220;
        const v = 175 + r() * 60;
        g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`; g.fillRect(x, y * ph, len, ph);
        // grain
        for (let i = 0; i < 14; i++) {
          g.strokeStyle = `rgba(60,40,20,${0.05 + r() * 0.09})`; g.lineWidth = 0.6 + r();
          g.beginPath(); const yy = y * ph + r() * ph; g.moveTo(x, yy);
          for (let k = 0; k <= 8; k++) g.lineTo(x + (len * k) / 8, yy + Math.sin(k * 1.3 + r() * 2) * 1.5);
          g.stroke();
        }
        // knots
        if (r() < 0.35) { g.fillStyle = 'rgba(70,45,25,0.35)'; g.beginPath(); g.ellipse(x + r() * len, y * ph + ph / 2, 5 + r() * 4, 2 + r() * 2, 0, 0, 7); g.fill(); }
        // butt joint + treenails
        g.fillStyle = 'rgba(30,20,10,0.75)'; g.fillRect(x, y * ph, 2, ph);
        g.fillStyle = 'rgba(40,25,10,0.6)'; for (const yy of [0.3, 0.7]) { g.beginPath(); g.arc(x + 7, y * ph + ph * yy, 1.6, 0, 7); g.fill(); }
        gb.fillStyle = '#000'; gb.fillRect(x, y * ph, 2, ph);
        x += len;
      }
      g.fillStyle = 'rgba(20,12,6,0.85)'; g.fillRect(0, y * ph, W, 2); // caulked seam
      gb.fillStyle = '#fff'; gb.fillRect(0, y * ph + 2, W, ph - 2); gb.fillStyle = '#000'; gb.fillRect(0, y * ph, W, 2);
    }
    return { map: tex(c), bump: tex(cb, [1, 1], false) };
  });
}

/** Deck planks running fore-aft. */
export function deck() {
  return memo('deck', () => {
    const W = 512, H = 512, [c, g] = canvas(W, H);
    const r = rnd(11);
    const cols = 12, pw = W / cols;
    for (let i = 0; i < cols; i++) {
      let y = -r() * 300;
      while (y < H) {
        const len = 200 + r() * 260, v = 160 + r() * 50;
        g.fillStyle = `rgb(${v * 1.05},${v * 0.9},${v * 0.68})`; g.fillRect(i * pw, y, pw, len);
        for (let k = 0; k < 8; k++) { g.strokeStyle = `rgba(70,45,20,${0.05 + r() * 0.08})`; g.beginPath(); const xx = i * pw + r() * pw; g.moveTo(xx, y); g.lineTo(xx + (r() - 0.5) * 3, y + len); g.stroke(); }
        g.fillStyle = 'rgba(30,20,10,0.7)'; g.fillRect(i * pw, y, pw, 2);
        y += len;
      }
      g.fillStyle = 'rgba(25,15,8,0.9)'; g.fillRect(i * pw, 0, 2, H);
    }
    return tex(c);
  });
}

/** Sail canvas: off-white cloth with vertical seams and reinforcement bands. Alpha channel holds
 *  a noise field that the damage shader thresholds to punch holes. */
export function sailcloth() {
  return memo('sail', () => {
    const W = 256, H = 256, [c, g] = canvas(W, H);
    const r = rnd(3);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const id = g.getImageData(0, 0, W, H);
    for (let i = 0; i < W * H; i++) { const n = 235 + r() * 20; id.data[i * 4] = n; id.data[i * 4 + 1] = n; id.data[i * 4 + 2] = n - 4; }
    g.putImageData(id, 0, 0);
    for (let x = 0; x < W; x += 21) { g.fillStyle = 'rgba(120,105,80,0.28)'; g.fillRect(x, 0, 1.5, H); }
    for (const y of [0.04, 0.33, 0.66]) { g.fillStyle = 'rgba(120,100,70,0.22)'; g.fillRect(0, y * H, W, 4); }
    g.fillStyle = 'rgba(110,90,60,0.4)'; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3); g.fillRect(0, 0, 3, H); g.fillRect(W - 3, 0, 3, H);
    return tex(c);
  });
}
/** Smooth value noise texture (R channel), for sail damage holes. */
export function noiseTex() {
  return memo('noise', () => {
    const W = 128, [c, g] = canvas(W, W), r = rnd(5);
    const grid = 16, v = [];
    for (let i = 0; i < (grid + 1) * (grid + 1); i++) v.push(r());
    const id = g.createImageData(W, W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const gx = (x / W) * grid, gy = (y / W) * grid, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const s = (t) => t * t * (3 - 2 * t);
      const a = v[iy * (grid + 1) + ix], b = v[iy * (grid + 1) + ix + 1], cc = v[(iy + 1) * (grid + 1) + ix], d = v[(iy + 1) * (grid + 1) + ix + 1];
      const n = (a + (b - a) * s(fx)) * (1 - s(fy)) + (cc + (d - cc) * s(fx)) * s(fy);
      const k = (y * W + x) * 4; id.data[k] = id.data[k + 1] = id.data[k + 2] = n * 255; id.data[k + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return tex(c, [1, 1], false);
  });
}

export function stone() {
  return memo('stone', () => {
    const W = 256, [c, g] = canvas(W, W), r = rnd(9);
    g.fillStyle = '#9a948a'; g.fillRect(0, 0, W, W);
    const rows = 8, h = W / rows;
    for (let y = 0; y < rows; y++) {
      let x = (y % 2) * -24;
      while (x < W) { const w = 36 + r() * 30, v = 130 + r() * 50; g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.9})`; g.fillRect(x + 2, y * h + 2, w - 3, h - 3); x += w; }
    }
    return tex(c, [3, 1]);
  });
}

/** Flag emblems drawn to canvas (index -> design). */
export const EMBLEMS = ['Skull', 'Crossed Swords', 'Hourglass', 'Anchor', 'Kraken', 'Crown', 'Star', 'Serpent'];
export function flagTex(emblem, bg = '#111', fg = '#eee') {
  return memo(`flag-${emblem}-${bg}-${fg}`, () => {
    const W = 128, H = 80, [c, g] = canvas(W, H);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = fg; g.strokeStyle = fg; g.lineWidth = 6; g.lineCap = 'round';
    const cx = W / 2, cy = H / 2;
    switch (emblem % EMBLEMS.length) {
      case 0: g.beginPath(); g.arc(cx, cy - 6, 16, 0, 7); g.fill(); g.fillRect(cx - 9, cy + 4, 18, 10); g.fillStyle = bg; g.beginPath(); g.arc(cx - 6, cy - 7, 4.5, 0, 7); g.arc(cx + 6, cy - 7, 4.5, 0, 7); g.fill(); g.fillStyle = fg;
        g.beginPath(); g.moveTo(cx - 30, cy + 22); g.lineTo(cx + 30, cy - 18); g.moveTo(cx + 30, cy + 22); g.lineTo(cx - 30, cy - 18); g.stroke(); break;
      case 1: g.beginPath(); g.moveTo(cx - 28, cy + 24); g.lineTo(cx + 26, cy - 24); g.moveTo(cx + 28, cy + 24); g.lineTo(cx - 26, cy - 24); g.stroke(); g.fillRect(cx - 34, cy + 12, 16, 5); g.fillRect(cx + 18, cy + 12, 16, 5); break;
      case 2: g.beginPath(); g.moveTo(cx - 16, cy - 26); g.lineTo(cx + 16, cy - 26); g.lineTo(cx - 16, cy + 26); g.lineTo(cx + 16, cy + 26); g.closePath(); g.fill(); break;
      case 3: g.beginPath(); g.moveTo(cx, cy - 26); g.lineTo(cx, cy + 24); g.moveTo(cx - 14, cy - 14); g.lineTo(cx + 14, cy - 14); g.stroke(); g.beginPath(); g.arc(cx, cy + 6, 20, 0.2, Math.PI - 0.2); g.stroke(); g.beginPath(); g.arc(cx, cy - 28, 5, 0, 7); g.stroke(); break;
      case 4: g.beginPath(); g.arc(cx, cy - 10, 14, Math.PI, 0); g.fill(); for (let i = 0; i < 5; i++) { g.beginPath(); const x0 = cx - 12 + i * 6; g.moveTo(x0, cy - 8); g.quadraticCurveTo(x0 + (i - 2) * 8, cy + 10, x0 + (i - 2) * 14, cy + 26); g.stroke(); } break;
      case 5: g.beginPath(); g.moveTo(cx - 24, cy + 16); g.lineTo(cx - 24, cy - 12); g.lineTo(cx - 12, cy); g.lineTo(cx, cy - 20); g.lineTo(cx + 12, cy); g.lineTo(cx + 24, cy - 12); g.lineTo(cx + 24, cy + 16); g.closePath(); g.fill(); break;
      case 6: g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 10 : 26; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); break;
      default: g.beginPath(); g.moveTo(cx - 34, cy + 12); g.bezierCurveTo(cx - 14, cy - 30, cx + 6, cy + 30, cx + 30, cy - 12); g.stroke(); g.beginPath(); g.arc(cx + 30, cy - 14, 6, 0, 7); g.fill();
    }
    const t = tex(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
  });
}

/** Soft round sprite used for smoke / spray / foam particles. */
export function puff() {
  return memo('puff', () => {
    const W = 64, [c, g] = canvas(W, W);
    const gr = g.createRadialGradient(W / 2, W / 2, 0, W / 2, W / 2, W / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
    const t = new THREE.CanvasTexture(c); return t;
  });
}
