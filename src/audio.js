// Procedural WebAudio: cannon booms, splashes, timber cracks, coins, ocean ambience and a small
// original shanty played by a little synthesised crew band. No audio files.
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
  whistle: { dur: 1.3, n: 2, fn: (c, d) => { tone({ f: 700, slide: 2600, dur: 1.1, type: 'triangle', gain: 0.07 }, c, d); burst({ dur: 1.1, f: 3000, type: 'bandpass', q: 3, gain: 0.05 }, c, d); } },
  pop: { dur: 2.2, n: 3, fn: (c, d) => { burst({ dur: 0.9, f: 1400, sweep: 120, gain: 0.6 }, c, d); tone({ f: 90, slide: 40, dur: 0.5, gain: 0.4 }, c, d); for (let i = 0; i < 14; i++) burst({ dur: 0.05, f: 4000 + Math.random() * 3000, type: 'highpass', gain: 0.12, delay: 0.25 + Math.random() * 1.6 }, c, d); } },
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
  firework(d = 0, fuse = 1.2) { if (!init()) return; play('whistle', att(d) * 0.8, d / 340); play('pop', att(d), fuse + d / 340); },
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
  /** 0 = sailing, 1 = in a fight: the crew band drums harder. */
  mood(k) { setMusicMood(k); },
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

