// Procedural WebAudio: cannon booms, splashes, timber cracks, coins, ocean ambience and a small
// original shanty loop. No audio files.
let ctx = null, master = null, music = null, amb = null;
let vol = 0.7, musicOn = true;
try { const s = JSON.parse(localStorage.getItem('saltfire-audio') || '{}'); if (s.vol != null) vol = s.vol; if (s.music != null) musicOn = s.music; } catch { /* */ }

function init() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = vol;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  ambience();
  if (musicOn) startMusic();
  buildBank();
  return ctx;
}
addEventListener('pointerdown', () => { init(); if (ctx?.state === 'suspended') ctx.resume(); }, { capture: true });
addEventListener('keydown', () => { init(); if (ctx?.state === 'suspended') ctx.resume(); }, { capture: true });

// ---- synthesis helpers (work on a live or an offline context)
const noiseBufs = new WeakMap();
function noiseFor(c) {
  let b = noiseBufs.get(c);
  if (b) return b;
  b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBufs.set(c, b);
  return b;
}
const noise = () => noiseFor(ctx);
const att = (d) => Math.max(0.03, 1 / (1 + (d || 0) / 120));
function burst({ dur = 0.5, f = 800, q = 0.7, type = 'lowpass', gain = 0.5, sweep = null, delay = 0 }, c = ctx, dest = master) {
  if (!c) return;
  const t = (c === ctx ? c.currentTime : 0) + delay;
  const src = c.createBufferSource(); src.buffer = noiseFor(c); src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(fl).connect(g).connect(dest);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone({ f = 440, dur = 0.2, type = 'sine', gain = 0.2, slide = null, delay = 0 }, c = ctx, dest = master) {
  if (!c) return;
  const t = (c === ctx ? c.currentTime : 0) + delay;
  const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}

// ---- pre-rendered sample bank: heavy sounds are synthesised ONCE (offline) into buffers, then each
// play is a single buffer source + gain. Hundreds of hits in a battle no longer build hundreds of
// filter/oscillator graphs, which is what made the audio crackle and drop out.
const BANK = {};
const RECIPES = {
  cannon: { dur: 1.6, n: 4, fn: (c, d) => { burst({ dur: 1.4, f: 900, sweep: 90, gain: 0.55 }, c, d); tone({ f: 70 + Math.random() * 15, slide: 32, dur: 0.6, gain: 0.6 }, c, d); } },
  volley: { dur: 1.9, n: 3, fn: (c, d) => { for (let i = 0; i < 4; i++) { const dl = i * 0.07 + Math.random() * 0.03; burst({ dur: 1.4, f: 900, sweep: 90, gain: 0.42, delay: dl }, c, d); tone({ f: 66 + Math.random() * 18, slide: 30, dur: 0.6, gain: 0.45, delay: dl }, c, d); } } },
  splash: { dur: 0.8, n: 3, fn: (c, d) => burst({ dur: 0.7, f: 2400, sweep: 500, type: 'bandpass', q: 0.6, gain: 0.25 }, c, d) },
  crack: { dur: 0.3, n: 3, fn: (c, d) => { burst({ dur: 0.25, f: 1800, type: 'highpass', gain: 0.35 }, c, d); tone({ f: 140, slide: 60, dur: 0.18, type: 'square', gain: 0.08 }, c, d); } },
  boom: { dur: 2.3, n: 2, fn: (c, d) => { burst({ dur: 2.2, f: 600, sweep: 40, gain: 0.8 }, c, d); tone({ f: 50, slide: 25, dur: 1.2, gain: 0.7 }, c, d); } },
  thunder: { dur: 4.5, n: 2, fn: (c, d) => { burst({ dur: 0.35, f: 2600, sweep: 900, gain: 0.5 }, c, d); burst({ dur: 4.2, f: 380, sweep: 30, gain: 0.95, delay: 0.12 }, c, d); tone({ f: 42, slide: 26, dur: 3.2, gain: 0.55, delay: 0.1 }, c, d); } },
  chop: { dur: 0.15, n: 2, fn: (c, d) => burst({ dur: 0.12, f: 1200, type: 'bandpass', q: 3, gain: 0.25 }, c, d) },
};
async function buildBank() {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OC) return;
  for (const [k, R] of Object.entries(RECIPES)) {
    BANK[k] = [];
    for (let i = 0; i < R.n; i++) {
      try { const oc = new OC(1, Math.ceil(ctx.sampleRate * R.dur), ctx.sampleRate); R.fn(oc, oc.destination); BANK[k].push(await oc.startRendering()); } catch { /* */ }
    }
  }
}
// voice limiting + per-kind rate limiting
const MAX_VOICES = 28;
let voices = 0;
const lastAt = {};
function play(kind, gain, delay = 0, rate = 1) {
  if (!ctx || gain < 0.035) return; // too far away to matter
  const now = ctx.currentTime;
  // the same kind of sound within 40 ms just merges into the one already playing
  const minGap = kind === 'cannon' || kind === 'volley' ? 0.03 : 0.05;
  const key = kind + Math.round(delay * 10);
  if (lastAt[key] && now - lastAt[key] < minGap) return;
  if (voices >= MAX_VOICES && gain < 0.4) return;
  const bufs = BANK[kind];
  if (!bufs?.length) { RECIPES[kind].fn(ctx, master); return; } // bank still rendering: synthesise live
  lastAt[key] = now;
  const src = ctx.createBufferSource(); src.buffer = bufs[Math.floor(Math.random() * bufs.length)];
  src.playbackRate.value = rate * (0.92 + Math.random() * 0.16);
  const g = ctx.createGain(); g.gain.value = Math.min(1.2, gain);
  src.connect(g).connect(master);
  voices++; src.onended = () => { voices--; g.disconnect(); };
  src.start(now + delay);
}

