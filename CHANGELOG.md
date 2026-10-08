# Changelog

One tag covers the whole repo: the CLI (`slidev-videos`), the player addon
(`slidev-addon-videos`) and the stage addon (`slidev-addon-stage`, versioned
on its own). A deck pins both addons and the CLI to the same tag.

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
