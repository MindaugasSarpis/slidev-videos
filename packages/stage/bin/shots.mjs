#!/usr/bin/env node
// Photograph a built deck, slide by slide, in a headless browser — the way to
// review a talk that lives in a 3D world without sitting through it — and
// report what a review looks for: content running off the slide, where the
// camera stood, page errors, the text on screen and what stands behind it.
//
//   slidev-stage-shots <dist> <out-dir> [options]
//   slidev-stage-shots --dev deck.md <out-dir> [options]
//
// Each frame is settled, not waited for: the world runs fast and undrawn until
// the camera has landed, nothing assembles and --settle engine-seconds have
// passed since the slide or click changed; then the dust moves a little, the
// world is drawn with its clock held, CSS animations are finished, and the
// page is photographed. One NDJSON line per frame goes to <out-dir>/shots.ndjson
// (--json elsewhere). Exit 0: clean; 3: overflow, page errors, failed requests,
// failed or unsettled frames; 1: the run itself failed; 2: bad arguments.
// See the README's "Headless review" for every option and the report fields.
//
// Needs playwright-chromium, found next to this file or in the working
// directory. Runs queue on a shared lock (/tmp/slidev-stage-shots.lock), so
// sessions on one machine take turns instead of thrashing the CPU.
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, appendFile, readdir } from 'node:fs/promises';
import { readFileSync, statSync, existsSync, realpathSync, appendFileSync } from 'node:fs';
import { join, extname, resolve, dirname, relative, sep } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon', '.txt': 'text/plain',
};
// WebGL in software. SwiftShader is everywhere and slow; Mesa's llvmpipe
// through ANGLE's GL backend is about three times faster where the browser
// build can reach it (Chromium 147 in WSL can, 151 cannot).
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const GL_ARGS_LLVMPIPE = ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu'];
export const LOCK = '/tmp/slidev-stage-shots.lock';
const VERSION = 2;
const HERE = dirname(fileURLToPath(import.meta.url));
// the headless browser's own complaints, not the deck's
const NOISE = /Wake Lock|favicon/i;
const STEP_MS = 100;   // a fast frame: past the engine's 1/12 s clamp, so every frame is one full engine step

// ---- serving ------------------------------------------------------------------------------

// The base a deck was built for, from the asset paths in its index.html:
// `/repo/talk/assets/index-x.js` → `/repo/talk/`. A relative build (`--base ./`)
// loads from anywhere: `/`.
export function detectBase(html) {
  const m = /(?:src|href)="([^"]*?)assets\/[^"]+\.(?:js|css)"/.exec(html || '');
  if (!m || !m[1].startsWith('/')) return '/';
  return m[1].endsWith('/') ? m[1] : `${m[1]}/`;
}

// A static server for a built deck, under the base it was built for. Unknown
// paths without an extension fall back to index.html (the deck is a
// single-page app); a missing file is a 404, which the report records. Media
// is served in byte ranges.
export function serve(dist, { base = '/' } = {}) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(base)) { res.writeHead(404); res.end('outside the base'); return; }
    p = `/${p.slice(base.length)}`;
    if (p.endsWith('/')) p += 'index.html';
    let file = join(dist, p);
    if (!file.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    try { if (!(await stat(file)).isFile()) throw 0; } catch {
      if (extname(p)) { res.writeHead(404); res.end('not found'); return; }
      file = join(dist, 'index.html');
    }
    try {
      const body = await readFile(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length });
      res.end(body);
    } catch { res.writeHead(500); res.end(); }
  });
  return new Promise((ok, fail) => { server.on('error', fail); server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port })); });
}

// ---- options ------------------------------------------------------------------------------

// "1-3,7" → [1, 2, 3, 7]
export function parseSlides(spec, total) {
  if (!spec) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= total) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

// The clicks to photograph on a slide with `total` clicks: --clicks none | last | all,
// or the older map {"9": 3} (slide 9: clicks 0 to 3).
export function clicksFor(o, slide, total) {
  if (o.clickMap) return Array.from({ length: Math.max(0, Number(o.clickMap[slide]) || 0) + 1 }, (_, i) => i);
  if (o.clicks === 'last') return [Math.max(0, total || 0)];
  if (o.clicks === 'all') return Array.from({ length: Math.max(0, total || 0) + 1 }, (_, i) => i);
  return [0];
}

export const frameName = (slide, click = 0, burst = 0) =>
  `${String(slide).padStart(2, '0')}${click ? `-c${click}` : ''}${burst ? `-b${burst}` : ''}`;

export const USAGE = `usage: slidev-stage-shots <dist> <out-dir> [options]
       slidev-stage-shots --dev deck.md <out-dir> [options]

  --slides 1-12,15     which slides (default: all)
  --clicks MODE        none (default) | last | all, or {"9":3}
  --settle S           engine-seconds a frame stands still after its last change (default 6)
  --wait MS            cap on one frame's settle, wall time (default 30000)
  --dust N             dust frames after the settle (default 12; 0: none)
  --size WxH           viewport (default 1600x900)
  --draft              device pixel ratio 0.5: quarter the pixels
  --burst N            N frames per click, --every S engine-seconds apart
  --every S            (default 1)
  --seed N             seed for Math.random (default 1)
  --no-halo            hide the halo layer (for comparing runs)
  --base PATH          the base the deck was built for (default: read from index.html)
  --changed            photograph only frames whose slide, styles or data changed
  --sheet              a labelled contact sheet, <out-dir>/sheet.png
  --probe              measure fps and engine-seconds per second per slide; no photographs
  --console            record console warnings
  --jobs N             N pages in parallel
  --gl MODE            auto (default: llvmpipe if the browser reaches it, else SwiftShader) | gl | swiftshader
  --json FILE          the NDJSON report (default <out-dir>/shots.ndjson)
  --dev DECK.md        start slidev's dev server on a free port and photograph that
  --lock FILE          the shared lock (default ${LOCK}); --no-lock: none

exit: 0 clean · 3 overflow, page errors, failed requests, failed or unsettled frames · 1 the run failed · 2 bad arguments`;

