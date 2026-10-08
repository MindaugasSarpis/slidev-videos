// One headless Chromium for every stage tool (shots, record, safe): the same
// browser, flags and environment for all of them, on the fastest WebGL the
// machine reaches. Node built-ins only, so each tool can carry this file as is.
//
// Backends, best first; $SLIDEV_STAGE_GL (or a tool's --gl) forces one:
//   gpu-nvidia   a native NVIDIA driver through EGL (nvidia-smi on PATH, not WSL)
//   d3d12        WSL's GPU through Mesa's d3d12 Gallium driver, from a private
//                Mesa prefix ($SLIDEV_STAGE_MESA_D3D12, default
//                ~/.local/share/mesa-d3d12); ANGLE on GL over WSLg's X server
//   llvmpipe     the system's GL through ANGLE: Mesa's llvmpipe in WSL. Needs an
//                X display: DISPLAY, else :0 when /tmp/.X11-unix/X0 is there
//   swiftshader  Chromium's own software GL: everywhere, about 3x slower
// A backend is kept only when the page's renderer string says it got there;
// else the next is tried. The browser: $SLIDEV_STAGE_CHROMIUM or Playwright's
// own, then the other headless shells in the Playwright cache, newest first
// (in WSL, Chromium 147 reaches GL and 151 does not). $SLIDEV_STAGE_CHROMIUM_ARGS
// (shell words) and $SLIDEV_STAGE_CHROMIUM_ENV (KEY=VAL;KEY=VAL) go last, over
// everything. The renderer string and the backend belong in every report: two
// runs compare frame for frame only on the same renderer.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const BACKENDS = ['gpu-nvidia', 'd3d12', 'llvmpipe', 'swiftshader'];
// what --gl and $SLIDEV_STAGE_GL take: auto, a backend, gl (any GL backend,
// never SwiftShader) or none (no WebGL at all)
export const MODES = ['auto', ...BACKENDS, 'gl', 'none'];
const ANGLE_GL = ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'];
export const ARGS = {
  'gpu-nvidia': ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
  d3d12: ANGLE_GL,
  llvmpipe: ANGLE_GL,
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  none: ['--disable-3d-apis'],
};
export const COMMON = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'];
export const MESA_D3D12 = join(homedir(), '.local', 'share', 'mesa-d3d12');
const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software/i;
// what a backend's renderer string has to say
const REACHED = {
  'gpu-nvidia': (r) => !!r && !SOFTWARE.test(r),
  d3d12: (r) => /d3d12/i.test(r || ''),
  llvmpipe: (r) => !!r && !/swiftshader/i.test(r),
  swiftshader: (r) => !!r,
  none: () => true,
};
export const SLOW = 'WebGL draws about 3x slower than on llvmpipe and takes 3-4x the CPU';

// ---- the environment's knobs ------------------------------------------------------------

// shell words: 'a "b c" d\ e' → ['a', 'b c', 'd e']; quotes and backslashes, no expansion
export function splitArgs(s, name = 'SLIDEV_STAGE_CHROMIUM_ARGS') {
  const out = [];
  let cur = null, q = null;
  const str = String(s ?? '');
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (q === "'") { if (c === q) q = null; else cur += c; }
    else if (q === '"') {
      if (c === q) q = null;
      else if (c === '\\' && '"\\$`'.includes(str[i + 1] ?? '')) cur += str[++i];
      else cur += c;
    }
    else if (/\s/.test(c)) { if (cur !== null) { out.push(cur); cur = null; } }
    else if (c === '"' || c === "'") { q = c; cur ??= ''; }
    else if (c === '\\' && i + 1 < str.length) cur = (cur ?? '') + str[++i];
    else cur = (cur ?? '') + c;
  }
  if (q) throw new Error(`${name}: an unclosed ${q}`);
  if (cur !== null) out.push(cur);
  return out;
}

