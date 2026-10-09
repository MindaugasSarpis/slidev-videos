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

    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.6.9&path:/packages/stage"

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

A slide's `places: { <group>: true | false }` (beside `space`, not in it)
shows or hides a group of StagePhoto places from that slide on, with a 1 s
fade; see the root README's *Place groups*. The engine side is
`space.setPlaceGroups({ group: bool }, { immediate })`.

### `stage:` options

| key | default | |
| --- | --- | --- |
| `space` | `data/space.json` | the stations |
| `records` | — | `{ records: [{ id, label, rows?, … }], figures: { id: { src, caption, see } } }` |
| `palette` | `classic` | a name, or an object over a `base` |
| `look` | — | a named look over the palette: `broadcast` (see [Broadcast and recording](#broadcast-and-recording)) |
| `plugins` | `[]` | shipped plugins to load: `hadron` |
| `hero` | `space.hero`, else `hero` | the station the deck opens and closes on; what builds itself there does so on arrival |
| `sound` | `true` | `false` is silent; `{ hum, flight, clip, level }` picks the voices: a low hum while the camera is at `humAt`, a soft whoosh for each flight of any length, a rising tone as a clip condenses. All start after the first key or click, none in the presenter window |
| `humAt` | `[hero]` | the stations within reach of which the hum plays; `all` (or `'*'`) hums on every pose, out in the open dust too |
| `stills` | `stills` | the folder under `public/` holding a still per slide (`01.jpg` …) for print, PDF export and the fallback; `false`: none |
| `tier` | from the device | the quality tier, 0 (full) … 3 (floor); a phone starts at 2, a lost context steps down one |
| `videos` | `true` | follow `slidev-addon-videos`: a clip arriving as dust draws the world's dust with it, one leaving shoves it out and leaves its colours in it for a few seconds (`tint: 0.8`, 0 for none), and the renderer rests under a clip that covers the slide |
| `halo` | `true` | the dust borders; `haloOn: '.card, .halo'` picks what gets one |
| `dim` | `0.6` | the content-slide scrim; `layoutDim: { cover: 0.15, … }` per layout |
| `hud` | — | `{ kicker, fields: [...] }` for the default stop panel |
| `options` | — | engine numbers: `nebula` (far clouds in the palette's colours, 0–1), `streak` (grains drawn out along their path while the camera flies, 0–2, default 1), `reach` (a pose within this of a station is *at* it, default 12), `bloom`, `vignette`, `grain`, `aberration`, `exposure`, `density`, `dustSize`, `dustGain`, `gather`, `fov`, `flight: [min, max]`, `maxBufferWidth`, `twinkle` (how far a form's grains swell as they shine, 0–1), `guard` (`false`: no frame-rate guard), `lift` (the ground's lightness raised this far toward white, its hue kept, 0–1) |
| `auto` | `true` | `false`: the deck mounts `<Stage>` itself from its `global-bottom.vue`, to fill the `#hud` slot |
| `lang` | — | how `<StageCount>` writes numbers: `lt` or `en` (else the deck's `htmlAttrs.lang`) |

### Palettes and looks

| | ground | accent | text accent | dust | nebula |
| --- | --- | --- | --- | --- | --- |
| `classic` | near-black | cyan `#7dd3fc` | the accent | dim cyan → white | off (Startertalk's look, unchanged) |
| `blue` | blue-black | `#5b93ff` | the accent | ultramarine → pale blue | 0.8 |
| `ember` | brown-black | `#ffb168` | light blue `#9fd8ff` | amber → cream | 0.7 |

A palette is fifteen colours (`stage/palette.js`). `text` is the accent text
is set in (kickers, the cover's and a section's label, panel kickers; CSS
`--stage-text-accent`): no shipped palette sets text in gold or amber. A
palette that changes its `accent` and not its `text` takes the new accent for
its text too. A *look* is the engine
options that come with its name. The nebula is painted on a sphere round the
camera, so it turns as the camera turns and stands still as it travels.
`options` in the headmatter win over the look: `options: { nebula: 0 }`.
A look can also be named on its own, over any palette (`look: broadcast`),
and `definePalette(name, colours, look)` brings one with a deck's palette.

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

    import { registerBuilder, definePalette, helpers } from 'slidev-addon-stage'
    import { Group, Mesh, BoxGeometry } from 'three'

    export default () => {
      definePalette('venue', { accent: '#ff5c8a', dust: '#b03060', dustBright: '#ffe3ec' })

      registerBuilder('beacon', (o, ctx) => {
        const group = new Group()
        const m = new Mesh(new BoxGeometry(1, 1, 1), helpers.marble(o.color || ctx.palette.accent))
        group.add(m)
        group.position.copy(helpers.v3(o.pos))
        return { group, update: (t) => { m.rotation.y = t * 0.4 } }
      }, { fields: ['pos'] })
    }

A plain function: Slidev calls it with `{ app, router }`. Do not import
`defineAppSetup` from `@slidev/types`: it is the identity, and under pnpm
`@slidev/types` is not a package the deck can resolve, so the build fails.
`three` is a dependency of the deck as well (`pnpm add three`). Then
`palette: venue` in the headmatter, and `{ "type": "beacon", "pos": [4, 0, 0] }`
in a station.

What the deck registers reaches the world in `slidev dev` too: the addon
ships its own `vite.config.js` (Slidev merges one from every addon), which
keeps the package and three.js out of Vite's pre-bundle, and its registries
are one per page however many copies of the package load. When the deck has
a `three` of its own (its builders import it), that config resolves three
from the deck for the engine as well (`resolve.dedupe`), so an addon
installed elsewhere, or a checkout linked in, does not bring a second copy
('Multiple instances of Three.js being imported'). A deck needs no
`vite.config.ts` for this.

A plugin is a module exporting `name` and `install({ registerBuilder,
setLabelSegmenter, setLabelFont, definePalette, helpers })`.

The palette reaches CSS as `--stage-bg`, `--stage-fg`, `--stage-dim`,
`--stage-accent` (and `-rgb` triplets) on `<html>`. The base CSS kit
(`styles/index.css`: transparent layouts, translucent cards, the cover in the
hero's type, `.src`, `.quote-hero`, `.world-caption`, `.plate`, `.row` +
`.col-40…60`) is keyed on `html[data-stage]`; override any of it from the
deck's own `styles/index.css`.

### Custom builders

A builder is `(object, ctx) => parts`, called once per object of its type
when the world is built. `object` is the entry from space.json, `ctx` is
`{ palette, records, anisotropy, asset(src), helpers }`.

| part | |
| --- | --- |
| `group` | a three.js Object3D; the builder places it at `object.pos` (relative to its station). Required |
| `update(t, camPos)` | every frame, with the world clock and the camera's position |
| `api` | `{ arm(), assemble(now, onDone), value?(), busy? }`: for something that builds itself on arrival; `busy` (a value or a function) is true while a form moves on its own clock without `assemble()` |
| `dispose()` | when the world is torn down, before the engine disposes every geometry and material under `group`: for what else the builder holds (listeners, timers, its own textures) |
| `labels` | sprites that fade with the scrim |
| `anchors` | `Map<id, Vector3>` relative to the object: places a pose or a stop can name |
| `pixelRatio` | a `{ value }` uniform the engine keeps at the drawing buffer's pixel ratio (for `gl_PointSize`) |

`registerBuilder(type, builder, { fields })`: `fields` are the keys an object
of the type must carry, for `slidev-stage-check`.

**The clock.** `t` is the world's own time in seconds. It advances at most
1/12 s a frame, so flights and assemblies keep their pace on a slow GPU and
in a headless browser, and it stands still while a clip covers the slide.
Animate from `t`, not from `performance.now()`, and what a builder does
stays in step with the camera.

**Building on arrival.** When the camera sets out from elsewhere for a pose
*at* a station, the engine calls `arm()` on every api there that has
`assemble`: scatter, hide, start from nothing. When it lands it calls
`assemble(now, onDone)` with the world clock (and so for the station the
deck opens on); call `onDone` once, when the form stands. The station
counts as assembled when the last of its forms has called it: the cover's
title and the headless tools' settle wait for that, and for any `api.busy`. `c` calls
`assemble` again. Give the object a `name` and an `api.value()` returning
the number the form shows now, and `<StageCount for="<name>">` counts with
it (see `example/setup/tally.js`).

**Readiness.** What a headless tool or a deck's own script can wait on:

| | set |
| --- | --- |
| `html[data-space-assembled]` | while no assembly runs (and always without WebGL): the cover's title waits for it |
| `.stage[data-space-at]` | the pose the slide asked for (`11.5,-2.6,0` for a point) |
| `.stage[data-space-station]`, `[data-space-at-station]` | the nearest station; the station the pose stands *at* (empty out in the open dust) |
| `.stage[data-space-paused]` | `1` while the renderer rests (a clip covers the slide, the tab is hidden) |
| `.stage[data-flights]`, `[data-assemblies]` | counters, one up per flight and per assembly started |
| `html[data-space-stop]` | while a stop's record is shown |

## Components

- `Stage` — the world. Mounted for you; mount it yourself (`auto: false`) for the `#hud` slot: `<Stage><template #hud="{ record, figure, rows }">…</template></Stage>`. `static-ground` draws the static gradient only.
- `StageCount` — a number that counts when its slide arrives: `<StageCount name="open" :from="800" :to="4000" />`. Props: `to` (required), `from` (0), `ms` (2900) and `delay` (1000: up, it waits a second and runs on a smoothstep, the pace at which a step's grains arrive), `name`, `decimals` (0), `group`, `plain`, `lang`, `for`. Counts of one `name` continue each other across slides: entered again, a count starts from what that name last landed on, so an unchanged form shows its number at once, and going back counts down over 1.1 s with the scattering grains. Groups of three are set apart by a narrow no-break space (U+202F). `group: 'auto'` follows the language: `lt` groups from five digits up (1844, 55 000) and takes a decimal comma, `en` from four (1 844) with a decimal point; `true` groups from four digits in any language, `false` never (years), and `plain` says `false`. A count is grouped throughout its run when it starts or lands grouped, and lands written as its number alone. `lang` defaults to `stage.lang`, else the deck's `htmlAttrs.lang`, else `en`. `for="<name>"` shows the value of the object of that `name` while the slide is up (its builder's `api.value()`), so the count cannot run ahead of the form; without one it keeps its own clock. Printed, exported, in the overview and under reduced motion it shows `to`.

  It takes every prop of the `setup/Count.vue` the talks carried, with the defaults of its named-count version, so a talk moves to it by deleting `setup/Count.vue` and its two lines in `setup/main.ts` (`import Count …`, `app.component('Count', Count)`), and renaming the tags (`sed -i 's/<Count\b/<StageCount/g' deck.md`). A Lithuanian deck adds `lang: lt` to its `stage:` block. Two differences show: where a Count.vue wrote a thin space (U+2009) StageCount writes the narrower U+202F, which never breaks a number across lines; and the older Count.vue (2600 ms, a 350 ms wait, `plain`) eased out where StageCount counts up on a smoothstep, so its tags keep that wait with `:delay="350"` and their own `ms`, and the curve changes. The addon does not register a `Count` of its own: Slidev runs the theme's and the addons' `setup/main` before the deck's, so it cannot tell whether the deck brings one, and the deck's `app.component('Count', …)` would replace it with a warning, or a `components/Count.vue` in the addon would silently win over the deck's. A tag left over is the check's `unknown-component` warning.
- `StagePanel` — a translucent panel with a `kicker`, haloed.
- `StageHalo` — the dust borders. Mounted for you.
- `StageHero` — a full-bleed hero slide with its own live scene, for a deck without the persistent world: `<StageHero mode="galaxy" kicker="Part I" title="Line one|line two" sound counter />`, modes `proton | galaxy | collider`.

## Tools

    slidev-stage-check [deck-dir] [--plugins hadron] [--types beacon] [--json]
    slidev-stage-shots <dist> <out-dir> [options]   # see Headless review
    slidev-stage-record <dist> <out-dir> [--fps 50] [--slides 2-5] [--plate] [--hold 8]
    slidev-stage-safe <dist> [--broadcast] [--json]

`check` validates the space file, the headmatter's `stage:` block and every
slide's `space:`; run it after editing any. It finds the types the deck
registers in its `setup/*.{js,ts}` (`registerBuilder('lineup', buildLineup,
{ fields: [...] })` gives the type and its fields), and palettes it defines
there; `--types` adds names it cannot find. The StagePhoto places the deck
and the pages it pulls in stand up are pose targets too. Each problem names its slide, as
Slidev counts them, and a code:

| code | |
| --- | --- |
| `unknown-type` `missing-field` | an object's type has no builder; an object lacks a field its type needs |
| `unknown-station` `unknown-pose` | a slide's `at` (or `space.hero`, or a named pose's station) names nothing; `unknown-pose` when the nearest name is a named pose. A close name is suggested |
| `missing-anchor` | a stop that is no anchor in the space |
| `duplicate-place` `place-is-station` `unknown-group` | a StagePhoto place-id used twice, or also a station id; a slide's `places:` names a group no place is in |
| `unknown-palette` `bad-colour` | `stage.palette`, its `base` or a key of it is no palette; a colour is not `#rgb`/`#rrggbb` |
| `unknown-option` | a `stage.options` key the engine does not read |
| `bad-pose` `bad-vector` | a slide's `dist`, `pitch`, `dim` … out of range; a position that is not `[x, y, z]` |
| `camera-inside-form` | warning: a slide's camera stands inside an object's `radius` (every grain is drawn across the screen). Not for a form a camera is meant to stand in: a `ring`, a type registered `registerBuilder(type, fn, { fields, enterable: true })` (a floor, enveloping strands), or an object with `"enterable": true` |
| `unknown-key` | warning: a key of `stage:` or of a slide's `space:` that nothing reads |
| `unknown-component` | warning: a `<Count>` tag, and no `Count` the deck registers itself (in `setup/` or `components/`): the addon's counter is `<StageCount>` |

Also `duplicate-station`, `missing-look`, `bad-src`, `missing-file`,
`unknown-record`, `unknown-plugin`, `no-stations`. Errors exit 1, warnings
do not. `--json` prints `{ ok, problems: [{ slide, line, station, code,
level, msg }], stats }`.

`shots` photographs a built deck slide by slide; see Headless review below.
`record` and `safe` are for a deck that goes to video or to air; see
Broadcast and recording.

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

Every stage tool starts its browser through one launcher,
`bin/lib/chromium.mjs`, so they all get the same browser, flags and WebGL
backend: the fastest the machine reaches, tried best first.

| backend | what draws | auto tries it when |
|---|---|---|
| `gpu-nvidia` | a native NVIDIA driver, ANGLE over EGL | `nvidia-smi` is on PATH and this is not WSL |
| `d3d12` | WSL's GPU, through Mesa's d3d12 driver; ANGLE over GL on WSLg's X server | `/dev/dxg` is there, and a Mesa prefix with the driver (below) |
| `llvmpipe` | the system's GL through ANGLE; in WSL, Mesa's llvmpipe on the CPU | there is an X display |
| `swiftshader` | Chromium's own software GL | always, last |

A backend counts only when the page's renderer string says it got there
(`D3D12 (…)` for d3d12, anything but SwiftShader for llvmpipe, no software
renderer for gpu-nvidia); otherwise the launcher tries the next one. Every
report line carries `renderer` and `backend`. Compare runs only on the same
renderer.

The browser build matters. In WSL, Chromium 147's headless shell
(playwright-chromium 1.59, which this package pins) reaches GL; the headless
shells of Chromium 151 and 153 (1.62 on) fell back to SwiftShader under every
flag tried (the full Chromium 151 was not tried with ANGLE on GL). So the
launcher tries
`$SLIDEV_STAGE_CHROMIUM` or Playwright's own browser first, then the other
headless shells in the Playwright cache, newest first;
`npx playwright@1.59.1 install chromium-headless-shell` puts a 147 there.

llvmpipe and d3d12 both draw through GLX on WSLg's X server, and fall back to
SwiftShader without it. A shell under tmux or cron, or an agent's, often has
no `DISPLAY`: the launcher then sets `DISPLAY=:0` for the browser when
`/tmp/.X11-unix/X0` exists. llvmpipe also gets `LP_NUM_THREADS=8` unless it is
set: with the default `--jobs 2` that used about a quarter less CPU than
llvmpipe's own thread count, at the same wall time.

AlmaLinux's Mesa 25.0 has no d3d12 driver, so that backend needs a Mesa built
with it in a private prefix: `<prefix>/root/usr/lib64` with
`dri/d3d12_dri.so`, and `<prefix>/egl_mesa.json`, the EGL vendor file naming
its `libEGL_mesa.so.0`. Fedora 43's Mesa 25.3.6 packages unpacked there work.
The prefix is `~/.local/share/mesa-d3d12` unless `SLIDEV_STAGE_MESA_D3D12`
says otherwise. For the browser the launcher sets `LD_LIBRARY_PATH` (the
prefix, then `/usr/lib/wsl/lib`), `LIBGL_DRIVERS_PATH`,
`GALLIUM_DRIVER=d3d12`, `__EGL_VENDOR_LIBRARY_FILENAMES` and, where
`nvidia-smi` exists, `MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA` (without it Mesa
can take an integrated GPU, about 15 times slower in a test shader). Do not set
`VK_ICD_FILENAMES` for these tools: it hides Chromium's SwiftShader, and the
last fallback with it.

On a 16-core WSL2 machine with an RTX 5080, four slides of a talk deck at
1600x900 with the default `--jobs 2` (CPU: every process of the run, browser
included):

| backend | wall | CPU |
|---|---|---|
| d3d12 | 7.3 s | 6.1 s |
| llvmpipe | 6.8 s | 26.2 s |
| swiftshader | 10.8 s | 113.0 s |

Wall time hardly moves, because a frame's settle runs the world undrawn; the
GPU saves CPU, for other sessions and for recording, where every frame is
drawn. On SwiftShader the tool prints a `WARNING` line on stderr, with why
each better backend was passed over, and every report line carries it as
`warning`.

The `gpu-nvidia` flags (`--use-angle=gl-egl`) have not been tried on a machine
with a native NVIDIA driver. If they do not reach the GPU there, auto goes on
to llvmpipe, and `SLIDEV_STAGE_CHROMIUM_ARGS` can try others: Chromium takes
the last of a repeated flag.

| variable | |
|---|---|
| `SLIDEV_STAGE_GL` | `auto` (default), a backend, or `gl` (any GL backend, never SwiftShader). A tool's `--gl` other than `auto` wins over it. A forced backend that is not reached is an error. |
| `SLIDEV_STAGE_MESA_D3D12` | the Mesa prefix for d3d12 (default `~/.local/share/mesa-d3d12`) |
| `SLIDEV_STAGE_CHROMIUM` | a browser to try first |
| `SLIDEV_STAGE_CHROMIUM_ARGS` | more browser flags, as shell words, after all the others |
| `SLIDEV_STAGE_CHROMIUM_ENV` | more variables for the browser, `KEY=VAL;KEY=VAL`, over the backend's |
| `SLIDEV_STAGE_PLAYWRIGHT` | a directory to load playwright-chromium from first; then the tool's own install, then the working directory's |

### When shots are slow

Run `--probe` first. For each slide it measures, on the live page and the
real clock, frames per second and engine-seconds per wall second, and warns
below 0.5. Settle gets there either way, but a slow page costs on every drawn
frame. Check the `renderer` line: SwiftShader is the usual reason. `--draft`
(device pixel ratio 0.5) draws a quarter of the pixels, `--slides` keeps a run
small, and `--jobs N` photographs with N pages at once (default 2; four pages
were barely faster than two).

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
| `--jobs N` | N pages in parallel (default 2; 1 with `--probe`, which times the real clock) |
| `--gl MODE` | the WebGL backend: `auto` (default: `$SLIDEV_STAGE_GL`, else the fastest the machine reaches), `gpu-nvidia`, `d3d12`, `llvmpipe`, `swiftshader`, or `gl` (any but SwiftShader); see [Renderer](#renderer) |
| `--json FILE` | the report (default `<out-dir>/shots.ndjson`) |
| `--dev deck.md` | start `slidev` on a free port, photograph it, stop it by its process group |
| `--lock FILE`, `--no-lock` | the shared lock (default `/tmp/slidev-stage-shots.lock`) |
| `--stills` | the world alone, no slide text, as `<out-dir>/01.jpg` …: the stills print, PDF export and the static fallback show (write them to the deck's `public/stills`); no clicks, no bursts |

A deck built for GitHub Pages (`--base /repo/talk/`) is served under that
base. `--changed` keeps its hashes in `<out-dir>/.shots-cache.json`: each
frame's markup and frontmatter, the built CSS file names, the public files
and the options. Public files count by their bytes, not their times, so a
rebuild that copies them again changes nothing; a file over 8 MB (a clip)
counts by its size and its first and last 64 KB. It does not see edits to
builder code (`setup/*.js`): photograph without it after changing a form. A
production build streams its clips from the release (the player is
remote-first outside `slidev dev`); build with `VITE_VIDEOS_LOCAL_FIRST=1` to
photograph offline.

### Shared machine

Every run holds `/tmp/slidev-stage-shots.lock` (`flock`) for its whole length,
so runs from several sessions queue instead of slowing each other down. A run
started inside `flock /tmp/slidev-stage-shots.lock …` sees that the lock is
already its own and goes ahead; so does one whose environment says
`SLIDEV_STAGE_SHOTS_LOCKED=/tmp/slidev-stage-shots.lock`. Otherwise a small
`flock` helper takes the lock for the run and lets it go when the run's
process ends, however it ends.

The run stays in the process that was started, so Ctrl-C, or a `SIGTERM` or
`SIGHUP` sent to that one process, stops all of it: the report is written with
the frames so far and a `{ "fatal": "stopped by SIGTERM" }` line last, the
browser (and `slidev dev`) is closed, and the exit code is 128 + the signal's
number. A second signal does not wait for the browser to close.

### Exit codes

| | |
|---|---|
| 0 | every frame settled and clean |
| 3 | a frame runs off the slide (more than 1 px), has page errors or failed same-origin requests, failed, or did not settle |
| 1 | the run itself failed (no browser, no deck, a crash) |
| 2 | bad arguments |
| 130, 143, 129 | stopped by SIGINT, SIGTERM or SIGHUP |

### The report

One JSON object per line, one line per frame, in slide order, written as the
run goes (a crash keeps what was photographed):

| field | |
|---|---|
| `slide`, `click`, `burst`, `frame`, `png` | which frame, and its picture (`07-c2.png`) |
| `station`, `at`, `atStation` | where the camera stood |
| `renderer`, `backend` | the WebGL renderer string, and the launcher's backend (`d3d12`, `llvmpipe` …) |
| `warning` | only on SwiftShader: the warning the run printed |
| `settled`, `settleMs`, `engineSec`, `engineTime` | did it settle, in how long, over how many engine-seconds, at what engine time |
| `shotMs` | finishing, measuring and photographing |
| `flying`, `assembled`, `dpr`, `dust`, `dustTotal` | the world's state in the picture (`dust`: grains drawn, of `dustTotal`) |
| `probe` | `stage` (window.__stage), `handles` (an older engine's canvas.__space) or `none` |
| `overflowPx`, `overflowRightPx` | how far the slide's content runs past its bottom and right edges (negative: inside) |
| `textBoxes` | `[{ text, x, y, w, h, fontPx, lumMean, lumVar, white }]`: every visible box of text on the slide and in the stop HUD, in screen px; luminance (0–1) of its area in the picture, and the share of clipped white |
| `wordsOnScreen`, `minFontPx` | |
| `pageErrors`, `consoleWarnings`, `httpErrors` | since the frame before (`httpErrors`: `{ status, url, local }`) |
| `unchanged` | `--changed` kept the last picture |
| `error` | the frame failed; the run went on |

`--probe` writes `{ slide, probe: true, renderer, backend, fps,
engineSecPerSec, dpr, dust, station, pageErrors, consoleWarnings, httpErrors }`
per slide instead. A run that fails, or is stopped by a signal, ends with a
`{ "fatal": …, "renderer": …, "backend": … }` line.

### The probe

The deck publishes `window.__stage` for tools like this one:
`state()` (slide, `total`, `clicks`, `clicksTotal`, `at`, `station`,
`flying`, `assembled`, `changedAt` — the engine time of the last pose or step
change — `elapsed`, `dpr`, `guard`, `dust`), `settle({ min, max })`,
`holdQuality()`, `fps(seconds)`, and `space` / `probe` / `hum`, the handles
older probes read as `root.__space`, `canvas.__space` and `root.__hum`. The
tool falls back to those handles on decks built with an older engine.

## Broadcast and recording

A deck that is filmed, recorded or streamed meets three things a hall does
not: an encoder at a few Mbit/s (2–3 for a 1080p web stream), a vision mixer
that may squeeze the picture back to two thirds of the frame, and a
channel's logo, name supers and clock in the corners.

### The look

    stage:
      palette: blue
      look: broadcast

| | default | broadcast |
| --- | --- | --- |
| `grain`, `aberration` | 0.035, 0.0004 | 0, 0: film grain and colour fringes are noise an encoder spends its bits on |
| `density`, `dustSize` | 1, 1.9 | 0.6, 2.85: fewer, larger grains, which survive 720p and a phone |
| `streak`, `bloom` | 1, 0.55 | 0.4, 0.45 |
| `nebula` | the palette's | at most 0.3: faint clouds over near-black band at a low bit rate |
| `flight` | 1.4–4.5 s | 2.5–5 s |
| `twinkle` | 1 | 0.35 |
| `guard` | on | off: a slow moment never drops the resolution mid-take |
| `lift` | 0 | 0.06: the ground is lifted off near-black in its own hue, whatever the accent (blue's `#03050d` becomes `#090f1d`, a warm ground stays warm); the scrim and the cards take their dark from it too |
| halo, paper texture | on | off (`halo: true` brings the halo back) |
| CSS kit | | no line under 16 canvas px (about 31 px in a 1080p frame), the source line included; edge-placed pieces 5% in from the edges |

Measured on the example's second slide (a flight, then a galaxy forming),
recorded at 1080p50 and encoded with x264 at 3 Mbit/s: SSIM 0.962 (luma)
under the default look, 0.995 under broadcast. At constant quality (CRF 20)
the same slide needs 6.3 Mbit/s under the default look and 3.4 under
broadcast.

The lift was measured on the example's content slide (the scrim at 0.7
over the ring), recorded and then encoded with x264 at 2.5 Mbit/s: of the
16 × 16 blocks that hold a smooth gradient, 8% came out flattened into
bands on blue's own `#03050d`, 4.5% with the ground at `#090f1e` (a lift
of 0.06 gives `#090f1d`) and 2% at `#0e162a`, which looks grey.

`options` in the headmatter still win: `look: broadcast` with
`options: { nebula: 0.5 }` keeps the clouds. `html[data-stage-look]` names
the look for a deck's own CSS.

The floor is a floor. Text meant to be read on TV wants much more: at two
thirds of a 1080p frame one canvas px is about 1.3 screen px, so body text
wants 37 canvas px or more (49 is better), headlines 72–92, kickers 24 or
more, and no more than two lines of about 28 characters. Every size of the
kit follows one variable, so a deck grows it all at once:

    :root { --stage-type-scale: 1.85; }   /* the kit's 20 px card text → 37 px */

### The safe check

    slidev-stage-safe <dist> [--broadcast] [--json] [--slides 1-12] [--size 1920x1080] [--base auto]

Walks every slide and click of a built deck with WebGL off and every rise-in
finished, measures each visible line in canvas px, and reports the smallest.
By default it flags lines under 11 px and text off the slide. `--broadcast`
flags lines under 16 px, text outside the safe box (x 98–882, y 55–408 of
the 980 × 551 canvas: room for a squeeze-back and a lower third) and text in
the logo corner (top right), the name super (bottom left) or the clock
(bottom right); ask the broadcaster where theirs actually sit. Exit 0 clean,
1 problems, 2 the deck could not be checked or an option is wrong or
unknown. The stop HUD needs the world and is not measured.

### Recording: slidev-stage-record

    slidev-stage-record <dist> <out-dir> [--fps 50] [--size 1920x1080] [--slides 2-5]
                        [--plate] [--hold 8] [--max 40] [--clicks all|none|'{"3":1}']
                        [--base auto] [--seed 1] [--flash]
                        [--gl auto|gpu-nvidia|d3d12|llvmpipe|swiftshader|gl]
                        [--chromium path] [--encoder auto|nvenc|x264]

One file per slide, as the audience sees it arrive: the flight in, the forms
building, the type rising, then `--hold` seconds (8 by default; a clip slide
holds for the rest of its clip). Each slide arrives from the one before it,
at its last click and settled, with its clips played to their end, as a
presenter who waits for a clip leaves it: a slide after a clip starts over
that clip's last frame, and the edit list names the clip (`from`). Frames
are stepped on a fake clock, not filmed: each moves the page exactly 1/fps,
however long the frame takes to render, with `Math.random` seeded, CSS
animations held to the same clock and clips seeked to it (the engine's
frame-time clamp is lifted to 1/fps, so a take under 12 fps moves at the live
pace, not slower); the clock waits
for a clip's data and for every seek, which come in real time. Two runs on
the same renderer give the same frames (on d3d12, one take in six differed
from the others by about a level after its first frame).

| file | |
| --- | --- |
| `NN.mp4` | slide NN arriving (1080p50 by default, H.264, BT.709) |
| `NN-cK.mp4` | the same slide after its K-th click (a stop), for slides with clicks |
| `NN-plate.mp4` | with `--plate`: the same frames without the slide's text, the halo or the stop HUD, for an editor's own type. The scrim stays, so a plate and its slide cut together |
| `index.json` | the edit list: each file's length, when it settled, where the camera stood, its frame hashes, the renderer, flash warnings, the clips it shows or could not record (a clip in the dist by its path there), and the clips ended before it arrived |

Build the deck for it as for shots (`--base /`, or let `--base auto` read
the base), and with `VITE_VIDEOS_LOCAL_FIRST=1` and the clips in
`public/videos/`: a clip served from the deck is stepped frame by frame; a
clip from another origin (a release URL) cannot be, so its slide is skipped
and the edit list names the clip, for the editor to cut in from the source.
`--flash` runs a rough check for bursts over a quarter of the frame more
than three times a second (the broadcast rule); run the finished programme
through a real analyser (EA's IRIS is free) as well. Exit 0 when a slide was
recorded or named for cutting in, 1 on a failure or when the deck has none
of the slides asked for, 2 on a wrong or unknown option, or on
`$SLIDEV_STAGE_GL` set to `none` or to a value it does not take (nothing is
written then).

The browser comes from `bin/lib/chromium.mjs`, the launcher shots and safe
use as well: the fastest WebGL the machine reaches, tried best first (a
native NVIDIA driver, WSL's GPU through Mesa's d3d12 driver, Mesa's
llvmpipe, then SwiftShader), each kept only when the page's renderer string
says it got there. `--gl` or `$SLIDEV_STAGE_GL` forces one (not the
launcher's `none`, no WebGL: the recorder films the world), `--chromium` or
`$SLIDEV_STAGE_CHROMIUM` names a browser to try first, and the launcher's
header lists the other variables (the Mesa prefix for d3d12, extra browser
flags and environment). index.json records `renderer` and `backend`; on
SwiftShader the recorder prints a `WARNING`, and index.json carries it as
`warning`. In WSL the headless shell of Chromium 147 (playwright-chromium
1.59, which this package pins) reaches GL and those of 151 and 153 do not,
so the launcher also tries the other headless shells in the Playwright
cache (`npx playwright@1.59.1 install chromium-headless-shell` puts one
there).

Every frame is drawn, so the backend sets the pace. One slide at 1080p50 on
a 16-core WSL2 machine with an RTX 5080, one run each (wall from start to
exit, browser start included; CPU of every process of the run):

| slide | backend | frames | a frame | wall | CPU |
| --- | --- | --- | --- | --- | --- |
| a still frame dissolving into 140,000 grains | d3d12 | 430 | 0.11 s | 52 s | 64 s |
| the same | llvmpipe | 430 | 0.20 s | 88 s | 346 s |
| a title card, with `--plate` | d3d12 | 560, each shot twice | 0.13 s | 76 s | 94 s |
| the same | llvmpipe | 560, each shot twice | 0.24 s | 136 s | 475 s |

On llvmpipe a frame of the example deck took 0.13 s under the broadcast
look and 0.18 s under the default one (SwiftShader: about 0.55 s), and 0.4 s
with `--plate`, which shoots every frame twice. So a 15-slide deck at
10 s a slide and 50 fps (7,500 frames) takes roughly 15–25 minutes on
llvmpipe, 30–50 with plates, and about a quarter of an hour on d3d12 with or
without them, plus a few seconds a slide to start. The recorder takes
no lock of its own: where others render on the same machine, run it inside
`flock /tmp/slidev-stage-shots.lock`, the lock shots queue on. ffmpeg comes
from `$SLIDEV_VIDEOS_FFMPEG_DIR`, the active conda env, `~/micromamba/envs`
or PATH; NVENC at QP 16 when it works, else x264 at CRF 14.

### By hand, with OBS

When there is a GPU and half an hour: serve the built deck from WSL
(`python3 -m http.server 8080 -d dist`), open it in Windows Chrome so WebGL
runs on the GPU, in a 1920 × 1080 window at a device pixel ratio of 1
(Windows display scaling at 100%, or Chrome started with
`--force-device-scale-factor=1`), with the display at 50 Hz so the browser's
frames match a 50 Hz broadcast chain, and the deck muted (`sound: false`).
Record with OBS at 1080p50, NVENC at CQP 16, holding each slide about 8 s,
and cut it per slide afterwards. A take that goes wrong has to be redone;
the recorder's files do not.

## Develop

    pnpm install
    pnpm --filter slidev-addon-stage test            # node --test
    pnpm --filter slidev-addon-stage build:example
    pnpm --filter slidev-addon-stage build:broadcast # the example under look: broadcast, in example/dist/broadcast
    pnpm --filter slidev-addon-stage smoke           # Playwright, headless, on the built example
    pnpm --filter slidev-addon-stage smoke:dev       # the example under `slidev dev`, and its export

Without WebGL2 float or half-float render targets, under
`prefers-reduced-motion`, or when the GPU drops the WebGL context (iOS does
under memory pressure), the stage draws its static gradient and the deck stays
readable. Printed and exported (`slidev export`, `/print`, the browser
exporter) every page opens no WebGL context; the overview shows the slides
without the world, and the presenter window draws a world of its own, silent. Why it fell back is on the
stage root as `data-stage-fallback` (`reduced-motion`, `no-webgl2`,
`no-float-target`, `plugin`, `data`, `init`, `context-lost`) and in one
`stage: fallback — …` console line. Add `?stage-debug` to the address (before
or after the `#`) to see it on screen with the GPU, the render targets, the
simulation size, the frame rate and any shader errors: the way to find out
from a phone. Three more switches narrow a fault down on the device itself:
`stage-post=off` (the scene straight to the screen, no bloom or finish),
`stage-targets=half` (half-float simulation targets) and `stage-tier=0..3`.

**Stills for print, PDF export and the fallback.** Slidev's print route mounts
the stage once per page, so the stage draws no world there (thirty WebGL
contexts would run out); it shows the slide's still instead, under the slide's
own text: `public/stills/01.jpg`, `02.jpg`, … (`stage.stills: <folder>` moves
them, `false` turns them off). The static fallback on screen shows the same
stills. Make them from a real render, the world alone without the slide:

    slidev build deck.md --out /tmp/deck --base /
    slidev-stage-shots /tmp/deck public/stills --stills

A slide without a still prints on the static gradient. `slidev export --range`
on a deck with `routerMode: hash` prints only those slides (Slidev read the
range from the hash's own query and printed every slide; the addon sets it
from the address).

The quality tier (0 full … 3 floor) is picked from the device (a phone starts
at 2) and caps the simulated field, the drawing buffer and the photo places'
grains and textures; `stage.tier: <n>` pins it. A lost WebGL context rebuilds
the world one tier lower, at most twice.
