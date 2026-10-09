# slidev-videos

Tools for keynote-grade Slidev talks, in one repo. It began as the video
pipeline and is growing into a toolkit: each tool is its own package, a deck
takes the ones it wants.

| tool | where | what it is |
| --- | --- | --- |
| **`slidev-videos`** | `src/` (Python ≥3.11, stdlib only) | manifest-driven CLI: `fetch · sync · encode · encode-hq · publish · publish-hq · pull · pull-hq · check · shared-check · frames · clean · preflight · venue · build · discover · depth · doctor · contact-sheet`. Web tier is 1080p H.264 with EBU R128 loudness normalisation; clips are hosted as GitHub Release assets |
| **`slidev-addon-videos`** | repo root | the full-bleed `VideoPlayer`: a local → own-release → shared-release fallback chain, slide-driven playback, look-ahead preload, `cut` / `fade` / `dust` transitions, advance-on-end, native auto-hide controls, keyboard volume; and `StagePhoto`, a photograph that arrives and leaves as grains, or stands in the world as a place |
| **`slidev-addon-stage`** | [`packages/stage`](packages/stage/README.md) | one persistent 3D world under a whole deck: stations in a field of dust, a camera that flies from slide to slide, palettes, a broadcast look, a builder registry, halo borders, photo places, a validator, a screenshot tool, a per-slide video recorder and a safe-area check |
| **the shared clip library** | `src/slidev_videos/shared.toml` | the registry, with the encodes on this repo's `videos-shared` Release |

The two addons know of each other only through window events: a clip that
arrives as dust draws the stage's dust with it, and the stage rests its
renderer under a clip that covers the slide. Either works alone.

## Install (per consumer repo)

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.6.4"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.6.4
    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.6.4&path:/packages/stage"   # the stage, if wanted
    pip install "slidev-videos[depth] @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.6.4"   # + depth maps for photo places

What changed between releases: [CHANGELOG.md](CHANGELOG.md).

## The player (`slidev-addon-videos`)

Enable the addon and point it at your release in the deck headmatter:

    ---
    addons:
      - slidev-addon-videos
    videos:
      repo: You/your-course     # GitHub repo whose release hosts the clips
      release: videos-web       # release tag (default: videos)
      shared: MindaugasSarpis/slidev-videos@videos-shared   # or `false`
      fit: cover                # cover | contain (default cover)
      hq: false                 # try public/videos-hq/<src> first (default false)
      volume: 1                 # 0..1 default playback level (default 1)
      transition: cut           # cut | fade | dust (default cut)
      dust: '#7dd3fc'           # colour of the grains in flight (dust only)
      dustStyle: frame          # frame | flight (dust only; default frame)
      advanceOnEnd: false       # go to the next slide when a clip ends (default false)
    ---

    <VideoPlayer src="clip_name.mp4" />

`VITE_VIDEO_REPO`, `VITE_VIDEO_RELEASE`, `VITE_VIDEO_SHARED_REPO` and
`VITE_VIDEO_SHARED_RELEASE` are the env fallbacks for the same values.

**Props:** `src` (bare filename, required), `fallback` (explicit URL for the
own-release step), `autoplay` (default `true`; `false` = the presenter starts
the clip by hand, it still preloads), `loop`, `muted`, `controls` (default
`true`), `autoHideControls` (default `true`: the native bar appears only while
the pointer is over the bottom strip or for a few seconds after a click/tap),
`hq`, `volume`, `fit`, `transition`, `dust`, `dustStyle`, `advanceOnEnd`. Prop beats headmatter beats env
beats built-in.

**Advance on end:** `<VideoPlayer src="intro.mp4" advance-on-end />` (or
`videos.advanceOnEnd: true` for every clip) goes on to the next slide when the
clip ends, so a clip can hand over to what follows without a key press. It
fires once, from the audience's slide only: not in the presenter window, the
overview, the next-slide preview or a print or export, and not under
`slidev-stage-record`, which moves the deck itself. If the speaker has left
the slide or taken a click on it since the clip started, the clip's end does
nothing, and a looping clip never ends. The player also sends a
`slidev-videos:advance` event (`{ src, from }`) as it goes on.

**StagePhoto:** a full-bleed photograph that arrives and leaves like a clip
with `transition: dust`:

    <StagePhoto src="/figures/x.jpg" focus="30% 50%" class="right">
      <div class="hero-text">…</div>
      <div class="credit">…</div>
    </StagePhoto>

