// Serve example/dist and assert, headless, on the browser and WebGL backend the
// tools get (lib/chromium.mjs: llvmpipe or a GPU where the machine has one,
// else SwiftShader; SLIDEV_STAGE_GL forces one):
//   1. the addon's global layers mounted the stage and the halo from the
//      headmatter `stage:` block alone, with the palette on <html>;
//   2. the world draws (frames advance) and the cover's title waits for the
//      hero to assemble;
//   3. a slide's `space:` frontmatter steers the camera (pose and station);
//   4. a click on a stop slide raises the HUD with the record, and the slide
//      steps back; leaving the slide clears it;
//   5. a covering clip (slidev-addon-videos' window events) rests the
//      renderer, and its leaving wakes it;
//   6. a form of grains gathers when the camera arrives at its station, and
//      not for a pose out in the open dust; grains streak during a flight
//      and only then; the dust takes a leaving clip's colour and lets it go;
//   7. the deck's own builder (example/setup/) stands in the world, and a
//      <StageCount for> follows the number its form shows as it builds;
//   8. window.__stage publishes the deck and settles;
//   9. nothing on the page threw;
//  10. slidev-stage-shots settles each frame: the camera has landed, the form
//      has gathered, the guard kept the full pixel ratio and dust, and a clean
//      deck exits 0; --changed keeps a frame whose public files were only
//      copied again (new times, the same bytes);
//  11. SIGTERM to the process that was started stops the whole run: the
//      browser and the lock's helper are gone, the report ends in a fatal
//      line, the exit is 143;
//  12. the fallback rehearsed (?stage-force, stage/diagnose.js): under
//      stage-force=no-webgl2 the reason is on <html>, the plate's chain is
//      exhausted at once (the example has no plates) and the living still
//      stands in, breathing; slidev-stage-shots --force says the fallback and
//      the layer on every report line;
//  13. under stage-force=reduced-motion the still stands alone; with
//      stage-motion=floor the world runs at its floor (world-floor) and a
//      pose change lands;
//  14. under stage-force=context-lost&stage-debug the world boots and its
//      live context is dropped past the last restore: the real handler takes
//      it down (context-lost on <html>, the living still in, one event whose
//      detail is the tier) and the panel names the forced reason and counts
//      the three losses.
// Every assertion polls for the state it expects, so a slow runner is only slow.
import { mkdtemp, rm, cp, readdir, utimes, readFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve, shoot, parseArgs, failedRequests } from '../bin/shots.mjs'
import { launch } from '../bin/lib/chromium.mjs'

const DIST = new URL('../example/dist', import.meta.url).pathname
const { server, port } = await serve(DIST)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const launched = await launch({ tool: 'the stage smoke' })
const { browser } = launched
console.log(`     renderer: ${launched.renderer} (${launched.backend}, Chromium ${launched.version})`)
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => { if (!/Wake Lock/i.test(e.message)) errors.push(e.message.slice(0, 200)) })
page.on('console', (m) => { if (m.type() === 'error' && !/Wake Lock|favicon/i.test(m.text())) errors.push(m.text().slice(0, 200)) })

const state = () => page.evaluate(() => {
  const html = document.documentElement
  const st = document.querySelector('.stage')
  const c = st?.querySelector('canvas.field')
  const cover = document.querySelector('.slidev-page[data-slidev-no="1"] .slidev-layout h1')
  const hud = st?.querySelector('.hud')
  const layout = document.querySelector('.slidev-page:not([style*="display: none"]) .slidev-layout')
  return {
    stage: html.dataset.stage ?? null,
    accent: html.style.getPropertyValue('--stage-accent'),
    mounted: !!st, ready: !!st?.classList.contains('ready'), staticBg: !!st?.classList.contains('static-bg'),
    frames: c?.__space?.frames ?? 0,
    at: st?.dataset.spaceAt ?? null, station: st?.dataset.spaceStation ?? null, paused: st?.dataset.spacePaused ?? null,
    atStation: st?.dataset.spaceAtStation ?? null, flights: Number(st?.dataset.flights || 0), assemblies: Number(st?.dataset.assemblies || 0),
    flying: !!st?.__space?.flying,
    streak: c?.__space?.field.material.uniforms.uStreak.value ?? null,
    tint: c?.__space?.field.material.uniforms.uTint.value.w ?? null,
    assembled: html.dataset.spaceAssembled ?? null,
    coverOpacity: cover ? Number(getComputedStyle(cover).opacity) : null,
    stop: html.dataset.spaceStop ?? null,
    hud: hud ? { name: hud.querySelector('.hud-name')?.textContent.trim(), rows: [...hud.querySelectorAll('dt')].map((d) => d.textContent.trim()) } : null,
    layoutOpacity: layout ? Number(getComputedStyle(layout).opacity) : null,
    halo: !!document.querySelector('.halo-layer canvas'),
    scrim: Number(st?.querySelector('.scrim')?.style.opacity ?? -1),
  }
})
const until = async (pred, timeout = 30000) => {
  const deadline = Date.now() + timeout
  let s = await state()
  while (!pred(s) && Date.now() < deadline) {
    await page.waitForTimeout(50)
    s = await state()
  }
  return s
}
const goto = (n) => page.evaluate((n) => { location.hash = `#/${n}` }, n)

