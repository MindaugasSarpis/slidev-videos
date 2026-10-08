# slidev-addon-stage

One persistent 3D world under a whole Slidev deck. Built scenes (*stations*)
stand in a field of drifting dust; each slide says where the camera should
be, and the camera flies there. A talk becomes one continuous flight instead
of a stack of pages.

It is the engine of the Startertalk deck ("Pentaquarks at LHCb"), taken out of
the talk so the next talks can use it: the world, the cinematic render chain,
the dust, the station builders, the halo borders, the hum, the hero slide and
the tools to check and photograph a deck. What was specific to that talk —
quarks, clusters, particle names — is a plugin.

## Install

    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.5.0&path:/packages/stage"

## Use

Headmatter, and nothing else: the addon mounts the world under the slides and
the halo layer over them by itself.

    ---
    addons:
      - slidev-addon-stage
    stage:
      space: data/space.json      # the stations, under the deck's public/
      palette: blue               # classic | blue | ember | { base, accent, dust, … }
    layout: cover
    space:
      at: wide
    ---

    # kicker

    # The title

    ## a subtitle

    <div class="mt-md">Name · Place</div>

Then each slide steers the camera from its frontmatter:

    ---
    space: { at: decay, dist: 13, yaw: -30, pitch: 8, dim: 0.2 }
    ---

| key | meaning |
| --- | --- |
| `at` | a station id, an anchor id (an object with an `id`), a named pose, or `[x, y, z]` |
| `dist` `yaw` `pitch` | where the camera stands relative to `at` (degrees); default: the station's `look` |
| `sway` | idle yaw swing in degrees (default 2.5) |
| `dim` | how far the world steps back behind the slide, 0–1. Default 0.15 on cover / section / statement / fact / quote layouts, 0.6 on content slides |
| `stops` | `[id, …]` with `clicks: n`: click *k* flies to `stops[k-1]`, lights it and shows its record |
| `asof` | tell a stop's record as of this year (`status_year`, `note_year`) |

A slide without `space` keeps the previous pose. Flights take 1.4–4.5 s by
distance and ease in and out.

### `stage:` options

