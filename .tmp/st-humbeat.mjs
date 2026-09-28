// st-humbeat.mjs <dist>: the hum's level sampled every 0.5 s for 12 s on the cover.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const DIST = process.argv[2];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8781);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:8781/#/1'); await page.waitForTimeout(3000);
await page.keyboard.press('Shift'); await page.waitForTimeout(3500);
const s = [];
for (let i = 0; i < 24; i++) { s.push(await page.evaluate(() => document.querySelector('.hadron-space').__hum())); await page.waitForTimeout(500); }
const r = s.filter((x) => x.playing).map((x) => x.rmsDb);
console.log(JSON.stringify({ samples: r.length, minDb: Math.min(...r), maxDb: Math.max(...r), peaksHz: [...new Set(s.map((x) => x.peakHz))], state: s[s.length - 1].state }));
await browser.close(); srv.close();
