// Why the stage fell back, readable from a phone (stage/diagnose.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageDebugOn, probeGL, debugLines, pickTier, stageOverrides, FALLBACK_REASONS } from '../stage/diagnose.js';

test('?stage-debug is found before or after the hash', () => {
  assert.equal(stageDebugOn({ search: '?stage-debug', hash: '#/3' }), true);
  assert.equal(stageDebugOn({ search: '?x=1&stage-debug=1', hash: '' }), true);
  assert.equal(stageDebugOn({ search: '', hash: '#/3?stage-debug' }), true);
  assert.equal(stageDebugOn({ search: '', hash: '#/3?clicks=2&stage-debug=true' }), true);
  assert.equal(stageDebugOn({ search: '?stage-debug=0', hash: '' }), false);
  assert.equal(stageDebugOn({ search: '?stage-debugger', hash: '#/stage-debug' }), false);
  assert.equal(stageDebugOn(undefined), false);
});

const fakeDoc = (exts, { webgl2 = true } = {}) => ({
  createElement: () => ({
    getContext: () => (webgl2 ? {
      MAX_TEXTURE_SIZE: 1, RENDERER: 2,
      getExtension: (n) => (n === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 3 } : n === 'WEBGL_lose_context' ? { loseContext() {} } : exts.includes(n) ? {} : null),
      getParameter: (p) => ({ 1: 4096, 2: 'WebKit WebGL', 3: 'Apple GPU' })[p],
    } : null),
  }),
});

test('probeGL names the reason a phone cannot run the stage', () => {
  const ios = probeGL(fakeDoc(['EXT_color_buffer_half_float']));
  assert.deepEqual(ios, { webgl2: true, float: false, halfFloat: true, floatLinear: false, floatBlend: false, gpu: 'Apple GPU', maxTexture: 4096, reason: null });
  assert.equal(probeGL(fakeDoc([])).reason, 'no-float-target');
  assert.equal(probeGL(fakeDoc([], { webgl2: false })).reason, 'no-webgl2');
  for (const r of ['no-webgl2', 'no-float-target', 'context-lost', 'reduced-motion']) assert.ok(FALLBACK_REASONS.includes(r));
});

test('the debug panel says the reason first, then what the GPU has', () => {
  const lines = debugLines({
    status: 'fallback', reason: 'context-lost',
    gl: { webgl2: true, float: false, halfFloat: true, gpu: 'Apple GPU', maxTexture: 4096 },
    device: { width: 390, height: 844, dpr: 3, coarse: true, reduced: false },
    events: { contextLost: 1 },
  });
  assert.equal(lines[0], 'stage: fallback — context-lost');
  assert.match(lines[1], /Apple GPU/);
  assert.match(lines[2], /float no · half-float yes · float-linear no · float-blend no · max texture 4096/);
  assert.ok(lines.some((l) => /context lost 1×/.test(l)));
  const running = debugLines({ status: 'running', space: { targets: 'half-float', sim: 192, dpr: 1.5, canvas: '585×330', guard: 0, fps: 58.4, frames: 300, textures: 24, programs: 27 } });
  assert.ok(running.some((l) => l.startsWith('tier ? · targets half-float · sim 192²')));
  assert.ok(running.some((l) => l.startsWith('fps 58 ')));
});

test('a phone starts at tier 2, a laptop at 0, a small GPU or memory lower', () => {
  assert.equal(pickTier({ maxTexture: 16384 }, { coarse: true, screenWidth: 390, screenHeight: 844 }), 2);   // iPhone
  assert.equal(pickTier({ maxTexture: 16384 }, { coarse: true, screenWidth: 820, screenHeight: 1180 }), 1);  // iPad
  assert.equal(pickTier({ maxTexture: 16384 }, { coarse: false, screenWidth: 1920, screenHeight: 1080, memory: 8 }), 0);
  assert.equal(pickTier({ maxTexture: 16384 }, { coarse: false, screenWidth: 1920, screenHeight: 1080, memory: 4 }), 1);
  assert.equal(pickTier({ maxTexture: 4096 }, { coarse: false, screenWidth: 1920, screenHeight: 1080 }), 2);
  assert.equal(pickTier(), 0);
});

test('switches in the address narrow a fault down on a device', () => {
  assert.deepEqual(stageOverrides({ search: '?stage-debug&stage-post=off', hash: '#/4' }), { post: false });
  assert.deepEqual(stageOverrides({ search: '', hash: '#/4?stage-targets=half&stage-tier=3' }), { targets: 'half', tier: 3 });
  assert.deepEqual(stageOverrides({ search: '?stage-tier=9&stage-post=on', hash: '' }), {});
  const lines = debugLines({ status: 'running', overrides: { post: false }, space: { targets: 'float', post: false, sim: 144, tier: 2 } });
  assert.ok(lines.includes('overrides: post=false'));
  assert.ok(lines.some((l) => l.includes('targets float · post off')));
});
