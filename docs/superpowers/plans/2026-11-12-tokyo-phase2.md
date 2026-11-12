# Tokyo's toolkit work, phase 2: a plan for the owner

From the Tokyo talk (outreach_talks, `talk/tokyo`, `talks/2026_11_18_Tokyo/CLAUDE.md`, "For the toolkit").
Phase 1 is on `feat/tokyo-toolkit`: the soundtrack fixes, `record --cold`, `data-full-bleed`, the README notes.
This file is a plan only. Nothing here is built. Sizes count toolkit lines plus tests. "Next" names the talk
that would use the item first. As of 12 Nov the talks in progress are MasterTalk (an Innoday-like keynote, one
collision, music and a recorded close) and the five Data lectures (their own `dk-*` forms; no StagePhoto, no
music, no clip loops).

Suggested order: 1, 5, 2, 4, 3, then the forms (6) one at a time. Items 1 to 5 are small and independent. Item 6
moves code that three talks have copied from one another.

## 1. A clip that hands over to a loop (`loopAfter`, and cutting the loop)

Tokyo: `setup/ClipLoop.vue` (66 lines) and `videos/finale/segments.sh`. The loop's address is the clip's
`currentSrc` with the file name swapped by a regex.

- **API.** `<VideoPlayer src="finale.mp4" loop-after="finale_loop.mp4" :loop-lead="0.12" />`. A second, muted
  `<video loop>` inside the player's box. The player resolves its address through its own release chain, the
  same way it resolves `src`, so no regex on the URL. It starts `lead` s before the clip's end. It is hidden and
  reset when the slide is left. On print and in the overview the player shows the loop's first frame. The
  recorder films it like any clip. `--skip-clips` names it in the edit list as `loopAfter`.
- **Cutting the loop.** A CLI verb, not a recorder mode, because the cut is made from a finished take:
  `slidev-videos loop-cut <take.mp4> --from 21 --len 30 --xfade 2 --out videos/raw/finale_loop.mp4`. It takes
  `from … from+len`, cross-fades the last `xfade` s into `from-xfade … from`, and encodes without sound on the
  talk's profile. Its first frame is the one after the clip's last frame. That is segments.sh's second ffmpeg
  line, with checks: the take must be at least `from+len` s long, and the report gives the seam's frame
  difference.
