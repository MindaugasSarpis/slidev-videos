---
theme: default
routerMode: hash
# The repo root is the addon: the player comes from its components/, the dust
# overlay from its global-top.vue. (Slidev resolves a relative addon against
# the parent of the deck's directory.)
addons:
  - ./
videos:
  repo: ExampleOwner/example-repo
  release: videos-example
  shared: false
  fit: cover
  volume: 0.4
---

# slidev-addon-videos example

The next slides embed `VideoPlayer` with clips that do not exist —
the smoke test asserts the resolved URL came from the `videos:` headmatter,
that `videos.volume` is applied, and that `+` / `-` / `p` drive the active clip.

---
hideInToc: true
---

<VideoPlayer src="clip_example.mp4" />

<!-- intentionally nonexistent: the chain must resolve to
     https://github.com/ExampleOwner/example-repo/releases/download/videos-example/clip_example.mp4 -->

---
hideInToc: true
---

<VideoPlayer src="clip_second.mp4" />

<!-- second clip: the smoke test asserts the `+`/`-` session level set on the
     previous slide carries over here -->

---
hideInToc: true
---

<VideoPlayer src="clip_dust.webm" transition="dust" dust="#4f8cff" />

<!-- the one real clip (scripts/make-example-clip.mjs writes it; its frame
     strip is committed under public/video-frames/): it arrives as particles
     and leaves as particles -->

---
hideInToc: true
---

# After the clip

<VideoPlayer src="clip_fade.mp4" transition="fade" fit="contain" />

<!-- nonexistent again: a `fade` clip that never loads shows the error, not a
     held picture -->
