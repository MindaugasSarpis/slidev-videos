// Serve example/dist and assert, in a headless browser:
//   1. the explainer draws live: SVG paths, no canvas, no bitmap, inside its slide;
//   2. it turns by itself; a drag turns and tilts it and ends the turning; a
//      double-click glides back to the opening view;
//   3. a view button glides to its view, a state button morphs the heights;
//   4. `still` draws the opening view and does not move;
//   5. a second window on the same slide follows the first (presenter ↔ audience);
//   6. the watchdog: with the processor throttled, slow frames switch to the
//      coarse mesh, and at rest it is drawn in full again;
//   7. the fallback: ?x3d-force=fail shows the golden picture, and a scene that
//      is not sound says what is wrong; neither leaves the slide blank;
//   8. nothing on the page threw.
// Every assertion polls for the state it expects, so a slow runner is only slow.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-chromium'

const DIST = new URL('../example/dist', import.meta.url).pathname
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' }
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname))
  const file = join(DIST, path.endsWith('/') ? `${path}index.html` : path)
  try {
    const body = await readFile(file.startsWith(DIST) ? file : join(DIST, 'index.html'))
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const until = async (fn, ms = 20000) => {
  const t0 = Date.now()
  for (;;) {
    const v = await fn().catch(() => null)
    if (v || Date.now() - t0 > ms) return v
    await new Promise((r) => setTimeout(r, 100))
  }
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
const errors = []
const open = async (hash, query = '') => {
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(`${base}/${query}#/${hash}`)
  return page
}
const SEC = '.slidev-page:not([style*="display: none"]) section.x3d'
const attr = (page, name, sel = `${SEC} svg.x3d-svg`) => page.locator(sel).first().getAttribute(name)
const num = async (page, name) => Number(await attr(page, name))

try {
  // 1. live, vector, inside the slide
  const page = await open('1')
  check('the explainer is live', await until(async () => (await attr(page, 'data-state', SEC)) === 'live'))
  const paths = await until(async () => { const n = await page.locator(`${SEC} g.x3d-items path`).count(); return n > 1000 ? n : 0 })
  check('it is drawn as SVG paths', paths > 1000, `${paths} paths`)
  check('no canvas and no bitmap in it', (await page.locator(`${SEC} canvas, ${SEC} image, ${SEC} img`).count()) === 0)
  const inside = await page.evaluate((sel) => {
    const s = document.querySelector(sel).getBoundingClientRect()
    const slide = document.querySelector('#slide-content').getBoundingClientRect()
    return s.width > 300 && s.height > 200 && s.left >= slide.left - 1 && s.right <= slide.right + 1 && s.top >= slide.top - 1 && s.bottom <= slide.bottom + 1
  }, SEC)
  check('it lies inside its slide', inside)

  // 2. it turns; a drag; a double-click
  const a0 = await num(page, 'data-azim')
  const turned = await until(async () => Math.abs((await num(page, 'data-azim')) - a0) > 0.5)
  check('it turns by itself', !!turned)
  const box = await page.locator(`${SEC} svg.x3d-svg`).first().boundingBox()
  const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.5
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 80, cy + 40, { steps: 6 })
  await page.mouse.up()
  const a1 = await num(page, 'data-azim'), e1 = await num(page, 'data-elev')
  await page.waitForTimeout(500)
  check('a drag turns and tilts it, and it no longer turns by itself', Math.abs(a1 - a0) > 5 && e1 > 36 && (await num(page, 'data-azim')) === a1, `azim ${a0} → ${a1}, elev ${e1}`)
  await page.mouse.dblclick(cx, cy)
  check('a double-click glides back to the opening view', await until(async () => (await num(page, 'data-azim')) === 150 && (await num(page, 'data-elev')) === 35))

  // 3. a view button
  await page.locator(`${SEC} button[data-view-id="above"]`).click()
  check('a view button glides to its view', await until(async () => (await num(page, 'data-elev')) === 90 && (await num(page, 'data-azim')) === -90))
  check('the button is marked', (await page.locator(`${SEC} button[data-view-id="above"].on`).count()) === 1)

  // 5. a second window follows
  const audience = await open('1')
  await until(async () => (await attr(audience, 'data-state', SEC)) === 'live')
  check('a window opened late shows the view of the first', await until(async () => (await num(audience, 'data-elev')) === 90))
  await page.bringToFront()
  await page.locator(`${SEC} button[data-view-id="along"]`).click()
  check('and follows its buttons', await until(async () => (await num(audience, 'data-elev')) === 10 && (await num(audience, 'data-azim')) === 147.5))
  await audience.close()

  // 6. the watchdog
  await page.bringToFront()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 })
  await page.locator(`${SEC} button.x3d-play`).click()
  const stats = () => page.evaluate((sel) => ({ ...document.querySelector(`${sel} svg.x3d-svg`).__x3d }), SEC)
  const slow = await until(async () => { const s = await stats(); return s.slow ? s : null }, 30000)
  check('throttled, slow frames switch to the coarse mesh', !!slow && slow.coarse >= 0, JSON.stringify(slow || await stats()))
  const pathsMoving = await page.locator(`${SEC} g.x3d-items path:not([style*="none"])`).count()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const s2 = await stats()
  if (!s2.tooSlow) await page.locator(`${SEC} button.x3d-play`).click()
  const full = await until(async () => { const n = await page.locator(`${SEC} g.x3d-items path:not([style*="none"])`).count(); return n > 1000 && n > pathsMoving ? n : 0 })
  check('at rest it is drawn in full again', full > pathsMoving, `${pathsMoving} paths moving, ${full} at rest`)
  await page.close()

  // 4. still
  const still = await open('2')
  await until(async () => (await attr(still, 'data-state', SEC)) === 'live')
  await until(async () => (await still.locator(`${SEC} g.x3d-items path`).count()) > 1000)
  const sa = await num(still, 'data-azim')
  await still.waitForTimeout(600)
  check('`still` draws the opening view and does not move', sa === 150 && (await num(still, 'data-azim')) === 150 && (await still.locator(`${SEC} nav`).count()) === 0)
  await still.close()

  // 3b. a deck's own scene, and its states
  const own = await open('3')
  await until(async () => (await attr(own, 'data-state', SEC)) === 'live')
  check("a deck's own scene draws", await until(async () => (await own.locator(`${SEC} g.x3d-items path`).count()) >= 400))
  check('its marker is labelled', (await own.locator(`${SEC} text.x3d-label`).count()) === 1)
  await own.locator(`${SEC} button[data-state-id="floor"]`).click()
  check('a state button morphs to the other state', await until(async () => (await attr(own, 'data-shown')) === 'floor' && (await own.locator(`${SEC} text.x3d-label`).count()) === 0))
  await own.close()

  // 7. the fallbacks
  const forced = await open('1', '?x3d-force=fail')
  check('forced to fail, it says so', await until(async () => (await attr(forced, 'data-state', SEC)) === 'fallback'))
  const img = await until(() => forced.evaluate((sel) => { const i = document.querySelector(`${sel} img.x3d-fallback`); return i && i.complete && i.naturalWidth > 0 ? i.currentSrc : null }, SEC))
  check('and shows the golden picture, a vector file', !!img && /\.svg(\?|$)/.test(img), String(img))
  await forced.close()
  const broken = await open('4')
  check('a scene that is not sound says what is wrong', await until(async () => /axes: three are needed/.test(await broken.locator(`${SEC} p.x3d-msg`).textContent())))
  await broken.close()

  // 8.
  const real = errors.filter((e) => !/forced to fail|axes: three are needed/.test(e))
  check('nothing on the page threw', real.length === 0, real.join(' | '))
} finally {
  await browser.close()
  server.close()
}
console.log(failures ? `${failures} FAILED` : 'smoke: all ok')
process.exit(failures ? 1 : 0)