await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForSelector('.slidev-layout', { timeout: 60000 })

let s = await until((s) => s.ready && s.frames > 5)
check('the addon mounted the stage from the headmatter', s.mounted && s.stage === '1', JSON.stringify(s))
check('the world draws', s.ready && !s.staticBg && s.frames > 5, `ready=${s.ready} static=${s.staticBg} frames=${s.frames}`)
check('the palette is on <html>', s.accent === '#5b93ff', `--stage-accent=${s.accent}`)
check('the halo layer is mounted', s.halo)
check('the cover opens on the hero', s.at === 'wide' && s.station === 'hero', `at=${s.at} station=${s.station}`)

s = await until((s) => s.assembled === '1' && s.coverOpacity === 1, 60000)
check('the cover title lands with the assembly', s.assembled === '1' && s.coverOpacity === 1, `assembled=${s.assembled} opacity=${s.coverOpacity}`)
check('display layouts keep the world open', s.scrim === 0.15, `scrim=${s.scrim}`)

const built = s.assemblies
await goto(2)
s = await until((s) => s.at === '11.5,-2.6,0')
check('frontmatter steers the camera', s.at === '11.5,-2.6,0' && s.station === 'galaxy', `at=${s.at} station=${s.station}`)
check('frontmatter sets the scrim', s.scrim === 0.08, `scrim=${s.scrim}`)
check('a pose near a station is at it', s.atStation === 'galaxy', `atStation=${s.atStation}`)
check('the flight is announced', s.flights === 1, `flights=${s.flights}`)
s = await until((s) => s.flying && s.streak > 0.05, 20000)
check('grains streak while the camera flies', s.flying && s.streak > 0.05, `flying=${s.flying} streak=${s.streak}`)
s = await until((s) => !s.flying && s.assemblies > built && s.assembled === '1', 90000)
check('the form gathers on arrival', s.assemblies === built + 1 && s.assembled === '1', `assemblies ${built} → ${s.assemblies} assembled=${s.assembled}`)
check('no streak once the camera has landed', s.streak === 0, `streak=${s.streak}`)

await goto(3)
s = await until((s) => s.at === 'marks')
check('a stop slide starts on its pose', s.at === 'marks' && s.hud === null && s.stop === null, JSON.stringify(s))
await page.keyboard.press('ArrowRight')
s = await until((s) => s.hud !== null && s.layoutOpacity === 0, 60000)
check('a click flies to the stop and raises its record', s.at === 'first' && s.hud?.name === 'The first mark', JSON.stringify(s.hud))
check('the record shows its rows', JSON.stringify(s.hud?.rows) === JSON.stringify(['found', 'by', 'status']), JSON.stringify(s.hud?.rows))
check('the slide steps back behind the stop', s.stop === '1' && s.layoutOpacity === 0, `stop=${s.stop} opacity=${s.layoutOpacity}`)
await page.keyboard.press('ArrowRight')
s = await until((s) => s.hud?.name === 'The second mark', 60000)
check('the next click moves to the next stop', s.at === 'second' && s.hud?.name === 'The second mark', JSON.stringify(s.hud))
check('a record without rows lists its fields', (s.hud?.rows || []).includes('status') && !(s.hud?.rows || []).includes('id'), JSON.stringify(s.hud?.rows))

