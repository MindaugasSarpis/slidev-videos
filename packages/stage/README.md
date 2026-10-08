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
| `look` | — | a named look over the palette: `broadcast` (see [Broadcast and recording](#broadcast-and-recording)) |
| `plugins` | `[]` | shipped plugins to load: `hadron` |
| `hero` | `space.hero`, else `hero` | the station the deck opens and closes on; what builds itself there does so on arrival |
| `sound` | `true` | `false` is silent; `{ hum, flight, clip, level }` picks the voices: a low hum while the camera is at `humAt`, a soft whoosh for each flight of any length, a rising tone as a clip condenses. All start after the first key or click, none in the presenter window |
| `humAt` | `[hero]` | |
| `videos` | `true` | follow `slidev-addon-videos`: a clip arriving as dust draws the world's dust with it, one leaving shoves it out and leaves its colours in it for a few seconds (`tint: 0.8`, 0 for none), and the renderer rests under a clip that covers the slide |
| `halo` | `true` | the dust borders; `haloOn: '.card, .halo'` picks what gets one |
| `dim` | `0.6` | the content-slide scrim; `layoutDim: { cover: 0.15, … }` per layout |
| `hud` | — | `{ kicker, fields: [...] }` for the default stop panel |
| `options` | — | engine numbers: `nebula` (far clouds in the palette's colours, 0–1), `streak` (grains drawn out along their path while the camera flies, 0–2, default 1), `reach` (a pose within this of a station is *at* it, default 12), `bloom`, `vignette`, `grain`, `aberration`, `exposure`, `density`, `dustSize`, `dustGain`, `gather`, `fov`, `flight: [min, max]`, `maxBufferWidth`, `twinkle` (how far a form's grains swell as they shine, 0–1), `guard` (`false`: no frame-rate guard), `lift` (the ground's lightness raised this far toward white, its hue kept, 0–1) |
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
    slidev-stage-shots <dist> <out-dir> [--slides 1-12] [--clicks '{"9":3}'] [--wait 4200]
    slidev-stage-record <dist> <out-dir> [--fps 50] [--slides 2-5] [--plate] [--hold 8]
    slidev-stage-safe <dist> [--broadcast] [--json]

`check` validates the space file and that every `space.at` and stop in the
deck resolves; run it after editing either. `shots` photographs a built deck
slide by slide in a headless browser (WebGL on SwiftShader) and reports
content running off a slide, where the camera stood, and page errors. It
needs `playwright-chromium` in the deck (`pnpm add -D playwright-chromium`,
then `pnpm exec playwright install chromium`); nothing else in the addon does.
`record` and `safe` are for a deck that goes to video or to air; see below.

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
1 problems, 2 the deck could not be checked. The stop HUD needs the world
and is not measured.

### Recording: slidev-stage-record

    slidev-stage-record <dist> <out-dir> [--fps 50] [--size 1920x1080] [--slides 2-5]
                        [--plate] [--hold 8] [--max 40] [--clicks all|none|'{"3":1}']
                        [--base auto] [--seed 1] [--flash] [--gl auto|gl|swiftshader]
                        [--chromium path] [--encoder auto|nvenc|x264]

One file per slide, as the audience sees it arrive: the flight in, the forms
building, the type rising, then `--hold` seconds (8 by default; a clip slide
holds for the rest of its clip). Frames are stepped on a fake clock, not
filmed: each moves the page exactly 1/fps, however long the frame takes to
render, with `Math.random` seeded, CSS animations held to the same clock and
clips seeked to it. Two runs on the same renderer give the same frames.

| file | |
| --- | --- |
| `NN.mp4` | slide NN arriving (1080p50 by default, H.264, BT.709) |
| `NN-cK.mp4` | the same slide after its K-th click (a stop), for slides with clicks |
| `NN-plate.mp4` | with `--plate`: the same frames without the slide's text, the halo or the stop HUD, for an editor's own type. The scrim stays, so a plate and its slide cut together |
| `index.json` | the edit list: each file's length, when it settled, where the camera stood, its frame hashes, the renderer, flash warnings, and the clips it could not record |

Build the deck for it as for shots (`--base /`, or let `--base auto` read
the base), and with `VITE_VIDEOS_LOCAL_FIRST=1` and the clips in
`public/videos/`: a clip served from the deck is stepped frame by frame; a
clip from another origin (a release URL) cannot be, so its slide is skipped
and the edit list names the clip, for the editor to cut in from the source.
`--flash` runs a rough check for bursts over a quarter of the frame more
than three times a second (the broadcast rule); run the finished programme
through a real analyser (EA's IRIS is free) as well.

The renderer is software WebGL. Mesa's llvmpipe is about three times faster
than SwiftShader, but headless Chromium 151 and later no longer reach it in WSL:
the recorder then tries the older headless shells in the Playwright cache
(`npx playwright@1.59 install chromium-headless-shell` puts one there), or
takes `--chromium` / `$SLIDEV_STAGE_CHROMIUM`, before falling back to
SwiftShader. On llvmpipe a 1080p frame of the example deck took 0.13 s under
the broadcast look and 0.18 s under the default one (SwiftShader: about
0.55 s), and about 0.4 s with `--plate`, which shoots every frame twice. So a
15-slide deck at 10 s a slide and 50 fps (7,500 frames) takes 20–30 minutes
with the start of each slide, or about an hour with plates. ffmpeg comes
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
    pnpm --filter slidev-addon-stage smoke           # Playwright, headless

Without WebGL2 float render targets, or under `prefers-reduced-motion`, the
stage draws its static gradient and the deck stays readable; the overview and
PDF export have no world.
