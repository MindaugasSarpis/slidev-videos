# Changelog

One tag covers the whole repo: the CLI (`slidev-videos`), the player addon
(`slidev-addon-videos`) and the stage addon (`slidev-addon-stage`, versioned
on its own). A deck pins both addons and the CLI to the same tag.

## v0.6.0 — 2026-10-09

slidev-videos 0.6.0 · slidev-addon-videos 0.6.0 · slidev-addon-stage 0.3.0

v0.5.4 with the three branches that waited beside the releases: the CLI
hardened, the stage addon fit for the talks' own builders and counters, and
headless review that settles on the engine's clock.

### Headless review (`slidev-stage-shots`, feat/shots-v2)

- **Settles each frame on the engine's clock** instead of waiting: the world
  runs fast and undrawn until the camera has landed, nothing assembles and
  `--settle` engine-seconds (default 6) have passed since the slide or click
  changed; `--wait` is a wall-time cap. Randomness is seeded, so two runs with
  `--seed` and `--no-halo` give the same pictures. Under a software renderer
  a still settles in about 2 s instead of the 7–36 s v0.5.4's real-time wait
  took (and a fixed wait caught slides mid-flight).
- **`--stills`** keeps its v0.5.3 meaning on the new engine: the world alone,
  one `NN.jpg` per slide, for print, PDF export and the static fallback.
- One NDJSON line per frame (the settle, renderer and backend, overflow, page
  errors, failed requests, every text box with the luminance behind it); exit
  0 clean, 3 problems, 1 the run failed, 2 bad arguments, 128 + n a signal.
- `--changed` (only what changed, public files keyed by their bytes),
  `--sheet`, `--clicks none|last|all`, `--base` (read from index.html by
  default: a Pages build is served under its base), `--jobs`, `--probe`,
  `--draft`, `--burst`/`--every`, `--dev deck.md`, `--gl`, `--seed`,
  `--no-halo`, `--console`. Runs queue on `/tmp/slidev-stage-shots.lock`; a
  signal stops the whole run and writes the report so far.
- `window.__stage`: one documented probe (`state()`, `settle()`, `fps()`,
  `holdQuality()`); `canvas.__space` and the other handles stay as aliases.
- `bin/lib/chromium.mjs`: one launcher for shots, record, safe and the smoke
  tests, on the best WebGL the machine reaches (a native NVIDIA driver, WSL's
  GPU through Mesa d3d12, llvmpipe, then SwiftShader with a warning);
  `SLIDEV_STAGE_GL` / `--gl` force one. playwright-chromium pinned to ~1.59.1.

### The stage addon (fix/stage-addon)

- **`slidev-stage-check` names the slide and a code** for every problem
  (`unknown-station`, `missing-anchor`, `bad-pose`, `camera-inside-form`, …),
  suggests a close name, reads slides as Slidev counts them (hidden ones not),
  and finds the types and palettes a deck registers in its own `setup/`.
  `--json` prints the problems with their codes. The v0.5.1 place checks
  carry over as `duplicate-place`, `place-is-station` and `unknown-group`.
- **`<StageCount>`**: a number that counts with its slide, or with a form's
  own value (`for="grains"`), taking every prop of the talks' `Count.vue`.
- The addon ships the Vite config the talks copied (one three.js and one
  builder registry when a deck brings its own copy); `static-ground` draws
  the gradient without the world; the probe handle carries the options as
  resolved. No shader calls `smoothstep` with reversed edges (undefined in
  GLSL; black on some GPUs).

### The CLI (fix/cli-hardening)

- **`slidev-videos doctor`**: the CLI install, ffmpeg, gh, rclone and the
  deck's addons, in one report. **`contact-sheet`** tiles a candidate clip
  into one PNG.
- `--json`, `--version`, and `--project` before or after the subcommand; an
  explicit `--project` must exist.
- ffmpeg and ffprobe are picked for reading HTTPS, not taken first on PATH,
  and never a directory with one but not the other.