const beforeFar = s.assemblies
await goto(4)
s = await until((s) => s.at === 'far' && s.stop === null && s.hud === null)
check('leaving the slide clears the stop', s.stop === null && s.hud === null, JSON.stringify(s))
check('a named pose resolves to its station', s.at === 'far' && s.station === 'ring' && s.atStation === 'ring', `at=${s.at} station=${s.station} atStation=${s.atStation}`)
s = await until((s) => !s.flying && s.assemblies > beforeFar && s.assembled === '1', 90000)
check('the ring gathers on arrival', s.assemblies === beforeFar + 1, `assemblies ${beforeFar} → ${s.assemblies}`)
// the next slide stands at the same station: nothing is scattered and built again
await goto(5)
s = await until((s) => s.at === 'ring' && !s.flying, 60000)
check('a second pose at the same station leaves the form whole', s.assemblies === beforeFar + 1 && s.atStation === 'ring', `assemblies=${s.assemblies} atStation=${s.atStation}`)
// a pose out in the open dust is at no station
await page.evaluate(() => document.querySelector('.stage').__space.setPose({ at: [52, 30, -60], dist: 10 }))
s = await until((s) => s.atStation === '' && !s.flying, 60000)
check('a pose in the open dust is at no station', s.atStation === '' && s.assemblies === beforeFar + 1, `atStation=${JSON.stringify(s.atStation)} assemblies=${s.assemblies}`)
await page.keyboard.press('c')
await page.waitForTimeout(300)
s = await state()
check('`c` builds nothing out in the open', s.assemblies === beforeFar + 1, `assemblies=${s.assemblies}`)
await goto(4)
await until((s) => s.at === 'far' && !s.flying && s.assembled === '1', 90000)
const beforeC = (await state()).assemblies
await page.keyboard.press('c')
s = await until((s) => s.assemblies > beforeC)
check('`c` builds again what stands at the station', s.assemblies === beforeC + 1, `assemblies ${beforeC} → ${s.assemblies}`)
await until((s) => s.assembled === '1', 60000)

// --- the dust takes a colour and lets it go ------------------------------------------
await page.evaluate(() => window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'dust', duration: 1700, color: [0.1, 0.2, 0.9] } })))
s = await until((s) => s.tint > 0.2)
check('the dust takes a leaving clip\'s colour', s.tint > 0.2, `tint=${s.tint}`)
s = await until((s) => s.tint === 0, 60000)
check('and lets it go', s.tint === 0, `tint=${s.tint}`)
await page.evaluate(() => window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'fade', duration: 450, color: null } })))
await page.waitForTimeout(300)
s = await state()
check('a clip that only fades leaves no colour', s.tint === 0, `tint=${s.tint}`)

// --- a covering clip rests the world ----------------------------------------------
const cover = (covered, fit = 'cover') => page.evaluate(([covered, fit]) => {
  window.dispatchEvent(new CustomEvent('slidev-videos:cover', { detail: { covered, fit, src: 'x.mp4' } }))
}, [covered, fit])
await cover(true)
s = await until((s) => s.paused === '1')
const f0 = s.frames
await page.waitForTimeout(400)
s = await state()
check('a covering clip rests the renderer', s.paused === '1' && s.frames === f0, `paused=${s.paused} frames ${f0} → ${s.frames}`)
await cover(false)
s = await until((s) => s.paused === '0' && s.frames > f0)
check('the clip leaving wakes it', s.paused === '0' && s.frames > f0, `paused=${s.paused} frames=${s.frames}`)
await cover(true, 'contain')
await page.waitForTimeout(900)
s = await state()
check('a letterboxed clip does not rest the world', s.paused === '0', `paused=${s.paused}`)
await cover(false)

// --- a video transition stirs the dust (no throw, world keeps drawing) ---------------
const f1 = (await state()).frames
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'enter', mode: 'dust', duration: 1400 } }))
  window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'dust', duration: 1000 } }))
})
s = await until((s) => s.frames > f1 + 3)
check('a video transition stirs the dust', s.frames > f1 + 3, `frames ${f1} → ${s.frames}`)

