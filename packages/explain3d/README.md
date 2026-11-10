# slidev-addon-explain3d

3D explainers for lecture slides, drawn as SVG. A scene is declared as data
(three axes, a view, layers of surfaces, lines, points and markers); the
engine projects it in perspective and draws it far to near. On a slide it
turns by itself, a drag turns and tilts it, buttons glide to named views and
morph between states, and the audience window follows the presenter's.

Extracted from the two turning figures of the course *Best Research and Data
Analysis Practices from CERN* (`TurningSurface.vue`, `TurningScatter.vue`),
which stay as they are in the course.

```md
---
addons:
  - slidev-addon-explain3d
---

<Explain3D name="line-fit-valley" class="fig-fill mt-sm" />
```

```json
"slidev-addon-explain3d": "github:MindaugasSarpis/slidev-videos#v0.12.0&path:/packages/explain3d"
```

A deck depends on a tag of this repository, never on a branch or a path, so a
slide shows the same explainer until its pin is moved.

## The explainers

| name | what it explains | source |
|--|--|--|
| `line-fit-valley` | S(a, b) = Σ (a·x + b − y)² of a straight line through ten yearly mean temperatures is a narrow valley over the slope and the intercept; the 500 steps of gradient descent from (0, 7) cross it, then creep along it to (−0.56 per decade, 7.41) | the course's weather log, `weather.csv` (one row per hour, 2016–2025) |
| `neuron-plane` | z = w₁x₁ + w₂x₂ + b of one neuron is a plane over the temperature and the humidity of 3646 evenings; where it crosses the height 0 is the decision boundary, a straight line; two neurons, w = (−1, 0), b = 3.8 and w = (−1, 4), b = 0.6 | `weather.csv` |
| `xor-ridge` | the output of a trained 2-2-1 network over its two inputs is a ridge, high at (0, 1) and (1, 0); each hidden neuron is one slope, an OR and an AND | the nine starting weights of the course's `figures/src/language.py` (`random.Random(0)`), trained here for 2000 steps |
| `hours-columns` | the 87 552 measured hours counted in cells of temperature × humidity, a column per cell: a histogram of two columns at once, its ridge slanting from cold and humid to warm and dry (r = −0.70) | `weather.csv` |

Each is a folder of `explainers/`:

| file | |
|--|--|
| `spec.json` | the scene, written by hand |
| `make.mjs` | `reduce(text)`: the source file → what the scene needs of it; `make(input)`: that → the numbers the scene draws. No clock, no random numbers, no network |
| `input.json` | the output of `reduce`, with the source file's path, repository and SHA-256 |
| `data.json` | the output of `make` (generated) |
| `golden.svg` | the opening view at 960 × 540 (generated): compared in the tests, and the picture a slide shows if the live one cannot be drawn |

```bash
explain3d list
explain3d reduce line-fit-valley path/to/weather.csv   # only when the source file changes
explain3d make                                         # input.json → data.json
explain3d golden                                       # spec + data → golden.svg; look at it before committing
explain3d check                                        # exit 1 if data.json or golden.svg is stale
explain3d render line-fit-valley --azim 147.5 --elev 10 > view.svg
```

From the tag alone, `explain3d make && explain3d golden` gives the committed
`data.json` and `golden.svg` again (`input.json` is committed; `reduce` needs
the source file, whose SHA-256 `input.json` records).

## A scene

```json
{
  "explain3d": 1,
  "name": "kebab-case",
  "label": "the sentence a screen reader gets",
  "axes": [
    { "label": "slope a (°C per decade)", "lo": -1.2, "hi": 0.5, "len": 1.7, "ticks": [-1, 0], "decimals": 1 },
    { "…": "the second floor axis" },
    { "…": "the height" }
  ],
  "view": { "azim": 150, "elev": 35, "dist": 5, "turn": 60, "elevRange": [5, 85] },
  "views": [{ "id": "above", "label": "from above", "azim": -90, "elev": 90 }],
  "states": [{ "id": "plane", "label": "z" }, { "id": "sigmoid", "label": "P(frost)" }],
  "key": { "label": "S (°C²)", "ticks": [4.2, 5], "decimals": 1 },
  "layers": []
}
```

