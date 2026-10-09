// Run the example deck under `slidev dev` and assert, headless (WebGL2 on SwiftShader):
//   1. the world draws and the hero assembles in dev, where Vite serves
//      modules one by one and pre-bundles dependencies;
//   2. the builder the deck registers from its setup/main.ts reaches the
//      engine: one builder registry, the deck's type built in the world;
//   3. the addon's own vite.config.js is merged: three.js is served as it is,
//      not pre-bundled, and the engine is loaded once; no 'Multiple instances
//      of Three.js' warning;
//   4. the browser exporter (/export, every slide through Slidev's print
//      components, as `slidev export` renders them) opens no WebGL context:
//      each page has the static ground, and a count shows its final value;
//   5. nothing on the page threw.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright-chromium'
import { ARGS, COMMON } from '../bin/lib/chromium.mjs'

const ROOT = new URL('..', import.meta.url).pathname
const port = await new Promise((ok) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)) }) })
const slidev = spawn(new URL('../node_modules/.bin/slidev', import.meta.url).pathname, ['example/slides.md', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
let serverLog = ''
slidev.stdout.on('data', (d) => { serverLog += d })
slidev.stderr.on('data', (d) => { serverLog += d })
const stop = () => { try { slidev.kill('SIGTERM') } catch {} }
process.on('exit', stop)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const url = `http://localhost:${port}/`
const t0 = Date.now()
for (;;) {
  try { if ((await fetch(url)).ok) break } catch {}
  if (Date.now() - t0 > 120000 || slidev.exitCode != null) { console.error(`slidev dev did not start\n${serverLog}`); process.exit(1) }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await chromium.launch({ args: [...ARGS.swiftshader, ...COMMON] })   // the launcher's software backend: no GPU needed
// every WebGL context a page opens, counted before any of its code runs
const counted = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(100000)
    window.__webgl = 0
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
      const c = get.call(this, kind, ...rest)
      if (c && /webgl/i.test(kind)) window.__webgl++
      return c
    }
  })
  const messages = [], errors = []
  page.on('console', (m) => {
    messages.push(m.text())
    // Slidev's dev client patches FloatingVue for twoslash and logs this when it is absent: not the addon's
    if (m.type() === 'error' && !/Wake Lock|favicon|Failed to patch FloatingVue/i.test(m.text())) errors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => { if (!/Wake Lock/i.test(e.message)) errors.push(e.message.slice(0, 200)) })
  return { page, messages, errors }
}
const poll = async (page, fn, pred, timeout) => {
  const deadline = Date.now() + timeout
  let s = await page.evaluate(fn)
  while (!pred(s) && Date.now() < deadline) { await page.waitForTimeout(250); s = await page.evaluate(fn) }
  return s
}

// --- the deck, live ------------------------------------------------------------------
const live = await counted()
await live.page.goto(url, { waitUntil: 'load', timeout: 120000 })
const s = await poll(live.page, () => {
  const st = document.querySelector('.stage')
  const sp = st?.querySelector('canvas.field')?.__space
  const reg = globalThis[Symbol.for('slidev-addon-stage/registry')]
  const res = performance.getEntriesByType('resource').map((e) => new URL(e.name).pathname)
  return {
    ready: !!st?.classList.contains('ready'), frames: sp?.frames ?? 0, assembled: document.documentElement.dataset.spaceAssembled ?? null,
    tally: !!sp?.scene.getObjectByName('tally'), registered: reg instanceof Map && reg.has('tally') && reg.has('galaxy'),
    engines: res.filter((p) => /\/stage\/builders\.js$|\/deps\/slidev-addon-stage/.test(p)),
    threes: res.filter((p) => /three\/build\/three\.module\.js$|\/deps\/three\.js$/.test(p)),
    webgl: window.__webgl,
  }
}, (s) => s.ready && s.frames > 5 && s.assembled === '1', 180000)
check('the world draws in dev', s.ready && s.frames > 5, `ready=${s.ready} frames=${s.frames}`)
check('the hero assembles in dev', s.assembled === '1', `assembled=${s.assembled}`)
check('the deck\'s own builder reaches the engine', s.registered && s.tally, `registered=${s.registered} built=${s.tally}`)
check('the engine is loaded once', s.engines.length === 1 && !/deps/.test(s.engines[0]), s.engines.join(', '))
check('three.js is served unbundled (the addon\'s vite config is merged)', s.threes.length === 1 && /three\.module\.js$/.test(s.threes[0]), s.threes.join(', '))
const dup = live.messages.filter((m) => /Multiple instances of Three/i.test(m))
check('no second three.js', dup.length === 0, dup[0] || '')
check('nothing on the live page threw', live.errors.length === 0, live.errors.join(' | '))
await live.page.close()

// --- the deck, exported ----------------------------------------------------------------
const exp = await counted()
await exp.page.goto(`${url}#/export`, { waitUntil: 'load', timeout: 120000 })   // the example routes by hash
const p = await poll(exp.page, () => ({
  pages: document.querySelectorAll('.print-slide-container').length,
  grounds: document.querySelectorAll('.print-slide-container .stage.static-bg').length,
  stage: document.documentElement.dataset.stage ?? null,
  count: document.querySelector('.print-slide-container .stage-count')?.textContent ?? null,
  webgl: window.__webgl,
}), (p) => p.pages >= 7 && p.grounds >= p.pages && p.count != null, 120000)
await exp.page.waitForTimeout(1500)
const webgl = await exp.page.evaluate(() => window.__webgl)
check('the exporter renders every slide', p.pages >= 7, `pages=${p.pages}`)
check('printed, every page has the static ground', p.pages > 0 && p.grounds === p.pages && p.stage === '1', `grounds=${p.grounds}/${p.pages} data-stage=${p.stage}`)
check('printed, no page opens a WebGL context', webgl === 0, `contexts=${webgl}`)
check('printed, a count shows its final value', p.count === '400', `count=${p.count}`)
check('nothing on the export page threw', exp.errors.length === 0, exp.errors.join(' | '))

await browser.close()
stop()
if (failures) { console.error(`${failures} dev smoke failure(s)`); process.exit(1) }
console.log('STAGE DEV SMOKE PASS')
process.exit(0)
