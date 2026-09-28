// Diagnose the hero render: screenshot variants with passes off / objects hidden. st-diag.mjs <dist> <out> <t0>
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, T0] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8774);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:8774/#/1'); await page.waitForTimeout(Number(T0) * 1000);
const variants = {
  a_normal: `null`,
  b_nobloom: `S.bloom.enabled = false`,
  c_noshell: `S.scene.traverse(o => { if (o.isMesh && o.geometry?.parameters?.radius > 2.5) o.visible = false })`,
  d_nograins: `S.scene.traverse(o => { if (o.isPoints && o.geometry.attributes.aKind) o.visible = false })`,
  e_nodust: `S.field.visible = false`,
  f_nofinish: `S.finish.enabled = false`,
};
for (const [name, code] of Object.entries(variants)) {
  await page.evaluate(`(() => { const S = document.querySelector('canvas.field').__space; ${code}; })()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.evaluate(`(() => { const S = document.querySelector('canvas.field').__space; S.bloom.enabled = true; S.finish.enabled = true; S.field.visible = true; S.scene.traverse(o => { o.visible = true }); })()`);
}
const info = await page.evaluate(`(() => { const S = document.querySelector('canvas.field').__space; const out = []; S.scene.traverse(o => { if (o.isMesh || o.isPoints) out.push((o.isPoints ? 'points' : 'mesh') + ':' + (o.geometry?.type) + ':' + (o.geometry?.parameters?.radius ?? '') + ':' + (o.material?.type)); }); return out.slice(0, 40); })()`);
console.log(JSON.stringify(info));
await browser.close(); srv.close();
