// The venue bundle opens from file:// (venue/file.js). Build it with
// `pnpm build:example:file` (example/dist-file), then assert, headless:
//   1. from file://: the deck runs with no page errors; fetch() of a public
//      file answers from the sidecar (Chromium refuses file:// fetches); a
//      frame strip read through <img> leaves the canvas readable (a file://
//      image taints it); the dust clip plays from videos/ beside index.html
//      and arrives as dust, and a cut clip covers its slide, as served;
//   2. index.html alone (opened inside the zip): the "Extract the zip
//      first" page covers the deck;
//   3. the same folder served over http (what RUN_ME.bat does): the shim
//      stays out of the way and the clip plays.
// The clips come from scripts/make-example-clip.mjs; without them (no ffmpeg)
// the clip checks are skipped with a note.
import { createServer } from 'node:http'
import { readFile, mkdtemp, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-chromium'

const ROOT = new URL('../example/dist-file', import.meta.url).pathname
const HAVE_CLIP = existsSync(join(ROOT, 'videos', 'clip_dust.webm'))
if (!existsSync(join(ROOT, 'venue-assets.js'))) {
  console.error(`no venue bundle in ${ROOT}: run pnpm build:example:file first`)
  process.exit(2)
}
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const until = async (page, fn, arg, ms = 15000) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true } catch { return false }
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
async function open(url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  const errors = []
  page.on('pageerror', (e) => { if (!/Wake Lock/i.test(e.message)) errors.push(e.message.slice(0, 200)) })
  page.on('console', (m) => { if (/Fetch API cannot load|outputs zeroes|not allowed to load local resource/i.test(m.text())) errors.push(m.text().slice(0, 200)) })
  // the example's other clips do not exist; the release URLs they try first are cut short
  await page.route(/^https?:\/\/github\.com\//, (r) => r.abort())
  await page.addInitScript(() => {
    window.__ev = []
    for (const t of ['cover', 'transition']) addEventListener(`slidev-videos:${t}`, (e) => window.__ev.push({ t, ...e.detail }))
  })
  await page.goto(url, { waitUntil: 'load' })
  return { page, errors }
}

// ---- 1. from file:// ---------------------------------------------------------------------
const fileUrl = pathToFileURL(join(ROOT, 'index.html')).href
{
  const { page, errors } = await open(`${fileUrl}#/1`)
  check('the deck runs from file://', await until(page, () => !!document.querySelector('.slidev-page h1')))
  const carried = await page.evaluate(() => window.__venueFile?.files ?? 0)
  check('the sidecar loaded and the shim is on', carried >= 4, `${carried} files`)
  const idx = await page.evaluate(() => fetch('video-frames/index.json').then((r) => r.json()).then((j) => Object.keys(j.clips || {}).length, (e) => e.message))
  check('fetch() of a public file answers from the sidecar', typeof idx === 'number' && idx > 0, String(idx))
  const px = await page.evaluate(async () => {
    const im = new Image(); im.src = 'video-frames/clip_dust.webm.jpg'; await im.decode()
    const c = document.createElement('canvas'); c.width = c.height = 4
    const g = c.getContext('2d'); g.drawImage(im, 0, 0, 4, 4)
    try { g.getImageData(0, 0, 1, 1); return 'readable' } catch (e) { return e.name }
  })
  check('an image of public/ leaves the canvas readable (a blob, not a tainting file:// URL)', px === 'readable', px)
  if (HAVE_CLIP) {
    await page.evaluate(() => { location.hash = '#/4' })
    check('the dust clip plays from videos/ beside index.html', await until(page, () => {
      const v = [...document.querySelectorAll('.slidev-page video')].find((v) => v.offsetParent && /clip_dust/.test(v.currentSrc))
      return v && v.currentSrc.startsWith('file:') && !v.paused && v.currentTime > 0.3
    }))
    const ev = await page.evaluate(() => window.__ev.map((e) => `${e.t}:${e.phase ?? e.covered}/${e.mode ?? ''}`))
    check('it arrives as dust and covers its slide', ev.includes('transition:enter/dust') && ev.includes('cover:true/'), ev.join(' '))
    await page.evaluate(() => { window.__ev.length = 0; location.hash = '#/7' })
    check('a cut clip covers its slide', await until(page, () => window.__ev.some((e) => e.t === 'cover' && e.covered)))
  } else {
    console.log('note: example clips missing (pnpm make:clip, then rebuild) — clip checks skipped')
  }
  check('no page errors, no refused file:// loads', errors.length === 0, errors.join(' | '))
  await page.close()
}

// ---- 2. index.html alone ------------------------------------------------------------------
{
  const dir = await mkdtemp(join(tmpdir(), 'venue-alone-'))
  await copyFile(join(ROOT, 'index.html'), join(dir, 'index.html'))
  const { page } = await open(`${pathToFileURL(join(dir, 'index.html')).href}#/1`)
  check('index.html alone says to extract the zip first', await until(page, () => /Extract the zip first/.test(document.body?.innerText || ''), undefined, 8000))
  await page.close()
  await rm(dir, { recursive: true, force: true })
}

// ---- 3. served over http ------------------------------------------------------------------
{
  const MIME = { '.webm': 'video/webm', '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    if (p.endsWith('/')) p += 'index.html'
    try {
      const body = await readFile(join(ROOT, p))
      const type = MIME[extname(p)] || 'application/octet-stream'
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      if (m) {
        const start = m[1] ? Number(m[1]) : 0
        const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 })
        return res.end(body.subarray(start, end + 1))
      }
      res.writeHead(200, { 'content-type': type, 'content-length': body.length })
      res.end(body)
    } catch { res.writeHead(404); res.end('not found') }
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { page, errors } = await open(`http://127.0.0.1:${server.address().port}/#/1`)
  check('served over http the deck runs', await until(page, () => !!document.querySelector('.slidev-page h1')))
  check('served, the shim stays out of the way', await page.evaluate(() => window.__venueFile === undefined))
  if (HAVE_CLIP) {
    await page.evaluate(() => { location.hash = '#/4' })
    check('served, the dust clip plays', await until(page, () => {
      const v = [...document.querySelectorAll('.slidev-page video')].find((v) => v.offsetParent && /clip_dust/.test(v.currentSrc))
      return v && !v.paused && v.currentTime > 0.3
    }))
  }
  check('served, no page errors', errors.length === 0, errors.join(' | '))
  await page.close()
  server.close()
}

await browser.close()
console.log(failures ? `\n${failures} failure(s)` : '\nSMOKE PASS')
process.exit(failures ? 1 : 0)
