import { chromium } from 'playwright-chromium';
import { writeFileSync } from 'node:fs';
const [OUT] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36' });
const page = await ctx.newPage();
const out = {};
for (const rn of ['CERN-TH-401', 'CERN-TH-412']) {
  const url = `https://cds.cern.ch/search?p=reportnumber%3A%22${rn}%22&of=recjson&ot=recid,files`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // Anubis challenge: wait for it to pass and the JSON to render
  for (let i = 0; i < 20; i++) { const t = await page.evaluate(() => document.body.innerText); if (t.trim().startsWith('[')) break; await page.waitForTimeout(1500); }
  const txt = await page.evaluate(() => document.body.innerText);
  try {
    const recs = JSON.parse(txt);
    out[rn] = recs.map((r) => ({ recid: r.recid, files: (r.files || []).map((f) => f.url).filter((u) => /\.pdf/i.test(u)) }));
  } catch { out[rn] = { error: txt.slice(0, 200) }; }
}
console.log(JSON.stringify(out, null, 1));
// download the first PDF of each
for (const rn of Object.keys(out)) {
  const f = out[rn][0]?.files?.[0]; if (!f) continue;
  const resp = await ctx.request.get(f);
  if (resp.ok()) { writeFileSync(`${OUT}/${rn}.pdf`, await resp.body()); console.log('saved', rn, resp.headers()['content-type']); }
  else console.log('download failed', rn, resp.status());
}
await browser.close();
