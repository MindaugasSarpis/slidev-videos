// Screenshot slide N of a built deck at several real-time moments after load, and report the page's frame rate.
// st-cover.mjs <dist> <out> <slide> <t1,t2,...>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, SLIDE, TIMES] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8773);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 200)));
const t0 = Date.now();
await page.goto(`http://localhost:8773/#/${SLIDE}`);
let last = 0;
for (const t of TIMES.split(',').map(Number)) {
  const wait = t * 1000 - (Date.now() - t0); if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${String(SLIDE).padStart(2, '0')}-t${t}.png` });
  const st = await page.evaluate(() => { const S = document.querySelector('canvas.field')?.__space; if (!S) return null; let bad = 0, n = 0; S.scene.traverse((o) => { if (o.isPoints && o.geometry.attributes.aKind) { const a = o.geometry.attributes.position.array; n = a.length; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++; } }); return { guard: S.guardStage, elapsed: Math.round(S.elapsed * 10) / 10, dpr: S.dpr, badGrains: bad, n, calls: S.renderer.info.render.calls }; });
  console.log('t=' + t, JSON.stringify(st));
  last = t;
}
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
const assembled = await page.evaluate(() => document.documentElement.dataset.spaceAssembled || 'unset');
console.log(JSON.stringify({ fps, assembled, errors: errors.slice(0, 8) }));
await browser.close(); srv.close();