// 'A=1;B=x y' → { A: '1', B: 'x y' }
export function parseEnv(s, name = 'SLIDEV_STAGE_CHROMIUM_ENV') {
  const out = {};
  for (const part of String(s ?? '').split(';')) {
    const t = part.trim();
    if (!t) continue;
    const i = t.indexOf('=');
    if (i < 1) throw new Error(`${name}: KEY=VAL;KEY=VAL, not ${t}`);
    out[t.slice(0, i).trim()] = t.slice(i + 1);
  }
  return out;
}

const onPath = (bin, env) => (env.PATH || '').split(delimiter).filter(Boolean).map((d) => join(d, bin)).find((f) => existsSync(f)) || null;
// where WSL puts it, for a shell (cron, a service) whose PATH leaves it out
const WSL_SMI = '/usr/lib/wsl/lib/nvidia-smi';

// What the machine offers: WSL or not, a GPU device, NVIDIA's tools, an X
// socket, a Mesa prefix with the d3d12 driver.
export function machine(env = process.env) {
  let version = '';
  try { version = readFileSync('/proc/version', 'utf8'); } catch { /* not Linux */ }
  const prefix = env.SLIDEV_STAGE_MESA_D3D12 || MESA_D3D12;
  return {
    wsl: !!env.WSL_DISTRO_NAME || /microsoft/i.test(version),
    dxg: existsSync('/dev/dxg'),
    nvidiaSmi: onPath('nvidia-smi', env) || (existsSync(WSL_SMI) ? WSL_SMI : null),
    x0: existsSync('/tmp/.X11-unix/X0'),
    mesa: { prefix, ok: existsSync(join(prefix, 'root', 'usr', 'lib64', 'dri', 'd3d12_dri.so')) },
  };
}

