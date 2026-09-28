// st-quality.mjs <dist> <out> <slide>: a still at venue resolution (1920x1080 css at 2x), the frame-rate guard held back.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, SLIDE] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8780);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`http://localhost:8780/#/${SLIDE}`);
for (let i = 0; i < 60; i++) { if (await page.evaluate(() => { const S = document.querySelector('canvas.field')?.__space; if (S?.holdQuality) { S.holdQuality(); return true; } return false; })) break; await page.waitForTimeout(100); }
await page.waitForTimeout(15000);
await page.screenshot({ path: `${OUT}/${SLIDE}-quality.png` });
console.log('dpr', await page.evaluate(() => document.querySelector('canvas.field').__space.dpr));
await browser.close(); srv.close();