- `preflight` probes what the player serves, in parallel and from a cache;
  one bad probe no longer sinks the run. `venue` builds with
  `VITE_VIDEOS_LOCAL_FIRST=1`.
- `frames` cuts from the web tier a deck plays, downloads into a temporary
  directory, and a SIGTERM removes every download (exit 143). `--prune` keeps
  the whole manifest and deletes only with `--yes`.
- NVENC web encodes reach libx264's quality at its size, not twice it.

### Upgrading from v0.5.4

- Pin `#v0.6.0` for both addons and `@v0.6.0` for the CLI.
- `slidev-stage-check` output changed shape: each line starts with its slide;
  `--json` gives `{ ok, problems: [{ slide, line, code, level, msg }] }`.
- `slidev-stage-shots`: `--wait` is now a cap, not the wait; a script that
  read `report.json` reads `<out-dir>/shots.ndjson` (or passes `--json`).
- A talk that copied the addon's Vite config (`optimizeDeps.exclude`) can drop
  its copy.

## v0.5.4 — 2026-10-09

slidev-videos 0.5.4 · slidev-addon-videos 0.5.4 · slidev-addon-stage 0.2.4

Print and export, from the talks' first v0.5.3 exports:

- **Every print page showed slide 1's still** on Slidev 52.14 (the talks'
  version): its `useNav()` returns the deck's nav, which stays at 1 on the
  print route. The stage reads each page's own slide context. Checked on
  52.14.2: three pages, three stills.