| key | default | |
| --- | --- | --- |
| `space` | `data/space.json` | the stations |
| `records` | — | `{ records: [{ id, label, rows?, … }], figures: { id: { src, caption, see } } }` |
| `palette` | `classic` | a name, or an object over a `base` |
| `plugins` | `[]` | shipped plugins to load: `hadron` |
| `hero` | `space.hero`, else `hero` | the station the deck opens and closes on; what builds itself there does so on arrival |
| `sound` | `true` | `false` is silent; `{ hum, flight, clip, level }` picks the voices: a low hum while the camera is at `humAt`, a soft whoosh for each flight of any length, a rising tone as a clip condenses. All start after the first key or click, none in the presenter window |
| `humAt` | `[hero]` | |
| `videos` | `true` | follow `slidev-addon-videos`: a clip arriving as dust draws the world's dust with it, one leaving shoves it out and leaves its colours in it for a few seconds (`tint: 0.8`, 0 for none), and the renderer rests under a clip that covers the slide |
| `halo` | `true` | the dust borders; `haloOn: '.card, .halo'` picks what gets one |
| `dim` | `0.6` | the content-slide scrim; `layoutDim: { cover: 0.15, … }` per layout |
| `hud` | — | `{ kicker, fields: [...] }` for the default stop panel |
| `options` | — | engine numbers: `nebula` (far clouds in the palette's colours, 0–1), `streak` (grains drawn out along their path while the camera flies, 0–2, default 1), `reach` (a pose within this of a station is *at* it, default 12), `bloom`, `vignette`, `grain`, `aberration`, `exposure`, `density`, `dustSize`, `dustGain`, `gather`, `fov`, `flight: [min, max]`, `maxBufferWidth` |
| `auto` | `true` | `false`: the deck mounts `<Stage>` itself from its `global-bottom.vue`, to fill the `#hud` slot |

### Palettes and looks

| | ground | accent | dust | nebula |
| --- | --- | --- | --- | --- |
| `classic` | near-black | cyan `#7dd3fc` | dim cyan → white | off (Startertalk's look, unchanged) |
| `blue` | blue-black | `#5b93ff` | ultramarine → pale blue | 0.8 |
| `ember` | brown-black | `#ffb168` | amber → cream | 0.7 |

A palette is fourteen colours (`stage/palette.js`); a *look* is the engine
options that come with its name. The nebula is painted on a sphere round the
camera, so it turns as the camera turns and stands still as it travels.
`options` in the headmatter win over the look: `options: { nebula: 0 }`.

Display type rises in as its slide arrives (section, statement, fact,
`.world-caption`, `.quote-hero`, a content slide's title and cards); none of
it under `prefers-reduced-motion`.

## The space file

    {
      "hero": "hero",
      "poses": { "far": { "station": "grid", "dist": 22, "yaw": -35, "pitch": 14 } },
      "stations": [
        {
          "id": "hero",
          "pos": [-26, 0, 0],
          "look": { "target": [-7.8, 0.4, 0], "dist": 15, "yaw": -22, "pitch": 7, "sway": 9 },
          "gather": 3.6,
          "pulse": 6,
          "objects": [ { "type": "constellation", "pos": [0, 0, 0], "radius": 3.1, "nodes": [ … ] } ]
        }
      ]
    }

`gather` is the dust's pull toward the station while the camera is there
(default 0.25: a uniform ground); `pulse` shoves it outward every so many
seconds. The field wraps in a ±30 box round the camera, so stations can stand
anywhere. An object appears to the right of the frame centre when its x is
larger than the pose target's x.

### Object types

Draw with grains. The forms made of points of light (`constellation`,
`galaxy`, `collider`) are of a piece with the dust round them; solid shapes
with labels (`orbs`, `ring`, `bar`) read as a diagram standing in the scene,
and are for when a diagram is what is wanted.

Whatever builds itself (`constellation`, `galaxy`, `collider`) is born
scattered and gathers when the camera arrives *at* its station: a pose whose
target is within `reach` of the station. A pose out in the open dust leaves it
be, and a second pose at the same station finds it whole. `c` builds again
what stands where the camera is.

| type | fields | |
| --- | --- | --- |
| `galaxy` | `pos radius` `arms winding grains tilt yaw roll spin core arm rim knots assemble` | a spiral of grains: a warm bulge, arms wound as log spirals, a faint disc between, turning as a pattern |
| `collider` | `pos radius` `lap tracks grains life tilt yaw roll beam bunch spray assemble` | a ring of grains streaming both ways; two bunches meet twice a lap, and a spray of bending tracks leaves each meeting |
| `constellation` | `pos radius nodes[{pos,color?,core?}]` `nodeRadius label strings haze assemble` | grains round bright cores on tilted orbits, joined by strings of flowing grains; born scattered, builds itself on arrival (`c` replays it) |
| `orbs` | `pos items[{id?,pos,color?,size?,label?,faint?}]` | marked places; an item with an `id` is an anchor for poses and stops |
| `tracks` | `pos tracks[{points,label?,labelAt?,color?,dashed?,fade?,width?}]` `nodes pulse` | lines and lit tubes, a pulse running down the solid ones |
| `page` | `src pos width height` `yaw paper tone halo` | an image as a lit sheet; `src` is written `/figures/…` |
| `text` | `text pos height` `color weight` | lines of type (`\n` breaks), anchored top-left |
| `label` | `text pos` `height color tracking upper` | one tracked line |
| `ring` | `pos radius` `thickness tilt spin color fadeNear id` | a turning torus |
| `grid` | `pos from to step` `depth opacity color` | a floor of lines fading out |
| `bar` | `pos length label` | a scale bar |

With `plugins: [hadron]`: `pentaquark`, `cluster` (`ghost`, `orbit`, `core`),
`molecule`, `spheres`, `planes`, and particle names in every world label set
with their flavour as a subscript (Λb⁰, Σc⁺, Pc(4312)⁺).

## Make it yours

From the deck's `setup/main.ts`:

    import { defineAppSetup } from '@slidev/types'
    import { registerBuilder, definePalette, usePlugin, helpers } from 'slidev-addon-stage'
    import { Group, Mesh, BoxGeometry } from 'three'

    export default defineAppSetup(() => {
      definePalette('venue', { accent: '#ff5c8a', dust: '#b03060', dustBright: '#ffe3ec' })

      registerBuilder('beacon', (o, ctx) => {
        const group = new Group()
        const m = new Mesh(new BoxGeometry(1, 1, 1), helpers.marble(o.color || ctx.palette.accent))
        group.add(m)
        group.position.copy(helpers.v3(o.pos))
        return { group, update: (t) => { m.rotation.y = t * 0.4 } }
      }, { fields: ['pos'] })
    })

A builder returns `{ group, labels?, anchors?, update?(t, camPos), api?, pixelRatio? }`
(see `stage/builders.js`). A plugin is a module exporting `name` and
`install({ registerBuilder, setLabelSegmenter, setLabelFont, definePalette, helpers })`.

The palette reaches CSS as `--stage-bg`, `--stage-fg`, `--stage-dim`,
`--stage-accent` (and `-rgb` triplets) on `<html>`. The base CSS kit
(`styles/index.css`: transparent layouts, translucent cards, the cover in the
hero's type, `.src`, `.quote-hero`, `.world-caption`, `.plate`, `.row` +
`.col-40…60`) is keyed on `html[data-stage]`; override any of it from the
deck's own `styles/index.css`.

## Components

- `Stage` — the world. Mounted for you; mount it yourself (`auto: false`) for the `#hud` slot: `<Stage><template #hud="{ record, figure, rows }">…</template></Stage>`.
- `StagePanel` — a translucent panel with a `kicker`, haloed.
- `StageHalo` — the dust borders. Mounted for you.
- `StageHero` — a full-bleed hero slide with its own live scene, for a deck without the persistent world: `<StageHero mode="galaxy" kicker="Part I" title="Line one|line two" sound counter />`, modes `proton | galaxy | collider`.

## Tools

    slidev-stage-check [deck-dir] [--plugins hadron] [--types beacon]
    slidev-stage-shots <dist> <out-dir> [options]

`check` validates the space file and that every `space.at` and stop in the
deck resolves; run it after editing either. `shots` photographs a deck frame
by frame in a headless browser; see [Headless review](#headless-review). It
needs `playwright-chromium` (`pnpm add -D playwright-chromium`, then
`pnpm exec playwright install chromium`); nothing else in the addon does.

## Headless review

`slidev-stage-shots` photographs a built deck, or a dev server, one settled
frame at a time, and writes a report a person or an agent can act on: where
the camera stood, content running off the slide, page errors and failed
requests, and every box of text on screen with its type size and the
brightness behind it.

    slidev build deck.md --base /
    slidev-stage-shots dist shots --sheet              # every slide, plus shots/sheet.png
    slidev-stage-shots dist shots --slides 4-6 --clicks all
    slidev-stage-shots dist shots --changed --sheet    # only what changed since the last run
    slidev-stage-shots --dev deck.md shots --slides 3  # straight from the markdown

### Why it settles instead of waiting

The world keeps its own time: a flight takes up to 4.5 s and a form gathers
for about as long after it. Headless, WebGL runs in software at 2–6 frames a
second, and the engine clamps its frame step to 1/12 s, so the same flight
takes half a minute of wall time. A fixed `--wait` either spends that time on
every slide or photographs the camera mid-flight.

So each frame is settled. Before the deck's own code runs, the tool puts
`performance.now` and every `requestAnimationFrame` timestamp on a clock it
drives. The clock stands still while the tool changes slide or click. Then the
world runs undrawn, each animation frame one full engine step, until the
camera has landed, nothing assembles (`html[data-space-assembled]`) and
`--settle` engine-seconds (default 6) have passed since the change. That
minimum is for talk forms that step on a click without telling the engine.
Then the dust simulates for `--dust` frames, one frame is drawn with the clock
held, finite CSS animations are finished (the cover title, rising cards) and
the page is photographed. The halo and the talks' counters read the same
clock, so they have finished too. `--wait` caps one frame's settle in wall
time; a frame that reaches it is reported as not settled.

The frame-rate guard is held from the first frame, so every picture has the
full pixel ratio and dust (the report records `dpr` and `dust`).
`Math.random` is seeded (`--seed`, default 1) and the clock moves in whole
steps, so two runs on one renderer settle to the same engine time. Compare
runs with a pixel threshold rather than checksums, never across renderers,
and with `--no-halo`: the halo draws from `Math.random` as cards appear.

### Renderer

`--gl auto` (the default) starts the browser with ANGLE on GL, keeps it when
that reaches a real driver (Mesa's llvmpipe is about three times faster than
SwiftShader), and otherwise starts again on SwiftShader. Which one you get
depends on the browser build: in WSL, Chromium 147 (playwright-chromium 1.59)
reaches llvmpipe and Chromium 151 (1.62) does not. The renderer string is in
every report line. playwright-chromium is an optional peer, looked for next
to the tool, then in the working directory; `SLIDEV_STAGE_PLAYWRIGHT=<dir>`
points at another install.

### When shots are slow

Run `--probe` first. For each slide it measures, on the live page and the
real clock, frames per second and engine-seconds per wall second, and warns
below 0.5. Settle gets there either way, but a slow page costs on every drawn
frame. `--draft` (device pixel ratio 0.5) draws a quarter of the pixels,
`--slides` keeps a run small, and `--jobs N` photographs with N pages at once.

### Options

| option | |
|---|---|
| `--slides 1-12,15` | which slides (default: all) |
| `--clicks none\|last\|all` | which click states of a slide (default `none`); `{"9":3}` still works |
| `--settle S` | engine-seconds a frame stands still after its last change (default 6) |
| `--wait MS` | cap on one frame's settle, wall time (default 30000); the screenshot timeout is the larger of this and 60 s |
| `--dust N` | dust frames after the settle (default 12) |
| `--size WxH`, `--draft` | viewport (default 1600x900); device pixel ratio 0.5 |
| `--burst N --every S` | N frames per click state, S engine-seconds apart (`04-b1.png` …) |
| `--seed N`, `--no-halo` | for comparing runs |
| `--base PATH` | the base the deck was built for (default: read from `dist/index.html`) |
| `--changed` | photograph only frames whose slide, CSS or public files changed |
| `--sheet` | a labelled contact sheet, `<out-dir>/sheet.png`, drawn in the browser |
| `--probe` | fps and engine-seconds per second per slide; no pictures |
| `--console` | record console warnings |
| `--jobs N` | N pages in parallel |
| `--gl auto\|gl\|swiftshader` | the renderer |
| `--json FILE` | the report (default `<out-dir>/shots.ndjson`) |
| `--dev deck.md` | start `slidev` on a free port, photograph it, stop it by its process group |
| `--lock FILE`, `--no-lock` | the shared lock (default `/tmp/slidev-stage-shots.lock`) |

A deck built for GitHub Pages (`--base /repo/talk/`) is served under that
base. `--changed` keeps its hashes in `<out-dir>/.shots-cache.json`: each
frame's markup and frontmatter, the built CSS file names, the public files
(size and time) and the options. It does not see edits to builder code
(`setup/*.js`): photograph without it after changing a form. A production
build streams its clips from the release (the player is remote-first outside
`slidev dev`); build with `VITE_VIDEOS_LOCAL_FIRST=1` to photograph offline.

### Shared machine

Every run holds `/tmp/slidev-stage-shots.lock` (`flock`) for its whole length,
so runs from several sessions queue instead of slowing each other down. A run
started inside `flock /tmp/slidev-stage-shots.lock …` sees that the lock is
already its own and goes ahead.

### Exit codes

| | |
|---|---|
| 0 | every frame settled and clean |
| 3 | a frame runs off the slide (more than 1 px), has page errors or failed same-origin requests, failed, or did not settle |
| 1 | the run itself failed (no browser, no deck, a crash) |
| 2 | bad arguments |

### The report

One JSON object per line, one line per frame, in slide order, written as the
run goes (a crash keeps what was photographed):

| field | |
|---|---|
| `slide`, `click`, `burst`, `frame`, `png` | which frame, and its picture (`07-c2.png`) |
| `station`, `at`, `atStation` | where the camera stood |
| `renderer` | the WebGL renderer string |
| `settled`, `settleMs`, `engineSec`, `engineTime` | did it settle, in how long, over how many engine-seconds, at what engine time |
| `shotMs` | finishing, measuring and photographing |
| `flying`, `assembled`, `dpr`, `dust` | the world's state in the picture (`dust`: grains drawn) |
| `probe` | `stage` (window.__stage), `handles` (an older engine's canvas.__space) or `none` |
| `overflowPx`, `overflowRightPx` | how far the slide's content runs past its bottom and right edges (negative: inside) |
| `textBoxes` | `[{ text, x, y, w, h, fontPx, lumMean, lumVar, white }]`: every visible box of text on the slide and in the stop HUD, in screen px; luminance (0–1) of its area in the picture, and the share of clipped white |
| `wordsOnScreen`, `minFontPx` | |
| `pageErrors`, `consoleWarnings`, `httpErrors` | since the frame before (`httpErrors`: `{ status, url, local }`) |
| `unchanged` | `--changed` kept the last picture |
| `error` | the frame failed; the run went on |

`--probe` writes `{ slide, probe: true, fps, engineSecPerSec, dpr, dust, station }`
per slide instead. A run that fails ends with a `{ "fatal": … }` line.

### The probe

The deck publishes `window.__stage` for tools like this one:
`state()` (slide, `total`, `clicks`, `clicksTotal`, `at`, `station`,
`flying`, `assembled`, `changedAt` — the engine time of the last pose or step
change — `elapsed`, `dpr`, `guard`, `dust`), `settle({ min, max })`,
`holdQuality()`, `fps(seconds)`, and `space` / `probe` / `hum`, the handles
older probes read as `root.__space`, `canvas.__space` and `root.__hum`. The
tool falls back to those handles on decks built with an older engine.

## Develop

    pnpm install
    pnpm --filter slidev-addon-stage test            # node --test
    pnpm --filter slidev-addon-stage build:example
    pnpm --filter slidev-addon-stage smoke           # Playwright, headless

Without WebGL2 float render targets, or under `prefers-reduced-motion`, the
stage draws its static gradient and the deck stays readable; the overview and
PDF export have no world.
