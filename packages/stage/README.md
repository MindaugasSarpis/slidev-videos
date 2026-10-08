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
| `lang` | — | how `<StageCount>` writes numbers: `lt` or `en` (else the deck's `htmlAttrs.lang`) |

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
are one per page however many copies of the package load. A deck needs no
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
| `api` | `{ arm(), assemble(now, onDone), value?() }`: for something that builds itself on arrival |
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
deck opens on); call `onDone` once, when the form stands. `c` calls
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
- `StageCount` — a number that counts when its slide arrives: `<StageCount :to="55000" />`. Props: `to` (required), `from` (0), `ms` (2600) and `delay` (350), `decimals` (0), `lang`, `plain`, `for`. `lang: lt` sets groups of three apart with a narrow no-break space from five digits up (1844, 55 000) and takes a decimal comma; `en` writes 1,844 and a decimal point; the default is `stage.lang`, else the deck's `htmlAttrs.lang`, else `en`. `plain` never groups (years). `for="<name>"` shows the value of the object of that `name` while the slide is up (its builder's `api.value()`), so the count cannot run ahead of the form; without one it keeps its own clock. Printed, exported, in the overview and under reduced motion it shows `to`.
- `StagePanel` — a translucent panel with a `kicker`, haloed.
- `StageHalo` — the dust borders. Mounted for you.
- `StageHero` — a full-bleed hero slide with its own live scene, for a deck without the persistent world: `<StageHero mode="galaxy" kicker="Part I" title="Line one|line two" sound counter />`, modes `proton | galaxy | collider`.

## Tools

    slidev-stage-check [deck-dir] [--plugins hadron] [--types beacon] [--json]
    slidev-stage-shots <dist> <out-dir> [--slides 1-12] [--clicks '{"9":3}'] [--wait 4200]

`check` validates the space file, the headmatter's `stage:` block and every
slide's `space:`; run it after editing any. It finds the types the deck
registers in its `setup/*.{js,ts}` (`registerBuilder('lineup', buildLineup,
{ fields: [...] })` gives the type and its fields), and palettes it defines
there; `--types` adds names it cannot find. Each problem names its slide, as
Slidev counts them, and a code:

| code | |
| --- | --- |
| `unknown-type` `missing-field` | an object's type has no builder; an object lacks a field its type needs |
| `unknown-station` `unknown-pose` | a slide's `at` (or `space.hero`, or a named pose's station) names nothing; `unknown-pose` when the nearest name is a named pose. A close name is suggested |
| `missing-anchor` | a stop that is no anchor in the space |
| `unknown-palette` `bad-colour` | `stage.palette`, its `base` or a key of it is no palette; a colour is not `#rgb`/`#rrggbb` |
| `unknown-option` | a `stage.options` key the engine does not read |
| `bad-pose` `bad-vector` | a slide's `dist`, `pitch`, `dim` … out of range; a position that is not `[x, y, z]` |
| `camera-inside-form` | warning: a slide's camera stands inside an object's `radius` (every grain is drawn across the screen) |
| `unknown-key` | warning: a key of `stage:` or of a slide's `space:` that nothing reads |

Also `duplicate-station`, `missing-look`, `bad-src`, `missing-file`,
`unknown-record`, `unknown-plugin`, `no-stations`. Errors exit 1, warnings
do not. `--json` prints `{ ok, problems: [{ slide, line, station, code,
level, msg }], stats }`.

`shots` photographs a built deck slide by slide in a headless browser
(WebGL on SwiftShader) and reports content running off a slide, where the
camera stood, and page errors. It needs `playwright-chromium` in the deck
(`pnpm add -D playwright-chromium`, then `pnpm exec playwright install
chromium`); nothing else in the addon does.

## Develop

    pnpm install
    pnpm --filter slidev-addon-stage test            # node --test
    pnpm --filter slidev-addon-stage build:example
    pnpm --filter slidev-addon-stage smoke           # Playwright, headless, on the built example
    pnpm --filter slidev-addon-stage smoke:dev       # the example under `slidev dev`, and its export

Without WebGL2 float render targets, or under `prefers-reduced-motion`, the
stage draws its static gradient and the deck stays readable. Printed and
exported (`slidev export`, `/print`, the browser exporter) every page draws
that gradient too and opens no WebGL context; the overview shows the slides
without the world. The presenter window draws a world of its own, silent.