It renders the kit's `.hero` markup (a `div.hero` holding the `<img>`, with
the slot over it), so a talk's `.hero` styles apply unchanged. On slide enter
the picture condenses out of grains coloured from the image itself (read when
it loads, so no strip file; the image must be served by the deck) and then
hands over to the sharp `<img>`; on leave it breaks back into grains, and the
stage takes its colour as it does a clip's. Props: `src`, `alt`, `focus` (the
crop's `object-position`), `dust` (`frame` | `flight` | `none`, default
`videos.dustStyle`), `color` (default `videos.dust`), `dust-ms` (a number or
`[arrive, leave]`, default `videos.dustMs`), `fit` (`cover` | `contain`),
`arrive` (`enter`: the grains condense as the slide comes up; `camera`: they
wait for the stage camera to reach the slide's pose, 85 % through the
flight's time, at most 3 s, so the flight there shows; a slide without a
flight arrives at once). A slide's pose may set its own flight time,
`space: { at: …, flight: 1.6 }` (seconds), instead of the rule from the
distance. Dispersed
grains (photos and clips, `frame` style) are capped at luminance 0.62 and
only about a third of them show, thinning toward the frame's edges, so a pale
picture never veils the frame and the world shows through; they reach their
true colour as they condense. slidev-stage-record waits for a StagePhoto to
arrive before it counts a slide as still. Known limit: the grains carry the bare
photo, not a talk's `.hero` gradient over it, so the gradient's darkening
steps in as the sheet hands over and steps out as it breaks up.
Only the audience's slide moves: the presenter window, the overview, the
next-slide preview, print and reduced motion show the plain image.
The slot waits for the picture, so two headlines never show at once: it is
hidden while the grains gather, fades in over 300 ms once the sharp image is
up, and on leave fades out in 250 ms while the grains hold the picture whole,
before it breaks up. `:hold-text="false"` leaves the slot to the deck's own
transition.

**StagePhoto as a place** (`mode="place"`): the photo stands in the world as
a grain cloud, one grain per pixel cell (`grains` columns, default 600; rows
follow the aspect), each at its depth from the photo's depth map (`depth`,
default `<src>.depth.png`, see below), as a relief (`relief`: the depth range
as a share of the width, default 0.2; raise it for a deep scene such as a
tunnel). In relief the grains are off their lattice by up to half a cell, vary
a little in size, are soft and round, and blur with distance from the picture's
plane, so the relief reads as a scene made of light; flat, they close the picture:

    <StagePhoto mode="place" place-id="stumpe" :at="[92, 0, 0]" :size="3" :yaw="90" src="/figures/stumpe.jpg">…</StagePhoto>

    space: { at: stumpe, dim: 0 }      # the slide's pose: the photo's front view

`at` is its centre in the world, `yaw` the way it faces (the pose `{ at, yaw }`
looks at it square-on), `size` its width in world units. Naming the place in
the slide's pose flies the camera to its front view (at the distance where the
photo covers the frame, held still: no sway or breathing); as the camera gets
there the relief flattens into the picture and the sharp image takes over, then
the slot fades in. Leaving, the image goes, the cloud rises back into relief,
dimmer, and stays in the world, so later poses see it in the distance. Grains
in relief are capped at luminance 0.62. The presenter window, the overview,
print and reduced motion show the plain image; without its depth map or the
stage, a place arrives as grains on the screen instead. The photo should be
full bleed (`fit: cover`), as a place's front view is the whole frame.

**Place groups:** a place stands in the world from the deck's start, so a
later part's places would show in an earlier part's frames. Give them a
`group`, and say on a slide where the group comes and goes:

    <StagePhoto mode="place" group="inventions" place-id="stumpe" …>…</StagePhoto>

    places: { inventions: true }       # a slide's frontmatter: the group shows from here on
    places: { inventions: false }      # … and is gone from here on

Before the first slide that names a group, the group is the opposite of what
that slide says, so one `places: { inventions: true }` on Part II's first
slide keeps Part I clear. Places fade in or out over a second. The state is
worked out from the slide list, not the way the deck got there, so going back
or jumping shows what that slide would have. A place in no group always
shows, and so does the place the slide's pose stands at. `places: inventions`
(or a list) is short for `true`. `slidev-stage-check` reports a `places:`
group that no StagePhoto is in.

