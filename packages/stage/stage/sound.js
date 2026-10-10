// The stage's sound, synthesised with Web Audio: no assets, nothing to load.
// Two voices: a collision (one shot, for StageHero's presenter-triggered
// events) and a hum (continuous, for as long as the camera is at a station
// that asks for it).
//
// Autoplay policy: browsers keep an AudioContext suspended until the page has
// seen a click, tap or key press. warmAudio() is called from those gestures;
// it creates the context once and resumes it. Every failure path returns
// quietly — a slide must never log an error because a venue machine has no
// audio device.

// ---- the collision ------------------------------------------------------------
// One voice, ~0.45 s: a low sine "thump" (95 → 38 Hz, fast exponential decay)
// for the weight, under a white-noise "crack" through a resonant band-pass
// that sweeps down (2.6 kHz → 180 Hz) — bright at the impact, dark in the
// tail. Output peaks near -12 dBFS; laptop speakers still hear the crack when
// they lose the thump.

let ctx = null;
let noise = null;

function getContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  return ctx;
}

// Create the context (if needed) and ask it to run. Idempotent; call from a
// user gesture. Returns the context or null when Web Audio is unavailable.
export function warmAudio() {
  const ac = getContext();
  if (ac && ac.state !== 'running') { try { ac.resume().catch(() => {}); } catch { /* noop */ } }
  return ac;
}

// The stage's output: every voice, and a deck's own (ctx.audio().out), goes
// through one gain at `stage.sound.level`.
let out = null;
let outLevel = 1;
export function stageOut(level) {
  if (level != null && Number.isFinite(Number(level))) outLevel = Math.max(0, Number(level));
  const ac = getContext();
  if (!ac) return null;
  if (!out) { try { out = ac.createGain(); out.connect(ac.destination); } catch { out = null; return null; } }
  out.gain.value = outLevel;
  return out;
}
const dest = (ac) => stageOut() || ac.destination;

const LENGTH = 0.45;      // s to silence
const NOISE_PEAK = 0.55;  // pre-filter; the band-pass keeps a fraction of it
const THUMP_PEAK = 0.28;

function getNoise(ac) {
  if (noise) return noise;
  const n = Math.ceil(ac.sampleRate * (LENGTH + 0.05));
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  noise = buf;
  return noise;
}

export function playCollision() {
  const ac = getContext();
  if (!ac) return { played: false, reason: 'no-webaudio' };
  try {
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    const t0 = ac.currentTime;
    const master = ac.createGain();
    master.gain.value = 1;
    master.connect(dest(ac));

    // crack
    const src = ac.createBufferSource();
    src.buffer = getNoise(ac);
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(2600, t0);
    bp.frequency.exponentialRampToValueAtTime(180, t0 + LENGTH * 0.8);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(NOISE_PEAK, t0);
    ng.gain.exponentialRampToValueAtTime(NOISE_PEAK * 0.01, t0 + LENGTH * 0.7);
    ng.gain.linearRampToValueAtTime(0, t0 + LENGTH);
    src.connect(bp).connect(ng).connect(master);

    // thump
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, t0);
    osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.28);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(THUMP_PEAK, t0 + 0.012);
    og.gain.exponentialRampToValueAtTime(THUMP_PEAK * 0.01, t0 + 0.4);
    og.gain.linearRampToValueAtTime(0, t0 + LENGTH);
    osc.connect(og).connect(master);

    src.start(t0); src.stop(t0 + LENGTH + 0.03);
    osc.start(t0); osc.stop(t0 + LENGTH + 0.03);
    osc.onended = () => {
      try { for (const n of [src, bp, ng, osc, og, master]) n.disconnect(); } catch { /* noop */ }
    };
    return { played: true, state: ac.state };
  } catch (e) {
    return { played: false, reason: String(e && e.message || e) };
  }
}

// ---- the hum ------------------------------------------------------------------
// A low drone on a 55 Hz fundamental: two sawtooths 5 cents apart, the second
// at 0.4 of the first, so their slow beating (one swell every ~6 s) moves the
// drone without emptying it (at 7 cents and equal level the fundamental
// cancelled every 4.5 s and the hum pulsed), and a sine an octave up for
// laptop speakers, which reproduce little below ~150 Hz, all through a
// resonant low-pass whose cutoff breathes on a slow LFO. It swells in over
// 2.5 s, holds for as long as it is wanted and fades over 1.8 s. Output peaks
// near -14 dBFS.