// --- the deck's own builder, and a count that moves with it ----------------------------
await goto(6)
const counts = new Set()
const tally = () => page.evaluate(() => ({
  at: document.querySelector('.stage')?.dataset.spaceAt ?? null,
  flying: !!document.querySelector('.stage')?.__space?.flying,
  built: !!document.querySelector('.stage canvas.field')?.__space?.scene.getObjectByName('tally'),
  value: document.querySelector('.stage')?.__space?.value('grains') ?? null,
  count: document.querySelector('.slidev-page[data-slidev-no="6"] .stage-count')?.textContent ?? null,
}))
let t = await tally()
const until6 = Date.now() + 120000
while (!(t.at === 'tally' && !t.flying && t.value === 400 && t.count === '400') && Date.now() < until6) {
  if (t.count != null) counts.add(t.count)
  await page.waitForTimeout(50)
  t = await tally()
}
counts.add(t.count)
check('the deck\'s own builder stands in the world', t.built, `built=${t.built}`)
check('its form reports what it shows', t.value === 400, `value=${t.value}`)
const between = [...counts].filter((c) => Number(c) > 0 && Number(c) < 400)
check('the count moves with the form and lands with it', t.count === '400' && between.length > 0, `counts seen: ${[...counts].slice(0, 12).join(', ')}`)

// --- a form that starts late: the settle waits for the last form at a station -----------
// (the tally station holds `grains`, 3.2 s, and `late`, which sets out 4 s after
// assemble() and takes 5; "assembled" once came with the first to finish)
await goto(5)
await until((s) => s.at !== 'tally' && !s.flying)
await goto(6)
const late = await page.evaluate(async () => {
  const r = await window.__stage.settle({ min: 0.5, max: 120 })
  const sp = document.querySelector('.stage').__space
  return { settled: r.settled, engineSec: r.engineSec, grains: sp.value('grains'), late: sp.value('late') }
})
check('the settle waits for a form that starts late', late.settled && late.grains === 400 && late.late === 100, JSON.stringify(late))
// --- the probe -------------------------------------------------------------------------
const probe = await page.evaluate(() => {
  const s = window.__stage?.state()
  return s ? { version: window.__stage.version, total: s.total, aliases: !!window.__stage.space && !!window.__stage.probe } : null
})
check('window.__stage publishes the deck', probe?.version === 1 && probe.total === 7 && probe.aliases, JSON.stringify(probe))
await goto(3)
await until((s) => s.at === 'marks')
const ct = await page.evaluate(() => window.__stage.state().clicksTotal)
check('window.__stage counts a slide\'s clicks', ct === 2, `clicksTotal=${ct}`)
const settled = await page.evaluate(() => window.__stage.settle({ min: 0.5, max: 90 }))
check('window.__stage.settle resolves once the world stands still', settled.settled && settled.engineSec >= 0, JSON.stringify(settled))

check('nothing on the page threw', errors.length === 0, errors.join(' | '))

// --- the fallback, rehearsed: ?stage-force (stage/diagnose.js) ------------------------------
// A fresh page each, on the same browser: the GL is there, the switch alone takes
// it away. Page errors only: the plate's 404 is a console error by design.
const forcedErrors = []
const forcedPage = async (query) => {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  pg.on('pageerror', (e) => { if (!/Wake Lock/i.test(e.message)) forcedErrors.push(`${query}: ${e.message.slice(0, 200)}`) })
  await pg.addInitScript(() => { window.__fallbacks = []; window.addEventListener('slidev-stage:fallback', (e) => window.__fallbacks.push(e.detail)) })
  await pg.goto(`http://localhost:${port}/?${query}`, { waitUntil: 'load' })
  await pg.waitForSelector('.slidev-layout', { timeout: 60000 })
  return pg
}
const forcedState = (pg) => pg.evaluate(() => {
  const html = document.documentElement, st = document.querySelector('.stage'), living = st?.querySelector('.living')
  const probe = window.__stage?.state?.() ?? null
  return {
    fallback: html.dataset.stageFallback ?? null, layer: html.dataset.stageLayer ?? null, plate: html.dataset.stagePlate ?? null,
    rootFallback: st?.dataset.stageFallback ?? null, staticBg: !!st?.classList.contains('static-bg'),
    frames: st?.querySelector('canvas.field')?.__space?.frames ?? 0, at: st?.dataset.spaceAt ?? null,
    living: living?.dataset.living ?? null, livingFrames: Number(living?.dataset.frames || 0), livingCanvas: !!living?.querySelector('canvas'),
    plates: st ? st.querySelectorAll('.plate video').length : 0,
    probeLayer: probe?.layer ?? null, probePlate: probe?.plate ?? null, probeStatic: probe?.static ?? null,
    events: window.__fallbacks,
    search: location.search, hash: location.hash,
    debug: document.querySelector('pre.stage-debug')?.textContent ?? '',   // ?stage-debug's panel
  }
})
const untilForced = async (pg, pred, timeout = 30000) => {
  const deadline = Date.now() + timeout
  let s = await forcedState(pg)
  while (!pred(s) && Date.now() < deadline) {
    await pg.waitForTimeout(50)
    s = await forcedState(pg)
  }
  return s
}

