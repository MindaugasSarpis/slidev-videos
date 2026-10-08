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
//   7. window.__stage publishes the deck and settles;
//   8. nothing on the page threw;
//   9. slidev-stage-shots settles each frame: the camera has landed, the form
//      has gathered, the guard kept the full pixel ratio and dust, and a clean
//      deck exits 0; --changed keeps a frame whose public files were only
//      copied again (new times, the same bytes);
//  10. SIGTERM to the process that was started stops the whole run: the
//      browser and the lock's helper are gone, the report ends in a fatal
//      line, the exit is 143.
// Every assertion polls for the state it expects, so a slow runner is only slow.
import { mkdtemp, rm, cp, readdir, utimes, readFile } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve, shoot, parseArgs } from '../bin/shots.mjs'
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

// --- the probe -------------------------------------------------------------------------
const probe = await page.evaluate(() => {
  const s = window.__stage?.state()
  return s ? { version: window.__stage.version, total: s.total, aliases: !!window.__stage.space && !!window.__stage.probe } : null
})
check('window.__stage publishes the deck', probe?.version === 1 && probe.total === 6 && probe.aliases, JSON.stringify(probe))
await goto(3)
await until((s) => s.at === 'marks')
const ct = await page.evaluate(() => window.__stage.state().clicksTotal)
check('window.__stage counts a slide\'s clicks', ct === 2, `clicksTotal=${ct}`)
const settled = await page.evaluate(() => window.__stage.settle({ min: 0.5, max: 90 }))
check('window.__stage.settle resolves once the world stands still', settled.settled && settled.engineSec >= 0, JSON.stringify(settled))

check('nothing on the page threw', errors.length === 0, errors.join(' | '))

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
console.log(`     shots: ${res.renderer} (${res.backend})`)

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
