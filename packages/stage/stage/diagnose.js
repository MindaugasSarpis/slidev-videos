// Why the stage runs as it does, or why it did not start: for a phone, where
// there is no console to read. Every fallback sets `data-stage-fallback` on
// the stage root and logs one `stage: fallback — <reason>` line; with
// `?stage-debug` in the address (before or after the #) a panel on screen
// shows the same, with the GPU, the render targets and the frame rate.
//
// Reasons:
//   reduced-motion   the device asks for reduced motion
//   no-webgl2        no WebGL2 context
//   no-float-target  WebGL2 without float or half-float colour buffers
//   plugin           a stage plugin failed to load
//   data             space.json could not be read
//   init             the engine threw while building the world
//   context-lost     the GPU dropped the WebGL context (iOS does under memory pressure)
export const FALLBACK_REASONS = ['reduced-motion', 'no-webgl2', 'no-float-target', 'plugin', 'data', 'init', 'context-lost'];

// `?stage-debug`, `?stage-debug=1`, or the same in the hash's query (`#/3?stage-debug`)
export function stageDebugOn(loc = globalThis.location) {
  if (!loc) return false;
  const q = [loc.search || '', (loc.hash || '').split('?').slice(1).join('?')].join('&');
  return /(^|[?&])stage-debug(=(1|true|on|yes))?(&|$)/i.test(q);
}

// What this browser's WebGL2 can do, from a throwaway context.
export function probeGL(doc = globalThis.document) {
  const out = { webgl2: false, float: false, halfFloat: false, floatLinear: false, floatBlend: false, gpu: '', maxTexture: 0, reason: null };
  let gl = null;
  try { gl = doc.createElement('canvas').getContext('webgl2'); } catch { /* none */ }
  if (!gl) { out.reason = 'no-webgl2'; return out; }
  out.webgl2 = true;
  try {
    out.float = gl.getExtension('EXT_color_buffer_float') !== null;
    out.halfFloat = gl.getExtension('EXT_color_buffer_half_float') !== null;
    out.floatLinear = gl.getExtension('OES_texture_float_linear') !== null;
    out.floatBlend = gl.getExtension('EXT_float_blend') !== null;
    out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
  } catch { /* keep what we have */ }
  // WebGL2 can always render to RGBA8, but the particle simulation needs float
  // or half-float targets; Safari on iOS has the half-float one.
  if (!out.float && !out.halfFloat) out.reason = 'no-float-target';
  try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* noop */ }
  return out;
}

// The panel's lines. s: { status, reason, detail, gl, space, device, events }
export function debugLines(s = {}) {
  const gl = s.gl || {}, sp = s.space || {}, dev = s.device || {}, ev = s.events || {};
  const yes = (b) => (b ? 'yes' : 'no');
  const lines = [
    `stage: ${s.status || '?'}${s.reason ? ` — ${s.reason}` : ''}${s.detail ? ` (${s.detail})` : ''}`,
    `gpu: ${gl.gpu || '?'}`,
    `webgl2 ${yes(gl.webgl2)} · float ${yes(gl.float)} · half-float ${yes(gl.halfFloat)} · float-linear ${yes(gl.floatLinear)} · float-blend ${yes(gl.floatBlend)} · max texture ${gl.maxTexture || '?'}`,
  ];
  if (s.overrides && Object.keys(s.overrides).length) lines.push(`overrides: ${Object.entries(s.overrides).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (sp.targets) lines.push(`tier ${sp.tier ?? '?'} · targets ${sp.targets}${sp.post === false ? ' · post off' : ''} · sim ${sp.sim}² · dpr ${fix(sp.dpr)} · canvas ${sp.canvas || '?'} · quality step ${sp.guard ?? '?'}`);
  if (sp.fps != null) lines.push(`fps ${fix(sp.fps, 0)} · frames ${sp.frames} · textures ${sp.textures ?? '?'} · programs ${sp.programs ?? '?'}`);
  lines.push(`device: ${dev.width}×${dev.height} @${fix(dev.dpr)} · memory ${dev.memory ?? '?'} GB · cores ${dev.cores ?? '?'} · touch ${yes(dev.coarse)} · reduced motion ${yes(dev.reduced)}`);
  if (ev.contextLost || ev.shaderErrors) lines.push(`context lost ${ev.contextLost || 0}× · shader errors ${ev.shaderErrors || 0}${ev.lastShaderError ? ` — ${ev.lastShaderError}` : ''}`);
  if (dev.ua) lines.push(dev.ua);
  return lines;
}

const fix = (v, d = 2) => (Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : '?');

export function deviceInfo(w = globalThis) {
  const mm = (q) => { try { return w.matchMedia(q).matches; } catch { return false; } };
  return {
    width: w.innerWidth, height: w.innerHeight, dpr: w.devicePixelRatio || 1,
    screenWidth: w.screen?.width, screenHeight: w.screen?.height,
    memory: w.navigator?.deviceMemory, cores: w.navigator?.hardwareConcurrency,
    coarse: mm('(pointer: coarse)'), reduced: mm('(prefers-reduced-motion: reduce)'),
    ua: String(w.navigator?.userAgent || '').slice(0, 160),
  };
}

// ---- quality tiers ---------------------------------------------------------------
// 0 full · 1 a tablet or a modest laptop · 2 a phone · 3 the floor (after a lost
// context). What a tier changes is in space.js TIERS; a deck can pin one with
// `stage.tier`. Safari has no navigator.deviceMemory, so a phone is known by a
// coarse pointer on a small screen.
export const MAX_TIER = 3;
export function pickTier(gl = {}, dev = {}) {
  const short = Math.min(dev.screenWidth || dev.width || 1280, dev.screenHeight || dev.height || 800);
  let tier = 0;
  if (dev.coarse) tier = short < 600 ? 2 : 1;
  if (dev.memory && dev.memory <= 4) tier = Math.max(tier, 1);
  if (dev.memory && dev.memory <= 2) tier = Math.max(tier, 2);
  if (gl.maxTexture && gl.maxTexture < 8192) tier = Math.max(tier, 2);
  return Math.min(MAX_TIER, tier);
}

// Switches in the address for narrowing a fault down on a device, before or
// after the # (?stage-debug&stage-post=off):
//   stage-post=off     the scene straight to the screen, no bloom or finish
//   stage-targets=half half-float simulation targets even where float would do
//   stage-tier=0..3    the quality tier
export function stageOverrides(loc = globalThis.location) {
  if (!loc) return {};
  const q = new URLSearchParams([loc.search || '', (loc.hash || '').split('?').slice(1).join('?')].map((x) => x.replace(/^\?/, '')).filter(Boolean).join('&'));
  const out = {};
  if (/^(off|0|false|no)$/i.test(q.get('stage-post') || '')) out.post = false;
  if ((q.get('stage-targets') || '').toLowerCase() === 'half') out.targets = 'half';
  const t = q.get('stage-tier');
  if (t != null && /^[0-3]$/.test(t)) out.tier = Number(t);
  return out;
}