// 12. no WebGL2, forced
const p12 = await forcedPage('stage-force=no-webgl2')
let f = await untilForced(p12, (s) => s.fallback === 'no-webgl2' && s.layer === 'living')
check('?stage-force=no-webgl2 falls back before the probe, the reason on <html> and the root', f.fallback === 'no-webgl2' && f.rootFallback === 'no-webgl2' && f.staticBg && f.frames === 0, JSON.stringify(f))
check('the query stays through the hash navigation', f.search === '?stage-force=no-webgl2' && /^#\/1/.test(f.hash), `${f.search} ${f.hash}`)
check('slidev-stage:fallback says the reason, that it was forced, and the plate it will try', f.events.length === 1 && f.events[0].reason === 'no-webgl2' && f.events[0].detail === 'forced' && f.events[0].layer === 'plate', JSON.stringify(f.events))
check('a deck with no plates drops to the living still, on <html> and in the probe', f.layer === 'living' && f.probeLayer === 'living' && f.plate === 'none' && f.probePlate === 'none', JSON.stringify(f))
const lf0 = f.livingFrames
f = await untilForced(p12, (s) => s.livingFrames > lf0 + 5)
check('the living still breathes (its canvas counts frames)', f.living === 'running' && f.livingCanvas && f.livingFrames > lf0 + 5, `living=${f.living} frames ${lf0} → ${f.livingFrames}`)
await p12.evaluate(() => { location.hash = '#/3' })
f = await untilForced(p12, (s) => /^#\/3/.test(s.hash) && s.layer === 'living')
check('a slide change under the fallback keeps the layer and the query', f.layer === 'living' && f.fallback === 'no-webgl2' && f.search === '?stage-force=no-webgl2', JSON.stringify(f))
await p12.close()

// 13. reduced motion, forced: respected by default, the world at its floor with stage-motion=floor
const p13r = await forcedPage('stage-force=reduced-motion')
f = await untilForced(p13r, (s) => s.fallback === 'reduced-motion' && s.layer === 'still')
check('?stage-force=reduced-motion respected: the still alone', f.fallback === 'reduced-motion' && f.layer === 'still' && f.staticBg && f.frames === 0 && !f.living && f.events[0]?.layer === 'still', JSON.stringify(f))
await p13r.close()
const p13 = await forcedPage('stage-force=reduced-motion&stage-motion=floor')
f = await untilForced(p13, (s) => s.layer === 'world-floor' && s.frames > 5)
check('?stage-force=reduced-motion&stage-motion=floor keeps the world, at its floor', f.layer === 'world-floor' && f.probeLayer === 'world-floor' && f.fallback === null && !f.staticBg && f.frames > 5 && f.events.length === 0, JSON.stringify(f))
await p13.evaluate(() => { location.hash = '#/2' })
f = await untilForced(p13, (s) => s.at === '11.5,-2.6,0', 60000)
check('a pose change lands on the floored world', f.at === '11.5,-2.6,0' && f.layer === 'world-floor', `at=${f.at} layer=${f.layer}`)
await p13.close()

// 14. context lost, forced: the world boots and its live context is dropped past the
// last restore, so the real handler (onContextLost) takes its final branch; with
// stage-debug the panel names the forced reason and counts the losses
const p14 = await forcedPage('stage-force=context-lost&stage-debug')
f = await untilForced(p14, (s) => s.fallback === 'context-lost' && s.layer === 'living' && s.plate === 'none' && /context lost 3×/.test(s.debug), 60000)
check('?stage-force=context-lost boots the world, loses it for good and falls back: the reason on <html> and the root, the living still in',
  f.fallback === 'context-lost' && f.rootFallback === 'context-lost' && f.layer === 'living' && f.probeLayer === 'living' && f.plate === 'none' && f.staticBg, JSON.stringify({ ...f, debug: undefined }))
check('the real handler took it down: one slidev-stage:fallback, its detail the tier, the plate tried first',
  f.events.length === 1 && f.events[0].reason === 'context-lost' && /^tier \d$/.test(f.events[0].detail) && f.events[0].layer === 'plate', JSON.stringify(f.events))
const panel = f.debug.split('\n')
check('the panel says the fallback was forced and counts the three losses',
  panel.some((l) => /^stage: fallback — context-lost \(tier \d\)$/.test(l)) && panel.some((l) => /^forced: context-lost — \?stage-force/.test(l)) && panel.some((l) => /^context lost 3× · shader errors 0$/.test(l)),
  panel.filter((l) => /^(stage|forced|context lost)/.test(l)).join(' | ') || '(no panel)')
await p14.close()
check('nothing threw on a forced page', forcedErrors.length === 0, forcedErrors.join(' | '))

await browser.close()
server.close()

// --- slidev-stage-shots ------------------------------------------------------------------
// the two slides whose forms gather on arrival, from a cold start, on a copy
// of the build whose times the checks below may change
const out = await mkdtemp(join(tmpdir(), 'stage-shots-'))
const dist = join(out, 'dist'), shots = join(out, 'shots')
await cp(DIST, dist, { recursive: true })
const res = await shoot(parseArgs([dist, shots, '--slides', '2,4', '--changed', '--no-lock']), () => {})
const recs = res.records.filter((r) => r.png)
const brief = recs.map((r) => `${r.frame}: settled=${r.settled} ${r.settleMs} ms ${r.engineSec} engine-s flying=${r.flying} assembled=${r.assembled} dpr=${r.dpr} dust=${r.dust}/${r.dustTotal}`).join(' | ')
check('shots photographs both slides', recs.length === 2 && !res.fatal, res.fatal || brief)
check('shots settles every frame', recs.every((r) => r.settled), brief)
check('shots waits for the camera to land and the form to gather', recs.every((r) => !r.flying && r.assembled && r.station), brief)
check('shots lets --settle engine-seconds pass after the change', recs.every((r) => r.engineSec >= 6), brief)
check('shots keeps the full pixel ratio and dust', recs.every((r) => r.dpr === 1 && r.dust > 0 && r.dust === r.dustTotal), brief)
check('shots settles in seconds', recs.every((r) => r.settleMs < 20000), brief)
check('shots reads the text on screen', recs.every((r) => r.wordsOnScreen > 0 && r.textBoxes.every((b) => b.fontPx > 0 && b.lumMean != null)), brief)
check('shots exits 0 on a clean deck', res.code === 0, JSON.stringify(res.problems))
check('shots says the world stood under every frame', recs.every((r) => r.layer === 'world' && r.fallback === null), brief)
console.log(`     shots: ${res.renderer} (${res.backend})`)

// --force: the same deck as a device without WebGL2 would show it; the report
// says the fallback and what stood in (the example has no plates and no stills:
// the living still alone). The plates' 404s are in the report and no failure
// under the living still (the stage asks for plates it may not have); the
// stills' 404s are failures, and the run exits 3 for those alone
const forced = await shoot(parseArgs([dist, join(out, 'forced'), '--slides', '2', '--force', 'no-webgl2', '--no-lock']), () => {})
const frs = forced.records.filter((r) => r.png)
check('shots --force photographs the fallback and says so on every line', frs.length === 1 && !forced.fatal && frs.every((r) => r.settled && r.fallback === 'no-webgl2' && r.layer === 'living'),
  forced.fatal || JSON.stringify(frs.map((r) => ({ frame: r.frame, settled: r.settled, fallback: r.fallback, layer: r.layer, http: (r.httpErrors || []).map((h) => `${h.status} ${h.url}`) }))))
const fhttp = frs.flatMap((r) => r.httpErrors || [])
const fplates = fhttp.filter((h) => h.local && h.status === 404 && /-plate\.mp4$/.test(new URL(h.url).pathname))
const fstills = fhttp.filter((h) => h.local && /\/stills\/\d+\.jpg$/.test(new URL(h.url).pathname))
const fcounted = frs.flatMap((r) => failedRequests(r))
check('shots --force reports the plates refused and counts the stills alone', fplates.length > 0 && fstills.length > 0 && fcounted.length === fstills.length && fcounted.every((h) => fstills.includes(h)) && forced.code === 3,
  `${fplates.length} plate(s), ${fstills.length} still(s), counted ${fcounted.map((h) => `${h.status} ${h.url}`).join(' | ')}, code ${forced.code}`)

// a rebuild copies public/ and writes _redirects again: new times, the same bytes
const later = new Date(Date.now() + 60000)
for (const e of await readdir(dist, { recursive: true, withFileTypes: true })) {
  if (e.isFile()) await utimes(join(e.parentPath, e.name), later, later)
}
const again = await shoot(parseArgs([dist, shots, '--slides', '2,4', '--changed', '--no-lock']), () => {})
check('--changed keeps frames whose files were only copied again', again.records.length === 2 && again.records.every((r) => r.unchanged) && again.code === 0,
  again.fatal || again.records.map((r) => `${r.frame}: unchanged=${!!r.unchanged}`).join(' | '))

// SIGTERM to the process that was started, while it photographs; it takes a
// lock of its own, so the lock's helper is part of what must go
const procs = () => {
  const out = new Map()
  for (const p of readdirSync('/proc').filter((p) => /^\d+$/.test(p))) {
    try {
      const s = readFileSync(`/proc/${p}/stat`, 'utf8'), f = s.slice(s.lastIndexOf(')') + 2).split(' ')
      out.set(Number(p), { state: f[0], ppid: Number(f[1]), start: f[19] })
    } catch { /* gone */ }
  }
  return out
}
const descendants = (root) => {
  const all = procs(), found = []
  const walk = (pid) => {
    for (const [p, v] of all) {
      if (v.ppid !== pid) continue
      let cmd = ''
      try { cmd = readFileSync(`/proc/${p}/cmdline`, 'utf8').split('\0')[0] } catch { /* gone */ }
      found.push({ pid: p, start: v.start, cmd })
      walk(p)
    }
  }
  walk(root)
  return found
}
const living = (list) => { const all = procs(); return list.filter(({ pid, start }) => all.get(pid)?.start === start && all.get(pid).state !== 'Z') }
const lock = join(out, 'lock'), sigOut = join(out, 'sig')
const run = spawn(process.execPath, [new URL('../bin/shots.mjs', import.meta.url).pathname, dist, sigOut, '--slides', '1-4', '--lock', lock],
  { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SLIDEV_STAGE_SHOTS_LOCKED: '' } })
let runLog = ''
run.stdout.on('data', (d) => { runLog += d }); run.stderr.on('data', (d) => { runLog += d })
const exited = new Promise((ok) => run.on('exit', (code, signal) => ok({ code, signal })))
const waitFor = async (pred, ms) => { const t0 = Date.now(); while (!pred() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 100)); return pred() }
await waitFor(() => /booted/.test(runLog), 90000)
const tree = descendants(run.pid)
const browserUp = tree.some((p) => /chrom/i.test(p.cmd)) && tree.some((p) => /flock$/.test(p.cmd))
run.kill('SIGTERM')
const ended = await exited
await waitFor(() => living(tree).length === 0, 10000)
const left = living(tree)
const lockFree = await waitFor(() => spawnSync('flock', ['-n', lock, 'true']).status === 0, 5000)
const last = (await readFile(join(sigOut, 'shots.ndjson'), 'utf8').catch(() => '')).trim().split('\n').at(-1)
check('SIGTERM to the run stops all of it', browserUp && ended.code === 143 && !left.length && lockFree && JSON.parse(last || '{}').fatal === 'stopped by SIGTERM',
  `exit ${JSON.stringify(ended)}, ${tree.length} process(es) under it (browser and lock helper: ${browserUp}), ${left.length} left, lock ${lockFree ? 'free' : 'held'}, last line ${last}`)
for (const { pid } of left) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }

await rm(out, { recursive: true, force: true })
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('STAGE SMOKE PASS')