export function parseArgs(argv) {
  const o = {
    dist: null, out: null, dev: null, slides: null, clicks: 'none', clickMap: null,
    settle: 6, wait: 30000, dust: 12, size: [1600, 900], draft: false, burst: 1, every: 1, seed: 1,
    halo: true, base: null, changed: false, sheet: false, probe: false, console: false, jobs: 1,
    gl: 'auto', json: null, lock: LOCK, help: false, errors: [],
  };
  const rest = [];
  const num = (v, name, min = 0) => { const n = Number(v); if (!Number.isFinite(n) || n < min) o.errors.push(`${name}: not a number ≥ ${min}: ${v}`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { const v = argv[++i]; if (v === undefined) o.errors.push(`${a} needs a value`); return v; };
    if (a === '--slides') o.slides = val();
    else if (a === '--clicks') {
      const v = String(val() ?? '');
      if (v.trim().startsWith('{')) { try { o.clickMap = JSON.parse(v); } catch { o.errors.push(`--clicks: not JSON: ${v}`); } }
      else if (['none', 'last', 'all'].includes(v)) o.clicks = v;
      else o.errors.push(`--clicks: none, last, all or {"slide": clicks}, not ${v}`);
    }
    else if (a === '--settle') o.settle = num(val(), a);
    else if (a === '--wait' || a === '--click-wait') o.wait = Math.max(a === '--click-wait' ? o.wait : 0, num(val(), a, 1));
    else if (a === '--dust') o.dust = Math.round(num(val(), a));
    else if (a === '--size') { const s = String(val() ?? '').split('x').map(Number); if (s.length !== 2 || !s.every((x) => x > 0)) o.errors.push(`--size: WxH, not ${s}`); else o.size = s; }
    else if (a === '--draft') o.draft = true;
    else if (a === '--burst') o.burst = Math.max(1, Math.round(num(val(), a, 1)));
    else if (a === '--every') o.every = num(val(), a);
    else if (a === '--seed') o.seed = Math.round(num(val(), a));
    else if (a === '--no-halo') o.halo = false;
    else if (a === '--base') { const b = String(val() ?? '/'); o.base = b.startsWith('/') ? (b.endsWith('/') ? b : `${b}/`) : '/'; }
    else if (a === '--changed') o.changed = true;
    else if (a === '--sheet') o.sheet = true;
    else if (a === '--probe') o.probe = true;
    else if (a === '--console') o.console = true;
    else if (a === '--jobs') o.jobs = Math.max(1, Math.round(num(val(), a, 1)));
    else if (a === '--gl') { const g = val(); if (!['auto', 'gl', 'swiftshader'].includes(g)) o.errors.push(`--gl: auto, gl or swiftshader, not ${g}`); else o.gl = g; }
    else if (a === '--json') o.json = val();
    else if (a === '--dev') o.dev = val();
    else if (a === '--lock') o.lock = val();
    else if (a === '--no-lock') o.lock = null;
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('--')) o.errors.push(`unknown option ${a}`);
    else rest.push(a);
  }
  if (o.dev) [o.out] = rest; else [o.dist, o.out] = rest;
  if (!o.help && !o.out) o.errors.push(o.dev ? 'usage: --dev deck.md <out-dir>' : 'usage: <dist> <out-dir>');
  return o;
}

// ---- the shared lock ------------------------------------------------------------------------
// flock(1) on one file, so a run started by hand inside `flock <lock> …` and a
// run that locks for itself are the same queue. A run already under the lock
// (an ancestor process holds it) goes ahead instead of waiting on itself.

// /proc/locks → [{ kind, pid, inode, waiting }]
export function parseProcLocks(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const m = /^\d+:\s+(->\s+)?(\S+)\s+\S+\s+\S+\s+(\d+)\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s/i.exec(line);
    if (m) out.push({ waiting: !!m[1], kind: m[2], pid: Number(m[3]), inode: Number(m[4]) });
  }
  return out;
}

function ancestors() {
  const out = [];
  for (let p = process.pid, i = 0; p > 1 && i < 64; i++) {
    out.push(p);
    try { const s = readFileSync(`/proc/${p}/stat`, 'utf8'); p = Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]); } catch { break; }
  }
  return out;
}

// true: an ancestor holds the lock; false: nobody of ours does; null: cannot tell
function lockedByAncestor(lock) {
  let locks;
  try { locks = parseProcLocks(readFileSync('/proc/locks', 'utf8')); } catch { return null; }
  let ino;
  try { ino = statSync(lock).ino; } catch { return false; }
  const mine = new Set(ancestors());
  return locks.some((l) => !l.waiting && l.kind === 'FLOCK' && l.inode === ino && mine.has(l.pid));
}

const onPath = (bin) => (process.env.PATH || '').split(':').map((d) => join(d, bin)).find((f) => existsSync(f)) || null;

// Run this command again under flock(1), unless the lock is ours already.
// → the child's exit code, or null: go ahead here.
async function relaunchLocked(o, argv) {
  if (!o.lock || process.env.SLIDEV_STAGE_SHOTS_LOCKED === o.lock) return null;
  const held = lockedByAncestor(o.lock);
  if (held) return null;
  const flock = onPath('flock');
  if (!flock || held === null) { console.error(`note: running without the shared lock (${flock ? 'no /proc/locks' : 'no flock(1) on PATH'})`); return null; }
  if (spawnSync(flock, ['-n', o.lock, 'true']).status !== 0) console.error(`waiting for ${o.lock}: another slidev-stage-shots run holds it`);
  const child = spawn(flock, [o.lock, process.execPath, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit', env: { ...process.env, SLIDEV_STAGE_SHOTS_LOCKED: o.lock },
  });
  const pass = (sig) => () => child.kill(sig);
  process.on('SIGINT', pass('SIGINT')); process.on('SIGTERM', pass('SIGTERM'));
  return new Promise((ok) => child.on('exit', (code) => ok(code ?? 1)));
}

// ---- the browser ------------------------------------------------------------------------------