- **`html[data-stage]` went missing in print**, and with it the CSS kit and
  every deck style scoped to it (the theme's background drew over the still,
  the type fell back to the theme's font): one stage mounts per page, and the
  first to unmount removed it for all. The page-wide marks are now counted.
- **A PDF a tenth the size**: the stage's paper grain (an SVG noise filter)
  printed as a page-sized raster on every page, and a filtered StagePhoto as a
  lossless one; in print the grain is left out and photos print unfiltered.
  The halo layer's canvas is not mounted in print. Innoday: 170 MB → 12.7 MB
  for 29 slides.
- **`slidev-stage-shots` settles each slide** before the shot (the camera
  landed, the forms gathered, StagePhotos handed over, transitions done),
  `--settle` seconds at most, instead of a fixed `--wait`, which caught slides
  mid-flight under a software renderer; the report names any that had not.
- **Posters** skip a speck on black: the first frame with 5 % of it lit
  (else anything lit at all), and a manifest entry's `poster = "0:24"` names
  the moment; a changed moment cuts the poster again.

## v0.5.3 — 2026-10-09

slidev-videos 0.5.3 · slidev-addon-videos 0.5.3 · slidev-addon-stage 0.2.3

- **Print and PDF export of a stage deck.** Slidev's print route mounts the
  stage once per page; each booted a WebGL world, so a long deck ran out of
  contexts and printed blank pages slowly. The stage now draws no world in
  print and shows the slide's still under the slide's own text:
  `public/stills/NN.jpg` (`stage.stills`), written by the new
  `slidev-stage-shots --stills` from a real render of the world alone. The
  example's six pages export in about 8 s.
- **The static fallback shows the same stills** (no float targets, reduced
  motion, a lost context at the lowest tier), not only the gradient.
- **`slidev export --range` works on hash-router decks**: it printed every
  slide (Slidev read the range from the hash's query); the stage addon sets
  the print range from the address. `--range 2-4` → three pages.
- **VideoPlayer in print and export** shows the clip's first lit frame, not a
  live `<video>` (a clip the exporting browser could not decode printed as a
  blank box). **`slidev-videos frames`** writes it as `<clip>.poster.jpg` beside
  the strip (up to 1280 px; `frames --all` for every clip); without one the
  strip's first lit tile is used. Strips cut before v0.5.3 are cut again once
  to add the poster.
- **Why the stage fell back, readable from a phone.** Every fallback sets
  `data-stage-fallback` on the stage root (`reduced-motion`, `no-webgl2`,
  `no-float-target`, `plugin`, `data`, `init`, `context-lost`) and logs one
  `stage: fallback — <reason>` line. `?stage-debug` in the address shows a
  panel with the reason, the GPU, float / half-float support, the render
  targets in use, the simulation size, pixel ratio, frame rate, textures,
  programs and shader errors.
- **A lost WebGL context no longer leaves the slide on black.** The stage
  stops drawing, shows its static background, and builds the world again one
  quality tier lower on a fresh canvas (photo places go back in); after two
  losses, or one at the lowest tier, the static stage stays. Shader compile
  errors are counted and logged.
- **Quality tiers** 0 (full) … 3 (floor), picked from the device: a phone
  (coarse pointer, small screen) starts at 2, a tablet or ≤ 4 GB at 1, a GPU
  with textures under 8192 at 2; `stage.tier` pins one. A tier caps the
  simulated field, the drawing buffer and a photo place's grains and textures
  (space.js `TIERS`).
- **Photo places hold far less GPU memory**: their photo and depth map are
  uploaded at about twice the grain lattice (1200 px for 600 grains, at most
  the tier's cap), not at full size (2400 px, ~23 MB a place with mipmaps
  off). The sharp picture at the front view is the page's `<img>`, unchanged.
- **Bloom follows the buffer's width**, so a phone's small buffer, or the
  frame-rate guard's lower steps, no longer wash a bright core out white.

### Upgrading from v0.5.2

- Pin `#v0.5.3` for both addons and `@v0.5.3` for the CLI.
- For print and export: `slidev-stage-shots <dist> public/stills --stills`,
  and `slidev-videos frames --all` for the posters; commit both. A talk's own
  print stills (`.print-still` over the slide) can go.
- On a phone, `?stage-debug` says how the stage runs or why it fell back.

## v0.5.2 — 2026-10-09

slidev-videos 0.5.2 · slidev-addon-videos 0.5.2 · slidev-addon-stage 0.2.2

- **Place groups.** `<StagePhoto mode="place" group="inventions">` and a
  slide's frontmatter `places: { inventions: true | false }` show or hide
  the group from that slide on, with a 1 s fade. Before the first slide that
  names a group it is the opposite, so one line on Part II's first slide keeps
  Part I's frames clear of Part II's places. The state comes from the slide
  list, so going back or jumping is right. A place the pose stands at always
  shows. `slidev-stage-check` reports a `places:` group no place is in.
  Engine: `space.setPlaceGroups()`, `placeGroups`, `placeVisibility`.
- **StagePhoto on GitHub Pages.** The photo and its depth map are resolved
  against the deck's base, so a deck served under `/<repo>/<talk>/` finds
  `/figures/x.jpg` and `x.depth.png` (they 404ed at the domain root, and a
  place had no grains). Paths that already carry the base, relative paths and
  full URLs are left as they are.
- **`humAt: all`** (or `'*'`): the hum plays on every pose, not only within
  reach of the listed stations.

## v0.5.1 — 2026-10-08

slidev-videos 0.5.1 · slidev-addon-videos 0.5.1 · slidev-addon-stage 0.2.1

- `slidev-stage-check` accepts StagePhoto places as pose targets: it reads
  every `<StagePhoto mode="place">` in the deck and the pages it pulls in
  (`src: ./pages/x.md`), by `place-id`, else the image's file stem, and stops
  reporting `space: { at: <place-id> }` as unresolved. A place-id used twice,
  or one that is also a station id, is reported.

## v0.5.0 — 2026-10-08

slidev-videos 0.5.0 · slidev-addon-videos 0.5.0 · slidev-addon-stage 0.2.0

### Clips (`slidev-addon-videos`)

- **Dust that fills the frame.** With `transition: dust` a clip now arrives as
  grains spread over the whole frame, in the clip's own colours, that
  condense in place into the full-bleed picture; leaving, it breaks up where
  it stands. `dustStyle: flight` keeps the earlier look (a card that gathers
  off in the world and flies to the frame). Dispersed grains are capped at
  luminance 0.62 and only about a third of them show, thinner toward the
  edges, so a pale picture never veils the frame and the world shows through.
- **A clip that opens on black** arrives as its first lit frame and plays
  from there (`dustFrom: lit`, the default; `start` keeps the opening). A
  frame counts as lit on the whole, or when a small subject is lit on black
  (0.2 % of its pixels), so an animation that opens on one figure in the dark
  no longer shows a second of black.
- **advance-on-end**: `<VideoPlayer advance-on-end />` (or
  `videos.advanceOnEnd`) goes to the next slide when the clip ends, once,
  from the audience's slide only (not the presenter window, overview,
  preview, print, or under the recorder), and not after the speaker has left
  the slide or clicked on it. Sends `slidev-videos:advance`.
- A leaving clip announces the mean colour it broke up from; the stage tints
  its dust with it. `videos.dustMs: [arrive, leave]`. The dust sheet is seen
  through a camera like the stage's.

### Photographs (`StagePhoto`, new)

- `<StagePhoto src focus>…</StagePhoto>` renders the kit's `.hero` markup
  (a talk's `.hero` styles apply) and arrives and leaves as grains coloured
  from the image itself (no strip file). The slot (headline, credit) waits
  for the picture: hidden while the grains gather, in over 300 ms once the
  sharp image is up, out in 250 ms before it breaks up, so two headlines
  never show at once (`:hold-text="false"` opts out).
- `arrive="camera"`: the grains condense when the stage camera is 85 %
  through its flight to the slide's pose (at most 3 s), so the flight shows.
- `mode="place"`: the photo stands in the world as a grain cloud, each pixel
  at its depth from a depth map, a relief (`relief`, default 0.2 of its
  width). A slide's pose `space: { at: <place-id> }` flies to its front view;
  there the relief flattens and the sharp image takes over. Leaving, it rises
  back into relief, dimmer, and stays in the world. In relief the grains are
  off their lattice, soft and round, with a mild depth of field.
- Presenter, overview, preview, print and reduced motion show the plain image.
- Known limit: the grains carry the bare photo, not a talk's `.hero`
  gradient, which steps in at the hand-over.

### The CLI (`slidev-videos`)

- **`slidev-videos depth <images>`** writes `<image>.depth.png` beside each
  photo (white = near) with Depth Anything V2 Small (ONNX, Apache-2.0) on
  the CPU through onnxruntime, under a second per image. Needs the `depth`
  extra; no project (`videos.toml`) needed.

### The stage (`slidev-addon-stage` 0.2.0)

- **Everything is grains**: `galaxy` and `collider` forms; whatever builds
  itself gathers on arrival at its station; `c` builds it again.
- **Flights**: streaks while the camera flies; a whoosh and a rising tone
  beside the hum (`sound: { hum, flight, clip, level }`); a slide's pose may
  set its own flight time (`space: { …, flight: 1.6 }`); the camera sends
  `slidev-stage:arrive` and exposes `flightProgress` and `camera`.
- **Broadcast**: `stage.look: broadcast` for a deck that is filmed or
  streamed (no film grain or fringes, fewer and larger grains, calmer bloom
  and flights, a ground lifted off near-black); the CSS kit scales its type
  and keeps to title-safe on air.
- **slidev-stage-record**: a deck to one video per slide on a fake clock, a
  slide after a clip recorded from the clip's last frame, and a slide counted
  as still only once its StagePhotos have arrived. **slidev-stage-safe**: the
  smallest type and the safe area per slide.
- Places: `addPhotoPlace` / `removePhotoPlace`, places as pose targets, poses
  held `still`.
- Playwright pinned to 1.59 (Chromium 147).

### Upgrading from v0.4.0

- Pin `#v0.5.0` for both addons and `@v0.5.0` for the CLI.
- A deck with `transition: dust` gets the full-frame arrival; set
  `videos.dustStyle: flight` to keep the old one.
- Run `pnpm videos:frames` again only if clips changed; strips are as before.
- For photo places: `pip install "slidev-videos[depth]"` and
  `slidev-videos depth public/figures/<photo>.jpg`, then commit the maps.