// --- an original rollicking shanty in D minor, 6/8 jig time. Arranged as a little crew band: a fiddle/squeezebox
// lead, oom-pah-pah accordion chords, a plucked bass, stomps + claps + shaker, a crew "HEY!" at the end of every
// chorus and a pipe counter-melody the second time round. The drums dig in harder during a fight (sfx.mood).
// Notes are scheduled ahead on the audio clock (a look-ahead scheduler), so the groove stays tight.
const NN = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const midiOf = (n) => { const m = /^([A-G][b#]?)(\d)$/.exec(n); return m ? 12 * (+m[2] + 1) + NN[m[1]] : null; };
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
// each bar = 6 eighth notes; '-' holds the previous note, '.' is a rest
const SECTIONS = {
  A: { ch: ['Dm', 'Gm', 'C', 'C', 'Dm', 'Gm', 'A', 'Dm'], mel: [
    'D4 - A3 D4 E4 F4', 'G4 - F4 E4 - D4', 'C4 - E4 G4 - E4', 'C4 D4 E4 F4 - E4',
    'D4 - A3 D4 E4 F4', 'G4 - A4 Bb4 - A4', 'G4 F4 E4 C#4 - E4', 'D4 - - D4 - .'] },
  B: { ch: ['Dm', 'Bb', 'C', 'Dm', 'Dm', 'Bb', 'A', 'Dm'], hey: true, mel: [
    'A4 - A4 A4 G4 F4', 'Bb4 - A4 G4 - F4', 'E4 - C4 C4 D4 E4', 'F4 - E4 D4 - .',
    'A4 - A4 A4 G4 F4', 'Bb4 - D5 C5 - Bb4', 'A4 G4 F4 E4 - C#4', 'D4 - - D4 . .'] },
  C: { ch: ['F', 'Bb', 'F', 'C', 'Dm', 'Gm', 'A', 'A'], mel: [
    'F4 - F4 A4 - C5', 'D5 - C5 Bb4 - A4', 'A4 - F4 G4 - A4', 'G4 F4 E4 C4 - .',
    'D4 E4 F4 A4 - D5', 'D5 C5 Bb4 G4 - Bb4', 'A4 - G#4 A4 B4 C#5', 'E5 - - A4 - .'] },
};
const ORDER = ['A', 'A', 'B', 'B', 'C', 'B'];
const CHORDS = { Dm: [50, 53, 57], Gm: [55, 58, 62], C: [48, 52, 55], A: [45, 49, 52], Bb: [46, 50, 53], F: [53, 57, 60] };
const EIGHTH = 0.165;
// harmony a diatonic third above, in D minor (C# — the leading note — harmonises up to E)
const DMIN = [2, 4, 5, 7, 9, 10, 0];
function third(n) {
  const pc = ((n % 12) + 12) % 12, i = DMIN.indexOf(pc);
  if (i < 0) return n + 3;
  const up = DMIN[(i + 2) % 7];
  return n + ((up - pc + 12) % 12);
} // ≈ 121 bpm dotted-quarter: a brisk jig
let mTimer = null, mood = 0, mNext = 0, mStep = 0;
const SONG = (() => { // flatten into steps
  const out = [];
  ORDER.forEach((sec, si) => {
    const S = SECTIONS[sec], pass = ORDER.slice(0, si).filter((x) => x === sec).length;
    S.mel.forEach((bar, b) => bar.split(' ').forEach((tok, e) => {
      let len = 0; if (tok !== '-' && tok !== '.') { len = 1; const toks = bar.split(' '); for (let k = e + 1; k < 6 && toks[k] === '-'; k++) len++; }
      out.push({ sec, pass, bar: b, e, note: len ? midiOf(tok) : null, len, chord: S.ch[b], hey: S.hey && b === 7 && e === 4, last: b === 7 });
    }));
  });
  return out;
})();
function voice(type, f, t, dur, g, cut, dest, { det = 0, vib = 0, atk = 0.012 } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
  if (vib) { const l = ctx.createOscillator(); l.frequency.value = 5.6; const lg = ctx.createGain(); lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(vib, t + Math.min(dur, 0.25)); l.connect(lg).connect(o.detune); l.start(t); l.stop(t + dur + 0.1); }
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cut; fl.Q.value = 0.8;
  const gn = ctx.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + atk); gn.gain.setValueAtTime(g, t + Math.max(atk, dur * 0.6)); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(fl).connect(gn).connect(dest); o.start(t); o.stop(t + dur + 0.05);
}
function hit(t, { f = 1200, type = 'bandpass', q = 1, dur = 0.05, g = 0.3 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise();
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  const gn = ctx.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(fl).connect(gn).connect(music); src.start(t, Math.random()); src.stop(t + dur + 0.02);
}
function stomp(t, g) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16); const gn = ctx.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(gn).connect(music); o.start(t); o.stop(t + 0.3); hit(t, { f: 300, type: 'lowpass', dur: 0.08, g: g * 0.5 }); }
function clap(t, g) { for (let i = 0; i < 3; i++) hit(t + i * 0.011, { f: 1500, q: 1.4, dur: 0.06 + i * 0.03, g: g * (i === 2 ? 1 : 0.6) }); }
function hey(t) { // a gang of hoarse sailors shouting "HEY!": detuned buzzy voices through an "eh" formant pair
  for (let v = 0; v < 5; v++) {
    const f0 = 150 + v * 23 + Math.random() * 10, d = t + v * 0.012;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.15, d); o.frequency.exponentialRampToValueAtTime(f0 * 0.85, d + 0.3);
    const gn = ctx.createGain(); gn.gain.setValueAtTime(0, d); gn.gain.linearRampToValueAtTime(0.16, d + 0.03); gn.gain.exponentialRampToValueAtTime(0.001, d + 0.32);
    for (const [ff, q, k] of [[620, 6, 1], [1750, 8, 0.6]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; const kg = ctx.createGain(); kg.gain.value = k * 3; o.connect(bp).connect(kg).connect(gn); }
    gn.connect(music); o.start(d); o.stop(d + 0.35);
  }
  hit(t, { f: 2600, q: 0.7, dur: 0.12, g: 0.35 });
}
function schedStep(st, t) {
  const E = EIGHTH, beat = st.e === 0 || st.e === 3, big = st.e === 0;
  // lead: fiddle + squeezebox reed doubling (detuned saws), vibrato on held notes
  if (st.note) {
    const f = hz(st.note), dur = st.len * E * 0.95;
    voice('sawtooth', f, t, dur, 0.34, 2400, music, { det: -7, vib: st.len > 1 ? 14 : 0 });
    voice('sawtooth', f, t, dur, 0.28, 2000, music, { det: 8, vib: st.len > 1 ? 12 : 0 });
    voice('square', f / 2, t, dur, 0.1, 900, music);
    // pipe counter-melody a sixth above on repeat passes of the chorus
    if (st.sec === 'B' && st.pass > 0) voice('triangle', hz(third(st.note) + 12), t, dur, 0.16, 5000, music, { vib: 10, atk: 0.03 });
  }
  const C = CHORDS[st.chord];
  // oom (bass) on beats 1 + 4, pah-pah (accordion stabs) on the off-eighths
  if (beat) { const root = C[0] - 12 + (st.e === 3 && st.bar % 2 ? 7 : 0); voice('triangle', hz(root), t, E * 2.2, 0.55, 700, music); voice('sine', hz(root - 12), t, E * 1.6, 0.35, 300, music); }
  else for (const n of C) voice('sawtooth', hz(n + 12), t, E * 0.7, 0.07, 1500, music, { det: (n % 3) * 4 - 4, atk: 0.006 });
  // percussion
  if (big) stomp(t, 0.55 + mood * 0.2); else if (st.e === 3) stomp(t, 0.32 + mood * 0.25);
  if (st.e === 3 && (st.bar % 2 === 1 || mood > 0.3)) clap(t, 0.25);
  hit(t, { f: 7000, type: 'highpass', dur: 0.035, g: st.e % 3 === 0 ? 0.09 : 0.05 });
  if (mood > 0.3 && st.e % 3 === 2) hit(t + E * 0.5, { f: 900, q: 0.8, dur: 0.06, g: 0.14 * mood }); // battle: snare pickups
  if (st.last && st.e >= 4 && mood > 0.3) clap(t + E * 0.5, 0.2);
  if (st.hey) hey(t);
}
function startMusic() {
  if (!ctx || mTimer) return;
  music = ctx.createGain(); music.gain.value = 0.06; music.connect(master);
  mNext = ctx.currentTime + 0.1; mStep = 0;
  mTimer = setInterval(() => {
    if (!ctx || !music) return;
    if (mNext < ctx.currentTime - 0.5) mNext = ctx.currentTime + 0.05; // tab was asleep: don't burst out a backlog
    while (mNext < ctx.currentTime + 0.18) { schedStep(SONG[mStep % SONG.length], mNext); mNext += EIGHTH; mStep++; }
  }, 40);
}
function stopMusic() { if (mTimer) { clearInterval(mTimer); mTimer = null; } if (music) { music.disconnect(); music = null; } }
export const setMusicMood = (k) => { mood = Math.max(0, Math.min(1, k)); };
export const songInfo = () => ({ steps: SONG.length, eighth: EIGHTH, seconds: SONG.length * EIGHTH });