// playwright-chromium is an optional peer: next to this file first (the addon's
// own install, or this repo's), then the working directory (the deck's).
function loadPlaywright() {
  const dirs = [process.env.SLIDEV_STAGE_PLAYWRIGHT, HERE, process.cwd()].filter(Boolean);
  for (const d of dirs) {
    try { return createRequire(join(resolve(d), 'noop.js'))('playwright-chromium'); } catch { /* next */ }
  }
  throw new Error(`slidev-stage-shots needs playwright-chromium, found neither next to it (${HERE}) nor in ${process.cwd()}:\n  pnpm add -D playwright-chromium && pnpm exec playwright install chromium`);
}

async function rendererOf(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return null;
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    });
  } finally { await page.close(); }
}

// --gl auto: ANGLE on GL first, kept when it reaches a real driver (llvmpipe,
// or a GPU), else SwiftShader.
async function launch(chromium, gl) {
  const extra = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];
  const tries = gl === 'swiftshader' ? [['swiftshader', GL_ARGS]] : gl === 'gl' ? [['gl', GL_ARGS_LLVMPIPE]] : [['gl', GL_ARGS_LLVMPIPE], ['swiftshader', GL_ARGS]];
  for (let i = 0; i < tries.length; i++) {
    const [name, args] = tries[i];
    const last = i === tries.length - 1;
    let browser;
    try { browser = await chromium.launch({ args: [...args, ...extra] }); } catch (e) { if (last) throw e; continue; }
    const renderer = await rendererOf(browser);
    if (last || (renderer && !/swiftshader/i.test(renderer))) return { browser, renderer, gl: name };
    await browser.close();
  }
  throw new Error('no browser');
}

