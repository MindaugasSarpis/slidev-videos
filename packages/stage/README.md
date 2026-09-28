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

    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.4.0&path:/packages/stage"

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
| `sound` | `true` | a low hum while the camera is at `humAt` (starts after the first key or click, never in the presenter window) |
| `humAt` | `[hero]` | |
| `videos` | `true` | follow `slidev-addon-videos`: a clip arriving as dust draws the world's dust with it, and the renderer rests under a clip that covers the slide |
| `halo` | `true` | the dust borders; `haloOn: '.card, .halo'` picks what gets one |
| `dim` | `0.6` | the content-slide scrim; `layoutDim: { cover: 0.15, … }` per layout |
| `hud` | — | `{ kicker, fields: [...] }` for the default stop panel |
| `options` | — | engine numbers: `nebula` (far clouds in the palette's colours, 0–1), `bloom`, `vignette`, `grain`, `aberration`, `exposure`, `density`, `dustSize`, `dustGain`, `gather`, `fov`, `flight: [min, max]`, `maxBufferWidth` |
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

| type | fields | |
| --- | --- | --- |
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

`check` validates the space file and that every `space.at` and stop in the
deck resolves; run it after editing either. `shots` photographs a built deck
slide by slide in a headless browser (WebGL on SwiftShader) and reports
content running off a slide, where the camera stood, and page errors.

## Develop

    pnpm install
    pnpm --filter slidev-addon-stage test            # node --test
    pnpm --filter slidev-addon-stage build:example
    pnpm --filter slidev-addon-stage smoke           # Playwright, headless

Without WebGL2 float render targets, or under `prefers-reduced-motion`, the
stage draws its static gradient and the deck stays readable; the overview and
PDF export have no world.