// The environment Mesa's d3d12 driver needs from a private prefix laid out as
// <prefix>/root/usr/lib64 (+ dri/) and <prefix>/egl_mesa.json. WSL's own
// libd3d12 and libdxcore come from /usr/lib/wsl/lib. Without an adapter name
// Mesa takes the first adapter, which can be an integrated GPU. Never set
// VK_ICD_FILENAMES: it hides Chromium's own SwiftShader and the fallback with it.
function d3d12Env(m, env) {
  const lib = join(m.mesa.prefix, 'root', 'usr', 'lib64');
  const egl = join(m.mesa.prefix, 'egl_mesa.json');
  return {
    LD_LIBRARY_PATH: [lib, '/usr/lib/wsl/lib', env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
    LIBGL_DRIVERS_PATH: join(lib, 'dri'),
    GALLIUM_DRIVER: 'd3d12',
    ...(existsSync(egl) ? { __EGL_VENDOR_LIBRARY_FILENAMES: egl } : {}),
    ...(env.MESA_D3D12_DEFAULT_ADAPTER_NAME || !m.nvidiaSmi ? {} : { MESA_D3D12_DEFAULT_ADAPTER_NAME: 'NVIDIA' }),
  };
}

// The backends to try for `mode`, in order, each with its flags (the tool's
// `args` after the backend's, $SLIDEV_STAGE_CHROMIUM_ARGS last) and the
// variables it sets ($SLIDEV_STAGE_CHROMIUM_ENV last); `skipped` says why a
// better backend is not tried. A forced backend is tried even where it is not
// expected to work, except d3d12 without its Mesa prefix.
export function plan(mode = 'auto', { args = [], env = process.env, m = machine(env) } = {}) {
  if (!MODES.includes(mode)) throw new Error(`SLIDEV_STAGE_GL / --gl: ${MODES.join(', ')}; not ${mode}`);
  const extraArgs = splitArgs(env.SLIDEV_STAGE_CHROMIUM_ARGS);
  const extraEnv = parseEnv(env.SLIDEV_STAGE_CHROMIUM_ENV);
  const hasDisplay = !!env.DISPLAY || m.x0;
  const display = env.DISPLAY ? {} : m.x0 ? { DISPLAY: ':0' } : {};
  const whyNot = {
    'gpu-nvidia': () => (m.wsl ? 'WSL, where the GPU is the d3d12 backend' : !m.nvidiaSmi ? 'no nvidia-smi' : null),
    d3d12: () => (!m.dxg ? 'no /dev/dxg' : !m.mesa.ok ? `no Mesa d3d12 driver under ${m.mesa.prefix} (SLIDEV_STAGE_MESA_D3D12)` : !hasDisplay ? 'no X display' : null),
    llvmpipe: () => (hasDisplay ? null : 'no X display (DISPLAY unset, no /tmp/.X11-unix/X0)'),
    swiftshader: () => null,
    none: () => null,
  };
  const envOf = {
    'gpu-nvidia': () => ({}),
    d3d12: () => ({ ...d3d12Env(m, env), ...display }),
    llvmpipe: () => ({ ...display, ...(env.LP_NUM_THREADS ? {} : { LP_NUM_THREADS: '8' }) }),
    swiftshader: () => ({}),
    none: () => ({}),
  };
  const list = mode === 'auto' ? BACKENDS : mode === 'gl' ? BACKENDS.slice(0, -1) : [mode];
  const steps = [], skipped = [];
  for (const backend of list) {
    const why = whyNot[backend]();
    if (why && (list.length > 1 || (backend === 'd3d12' && !m.mesa.ok))) { skipped.push({ backend, why }); continue; }
    steps.push({ backend, args: [...ARGS[backend], ...COMMON, ...args, ...extraArgs], env: { ...envOf[backend](), ...extraEnv } });
  }
  return { mode, steps, skipped };
}

// ---- the browser ----------------------------------------------------------------------------

// playwright-chromium is an optional peer: $SLIDEV_STAGE_PLAYWRIGHT=<dir>
// first, then next to the tool (the addon's own install, or this repo's),
// then the working directory (the deck's).
let loadedFrom = null;
export function loadPlaywright(tool = 'this tool', dirs = [process.env.SLIDEV_STAGE_PLAYWRIGHT, HERE, process.cwd()]) {
  for (const d of dirs.filter(Boolean)) {
    try {
      const req = createRequire(join(resolve(d), 'noop.js'));
      const mod = req('playwright-chromium');
      loadedFrom = req.resolve('playwright-chromium');
      return mod;
    } catch { /* next */ }
  }
  throw new Error(`${tool} needs playwright-chromium, found neither next to it (${dirname(HERE)}) nor in ${process.cwd()}:\n  pnpm add -D playwright-chromium@~1.59.1 && pnpm exec playwright install chromium`);
}

const browsersRoot = (env = process.env) => env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');
const shellIn = (root, dir) => join(root, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');

// Headless shells in the Playwright cache, newest first.
export function cachedShells(env = process.env) {
  const root = browsersRoot(env);
  let dirs = [];
  try { dirs = readdirSync(root).filter((d) => /^chromium_headless_shell-\d+$/.test(d)); } catch { return []; }
  return dirs
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((d) => shellIn(root, d))
    .filter((p) => existsSync(p));
}

// The headless shell the loaded Playwright launches by default, from its
// browsers.json; null when it cannot tell.
function ownShell(env) {
  if (!loadedFrom) return null;
  try {
    const core = createRequire(loadedFrom).resolve('playwright-core/package.json');
    const b = JSON.parse(readFileSync(join(dirname(core), 'browsers.json'), 'utf8')).browsers.find((x) => x.name === 'chromium-headless-shell');
    return b ? shellIn(browsersRoot(env), `chromium_headless_shell-${b.revision}`) : null;
  } catch { return null; }
}

// The WebGL2 renderer a page gets, or null without WebGL2 float render targets
// (the stage needs them).
export async function rendererOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(r);
  });
}

// why each better backend was passed over, in a line
function because(skipped, tried) {
  const out = skipped.map((s) => `${s.backend}: ${s.why}`);
  for (const t of tried) {
    const head = `${t.backend}: ${/swiftshader/i.test(t.got) ? 'fell back to SwiftShader' : t.got}`;
    if (t.version && out.at(-1)?.startsWith(`${head} on Chromium `)) out[out.length - 1] += `, ${t.version}`;
    else out.push(t.version ? `${head} on Chromium ${t.version}` : head);
  }
  return out.join('; ');
}