// ---- the page side ------------------------------------------------------------------------------
// Installed before any of the deck's code runs. It seeds Math.random, puts
// performance.now and every rAF timestamp on a clock the tool drives (the
// engine, the halo and the talks' counters all read it), stops the world from
// drawing until a frame is wanted, and keeps the frame-rate guard from
// lowering the pixel ratio or the dust while the world runs fast.
function pageInit(cfg) {
  let seed = (cfg.seed >>> 0) || 1;   // mulberry32
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // The clock. real: page time; fast: each animation frame lasts STEP ms,
  // however long it took; hold: time stands still. It starts held, so the
  // world boots at engine time 0 and moves only when the tool lets it.
  const read = (f, d) => { try { return f() ?? d; } catch { return d; } };   // a handle whose engine failed to start reads d
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let mode = 'hold', virt = realNow(), offset = 0, lastTs = -1;
  const setMode = (m) => {
    if (m === mode) return;
    if (mode === 'real') virt = realNow() + offset;
    if (m === 'real') offset = virt - realNow();
    mode = m;
  };
  performance.now = () => (mode === 'real' ? realNow() + offset : virt);
  const tickers = new Set();
  // once per animation frame, before any callback of it: the tickers decide,
  // then the clock moves for the callbacks
  const tick = (ts) => {
    if (ts === lastTs) return;
    lastTs = ts;
    for (const t of [...tickers]) t();
    if (mode === 'fast') virt += cfg.step;
  };
  window.requestAnimationFrame = (cb) => realRaf((ts) => { tick(ts); cb(mode === 'real' ? ts + offset : virt); });
  const pump = (ts) => { realRaf(pump); tick(ts); };
  realRaf(pump);

  // Drawing. off: nothing is rendered; dust: only the dust's simulation passes;
  // on: everything. The engine's render handles are canvas.__space (every
  // engine since 0.2): caught as they are set, so the first frame is already
  // undrawn and the guard is held from the start.
  // The dust's simulation ping-pongs between two position targets and swaps
  // them every frame, drawn or not; the second target is empty until the first
  // real pass. So drawing resumes only after an even number of undrawn frames,
  // or every grain would stand at the origin.
  let draw = 'off', probe = null, original = null, offFrom = 0;
  // (a paused world runs no frames, so there is nothing to wait for)
  const offOdd = () => draw === 'off' && !!probe && (read(() => probe.frames, 0) - offFrom) % 2 === 1 && !handles().api?.paused;
  const applyDraw = () => {
    if (!probe) return;
    const { composer, renderer } = probe;
    original ??= { c: composer.render, r: renderer.render };
    composer.render = draw === 'on' ? original.c : () => {};
    renderer.render = draw === 'off' ? () => {} : original.r;
  };
  Object.defineProperty(HTMLCanvasElement.prototype, '__space', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      Object.defineProperty(this, '__space', { value: v, writable: true, configurable: true, enumerable: true });
      if (!v || !v.composer || !v.renderer) return;
      probe = v; original = null; offFrom = 0; applyDraw();
      // createSpace sets the handle before its own clock and guard exist: hold
      // the guard once it returns (it acts only after 4 engine-seconds)
      queueMicrotask(() => { try { v.holdQuality?.(); } catch { /* the engine did not start */ } });
    },
  });
  const setDraw = (d) => {
    if (d === 'off' && draw !== 'off') offFrom = read(() => probe.frames, 0);
    draw = d; applyDraw();
  };
  const whenEven = () => new Promise((ok) => { const f = () => { if (!offOdd()) { tickers.delete(f); ok(); } }; tickers.add(f); });

  const nav = () => (window.__slidev__ || document.querySelector('#app')?.__vue_app__?._context?.provides?.['$$slidev-context'])?.nav || null;
  const handles = () => {
    const root = document.querySelector('.stage');
    const canvas = root?.querySelector('canvas.field');
    return { st: window.__stage || null, root, p: canvas?.__space || null, api: window.__stage?.space || root?.__space || null };
  };
  const where = () => {
    const nv = nav();
    if (nv) return { slide: Number(nv.currentSlideNo), clicks: Number(nv.clicks) || 0 };
    const m = /^#\/(\d+)(?:\?(?:.*&)?clicks=(\d+))?/.exec(location.hash);
    return { slide: m ? Number(m[1]) : null, clicks: m && m[2] ? Number(m[2]) : 0 };
  };
  const state = () => {
    const { st, root, p, api } = handles();
    const s = read(() => st?.state?.(), {});
    const nv = nav();
    const g = p?.field?.geometry;
    return {
      stage: !!root,
      static: !!root?.classList.contains('static-bg'),
      ready: !!p,
      station: s.station ?? root?.dataset.spaceStation ?? null,
      at: s.at ?? root?.dataset.spaceAt ?? null,
      atStation: s.atStation ?? root?.dataset.spaceAtStation ?? null,
      flying: s.flying ?? !!api?.flying,
      paused: s.paused ?? !!api?.paused,
      assembled: document.documentElement.dataset.spaceAssembled === '1',
      changedAt: s.changedAt ?? null,
      elapsed: read(() => p.elapsed, 0),
      frames: read(() => p.frames, 0),
      dpr: read(() => p.dpr, null),
      guard: read(() => p.guardStage, null),
      dust: g ? Math.min(g.drawRange.count, g.attributes.position.count) : null,
      total: s.total ?? (nv ? Number(nv.total) : null),
      clicksTotal: s.clicksTotal ?? (nv ? Number(nv.clicksTotal) : null),
      probe: st ? 'stage' : p ? 'handles' : 'none',
      ...where(),
    };
  };

  // Run the world until it stands still, then let the dust move for `dust`
  // frames, draw `frames` frames with time held, and stop drawing: the canvas
  // keeps the last picture. With `sec`, run that many engine-seconds instead
  // (the dust moving all the while). Frame-synchronous: the same deck settles
  // to the same engine time on every run.
  const settle = ({ min = 6, since = 0, capMs = 30000, dust = 12, frames = 1, sec = null }) => new Promise((done) => {
    const t0 = realNow(), e0 = state().elapsed;
    let phase = 'run', n = 0, settled = false;
    setMode('fast');
    const end = () => {
      tickers.delete(step); clearTimeout(timer);
      setMode('hold'); setDraw('off');
      const s = state();
      done({ settled, settleMs: Math.round(realNow() - t0), engineSec: +(s.elapsed - e0).toFixed(3) });
    };
    const step = () => {
      if (phase === 'run') {
        if (sec != null && draw === 'off') { if (!offOdd()) setDraw('dust'); return; }
        const s = state();
        const anchor = Math.max(since ?? 0, s.changedAt ?? 0);
        const still = sec != null ? s.elapsed - e0 >= sec - 1e-6
          : !s.ready || s.static || s.paused || (!s.flying && s.assembled && s.elapsed - anchor >= min - 1e-6);
        if (!still && realNow() - t0 < capMs) return;
        if (offOdd()) return;   // one more undrawn frame first (see offOdd)
        settled = still;
        phase = 'dust'; n = 0;
        if (sec == null && dust > 0) { setDraw('dust'); return; }   // this frame is the first dust frame
      }
      if (phase === 'dust') {
        if (sec == null && ++n < dust) return;
        phase = 'draw'; n = 0;
        setMode('hold'); setDraw('on');
        return;
      }
      if (++n >= frames) end();
    };
    tickers.add(step);
    const timer = setTimeout(() => { if (tickers.has(step)) end(); }, capMs + 20000);
  });

  const frames = (k = 2) => new Promise((ok) => { let n = 0; const f = () => { if (++n >= k) { tickers.delete(f); ok(); } }; tickers.add(f); });

  // Finite CSS animations and transitions jump to their end (a cover title
  // still fading in, cards rising); infinite ones are left be.
  const finish = () => {
    let n = 0;
    for (const a of document.getAnimations()) {
      try {
        const end = a.effect?.getComputedTiming?.().endTime;
        if (end != null && Number.isFinite(end) && a.playState !== 'finished') { a.finish(); n++; }
      } catch { /* a cancelled animation */ }
    }
    return n;
  };

  // What a review reads off a frame: how far the slide's content runs past its
  // edges, and every visible box of text (its words, place and type size in
  // screen px), on the slide and in the stop HUD.
  const measure = (no) => {
    const out = { overflowPx: null, overflowRightPx: null, textBoxes: [], wordsOnScreen: 0, minFontPx: null };
    const lay = document.querySelector(`.slidev-page[data-slidev-no="${no}"] .slidev-layout`);
    if (!lay) return out;
    const r = lay.getBoundingClientRect();
    const scale = lay.offsetWidth ? r.width / lay.offsetWidth : 1;
    let bottom = 0, right = 0;
    for (const el of lay.querySelectorAll('*')) {
      if (el.closest('.video-player')) continue;     // full-bleed by design
      const b = el.getBoundingClientRect();
      if (b.height > 0 && b.width > 0) { bottom = Math.max(bottom, b.bottom); right = Math.max(right, b.right); }
    }
    out.overflowPx = Math.round(bottom - r.bottom);
    out.overflowRightPx = Math.round(right - r.right);
    // each text node belongs to its nearest box that is not inline
    const blocks = new Map();
    for (const scope of [lay, document.querySelector('.stage .hud')].filter(Boolean)) {
      const w = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        const s = t.nodeValue.replace(/\s+/g, ' ').trim();
        const parent = t.parentElement;
        if (!s || !parent || parent.closest('style, script, noscript, template, svg')) continue;
        let el = parent;
        while (el !== scope && getComputedStyle(el).display === 'inline') el = el.parentElement;
        const b = blocks.get(el) || { parts: [], font: Infinity };
        b.parts.push(s);
        b.font = Math.min(b.font, parseFloat(getComputedStyle(parent).fontSize) || Infinity);
        blocks.set(el, b);
      }
    }
    for (const [el, { parts, font }] of blocks) {
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const b = el.getBoundingClientRect();
      if (b.width < 1 || b.height < 1 || b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight) continue;
      const text = parts.join(' ');
      const fontPx = Number.isFinite(font) ? +(font * scale).toFixed(1) : null;
      out.textBoxes.push({ text: text.slice(0, 160), x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), fontPx });
      out.wordsOnScreen += text.split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x)).length;
      if (fontPx != null) out.minFontPx = out.minFontPx == null ? fontPx : Math.min(out.minFontPx, fontPx);
    }
    return out;
  };

  // Luminance (Rec. 709, 0..1) of each box in the screenshot: mean, variance,
  // and the share of clipped-white pixels.
  const lum = async (b64, boxes) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const k = bmp.width / innerWidth;   // picture px per CSS px
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    return boxes.map((b) => {
      const x = Math.max(0, Math.floor(b.x * k)), y = Math.max(0, Math.floor(b.y * k));
      const w = Math.min(bmp.width - x, Math.ceil(b.w * k)), h = Math.min(bmp.height - y, Math.ceil(b.h * k));
      if (w < 1 || h < 1) return { lumMean: null, lumVar: null, white: null };
      const d = g.getImageData(x, y, w, h).data;
      let s = 0, s2 = 0, white = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const L = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        s += L; s2 += L * L; if (L >= 0.97) white++;
      }
      const m = s / n;
      return { lumMean: +m.toFixed(3), lumVar: +Math.max(0, s2 / n - m * m).toFixed(4), white: +(white / n).toFixed(3) };
    });
  };

  // A slide as --changed compares it: its frontmatter and its markup, without
  // the classes and styles a slide transition leaves on it mid-way.
  const fingerprint = (no) => {
    const pg = document.querySelector(`.slidev-page[data-slidev-no="${no}"]`);
    if (!pg) return null;
    const c = pg.cloneNode(true);
    for (const el of [c, ...c.querySelectorAll('*')]) {
      for (const k of [...el.classList]) if (/-(enter|leave)(-active|-from|-to)?$/.test(k)) el.classList.remove(k);
    }
    c.removeAttribute('style');
    let fm = null;
    try { fm = JSON.stringify(nav()?.currentSlideRoute?.meta?.slide?.frontmatter ?? null); } catch { /* circular */ }
    return `${fm}\n${c.outerHTML}`;
  };

  const go = async (n, k = 0) => {
    const nv = nav();
    if (nv?.go) await nv.go(n, k);
    else location.hash = `#/${n}${k ? `?clicks=${k}` : ''}`;
  };

  // live measurement on the real clock, drawing: frames and engine-seconds per wall second
  const measureFps = (ms) => whenEven().then(() => new Promise((ok) => {
    setMode('real'); setDraw('on');
    setTimeout(() => {
      const a = state(), t0 = realNow();
      setTimeout(() => {
        const b = state(), s = (realNow() - t0) / 1000;
        setMode('hold'); setDraw('off');
        ok({ fps: +((b.frames - a.frames) / s).toFixed(2), engineSecPerSec: +((b.elapsed - a.elapsed) / s).toFixed(3) });
      }, ms);
    }, 800);
  }));

  // --no-halo: the halo layer never draws, so it takes nothing from Math.random either
  if (cfg.halo === false) {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = '.halo-layer { display: none !important; }';
      document.head.append(s);
    });
  }

  window.__shots = { state, where, settle, frames, finish, measure, lum, fingerprint, go, measureFps, setMode, setDraw };
}