**Depth maps:** `slidev-videos depth public/figures/a.jpg …` writes
`a.depth.png` beside each image: 8-bit grey, white = near, the image's aspect,
the long side at most `--size` (1024). Depth Anything V2 Small (the
onnx-community ONNX export, Apache-2.0) runs on the CPU through onnxruntime,
under a second per image; run it through the render slot (`pnpm talk render
-- slidev-videos depth …`) and commit the maps; the browser only reads them.
It needs the `depth` extra (`pip install "slidev-videos[depth]"`); the model
(~100 MB) is fetched once into the Hugging Face cache. The map is a plain
per-pixel depth, so it can drive both a photo's parallax and a grain cloud.

**Source chain**, front to back: a production build tries the own release,
then the shared release, then `videos/` and `videos-hq/` under the deck's
`public/` (only present in a keep-videos build — the offline fallback);
`slidev` dev mode tries the local copies first. Setting
`VITE_VIDEOS_LOCAL_FIRST=1` at build time makes a keep-videos build
local-first too; `slidev-videos venue` always builds with it. Each
`<source>` failure advances the chain; when it is exhausted the slide shows
`Video not available: <src>`.

**Playback** is slide-driven: rewind + play on activation (muted first, then
unmuted unless `muted`), pause + rewind on deactivation. A `<source>` is only
attached inside a sliding window — the live slide, the three ahead (preloaded
early, in dev and production alike) and the one just passed; every other
player is detached and `load()`ed empty so the browser frees its media
pipeline. Chrome caps the number of media elements loaded at once (~10 per
page on desktop) and beyond that a `load()` silently never completes, which
is what froze a 32-clip reel from its 9th clip on (v0.3.3).

**Transitions.** How a clip arrives and leaves with its slide
(`videos.transition`, or `transition=` on one clip):

| | arriving | leaving |
| --- | --- | --- |
| `cut` | on when ready (the default, as before v0.4) | off at once |
| `fade` | the picture dissolves in over 0.45 s, the sound over 0.6 s | both fade out; the clip plays on unseen for the 0.4 s its sound takes to go |
| `dust` | grains adrift in depth gather onto a plane standing some way off, turned aside, each taking its pixel's colour as it lands; the plane swings square and flies to the camera until it fills the frame (1.9 s); the clip dissolves in over it and starts | the picture stands back and breaks up from its edges in, its grains thrown toward and past the camera (1.7 s), keeping the picture's colours, while the next slide shows through |

With a transition the player has no black ground: what is under the slide
shows until the picture is up. The grains are drawn by an overlay the addon
mounts itself (its `global-top.vue`; plain WebGL2, created on first use), so
the deck must load the package as an addon, not symlink its `components/`.
While a clip is slow to arrive the assembled sheet holds its first frame. A
clip that opens on black gives the grains nothing to gather into, so its
sheet is made of the first lit frame of its opening twelve seconds (lit on
the whole, or a small lit subject on black) and the clip plays from that
moment (`videos.dustFrom: start` keeps the opening).
By default (`dustStyle: frame`) the grains arrive spread over the whole frame,
in the picture's own colours, and condense in place into the full-bleed clip;
leaving, the picture breaks up where it stands and its grains are thrown past
the camera. `dustStyle: flight` is the earlier look: the grains gather into a
card standing off in the world, which swings square and flies to the frame,
and a leaving picture steps back and turns aside before it breaks up. The
sheet is seen through a camera like the stage's (the same field of view), so
over the stage it belongs to that world. `videos.dustMs: [1900, 1700]`
sets the two durations.

The grains need the picture's pixels. Release assets are served without CORS
headers, so a deployed deck can play a clip but not read it; **`slidev-videos
frames`** writes a small strip of frames per clip into
`public/video-frames/` (one 320 px tile every 4 s, at most 64, about
150–350 KB a clip) for the deck to commit. Arriving uses the first tile,
leaving the tile at the moment the presenter moved on. Where the clip is
same-origin (dev mode, venue and portable builds) the frame on screen is read
directly instead. No strip, no overlay, no WebGL2 or `prefers-reduced-motion`:
the clip fades. `check` lists the `dust` clips that have no strip. `frames`
cuts from the web tier, which a deployed deck plays: the local web copy, else
the talk's release, else the shared release (a local HQ copy only as a last
resort). Where the ffmpeg in use cannot read HTTPS the clip is downloaded
into a temporary directory outside the deck, cut and removed; a run stopped
with SIGTERM (`timeout`) removes its downloads too and exits 143. Beside each
strip it writes a poster, `<clip>.poster.jpg`: the first frame with 5 % of it
lit (past an opening fade from black, and past a speck on black), up to
1280 px wide, which print and PDF export show; a manifest entry's
`poster = "0:24"` names the moment instead (`frames --all` gives every clip
one, not only the `dust` clips).

