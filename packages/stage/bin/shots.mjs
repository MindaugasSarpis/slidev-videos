#!/usr/bin/env node
// Photograph a built deck, slide by slide, in a headless browser — the way to
// review a talk that lives in a 3D world without sitting through it — and
// report what a review looks for: content running off the slide, where the
// camera stood, page errors.
//
//   slidev-stage-shots <dist> <out-dir> [--slides 1-12,15] [--clicks '{"9":3}']
//                      [--wait 4200] [--click-wait 9000] [--size 1600x900] [--json report.json]
//
//   dist        a built deck (slidev build … --base /)
//   --slides    which slides (default: all, counted from the deck itself)
//   --clicks    slides with clicks to step through: {"slide": clicks}
//   --wait      ms to let a slide settle before the shot (a flight takes up to 4.5 s)
//   --stills    the world alone, no slide text, as <out-dir>/01.jpg …: the stills
//               print, PDF export and the static fallback show (stage/stills.js);
//               write them to the deck's public/stills
//
// WebGL runs on SwiftShader (software), which is slow but draws the same
// picture. Needs playwright-chromium (a devDependency of the deck or this repo).
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
};
export const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

// A static server for a built deck: unknown paths fall back to index.html
// (the deck is a single-page app), media is served in byte ranges.
export function serve(dist) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try { if (!(await stat(join(dist, p))).isFile()) p = '/index.html'; } catch { p = '/index.html'; }
    try {
      const body = await readFile(join(dist, p));
      const type = MIME[extname(p)] || 'application/octet-stream';
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
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((ok) => server.listen(0, () => ok({ server, port: server.address().port })));
}

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

function parseArgs(argv) {
  const o = { dist: null, out: null, slides: null, clicks: {}, wait: 4200, clickWait: 9000, size: [1600, 900], json: null, stills: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slides') o.slides = argv[++i];
    else if (a === '--clicks') o.clicks = JSON.parse(argv[++i]);
    else if (a === '--wait') o.wait = Number(argv[++i]);
    else if (a === '--click-wait') o.clickWait = Number(argv[++i]);
    else if (a === '--size') o.size = argv[++i].split('x').map(Number);
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--stills') o.stills = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  [o.dist, o.out] = rest;
  return o;
}

export async function shoot(o) {
  let chromium;
  try { ({ chromium } = await import('playwright-chromium')); } catch {
    throw new Error('slidev-stage-shots needs playwright-chromium: pnpm add -D playwright-chromium && pnpm exec playwright install chromium');
  }
  const dist = resolve(o.dist), out = resolve(o.out);
  await mkdir(out, { recursive: true });
  const { server, port } = await serve(dist);
  const browser = await chromium.launch({ args: [...GL_ARGS, '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: o.size[0], height: o.size[1] } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  const report = [];
  try {
    await page.goto(`http://localhost:${port}/#/1`);
    await page.waitForSelector('.slidev-layout', { state: 'attached', timeout: 60000 });   // attached, not visible: the first in the DOM may be a hidden slide
    await page.waitForTimeout(3000);
    // --stills: only the world shows; the slide, the stage's scrim, HUD and paper
    // grain, the halo layer and the controls are drawn live over the still
    if (o.stills) await page.addStyleTag({ content: `
      .slidev-page, .slidev-nav, .slidev-icon-btn, #slidev-goto-dialog, .stage .scrim, .stage .grain, .stage .hud, .halo-layer, .stage-debug { visibility: hidden !important; }
      .stage, .stage .field { visibility: visible !important; }` });
    // A built deck does not say how long it is, and Slidev mounts only the
    // slides near the current one: walk until a slide fails to appear.
    const MAX = 500;
    for (const n of parseSlides(o.slides, MAX)) {
      await page.evaluate((n) => { location.hash = `#/${n}`; }, n);
      const there = await page.waitForSelector(`.slidev-page[data-slidev-no="${n}"]`, { state: 'attached', timeout: 5000 }).then(() => true, () => false);
      const on = there && await page.evaluate((n) => Number((/^#\/(\d+)/.exec(location.hash) || [])[1]) === n, n);
      if (!on) break;
      await page.waitForTimeout(o.wait);
      const shot = async (suffix) => {
        const info = await page.evaluate((n) => {
          const pg = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`);
          const lay = pg?.querySelector('.slidev-layout');
          const st = document.querySelector('.stage, .hadron-space');
          const at = st?.dataset.spaceAt ?? null, station = st?.dataset.spaceStation ?? null;
          if (!lay) return { at, station, overflowPx: null };
          const r = lay.getBoundingClientRect();
          let bottom = 0, right = 0;
          for (const el of lay.querySelectorAll('*')) {
            if (el.closest('.video-player')) continue;     // full-bleed by design
            const b = el.getBoundingClientRect();
            if (b.height > 0 && b.width > 0) { bottom = Math.max(bottom, b.bottom); right = Math.max(right, b.right); }
          }
          return { at, station, overflowPx: Math.round(bottom - r.bottom), overflowRightPx: Math.round(right - r.right), textChars: lay.innerText.length };
        }, n);
        const name = `${String(n).padStart(2, '0')}${suffix}`;
        if (o.stills) await page.screenshot({ path: join(out, `${name}.jpg`), type: 'jpeg', quality: 82 });
        else await page.screenshot({ path: join(out, `${name}.png`) });
        report.push({ slide: n, frame: name, ...info });
      };
      await shot('');
      for (let c = 1; c <= (o.stills ? 0 : o.clicks[n] || 0); c++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(o.clickWait);
        await shot(`-c${c}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { report, errors: [...new Set(errors)].slice(0, 20) };
}

export async function main(argv = process.argv.slice(2)) {
  const o = parseArgs(argv);
  if (o.help || !o.dist || !o.out) {
    console.log("usage: slidev-stage-shots <dist> <out-dir> [--slides 1-12,15] [--clicks '{\"9\":3}'] [--wait 4200] [--click-wait 9000] [--size 1600x900] [--json report.json] [--stills]");
    return o.help ? 0 : 2;
  }
  let result;
  try { result = await shoot(o); } catch (e) { console.error(e.message || e); return 1; }
  if (o.json) await writeFile(resolve(o.json), JSON.stringify(result, null, 2) + '\n');
  const over = result.report.filter((r) => (r.overflowPx ?? 0) > 0 || (r.overflowRightPx ?? 0) > 0);
  for (const r of result.report) console.log(`${r.frame}  at=${r.at ?? '-'}  station=${r.station ?? '-'}  overflow=${r.overflowPx ?? '-'}px`);
  if (over.length) console.log(`\n${over.length} frame(s) run off the slide: ${over.map((r) => r.frame).join(', ')}`);
  if (result.errors.length) console.log(`\npage errors:\n  ${result.errors.join('\n  ')}`);
  console.log(`\n${result.report.length} frame(s) in ${resolve(o.out)}`);
  return 0;
}

const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(await main());