// ---- one page ------------------------------------------------------------------------------

class Deck {
  constructor(browser, o, url, renderer) { Object.assign(this, { browser, o, url, renderer }); this.sink = { errors: [], warnings: [], http: [] }; }

  async open() {
    const { o } = this;
    this.context = await this.browser.newContext({ viewport: { width: o.size[0], height: o.size[1] }, deviceScaleFactor: o.draft ? 0.5 : 1 });
    const page = this.page = await this.context.newPage();
    await page.addInitScript(pageInit, { seed: o.seed, step: STEP_MS, halo: o.halo });
    const origin = new URL(this.url).origin;
    page.on('pageerror', (e) => { if (!NOISE.test(e.message)) this.sink.errors.push(`pageerror: ${e.message.slice(0, 300)}`); });
    page.on('console', (m) => {
      const t = m.text();
      if (NOISE.test(t)) return;
      if (m.type() === 'error' && !/^Failed to load resource/.test(t)) this.sink.errors.push(t.slice(0, 300));   // those are in httpErrors
      else if (m.type() === 'warning' && o.console) this.sink.warnings.push(t.slice(0, 300));
    });
    page.on('response', (r) => { if (r.status() >= 400) this.sink.http.push({ status: r.status(), url: r.url(), local: r.url().startsWith(origin) }); });
    page.on('requestfailed', (r) => {
      const f = r.failure()?.errorText || 'failed';
      if (/ERR_ABORTED/.test(f)) return;   // a media request the player cancelled
      this.sink.http.push({ status: 0, url: r.url(), error: f, local: r.url().startsWith(origin) });
    });
    page.setDefaultTimeout(Math.max(60000, o.wait));
    await page.goto(this.url, { waitUntil: 'load', timeout: o.dev ? 180000 : 90000 });
    await page.waitForSelector('.slidev-layout', { state: 'attached', timeout: o.dev ? 180000 : 90000 });   // attached: the first may be a hidden slide
    // the world boots (or the deck has none, or no WebGL)
    const t0 = Date.now();
    for (;;) {
      const s = await this.state();
      if (s.ready || s.static) break;
      if (!s.stage && Date.now() - t0 > 2500) break;
      if (Date.now() - t0 > 60000) throw new Error('the stage did not boot in 60 s');
      await page.waitForTimeout(100);
    }
    return this;
  }

  state() { return this.page.evaluate(() => window.__shots.state()); }

  // problems seen since the last call
  drain() {
    const s = this.sink;
    const out = { pageErrors: [...new Set(s.errors)], consoleWarnings: [...new Set(s.warnings)], httpErrors: s.http };
    this.sink = { errors: [], warnings: [], http: [] };
    return out;
  }

  // to slide n, click k; false when there is no such slide
  async go(n, k = 0) {
    const { page } = this;
    await page.evaluate(([n, k]) => window.__shots.go(n, k), [n, k]);
    const deadline = Date.now() + (this.o.dev ? 120000 : 15000);
    while (Date.now() < deadline) {
      const ok = await page.evaluate(([n, k]) => {
        const w = window.__shots.where();
        return w.slide === n && (k === 0 || w.clicks === k) && !!document.querySelector(`.slidev-page[data-slidev-no="${n}"] .slidev-layout`);
      }, [n, k]);
      if (ok) { await page.evaluate(() => window.__shots.frames(2)); return true; }
      await page.waitForTimeout(50);
    }
    return false;
  }