const F0 = 55, DETUNE = 5, SAW_B = 0.4, PEAK = 0.1;
const ATTACK = 2.5, RELEASE = 1.8;
const CUT_LO = 90, CUT_HI = 320, LFO_HZ = 0.25, LFO_DEPTH = 40, Q = 1.8;

let hum = null;

// from wherever the automation is now, glide to a value
function glide(param, t, value, secs) {
  const cur = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(cur, t);
  param.linearRampToValueAtTime(value, t + secs);
}

export function startHum() {
  const ac = warmAudio();
  if (!ac) return { playing: false, reason: 'no-webaudio' };
  try {
    const t = ac.currentTime;
    if (hum) {
      // already humming, or fading out: cancel the fade and swell back
      if (hum.stopTimer) {
        clearTimeout(hum.stopTimer); hum.stopTimer = 0;
        glide(hum.master.gain, t, PEAK, ATTACK * 0.5);
        glide(hum.filter.frequency, t, CUT_HI, ATTACK * 0.5);
      }
      return { playing: true, state: ac.state };
    }
    const sawA = ac.createOscillator(); sawA.type = 'sawtooth'; sawA.frequency.value = F0;
    const sawB = ac.createOscillator(); sawB.type = 'sawtooth'; sawB.frequency.value = F0; sawB.detune.value = DETUNE;
    const sawBGain = ac.createGain(); sawBGain.gain.value = SAW_B;
    const octave = ac.createOscillator(); octave.type = 'sine'; octave.frequency.value = F0 * 2;
    const octaveGain = ac.createGain(); octaveGain.gain.value = 0.35;
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.Q.value = Q;
    filter.frequency.setValueAtTime(CUT_LO, t);
    filter.frequency.exponentialRampToValueAtTime(CUT_HI, t + ATTACK + 1);
    const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = LFO_HZ;
    const lfoGain = ac.createGain(); lfoGain.gain.value = LFO_DEPTH;
    lfo.connect(lfoGain).connect(filter.frequency);
    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t);
    master.gain.linearRampToValueAtTime(PEAK, t + ATTACK);
    const analyser = ac.createAnalyser(); analyser.fftSize = 8192;   // for humProbe()
    sawA.connect(filter); sawB.connect(sawBGain).connect(filter);
    octave.connect(octaveGain).connect(filter);
    filter.connect(master).connect(analyser).connect(dest(ac));
    const oscs = [sawA, sawB, octave, lfo];
    for (const o of oscs) o.start(t);
    hum = { ac, oscs, nodes: [...oscs, sawBGain, octaveGain, lfoGain, filter, master, analyser], master, filter, analyser, stopTimer: 0 };
    return { playing: true, state: ac.state };
  } catch (e) {
    return { playing: false, reason: String((e && e.message) || e) };
  }
}

export function stopHum() {
  if (!hum || hum.stopTimer) return;
  const h = hum;
  try {
    const t = h.ac.currentTime;
    glide(h.master.gain, t, 0.0001, RELEASE);
    glide(h.filter.frequency, t, CUT_LO, RELEASE);
  } catch { /* noop */ }
  h.stopTimer = setTimeout(() => {
    try { for (const o of h.oscs) o.stop(); for (const n of h.nodes) n.disconnect(); } catch { /* noop */ }
    if (hum === h) hum = null;
  }, (RELEASE + 0.3) * 1000);
}

// For the headless probes: the output level and the strongest frequency now.
export function humProbe() {
  if (!hum) return { playing: false };
  try {
    const a = hum.analyser;
    const buf = new Float32Array(a.fftSize); a.getFloatTimeDomainData(buf);
    let s = 0; for (const x of buf) s += x * x;
    const spec = new Float32Array(a.frequencyBinCount); a.getFloatFrequencyData(spec);
    let bi = 1; for (let i = 2; i < spec.length; i++) if (spec[i] > spec[bi]) bi = i;
    return { playing: true, fading: !!hum.stopTimer, state: hum.ac.state, rmsDb: +(20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9)).toFixed(1), peakHz: Math.round(bi * hum.ac.sampleRate / a.fftSize) };
  } catch (e) {
    return { playing: true, error: String(e) };
  }
}