- **Size.** About 70 lines in VideoPlayer.vue and 80 in the CLI, with tests (the chain resolution, the lead,
  and the cut's length and seam on a generated test clip).
- **Next.** MasterTalk's recorded close: its last page wants the world still moving. Any finale that ends on a
  clip.

## 2. What follows a clip's end (`AtClipEnd`, `ZoomOn`)

Tokyo: `AtClipEnd.vue` (51 lines) and `ZoomOn.vue` (35). Both poll the slide's `<video>` every 100 to 200 ms.

- **API.** In the videos addon, beside VideoPlayer:
  `<ClipAtEnd :lead="0.8">…</ClipAtEnd>`. It shows what it wraps once the slide's clip is within `lead` s of its
  end. It is shown at once on print and in the overview.
  `<VideoPlayer … :zoom-after="{ at: [71.3, 58.2], to: 1.6, delay: 5, seconds: 90 }" />`. A slow push about a
  point once the clip has ended, made with the Web Animations API on the `<video>` and clipped by the player's
  box. It is undone on leaving.
  Both read the clip's state from the player (a `provide` of `{ t, duration, ended }`), not by polling the DOM.
- **Size.** About 40 lines for `ClipAtEnd`, 30 for `zoomAfter`, and 20 for the provide. Tests are source and
  logic checks, plus one smoke frame.
- **Next.** MasterTalk. Tokyo's globe names would move to `ClipAtEnd` after 18 Nov. Check whether any talk
  still carries its own `ClipEnd` and fold it in.

## 3. A photo's pan (`StagePhoto pan`)

Tokyo: `PanCanvas.vue` (61 lines). It draws on a canvas in StagePhoto's slot over the same photo standing still.

- **API.** `<StagePhoto src="…" pan />`, or
  `:pan="{ to: 1.11, drift: [-1.6, -0.6], focus: [50, 55], delay: 1.5, seconds: 44 }"`. StagePhoto draws the
  photo on a canvas that keeps its box: a cover fit, an ease in and out, starting again on each entry. Off the
  live slide it is drawn at rest. A scaled `<img>` would run off the slide, and `object-view-box` moves in whole
  pixels. With phase 1's `data-full-bleed` a talk could scale an `<img>`, but the canvas is still the smoother
  picture.
- **Size.** About 70 lines in StagePhoto.vue, and tests (its props in `check.mjs`, the cover-fit math as a pure
  function).
- **Next.** Tokyo's group photo after 18 Nov, and MasterTalk if it keeps a photograph (its notes mention one).

## 4. A music bed for the whole talk, and levels per slide in the headmatter

Tokyo: `public/audio/wonder_bed.m4a`, built by one ffmpeg line (the piece to 3:35, then 1:00 to 3:35 five
times, 4 s cross-fades), and a `<StageSoundtrack>` tag on every slide with its level. Karjera:
`scripts/starfire_bed.py` (115 lines): joins on the piece's bar grid, gain riding under speech, −16 LUFS.

- **API, the bed.**
  `slidev-videos bed <track> --keep 0:00-3:35 --repeat 1:00-3:35 --until 16:00 --xfade 4 [--bars 80:2:54.85]
  [--ride 0.7] [--lufs -16] --out public/audio/bed.m4a`. `--bars` (bpm and a downbeat) moves each join onto
  the bar grid, as Karjera's builder did. `--ride` evens out the sections under speech. The tool prints the
  joins' times.
- **API, the levels.** In the headmatter:
  `stage.music: { src: audio/bed.m4a, from: 2, level: 0.35, close: { slide: 17, src: audio/close.m4a, xfade: 1.5, level: 0.85 } }`.
  A slide's own level goes in its frontmatter: `music: 0.6`, or `music: false` for silence. One player in
  Stage.vue drives it, so there is no tag on each slide. `<StageSoundtrack>` stays for the drops and the
  click cross-fades. `check.mjs` validates the block and names a slide's `music` that the deck's headmatter
  does not use.
- **Size.** The bed builder is about 150 lines of Python plus tests on a generated tone (the joins on the
  grid, the length, the loudness). The headmatter music is about 100 lines across Stage.vue and soundtrack.js,
  plus check rules and tests on the fake context in soundtrack.test.mjs.
- **Next.** MasterTalk (music across the talk, as Innoday). It would replace Tokyo's 17 tags after 18 Nov.

## 5. The look: the ground's glow and the nearest dust

Tokyo: `setup/look.js` (42 lines). It reaches into `canvas.field.__space`, scales the ground's `uGlow` and
rewrites a line of the dust's vertex shader by string. The next release that changes that line breaks it
silently.

- **API.** `stage.options.groundGlow: 0.35` (a factor on the two glows, default 1) and
  `stage.options.nearDust: 3.5` (the nearest depth at which a grain is drawn, as a uniform in the dust's
  shader, default off). `check.mjs` knows both keys.
- **Size.** About 25 lines, plus tests (the keys in `SPACE_KEYS` and options, and the uniform in the shader
  source).
- **Next.** Every projector deck: Tokyo after 18 Nov (look.js deleted), MasterTalk.

## 6. The forms

A second talk that wants one of these should get it from the kit, not copy it. Three talks already carry
copies of the cover's collision and of `grains.js`.

- **The colour-charge pentaquark** (`pentaquark.js`, 231 lines, on `grains.js`'s 125). It goes into the hadron
  plugin as `pentaquark-cc` (`{ pos, name, colors? }`), with `grains.js`'s drawing as a plugin helper.
  About 380 lines moved, plus a build test in node and a check of the fields. Next: MasterTalk (a pentaquark
  keynote). Karjera and Tokyo would drop their copies.
- **The moving interiors** (`interiors.js`, 144 lines, on `grains.js`). It goes into the hadron plugin as
  `interior` with `kind: molecule | compact | hadroquarkonium`, beside the plugin's five still `pentaquark`
  forms; those forms could take a `move` option instead. About 160 lines plus tests. Next: any talk with
  the pentaquark's models.
- **The cover's collision loop with its sound** (`coverCollision.js`, 116 lines). It is built on
  outreach_talks' `components/lhc-opening` (collision-cms.js, sound.js), which is not in this repo. Its home
  is beside lhc-opening in outreach_talks' shared `components/`, not the stage. If lhc-opening moves into the
  kit, which Data1Trigger's and Data5Open's kit requests also ask for (`lhc-collision` on the step bus), it
  moves with it. Next: MasterTalk ("one collision, one shot"), Data1Trigger, Data5Open.
- **The globe** (`globe.js`, 570 lines, `CollabGlobe.vue` 288, `data/globe.json` 168 kB of Natural Earth,
  public domain). It becomes a stage plugin `globe`: the form `collab-globe` (`tour`, `tourFrom`, `pq`, `link`)
  and a `<StageGlobe>` component (a photo dissolving into the globe's grains). The cities and links come from
  the talk's own data file, and the coastlines ship with the plugin. This is the largest item, about 900 lines
  moved. It needs tests for the tour's easing, the cue, and a build in node, and a shots smoke. Next: any talk
  with a collaboration map. Innoday and Tokyo carry copies.

## Not in the toolkit: outreach_talks' own scripts

These came from the same list, but they live in the Talks repo's scripts and docs:

- `scripts/talk_lint.py`, WORDS: count words with KaTeX removed. Strip `$$ … $$` and `$ … $` blocks (and
  rendered `.katex` text, if the lint reads HTML) before `talk_deck.count_words`.
- `scripts/talk.py` `is_broadcast`: a headmatter `broadcast: false` wins over `stage.options.grain: 0`. Check
  `hm.get("broadcast") is False` first, and do the same in the regex fallback.
- `scripts/talk_map.py` and `talk_deck.clip_durations`: take a clip's seconds from the encode
  (`ffprobe` on `public/videos/<name>`, or the release's asset metadata) before the manifest trim or the
  frames index. A re-cut such as Tokyo's 47 s atoms clip then counts as it plays.
- `docs/authoring.md`: two lines pointing to the stage README's new section "A slide's own components" (the
  WebGL renderer rule and the icon resolver).
- Nothing is needed for `--cold`: `pnpm talk record` already passes extra arguments to `slidev-stage-record`.
  It works once a talk's pin is on a release that has the option.