  // the clicks a slide has: published by the engine or Slidev, else counted
  // by stepping through it with the keyboard until the slide changes
  async clicksTotal(n) {
    const s = await this.state();
    if (s.slide === n && Number.isFinite(s.clicksTotal)) return s.clicksTotal;
    const { page } = this;
    let k = 0;
    for (; k < 60; k++) {
      const before = await page.evaluate(() => location.hash);
      await page.keyboard.press('ArrowRight');
      const t0 = Date.now();
      while (Date.now() - t0 < 3000 && (await page.evaluate(() => location.hash)) === before) await page.waitForTimeout(30);
      if ((await page.evaluate(() => window.__shots.where().slide)) !== n) break;
    }
    await this.go(n, 0);
    return k;
  }

  async close() { await this.context?.close().catch(() => {}); }
}

// ---- photographing ------------------------------------------------------------------------------

// A PNG of the page as it stands. CDP's fast encoder first (about a third of
// a second sooner than Playwright's screenshot at 1600x900, files ~15% larger).
async function capture(deck, file, timeout) {
  const { page, o } = deck;
  const within = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`screenshot: no picture in ${timeout} ms`)), timeout).unref())]);
  try {
    deck.cdp ??= await page.context().newCDPSession(page);
    const clip = o.draft ? { x: 0, y: 0, width: o.size[0], height: o.size[1], scale: 0.5 } : undefined;
    const r = await within(deck.cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, fromSurface: true, clip }));
    const buf = Buffer.from(r.data, 'base64');
    await writeFile(file, buf);
    return buf;
  } catch (e) {
    if (/no picture/.test(e.message)) throw e;
    return page.screenshot({ path: file, timeout });
  }
}

async function shootFrame(deck, o, rec, { sec = null } = {}) {
  const { page } = deck;
  const before = await deck.state();
  // The change happened with the clock held: its engine time is now. One
  // drawn frame is enough: with time held, a second would be the same picture.
  const st = await page.evaluate((a) => window.__shots.settle(a), {
    min: o.settle, since: before.elapsed, capMs: o.wait, dust: o.dust, frames: 1, sec,
  });
  const t1 = Date.now();
  await page.evaluate(() => window.__shots.finish());
  await page.evaluate(() => window.__shots.frames(2));
  await page.evaluate(() => window.__shots.finish());   // what the first finish started
  const s = await deck.state();
  const m = await page.evaluate((n) => window.__shots.measure(n), rec.slide);
  const png = join(o.outDir, `${rec.frame}.png`);
  const buf = await capture(deck, png, Math.max(60000, o.wait));
  if (m.textBoxes.length) {
    const l = await page.evaluate(([b64, boxes]) => window.__shots.lum(b64, boxes), [buf.toString('base64'), m.textBoxes]);
    m.textBoxes.forEach((b, i) => Object.assign(b, l[i]));
  }
  return {
    ...rec, png, station: s.station, at: s.at, atStation: s.atStation, renderer: deck.renderer,
    settled: st.settled, settleMs: st.settleMs, shotMs: Date.now() - t1, engineSec: st.engineSec, engineTime: +s.elapsed.toFixed(3),
    flying: s.flying, assembled: s.assembled, dpr: s.dpr, dust: s.dust, probe: s.probe,
    ...m, ...deck.drain(),
  };
}

// The files a frame's look depends on besides its own slide: the built CSS
// (content-hashed names), the public files (data/space.json …: size and
// mtime), the tool's own settings.
async function staticKey(dist, o, renderer) {
  const files = [];
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) await walk(f);
      else files.push(f);
    }
  };
  if (dist) await walk(dist);
  const css = files.filter((f) => f.endsWith('.css')).map((f) => relative(dist, f)).sort();
  const pub = [];
  for (const f of files) {
    const r = relative(dist, f);
    if (r.startsWith(`assets${sep}`) || r === 'index.html' || r === '404.html') continue;
    const s = await stat(f);
    pub.push(`${r}:${s.size}:${Math.round(s.mtimeMs)}`);
  }
  pub.sort();
  return JSON.stringify([VERSION, o.size, o.draft, o.seed, o.halo, o.settle, o.dust, o.burst, o.every, renderer, css, pub]);
}

const sha1 = (s) => createHash('sha1').update(s).digest('hex');

// What makes a run exit 3, frame by frame.
export function problemsOf(r) {
  const p = [];
  if (r.error) p.push(`failed: ${r.error}`);
  if (r.settled === false) p.push('not settled');
  if ((r.overflowPx ?? 0) > 1) p.push(`runs ${r.overflowPx}px off the bottom`);
  if ((r.overflowRightPx ?? 0) > 1) p.push(`runs ${r.overflowRightPx}px off the right`);
  if (r.pageErrors?.length) p.push(`${r.pageErrors.length} page error(s)`);
  const local = (r.httpErrors || []).filter((h) => h.local);
  if (local.length) p.push(`${local.length} failed request(s)`);
  return p;
}

// slides → n contiguous runs, one per page
export function split(list, n) {
  const k = Math.max(1, Math.min(n, list.length));
  const size = Math.ceil(list.length / k);
  return Array.from({ length: k }, (_, i) => list.slice(i * size, (i + 1) * size)).filter((x) => x.length);
}