export const sfx = {
  cannon(d = 0, n = 1) {
    if (!init()) return;
    const a = att(d), dl = d / 340;
    if (n <= 2) { for (let i = 0; i < n; i++) play('cannon', a, dl + i * 0.08); return; }
    // a big broadside is a rolling volley: a couple of pre-mixed layers, louder with more guns
    const layers = Math.min(3, Math.ceil(n / 6));
    for (let i = 0; i < layers; i++) play('volley', a * Math.min(1.5, 0.8 + n * 0.02), dl + i * 0.22, 1 - i * 0.04);
  },
  splash(d = 0) { if (!init()) return; play('splash', att(d), d / 340); },
  crack(d = 0) { if (!init()) return; play('crack', att(d), d / 340); },
  boom(d = 0) { if (!init()) return; play('boom', att(d), d / 340); },
  thunder(d = 0) { if (!init()) return; play('thunder', Math.max(0.25, att(d) * 1.3), Math.min(3, d / 340)); },
  coin() { if (!init()) return; tone({ f: 1320, dur: 0.12, type: 'triangle', gain: 0.18 }); tone({ f: 1760, dur: 0.25, type: 'triangle', gain: 0.16, delay: 0.08 }); },
  chop(d = 0) { if (!init()) return; play('chop', att(d)); },
  rope() { if (!init()) return; tone({ f: 180 + Math.random() * 40, slide: 120, dur: 0.35, type: 'sawtooth', gain: 0.04 }); burst({ dur: 0.3, f: 3000, type: 'bandpass', q: 2, gain: 0.08 }); },
  bell() { if (!init()) return; for (const [f, g] of [[880, 0.15], [1320, 0.06], [2210, 0.04]]) tone({ f, dur: 1.6, gain: g }); },
  click() { if (!init()) return; tone({ f: 900, dur: 0.05, type: 'square', gain: 0.05 }); },
  ui() { if (!init()) return; tone({ f: 660, dur: 0.07, type: 'triangle', gain: 0.08 }); },
  fanfare() { if (!init()) return; [523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.4, type: 'triangle', gain: 0.14, delay: i * 0.12 })); },
  setVolume(v) { vol = v; if (master) master.gain.value = v; save(); },
  get volume() { return vol; },
  setMusic(on) { musicOn = on; if (on) startMusic(); else stopMusic(); save(); },
  get music() { return musicOn; },
  get voices() { return voices; },
};
function save() { try { localStorage.setItem('saltfire-audio', JSON.stringify({ vol, music: musicOn })); } catch { /* */ } }

function ambience() {
  // two slow-modulated noise beds: surf + wind
  for (const [f, g, rate] of [[420, 0.07, 0.11], [1800, 0.025, 0.07]]) {
    const src = ctx.createBufferSource(); src.buffer = noise(); src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f;
    const gn = ctx.createGain(); gn.gain.value = g;
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate; const lg = ctx.createGain(); lg.gain.value = g * 0.8;
    lfo.connect(lg).connect(gn.gain); lfo.start();
    src.connect(fl).connect(gn).connect(master); src.start();
  }
  amb = true;
}

// --- a short original shanty in D dorian, 6/8, played softly on a squeezebox-ish voice
const NOTES = { D: 62, E: 64, F: 65, G: 67, A: 69, B: 71, C: 72, d: 74, e: 76, f: 77, g: 79, a: 81 };
const TUNE = 'D.FA.d c.AG.E F.ED.. A.dd.c A.GF.G A.cd.. d.cA.G F.ED.E F.GA.F E.DD..';
let mTimer = null;
function startMusic() {
  if (!ctx || mTimer) return;
  music = ctx.createGain(); music.gain.value = 0.05; music.connect(master);
  const steps = TUNE.replace(/ /g, '').split('');
  let i = 0;
  const beat = 0.2;
  mTimer = setInterval(() => {
    const ch = steps[i % steps.length]; i++;
    if (ch === '.') return;
    const midi = NOTES[ch]; if (!midi) return;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const t = ctx.currentTime;
    for (const [mul, type, g] of [[1, 'sawtooth', 0.5], [1.005, 'square', 0.25], [0.5, 'triangle', 0.6]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1400;
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.03); gn.gain.exponentialRampToValueAtTime(0.001, t + beat * 1.9);
      o.connect(fl).connect(gn).connect(music); o.start(t); o.stop(t + beat * 2);
    }
    if (i % 3 === 1) { // bass on the beat
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f / 4;
      const gn = ctx.createGain(); gn.gain.setValueAtTime(0.7, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(gn).connect(music); o.start(t); o.stop(t + 0.55);
    }
  }, beat * 1000);
}
function stopMusic() { if (mTimer) { clearInterval(mTimer); mTimer = null; } if (music) { music.disconnect(); music = null; } }