- `axes`: data limits, ticks, and `len`, the side of the box in box units (the
  box is centred, the third axis is up). `view`: matplotlib's `view_init`
  angles in degrees, the eye's distance in box units, seconds per turn (0:
  it does not turn by itself).
- A layer's numbers are a list, or `"data:name"`, a list of the data file.

| layer | fields |
|--|--|
| `surface` | `grid: { nx, ny, x: [lo, hi], y: [lo, hi] }` (default: the axes' limits), `z`: `ny` rows of `nx` heights, or one such list per state (`{ "plane": "data:z", … }`: a state button morphs between them); `palette` (`viridis` or a list of hex stops), `range` (the heights the palette spans), `color` (one colour instead), `split: { at, below, above }` (two colours, the cells cut exactly at that height), `shade`, `opacity`. Cut at the bottom and the top of the box |
| `bars` | `grid: { nx, ny, x, y }`: `nx` × `ny` cells over those limits; `z`: a height per cell (a cell at or below `base` has no column); `base` (default: the bottom of the box), `gap`, `palette`, `range`. Each column: its top and the two sides that face the eye |
| `line` | `x`, `y`, `z` (lists, or a number for a constant), `color`, `width`, `dash`, `closed`, `lift` |
| `points` | `x`, `y`, `z`, `radius`, `color`, or `group` (a whole number per point) with `colors`; drawn in `bands` depth bands, far ones dimmer |
| `marker` | `at: [x, y, z]`, `label`, `color`, `radius`, `dx`, `dy`, `anchor` |

Every layer takes `in: [state ids]` (shown only in those states) and `lift`
(how far it is moved towards the eye in the drawing order, in box units: a
line lying on a surface needs a little). A colour is a CSS colour or a token
(`fg`, `fg-2`, `dim`, `accent`, `warn`, `ok`, `bg`, and `c0` to `c6`, the
series colours of the course's static figures); a token follows the deck's
`--<token>` variable.

`validateSpec(spec, data)` lists everything wrong with a scene;
`prepareScene` throws with that list.

## One look

Every explainer is drawn in the look of the course's static figures, set in
one place (`engine/palette.js`, `LOOK`, and the component's CSS): the plot's
text in the figures' serif face (`--font-figure`) and the text colour, tick
labels 13.75 px and axis names 15.625 px on a 980 px slide, ticks 1 px, the
colour key edged with its ticks pointing in, the box's edges faint, labels on
a surface bold with a halo; the buttons are in the slides' own type. A scene
cannot restyle any of this; a deck can set `--font-figure`, `--x3d-tick-size`
and `--x3d-name-size`, and the theme's colour tokens.

## When it cannot keep up, or cannot draw

- Frames slower than about 30 a second while it moves: every second grid line
  of its surfaces until it rests (at rest it is always drawn in full).
- Still slower than about 12 a second: it stops turning by itself; a drag and
  the buttons still work.
- The scene does not load or drawing throws: the slide shows `golden.svg`,
  the opening view as a file (`?x3d-force=fail` in the address rehearses it).
  A deck's own scene has no golden picture: the slide says what is wrong.
- `still`: the opening view only. `prefers-reduced-motion`: no turning, and
  views and states change at once.

## The engine without a slide

```js
import { prepareScene, drawFrame, toSVG } from 'slidev-addon-explain3d'
const scene = prepareScene(spec, data)
const size = { width: 960, height: 540 }
const svg = toSVG(drawFrame(scene, { azim: 150, elev: 35 }, size), size, { label: spec.label })
```

`engine/`: `camera.js` (projection, the scale of a whole turn), `axes.js` (the
box, ticks and names), `surface.js` (grid → shaded polygons, cut at the box), `bars.js` (columns),
`scene.js` (specs and frames), `svg.js` (a frame as a file; `diffSVG`),
`motion.js` (turning, drags, glides, morphs), `sync.js` (presenter ↔
audience), `paint.js` (a frame into the page), `palette.js` (colours, the look).

## Tests

```bash
pnpm test            # node --test: projection, depth order, surfaces, specs, motion, sync; every explainer's data, golden picture and numbers
pnpm build:example && pnpm smoke     # a headless browser on example/: live, drag, views, states, two windows, the watchdog, the fallbacks
```