// ---- movement -----------------------------------------------------------------
// Two short voices for things that move, both quiet enough to sit under a
// speaker's voice (peaks near -24 dBFS):
//
//   the whoosh   a flight. Noise through a band-pass that opens and closes
//                with the flight, low in pitch: air, not a swoosh effect.
//   the rise     a clip condensing out of the dust. Two sines a fifth apart
//                gliding up a fourth, with a breath of noise, swelling to the
//                moment the picture is whole and gone just after.
//
// Both return quietly when Web Audio is missing or still locked.
const last = { whoosh: 0, rise: 0 };
let longNoise = null;
function getLongNoise(ac) {
  if (longNoise && longNoise.sampleRate === ac.sampleRate) return longNoise;
  const n = Math.ceil(ac.sampleRate * 2);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const d = buf.getChannelData(0);
  // pink-ish: a one-pole low-pass over white, so it is breath rather than hiss
  let y = 0;
  for (let i = 0; i < n; i++) { y = 0.93 * y + 0.07 * (Math.random() * 2 - 1); d[i] = y * 3.2; }
  longNoise = buf;
  return longNoise;
}
function running() {
  const ac = getContext();
  return ac && ac.state === 'running' ? ac : null;
}

export function playWhoosh(seconds = 2, { level = 1 } = {}) {
  const ac = running();
  if (!ac) return { played: false, reason: 'locked' };
  if (ac.currentTime - last.whoosh < 0.25) return { played: false, reason: 'too-soon' };
  try {
    const t0 = ac.currentTime, dur = Math.min(6, Math.max(0.6, seconds));
    last.whoosh = t0;
    const src = ac.createBufferSource(); src.buffer = getLongNoise(ac); src.loop = true;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(140, t0);
    bp.frequency.exponentialRampToValueAtTime(520, t0 + dur * 0.5);
    bp.frequency.exponentialRampToValueAtTime(160, t0 + dur);
    const g = ac.createGain();
    const peak = 0.06 * Math.min(1.5, Math.max(0, level));
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(dest(ac));
    src.start(t0); src.stop(t0 + dur + 0.05);
    src.onended = () => { try { for (const n of [src, bp, g]) n.disconnect(); } catch { /* noop */ } };
    return { played: true, seconds: dur };
  } catch (e) {
    return { played: false, reason: String((e && e.message) || e) };
  }
}

export function playRise(seconds = 1.8, { level = 1 } = {}) {
  const ac = running();
  if (!ac) return { played: false, reason: 'locked' };
  if (ac.currentTime - last.rise < 0.25) return { played: false, reason: 'too-soon' };
  try {
    const t0 = ac.currentTime, dur = Math.min(5, Math.max(0.6, seconds));
    last.rise = t0;
    const peak = 0.05 * Math.min(1.5, Math.max(0, level));
    const out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.linearRampToValueAtTime(peak, t0 + dur * 0.85);
    out.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.45);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(300, t0);
    lp.frequency.exponentialRampToValueAtTime(1800, t0 + dur);
    const nodes = [out, lp];
    for (const [f, gain] of [[110, 1], [165, 0.6]]) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 4 / 3, t0 + dur);
      const g = ac.createGain(); g.gain.value = gain;
      o.connect(g).connect(lp);
      o.start(t0); o.stop(t0 + dur + 0.5);
      nodes.push(o, g);
    }
    const src = ac.createBufferSource(); src.buffer = getLongNoise(ac); src.loop = true;
    const ng = ac.createGain(); ng.gain.value = 0.35;
    src.connect(ng).connect(lp);
    src.start(t0); src.stop(t0 + dur + 0.5);
    nodes.push(src, ng);
    lp.connect(out).connect(dest(ac));
    src.onended = () => { try { for (const n of nodes) n.disconnect(); } catch { /* noop */ } };
    return { played: true, seconds: dur };
  } catch (e) {
    return { played: false, reason: String((e && e.message) || e) };
  }
}
