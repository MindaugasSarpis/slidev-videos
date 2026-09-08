---
theme: default
routerMode: hash
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