// launch({ backend, chromium, executable, args, options, page, webgl, warn, tool })
//   backend   a mode from MODES; null or 'auto': $SLIDEV_STAGE_GL, else auto
//   chromium  Playwright's chromium (default: loadPlaywright(tool).chromium)
//   executable  a browser to try first (default $SLIDEV_STAGE_CHROMIUM)
//   args      the tool's own flags; options: more chromium.launch() options
//             (options.env: the environment to start from, default process.env)
//   page      keep the page the renderer was read on, and return it
//   webgl     false: a browser without WebGL2 float targets will do (the deck
//             then draws its static background)
//   warn      where the SwiftShader warning goes (default stderr)
//   system    what machine() would say (for tests)
// → { browser, page, renderer, backend, env, args, executablePath, version, warning, tried, skipped }
//   env: only the variables the backend and $SLIDEV_STAGE_CHROMIUM_ENV set.
export async function launch({
  backend = null, chromium = null, executable = process.env.SLIDEV_STAGE_CHROMIUM || '', args = [], options = {},
  page: keepPage = false, webgl = true, warn = (s) => console.error(s), tool = 'this tool', system = null,
} = {}) {
  const base = options.env || process.env;
  const mode = backend && backend !== 'auto' ? backend : base.SLIDEV_STAGE_GL || 'auto';
  const p = plan(mode, { args, env: base, m: system || machine(base) });
  chromium ??= loadPlaywright(tool).chromium;
  // the cache Playwright itself reads: the driver's environment, not the browser's
  const own = ownShell(process.env);
  const shells = cachedShells(process.env).filter((s) => s !== own);
  const tried = [];
  for (const step of p.steps) {
    // GL depends on the browser build, so the GL backends try the cached shells
    // too; SwiftShader (and no WebGL) works in any
    const gl = step.backend !== 'swiftshader' && step.backend !== 'none';
    const exes = !gl ? [executable || undefined] : executable ? [executable, undefined] : [undefined, ...shells];
    for (const exe of exes) {
      let browser = null;
      try {
        browser = await chromium.launch({ timeout: 30000, ...options, executablePath: exe, args: step.args, env: { ...base, ...step.env } });
        const version = browser.version();
        const pg = step.backend === 'none' && !keepPage ? null : await browser.newPage();
        const renderer = step.backend === 'none' ? null : await rendererOf(pg);
        if (REACHED[step.backend](renderer) || (step.backend === 'swiftshader' && !webgl)) {
          if (pg && !keepPage) await pg.close();
          const res = {
            browser, page: keepPage ? pg : null, renderer, backend: step.backend, env: step.env, args: step.args,
            executablePath: exe || own || chromium.executablePath(), version, warning: null, tried, skipped: p.skipped,
          };
          if (step.backend === 'swiftshader') {
            const why = mode !== 'swiftshader' ? `Passed over: ${because(p.skipped, tried) || 'nothing'}`
              : `Asked for with ${backend === 'swiftshader' ? '--gl swiftshader' : 'SLIDEV_STAGE_GL=swiftshader'}`;
            res.warning = `WARNING: renderer is SwiftShader${renderer ? '' : ', without WebGL2'}: ${SLOW}. ${why}. See the stage README, "Renderer".`;
            warn(res.warning);
          }
          return res;
        }
        tried.push({ backend: step.backend, exe: exe || null, version, got: renderer || 'no WebGL2' });
      } catch (e) { tried.push({ backend: step.backend, exe: exe || null, got: String(e.message || e).split('\n')[0] }); }
      await browser?.close().catch(() => {});
    }
  }
  throw new Error(`${tool}: no browser reached ${mode === 'auto' ? 'WebGL2 float render targets' : mode} (${because(p.skipped, tried) || 'nothing to try'})`);
}
