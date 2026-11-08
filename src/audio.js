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
  return ctx;
}
addEventListener('pointerdown', () => { init(); if (ctx?.state === 'suspended') ctx.resume(); }, { capture: true });
addEventListener('keydown', () => { init(); if (ctx?.state === 'suspended') ctx.resume(); }, { capture: true });

let noiseBuf = null;
function noise() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}
const att = (d) => Math.max(0.03, 1 / (1 + (d || 0) / 120));
function burst({ dur = 0.5, f = 800, q = 0.7, type = 'lowpass', gain = 0.5, sweep = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource(); src.buffer = noise(); src.playbackRate.value = 0.7 + Math.random() * 0.6;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (sweep) fl.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(fl).connect(g).connect(master);
  src.start(t, Math.random()); src.stop(t + dur + 0.05);
}
function tone({ f = 440, dur = 0.2, type = 'sine', gain = 0.2, slide = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  cannon(d = 0, n = 1) {
    if (!init()) return;
    const a = att(d);
    for (let i = 0; i < Math.min(n, 6); i++) {
      const dl = i * 0.07 + Math.random() * 0.03 + d / 340;
      burst({ dur: 1.4, f: 900, sweep: 90, gain: 0.55 * a, delay: dl });
      tone({ f: 70 + Math.random() * 15, slide: 32, dur: 0.6, gain: 0.6 * a, delay: dl });
    }
  },
  splash(d = 0) { if (!init()) return; burst({ dur: 0.7, f: 2400, sweep: 500, type: 'bandpass', q: 0.6, gain: 0.25 * att(d), delay: d / 340 }); },
  crack(d = 0) { if (!init()) return; burst({ dur: 0.25, f: 1800, type: 'highpass', gain: 0.35 * att(d), delay: d / 340 }); tone({ f: 140, slide: 60, dur: 0.18, type: 'square', gain: 0.08 * att(d), delay: d / 340 }); },
  boom(d = 0) { if (!init()) return; burst({ dur: 2.2, f: 600, sweep: 40, gain: 0.8 * att(d), delay: d / 340 }); tone({ f: 50, slide: 25, dur: 1.2, gain: 0.7 * att(d) }); },
  coin() { if (!init()) return; tone({ f: 1320, dur: 0.12, type: 'triangle', gain: 0.18 }); tone({ f: 1760, dur: 0.25, type: 'triangle', gain: 0.16, delay: 0.08 }); },
  chop() { if (!init()) return; burst({ dur: 0.12, f: 1200, type: 'bandpass', q: 3, gain: 0.25 }); },
  rope() { if (!init()) return; tone({ f: 180 + Math.random() * 40, slide: 120, dur: 0.35, type: 'sawtooth', gain: 0.04 }); burst({ dur: 0.3, f: 3000, type: 'bandpass', q: 2, gain: 0.08 }); },
  bell() { if (!init()) return; for (const [f, g] of [[880, 0.15], [1320, 0.06], [2210, 0.04]]) tone({ f, dur: 1.6, gain: g }); },
  click() { if (!init()) return; tone({ f: 900, dur: 0.05, type: 'square', gain: 0.05 }); },
  ui() { if (!init()) return; tone({ f: 660, dur: 0.07, type: 'triangle', gain: 0.08 }); },
  fanfare() { if (!init()) return; [523, 659, 784, 1046].forEach((f, i) => tone({ f, dur: 0.4, type: 'triangle', gain: 0.14, delay: i * 0.12 })); },
  setVolume(v) { vol = v; if (master) master.gain.value = v; save(); },
  get volume() { return vol; },
  setMusic(on) { musicOn = on; if (on) startMusic(); else stopMusic(); save(); },
  get music() { return musicOn; },
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
