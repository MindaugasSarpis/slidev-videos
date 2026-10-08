// lib/chromium.mjs, the launcher every stage tool shares: which backends it
// tries, in what order, with what flags and environment, and what it keeps.
// No browser: a fake Playwright answers with the renderer a real one would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitArgs, parseEnv, plan, machine, cachedShells, launch, ARGS, COMMON, MODES } from '../bin/lib/chromium.mjs';

const WSL = { wsl: true, dxg: true, nvidiaSmi: '/usr/lib/wsl/lib/nvidia-smi', x0: true, mesa: { prefix: '/p', ok: true } };
const NATIVE = { wsl: false, dxg: false, nvidiaSmi: '/usr/bin/nvidia-smi', x0: false, mesa: { prefix: '/p', ok: false } };
const CI = { wsl: false, dxg: false, nvidiaSmi: null, x0: false, mesa: { prefix: '/p', ok: false } };

test('shell words and KEY=VAL lists from the environment', () => {
  assert.deepEqual(splitArgs(''), []);
  assert.deepEqual(splitArgs(undefined), []);
  assert.deepEqual(splitArgs(`  --a --b=1  'c d' "e \\"f\\"" g\\ h ''`), ['--a', '--b=1', 'c d', 'e "f"', 'g h', '']);
  assert.throws(() => splitArgs(`--a 'b`), /unclosed '/);
  assert.deepEqual(parseEnv('A=1; B=x y ;;C='), { A: '1', B: 'x y', C: '' });
  assert.deepEqual(parseEnv('LD_LIBRARY_PATH=/a:/b;X=a=b'), { LD_LIBRARY_PATH: '/a:/b', X: 'a=b' });
  assert.throws(() => parseEnv('A=1;oops'), /KEY=VAL/);
});

test('auto in WSL: d3d12 from the Mesa prefix, then llvmpipe, then SwiftShader', () => {
  const p = plan('auto', { env: {}, m: WSL });
  assert.deepEqual(p.steps.map((s) => s.backend), ['d3d12', 'llvmpipe', 'swiftshader']);
  assert.deepEqual(p.skipped, [{ backend: 'gpu-nvidia', why: 'WSL, where the GPU is the d3d12 backend' }]);
  const [d3d12, llvmpipe, swift] = p.steps;
  assert.deepEqual(d3d12.env, {
    LD_LIBRARY_PATH: '/p/root/usr/lib64:/usr/lib/wsl/lib', LIBGL_DRIVERS_PATH: '/p/root/usr/lib64/dri', GALLIUM_DRIVER: 'd3d12',
    MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA', DISPLAY: ':0',
  });
  assert.ok(!('VK_ICD_FILENAMES' in d3d12.env));
  assert.deepEqual(llvmpipe.env, { DISPLAY: ':0', LP_NUM_THREADS: '8' });
  assert.deepEqual(swift.env, {});
  assert.deepEqual(d3d12.args, [...ARGS.d3d12, ...COMMON]);
  assert.deepEqual(swift.args, [...ARGS.swiftshader, ...COMMON]);
});

test('the environment wins: DISPLAY, LP_NUM_THREADS, an adapter name, LD_LIBRARY_PATH kept after the prefix', () => {
  const env = { DISPLAY: ':1', LP_NUM_THREADS: '4', MESA_D3D12_DEFAULT_ADAPTER_NAME: 'AMD', LD_LIBRARY_PATH: '/mine' };
  const [d3d12, llvmpipe] = plan('auto', { env, m: WSL }).steps;
  assert.equal(d3d12.env.LD_LIBRARY_PATH, '/p/root/usr/lib64:/usr/lib/wsl/lib:/mine');
  assert.ok(!('DISPLAY' in d3d12.env) && !('MESA_D3D12_DEFAULT_ADAPTER_NAME' in d3d12.env));
  assert.deepEqual(llvmpipe.env, {});
});

test('without a Mesa prefix, an X socket or a GPU, auto skips what cannot work and says why', () => {
  const p = plan('auto', { env: {}, m: { ...WSL, mesa: { prefix: '/nowhere', ok: false } } });
  assert.deepEqual(p.steps.map((s) => s.backend), ['llvmpipe', 'swiftshader']);
  assert.match(p.skipped[1].why, /no Mesa d3d12 driver under \/nowhere \(SLIDEV_STAGE_MESA_D3D12\)/);
  const n = plan('auto', { env: {}, m: NATIVE });
  assert.deepEqual(n.steps.map((s) => s.backend), ['gpu-nvidia', 'swiftshader']);
  assert.deepEqual(n.skipped.map((s) => s.backend), ['d3d12', 'llvmpipe']);
  assert.deepEqual(n.steps[0].args, [...ARGS['gpu-nvidia'], ...COMMON]);
  assert.deepEqual(plan('auto', { env: {}, m: CI }).steps.map((s) => s.backend), ['swiftshader']);
  assert.deepEqual(plan('auto', { env: { DISPLAY: ':99' }, m: CI }).steps.map((s) => s.backend), ['llvmpipe', 'swiftshader']);
});

test('a forced backend is tried even where auto would skip it, except d3d12 without its prefix', () => {
  assert.deepEqual(plan('llvmpipe', { env: {}, m: CI }).steps.map((s) => s.backend), ['llvmpipe']);
  assert.deepEqual(plan('gpu-nvidia', { env: {}, m: WSL }).steps.map((s) => s.backend), ['gpu-nvidia']);
  const none = plan('d3d12', { env: {}, m: CI });
  assert.deepEqual(none.steps, []);
  assert.match(none.skipped[0].why, /no \/dev\/dxg/);
  assert.deepEqual(plan('gl', { env: {}, m: WSL }).steps.map((s) => s.backend), ['d3d12', 'llvmpipe']);
  assert.deepEqual(plan('none', { env: {}, m: WSL }).steps[0].args.slice(0, 1), ['--disable-3d-apis']);
  assert.throws(() => plan('vulkan', { env: {}, m: WSL }), /SLIDEV_STAGE_GL \/ --gl: auto, gpu-nvidia, d3d12, llvmpipe, swiftshader, gl, none; not vulkan/);
  assert.deepEqual(MODES, ['auto', 'gpu-nvidia', 'd3d12', 'llvmpipe', 'swiftshader', 'gl', 'none']);
});

test('the tool\'s flags come after the backend\'s, SLIDEV_STAGE_CHROMIUM_ARGS and _ENV last', () => {
  const env = { SLIDEV_STAGE_CHROMIUM_ARGS: `--use-angle=vulkan --x='a b'`, SLIDEV_STAGE_CHROMIUM_ENV: 'LP_NUM_THREADS=2;DISPLAY=:5' };
  for (const s of plan('auto', { args: ['--tool'], env, m: WSL }).steps) {
    assert.deepEqual(s.args.slice(-3), ['--tool', '--use-angle=vulkan', '--x=a b']);
    assert.equal(s.env.DISPLAY, ':5');
    assert.equal(s.env.LP_NUM_THREADS, '2');
  }
  assert.throws(() => plan('auto', { env: { SLIDEV_STAGE_CHROMIUM_ENV: 'nope' }, m: WSL }), /SLIDEV_STAGE_CHROMIUM_ENV/);
});

test('the Mesa prefix counts only with the d3d12 driver in it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mesa-'));
  try {
    assert.deepEqual(machine({ SLIDEV_STAGE_MESA_D3D12: dir, PATH: '' }).mesa, { prefix: dir, ok: false });
    await mkdir(join(dir, 'root', 'usr', 'lib64', 'dri'), { recursive: true });
    await writeFile(join(dir, 'root', 'usr', 'lib64', 'dri', 'd3d12_dri.so'), '');
    const m = machine({ SLIDEV_STAGE_MESA_D3D12: dir, PATH: '' });
    assert.deepEqual(m.mesa, { prefix: dir, ok: true });
    // off PATH, only WSL's own copy counts
    assert.equal(m.nvidiaSmi, existsSync('/usr/lib/wsl/lib/nvidia-smi') ? '/usr/lib/wsl/lib/nvidia-smi' : null);
    await writeFile(join(dir, 'egl_mesa.json'), '{}');
    assert.equal(plan('d3d12', { env: {}, m: { ...WSL, mesa: m.mesa } }).steps[0].env.__EGL_VENDOR_LIBRARY_FILENAMES, join(dir, 'egl_mesa.json'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---- launch(), on a fake Playwright ----------------------------------------------------------
// Its own browser is a Chromium 151 that never reaches GL; the cached 1217
// shell (Chromium 147) reaches llvmpipe, or the GPU under the d3d12 variables.
const SWIFT = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
const LLVMPIPE = 'ANGLE (Mesa, llvmpipe (LLVM 19.1.7, 256 bits), OpenGL 4.5)';
const D3D12 = 'ANGLE (Microsoft Corporation, D3D12 (NVIDIA GeForce RTX 5080), OpenGL 4.6)';
function fakePlaywright({ swiftshader = SWIFT } = {}) {
  const launches = [];
  const rendererFor = (o) => {
    if (o.args.includes('--use-angle=swiftshader')) return swiftshader;
    if (!o.executablePath?.includes('-1217')) return SWIFT;
    return o.env.GALLIUM_DRIVER === 'd3d12' ? D3D12 : LLVMPIPE;
  };
  return {
    launches,
    executablePath: () => '/fake/chromium',
    async launch(o) {
      launches.push(o);
      let closed = false;
      const r = rendererFor(o);
      return {
        version: () => (o.executablePath?.includes('-1217') ? '147.0.7727.15' : '151.0.7800.0'),
        newPage: async () => ({ evaluate: async () => r, close: async () => {} }),
        close: async () => { closed = true; },
        get closed() { return closed; },
      };
    },
  };
}

async function withShells(revs, fn) {
  const root = await mkdtemp(join(tmpdir(), 'pw-'));
  const was = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = root;
  try {
    for (const r of revs) {
      const d = join(root, `chromium_headless_shell-${r}`, 'chrome-headless-shell-linux64');
      await mkdir(d, { recursive: true });
      await writeFile(join(d, 'chrome-headless-shell'), '');
    }
    return await fn(root);
  } finally {
    if (was === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = was;
    await rm(root, { recursive: true, force: true });
  }
}

test('cached headless shells, newest first', () => withShells(['1217', '1243', '1234'], (root) => {
  assert.deepEqual(cachedShells().map((p) => p.slice(root.length + 1).split('/')[0]),
    ['chromium_headless_shell-1243', 'chromium_headless_shell-1234', 'chromium_headless_shell-1217']);
}));

const quiet = { executable: '', options: { env: {} }, warn: () => {} };

test('auto keeps the first backend whose renderer says it got there, trying the cached shells', () => withShells(['1217', '1234'], async () => {
  const pw = fakePlaywright();
  const r = await launch({ ...quiet, chromium: pw, system: WSL });
  assert.equal(r.backend, 'd3d12');
  assert.equal(r.renderer, D3D12);
  assert.match(r.executablePath, /chromium_headless_shell-1217/);
  assert.equal(r.version, '147.0.7727.15');
  assert.equal(r.warning, null);
  assert.equal(r.env.GALLIUM_DRIVER, 'd3d12');
  // Playwright's own, the 1234 shell, then the 1217 shell; the browsers it did not keep are closed
  assert.equal(pw.launches.length, 3);
  assert.deepEqual(r.tried.map((t) => [t.backend, t.got === SWIFT]), [['d3d12', true], ['d3d12', true]]);
  assert.equal(pw.launches[2].env.LP_NUM_THREADS, undefined);
  assert.equal(pw.launches[2].timeout, 30000);
}));

test('without the prefix auto lands on llvmpipe with DISPLAY and LP_NUM_THREADS set for the browser', () => withShells(['1217'], async () => {
  const pw = fakePlaywright();
  const r = await launch({ ...quiet, chromium: pw, system: { ...WSL, mesa: { prefix: '/x', ok: false } }, args: ['--tool'], options: { env: { HOME: '/h' }, handleSIGINT: false } });
  assert.equal(r.backend, 'llvmpipe');
  assert.equal(r.renderer, LLVMPIPE);
  assert.deepEqual(r.env, { DISPLAY: ':0', LP_NUM_THREADS: '8' });
  const kept = pw.launches.at(-1);
  assert.deepEqual(kept.env, { HOME: '/h', DISPLAY: ':0', LP_NUM_THREADS: '8' });
  assert.equal(kept.handleSIGINT, false);
  assert.equal(kept.args.at(-1), '--tool');
}));

test('SwiftShader, when nothing better is reached, comes with a warning that says why', () => withShells([], async () => {
  const said = [];
  const r = await launch({ ...quiet, chromium: fakePlaywright(), system: { ...WSL, mesa: { prefix: '/x', ok: false } }, warn: (s) => said.push(s) });
  assert.equal(r.backend, 'swiftshader');
  assert.equal(said.length, 1);
  assert.equal(r.warning, said[0]);
  assert.match(r.warning, /^WARNING: renderer is SwiftShader: WebGL draws about 3x slower than on llvmpipe and takes 3-4x the CPU\. Passed over: /);
  assert.match(r.warning, /d3d12: no Mesa d3d12 driver under \/x/);
  assert.match(r.warning, /Passed over: gpu-nvidia: WSL, where the GPU is the d3d12 backend; d3d12: no Mesa d3d12 driver under \/x \(SLIDEV_STAGE_MESA_D3D12\); llvmpipe: fell back to SwiftShader on Chromium 151\.0\.7800\.0\. See/);
}));

test('SLIDEV_STAGE_GL forces a backend; --gl (backend) wins over it; a forced one that is not reached fails', () => withShells(['1217'], async () => {
  const env = { SLIDEV_STAGE_GL: 'swiftshader' };
  const s = await launch({ ...quiet, chromium: fakePlaywright(), system: WSL, options: { env } });
  assert.equal(s.backend, 'swiftshader');
  assert.match(s.warning, /CPU\. Asked for with SLIDEV_STAGE_GL=swiftshader\. See/);
  const g = await launch({ ...quiet, chromium: fakePlaywright(), system: WSL, backend: 'swiftshader' });
  assert.match(g.warning, /Asked for with --gl swiftshader/);
  const l = await launch({ ...quiet, chromium: fakePlaywright(), system: WSL, options: { env }, backend: 'llvmpipe' });
  assert.equal(l.backend, 'llvmpipe');
  const a = await launch({ ...quiet, chromium: fakePlaywright(), system: WSL, options: { env }, backend: 'auto' });
  assert.equal(a.backend, 'swiftshader', "'auto' from a tool's default leaves the choice to SLIDEV_STAGE_GL");
  await assert.rejects(launch({ ...quiet, chromium: fakePlaywright(), system: { ...WSL, mesa: { prefix: '/x', ok: false } }, backend: 'd3d12' }),
    /no browser reached d3d12 \(d3d12: no Mesa d3d12 driver under \/x/);
}));

test('gl: any GL backend, never SwiftShader; the reasons name each browser tried', () => withShells(['1234'], async () => {
  await assert.rejects(launch({ ...quiet, chromium: fakePlaywright(), system: CI, backend: 'gl', options: { env: { DISPLAY: ':1' } } }),
    /no browser reached gl \(gpu-nvidia: no nvidia-smi; d3d12: no \/dev\/dxg; llvmpipe: fell back to SwiftShader on Chromium 151\.0\.7800\.0, 151\.0\.7800\.0\)$/);
}));

test('no WebGL2 at all: a failure, unless the tool can do without', () => withShells([], async () => {
  const pw = fakePlaywright({ swiftshader: null });
  await assert.rejects(launch({ ...quiet, chromium: pw, system: CI }), /no browser reached WebGL2 float render targets/);
  const r = await launch({ ...quiet, chromium: pw, system: CI, webgl: false });
  assert.equal(r.renderer, null);
  assert.match(r.warning, /SwiftShader, without WebGL2/);
}));