Other addons can follow along on `window`: `slidev-videos:transition`
`{ phase: 'enter' | 'leave', mode, src, duration, color }` and
`slidev-videos:cover` `{ covered, src, fit }`. `color` is the mean colour of
the frame a leaving `dust` clip broke up from (`[r, g, b]`, weighted toward
its lit and coloured parts); the stage tints its dust with it.

**Overview, previews and print.** In Slidev's overview grid (`o`), the
presenter's next-slide preview, print and PDF export the player renders the
clip's poster, not a `<video>`: the overview and print mount every slide at
once, the overview's copy of the current slide would otherwise re-download the
clip being watched, and the exporting browser may not decode the clip at all
(H.264 in Playwright's Chromium printed a blank box). Without a poster it
shows the strip's first lit tile, without a strip a play icon.

**Keyboard**, on the active slide's clip, without revealing the control bar:

| key | action |
| --- | --- |
| `p` | play / pause |
| `+` (also `=`) | volume up 10% |
| `-` (also `_`) | volume down 10% |

The level set with `+` / `-` sticks for every later clip in the browser
(shared across players, kept in `localStorage`), so one adjustment at the
venue carries through the whole talk. A small `🔊 NN%` badge confirms the
level for about a second. Rationale: a Mac over HDMI ignores keyboard and room
volume controls (digital output), so the in-page level is the only handle.

Smoke test: `pnpm make:clip && pnpm build:example && pnpm smoke` (Playwright,
headless) checks the headmatter reaches the chain, the fallback order,
`videos.volume`, the three keys and the sticky level, and watches the `dust`
transition end to end on a generated clip (`make:clip` needs ffmpeg; without
the clip those checks are skipped with a note). `pnpm test:all` runs this and
the stage's tests.

## videos.toml (project root)

    [project]                # optional — defaults are the classic talk layout
    slides_dir = "lectures/content/slides"
    public_dir = "lectures/content/public"

    [defaults]
    repo          = "You/your-course"   # default: origin remote
    release_tag   = "videos-web"
    source_remote = "gdrive:your/raws"  # for `sync`
    # web_long_edge_px = 1920, max_size_mb = 200, loudnorm = true, ...
    # ffmpeg_dir = "~/micromamba/envs/talks/bin"   # optional, see below

**Which ffmpeg.** `$SLIDEV_VIDEOS_FFMPEG_DIR`, then `[defaults].ffmpeg_dir`,
name the directory holding the ffmpeg and ffprobe to use. After those the CLI
looks in `$CONDA_PREFIX/bin`, `~/micromamba/envs/*/bin` (also miniforge3,
mambaforge, miniconda3) and every PATH entry. It skips a build that crashes
on an offline HTTPS probe, as the static Linux builds do, and among the builds
it finds on its own it prefers one with NVENC. Each build is probed once; the
result is cached in `~/.cache/slidev-videos/tools.json` until the binary
changes. Choosing a binary does not change how it encodes: `encode` still
test-encodes `h264_nvenc`, with the web tier's rate-control options, on the
chosen ffmpeg to decide between NVENC and libx264. `slidev-videos doctor`
shows the pair in use, the ones passed over and why.

Manifest (`videos/manifest.toml`) entries:

    [[videos]]
    name    = "clip.mp4"
    profile = "standard"          # remux | standard | standard-tight | silent-loop | high-motion
    used_in = ["L01"]
    trim    = ["0:20", "1:50"]    # optional; remux trims on keyframes
    poster  = "0:24"              # optional; the print poster's moment (default: the first frame 5 % lit)
    notes   = "what it shows"

A web profile is one quality target for both encoders. On NVENC its `-cq`
is set to match or beat libx264 `-preset slow` at the profile's `-crf` on
SSIM and XPSNR (see `WEB_PROFILES` in `pipeline.py` for the measurement).
`encode` skips a clip whose web file is newer than its raw, so a change of
profile settings reaches a clip only when it is re-encoded (a newer raw, or
`encode --force`).

## The shared library

`src/slidev_videos/shared.toml` lists 43 clips served from this repo's
`videos-shared` release. Consumers reference them by name; `check` reports
them as inherited. `scripts/fetch-shared-raws.sh` rebuilds the local raw
bank (`videos/raw/`, ~15 GB) from the Drive masters.

Library clips are **full length**. A deck that wants a shorter cut lists the
clip in its own manifest with a `trim` and publishes to its own release; the
talk release wins the player's chain over the library, and the raw stays
whole. (Until 2026-09-09 six entries carried a course reel's 90 s trims.)

Names changed when the outreach decks moved onto the library (2026-09-08):

| old name (outreach decks) | library name |
|---|---|
| cern_video_2019_050_008_1080ph265.mp4 | cern_video_2019_050_008.mp4 |
| cassini.mov | cassini_grand_finale.mp4 |
| perseverence_rover_landing_nasa.mp4 | perseverance_rover_landing_nasa.mp4 |
| cern_footage_2022_013_001_1080p_lhc.mp4 | cern_footage_2022_013_001.mp4 |
| drone_climbing_mountain_2.mp4 | drone_climbing_mountain.mp4 |
| expansion_funnel_h264_1080p.webm | expansion_funnel.webm |
| lhcb_aciu.mov | lhcb_aciu.mp4 |
| sm.mov | standard_model.mp4 (silent) |
| atoms.mov | atoms.mp4 |
| mountain.mov | mountain.mp4 |

## Day to day

    slidev-videos fetch <url> --name Clip --used-in L05
    slidev-videos encode && slidev-videos publish
    slidev-videos check          # manifest vs slides vs raw/web (and dust clips without a strip)
    slidev-videos frames         # frame strips for the dust transition -> public/video-frames/ (commit them)
    slidev-videos preflight      # probe what the deck will really play (--mode remote-first: the deployed deck)
    slidev-videos pull           # restore local web copies from the release
    slidev-videos discover "cloud chamber" lhc --source cds,nasa   # find new clips; prints [[videos]] snippets
    slidev-videos doctor         # CLI version and install, the ffmpeg in use, gh, rclone, the deck's addon versions
    slidev-videos contact-sheet clip.mp4 --every 10   # one PNG of a candidate clip's frames (a file or https URL)

Run from anywhere inside a project (`videos.toml` is found by walking up), or
pass `--project <dir>`, before or after the subcommand.

`preflight` follows the player's chain for each clip: the local HQ copy only
when the clip opts into `hq`, then the local web copy, the talk's release and
the shared release; local copies first by default (dev, the venue bundle),
releases first with `--mode remote-first`. It probes `--jobs` clips at once
(default 6) and caches each probe and loudness reading in
`~/.cache/slidev-videos/probe.json` under the file's path and mtime or the
release asset's version, so a re-run reads only what changed. A track that
measures `-inf` LUFS is reported as silent (use the `silent-loop` profile),
not as a loudness miss.

`check`, `preflight`, `frames` and `doctor` take `--json`: one JSON object on
stdout, the usual text on stderr. Exit codes: 0 when all is well, 1 when
problems were found, 2 for usage and setup errors (a bad flag, no
`videos.toml`, a missing tool). `slidev-videos --version` prints the installed
version and the directory it runs from. rclone's `--progress` is passed only
when stdout is a terminal.

`--prune` (on `publish`, `publish-hq`, `pull`, `pull-hq`) deletes what the
whole manifest no longer lists: release assets for the publish commands, local
files for the pull commands. It cannot be combined with `--only`, and it
deletes only with `--yes`; `--dry-run` lists what it would delete and changes
nothing (a dry run does not create a missing release either):

    slidev-videos publish --prune --dry-run
    slidev-videos publish --prune --yes
    pnpm videos:publish -- --prune --yes   # through a talk's pnpm script

## New course, three steps

1. `videos.toml` at the repo root (see above) + an empty `videos/manifest.toml`.
2. Install both packages, add the `addons:` and `videos:` headmatter.
3. Embed clips as `<VideoPlayer src="name.mp4" />` — shared-library names
   stream from this repo's `videos-shared` release with no further setup.
   `src` may stand anywhere in the tag; `check`, `preflight` and `frames`
   find it.
4. For `transition: dust`: `slidev-videos frames`, and commit
   `public/video-frames/`.

## Adding a tool

A new tool is a new directory under `packages/` with its own `package.json`
(the workspace picks it up), README, tests and example deck; a Slidev addon
puts `components/`, `styles/` and its `global-top.vue` / `global-bottom.vue`
at its package root, where Slidev looks for them. Keep a tool configurable
from the deck's headmatter, keep talk content out of it, and let tools meet
through window events rather than imports, so a deck can take one without
the others. `slidev-addon-videos` stays at the repo root so that existing
`#v0.3.x` installs keep resolving.

Design spec: [2026-09-01 video pipeline package design](https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis/blob/main/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md) (in the course repo).