async function contactSheet(browser, records, file) {
  const shots = records.filter((r) => r.png && existsSync(r.png));
  if (!shots.length) return null;
  const page = await browser.newPage();
  try {
    await page.evaluate(([cols, W, n]) => { window.__sheet = { cols, W, n, c: null, i: 0 }; }, [Math.min(4, shots.length), 400, shots.length]);
    for (const r of shots) {
      const b64 = (await readFile(r.png)).toString('base64');
      const flags = problemsOf(r);
      const label = [r.frame, r.station ?? '', r.settleMs != null ? `${(r.settleMs / 1000).toFixed(1)} s` : '', r.unchanged ? 'unchanged' : ''].filter(Boolean).join('  ·  ');
      await page.evaluate(async ([b64, label, flags]) => {
        const S = window.__sheet;
        const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
        const H = Math.round(S.W * bmp.height / bmp.width), L = 38, G = 10;
        if (!S.c) {
          const rows = Math.ceil(S.n / S.cols);
          S.c = new OffscreenCanvas(G + S.cols * (S.W + G), G + rows * (H + L + G));
          S.g = S.c.getContext('2d');
          S.g.fillStyle = '#111'; S.g.fillRect(0, 0, S.c.width, S.c.height);
          S.H = H; S.L = L; S.G = G;
        }
        const col = S.i % S.cols, row = Math.floor(S.i / S.cols);
        const x = S.G + col * (S.W + S.G), y = S.G + row * (S.H + S.L + S.G);
        S.g.drawImage(bmp, x, y, S.W, S.H);
        S.g.font = '13px sans-serif'; S.g.fillStyle = '#ddd'; S.g.fillText(label, x + 2, y + S.H + 15);
        if (flags.length) { S.g.fillStyle = '#ff6b6b'; S.g.fillText(flags.join(' · ').slice(0, 70), x + 2, y + S.H + 32); }
        S.i++;
      }, [b64, label, flags]);
    }
    const out = await page.evaluate(async () => {
      const blob = await window.__sheet.c.convertToBlob({ type: 'image/png' });
      const a = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
      return btoa(s);
    });
    await writeFile(file, Buffer.from(out, 'base64'));
    return file;
  } finally { await page.close(); }
}

// ---- slidev dev ---------------------------------------------------------------------------------

function findUp(dir, rel) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, rel))) return join(d, rel);
    if (dirname(d) === d) return null;
  }
}

const freePort = () => new Promise((ok, fail) => {
  const s = createServer();
  s.on('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

// slidev's dev server for a deck, on a free port; stopped by its process
// group's id, never by a name pattern.
async function startDev(deck) {
  const file = resolve(deck), dir = dirname(file);
  const bin = findUp(dir, join('node_modules', '.bin', 'slidev'));
  if (!bin) throw new Error(`--dev: no slidev in ${dir}/node_modules/.bin or above it`);
  const port = await freePort();
  const child = spawn(bin, [file, '--port', String(port), '--open', 'false'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  const keep = (d) => { log = (log + d).slice(-4000); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  const stop = () => {
    if (child.exitCode != null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 3000).unref();
  };
  const url = `http://localhost:${port}/`;
  const t0 = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`--dev: slidev exited (${child.exitCode}):\n${log}`);
    try { if ((await fetch(url)).ok) break; } catch { /* not yet */ }
    if (Date.now() - t0 > 120000) { stop(); throw new Error(`--dev: slidev did not answer on ${url} in 120 s:\n${log}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  return { url, stop, pid: child.pid };
}

// ---- the run --------------------------------------------------------------------------------------

export async function shoot(o, log = console.log) {
  o.outDir = resolve(o.out);
  await mkdir(o.outDir, { recursive: true });
  const report = resolve(o.json || join(o.outDir, 'shots.ndjson'));
  await writeFile(report, '');
  const records = [];
  const emit = async (r) => { records.push(r); await appendFile(report, `${JSON.stringify(r)}\n`); };
  const cleanup = [];
  const done = async () => { for (const f of cleanup.reverse()) { try { await f(); } catch { /* best effort */ } } };
  const onSignal = (sig) => {
    try { appendFileSync(report, `${JSON.stringify({ fatal: `stopped by ${sig}` })}\n`); } catch { /* best effort */ }
    done().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  const T0 = Date.now();
  let renderer = null, gl = null, fatal = null;
  try {
    const { chromium } = loadPlaywright();
    // where the deck is
    let url, dist = null;
    if (o.dev) {
      const dev = await startDev(o.dev);
      cleanup.push(dev.stop);
      url = dev.url;
      log(`slidev dev on ${url} (pid ${dev.pid})`);
    } else {
      dist = realpathSync(resolve(o.dist));
      const html = await readFile(join(dist, 'index.html'), 'utf8').catch(() => { throw new Error(`${dist}: no index.html (is it a built deck?)`); });
      const base = o.base || detectBase(html);
      const { server, port } = await serve(dist, { base });
      cleanup.push(() => new Promise((r) => server.close(r)));
      url = `http://localhost:${port}${base}`;
      if (base !== '/') log(`serving ${dist} under ${base}`);
    }
    const launched = await launch(chromium, o.gl);
    ({ renderer, gl } = launched);
    cleanup.push(() => launched.browser.close());
    log(`renderer: ${renderer ?? 'no WebGL2'}${gl === 'swiftshader' && o.gl === 'auto' ? '  (llvmpipe not reachable from this browser build)' : ''}`);

    // the deck's length: published by the engine or Slidev, else walked
    const tb = Date.now();
    const first = await new Deck(launched.browser, o, url, renderer).open();
    log(`booted in ${((Date.now() - tb) / 1000).toFixed(1)} s (engine probe: ${(await first.state()).probe})`);
    const s0 = await first.state();
    let total = Number.isFinite(s0.total) && s0.total > 0 ? s0.total : null;
    if (!total) {
      // a deck that does not say how long it is: Slidev mounts only the slides
      // near the current one, so walk until a slide fails to appear
      total = 0;
      while (total < 500 && await first.go(total + 1, 0)) total++;
      await first.go(1, 0);
    }
    const slides = parseSlides(o.slides, total);
    if (!slides.length) throw new Error(`no slides to photograph (${o.slides ?? 'all'} of ${total})`);
    log(`${total} slide(s); photographing ${o.slides ? slides.join(',') : 'all'}${o.probe ? ' (probe)' : ''}`);

    const key0 = o.changed ? await staticKey(dist, o, renderer) : null;
    const cacheFile = join(o.outDir, '.shots-cache.json');
    const cache = o.changed ? await readFile(cacheFile, 'utf8').then(JSON.parse).catch(() => ({})) : {};
    if (o.changed && o.dev) log('note: --changed compares built files; with --dev every frame is photographed');

    const pages = [first];
    const runs = split(slides, o.jobs);
    for (let i = 1; i < runs.length; i++) pages.push(await new Deck(launched.browser, o, url, renderer).open());
    const runSlides = async (deck, list) => {
      for (const n of list) {
        try {
          if (deck.page.isClosed()) deck = await new Deck(launched.browser, o, url, renderer).open();
          if (!(await deck.go(n, 0))) throw new Error(`slide ${n} did not appear`);
          if (o.probe) {
            const f = await deck.page.evaluate(() => window.__shots.measureFps(2000));
            const s = await deck.state();
            const r = { slide: n, probe: true, renderer, fps: f.fps, engineSecPerSec: f.engineSecPerSec, dpr: s.dpr, dust: s.dust, station: s.station, ...deck.drain() };
            await emit(r);
            log(`${frameName(n)}  ${String(f.fps).padStart(6)} fps  ${String(f.engineSecPerSec).padStart(6)} engine-s/s  station=${s.station ?? '-'}${f.engineSecPerSec < 0.5 ? '  slow: shots rely on settle here' : ''}`);
            continue;
          }
          const ks = clicksFor(o, n, !o.clickMap && o.clicks !== 'none' ? await deck.clicksTotal(n) : 0);
          for (const k of ks) {
            for (let b = 0; b < o.burst; b++) {
              const rec = { slide: n, click: k, ...(o.burst > 1 ? { burst: b } : {}), frame: frameName(n, k, o.burst > 1 ? b : 0) };
              try {
                if (b === 0 && !(await deck.go(n, k))) throw new Error(`click ${k} of slide ${n} did not come`);
                let key = null;
                if (o.changed && b === 0 && !o.dev) {
                  key = sha1(key0 + (await deck.page.evaluate((n) => window.__shots.fingerprint(n), n)));
                  const hit = cache[rec.frame];
                  if (hit?.key === key && existsSync(join(o.outDir, `${rec.frame}.png`)) && o.burst === 1) {
                    await emit({ ...hit.record, unchanged: true });
                    log(`${rec.frame}  unchanged`);
                    continue;
                  }
                }
                const r = await shootFrame(deck, o, rec, { sec: b > 0 ? o.every : null });
                await emit(r);
                if (key) cache[rec.frame] = { key, record: r };
                const p = problemsOf(r);
                log(`${r.frame}  station=${r.station ?? '-'}  settle ${(r.settleMs / 1000).toFixed(1)} s (${r.engineSec} engine-s) + ${(r.shotMs / 1000).toFixed(1)} s  overflow=${r.overflowPx ?? '-'}px  words=${r.wordsOnScreen}${p.length ? `  ! ${p.join('; ')}` : ''}`);
              } catch (e) {
                const r = { ...rec, png: null, renderer, error: String(e.message || e).split('\n')[0].slice(0, 300), ...deck.drain() };
                await emit(r);
                log(`${rec.frame}  FAILED: ${r.error}`);
                if (deck.page.isClosed() || /Target (page, context or browser )?(has been )?closed|crashed/i.test(r.error)) {
                  await deck.close();
                  deck = await new Deck(launched.browser, o, url, renderer).open();
                }
              }
            }
          }
        } catch (e) {
          const r = { slide: n, click: 0, frame: frameName(n), png: null, renderer, error: String(e.message || e).split('\n')[0].slice(0, 300) };
          await emit(r);
          log(`${r.frame}  FAILED: ${r.error}`);
        }
      }
    };
    await Promise.all(runs.map((list, i) => runSlides(pages[i], list)));
    if (o.changed) await writeFile(cacheFile, JSON.stringify(cache));
    if (o.sheet && !o.probe) {
      const sorted = [...records].sort(byFrame);
      const f = await contactSheet(launched.browser, sorted, join(o.outDir, 'sheet.png'));
      if (f) log(`contact sheet: ${f}`);
    }
  } catch (e) {
    fatal = String(e.message || e);
    await appendFile(report, `${JSON.stringify({ fatal: fatal.slice(0, 2000), renderer })}\n`).catch(() => {});
  } finally {
    await done();
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
  }
  // in slide order, the fatal line (if any) last
  const sorted = [...records].sort(byFrame);
  await writeFile(report, sorted.map((r) => `${JSON.stringify(r)}\n`).join('') + (fatal ? `${JSON.stringify({ fatal: fatal.slice(0, 2000), renderer })}\n` : ''));
  const problems = sorted.map((r) => [r.frame ?? frameName(r.slide), problemsOf(r)]).filter(([, p]) => p.length);
  return { records: sorted, renderer, gl, report, fatal, problems, ms: Date.now() - T0, code: fatal ? 1 : problems.length ? 3 : 0 };
}

const byFrame = (a, b) => (a.slide - b.slide) || ((a.click ?? 0) - (b.click ?? 0)) || ((a.burst ?? 0) - (b.burst ?? 0));

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help) { console.log(USAGE); return 0; }
  if (o.errors.length) { console.error(`${o.errors.join('\n')}\n\n${USAGE}`); return 2; }
  const relaunched = await relaunchLocked(o, argv);
  if (relaunched !== null) return relaunched;
  let res;
  try { res = await shoot(o); } catch (e) { console.error(e.message || e); return 1; }
  const frames = res.records.filter((r) => r.png || r.unchanged).length;
  if (res.problems.length) {
    console.log(`\n${res.problems.length} frame(s) with problems:`);
    for (const [f, p] of res.problems) console.log(`  ${f}: ${p.join('; ')}`);
    const errs = [...new Set(res.records.flatMap((r) => r.pageErrors || []))].slice(0, 10);
    if (errs.length) console.log(`\npage errors:\n  ${errs.join('\n  ')}`);
  }
  if (res.fatal) console.error(`\nthe run failed: ${res.fatal}`);
  console.log(`\n${o.probe ? `${res.records.length} slide(s) probed` : `${frames} frame(s) in ${resolve(o.out)}`} · ${(res.ms / 1000).toFixed(1)} s · report ${res.report}`);
  return res.code;
}

const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(await main());
