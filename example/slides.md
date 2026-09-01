---
theme: default
routerMode: hash
videos:
  repo: ExampleOwner/example-repo
  release: videos-example
  shared: false
  fit: cover
---

# slidev-addon-videos example

The next slide embeds `VideoPlayer` with a clip that does not exist —
the smoke test asserts the resolved URL came from the `videos:` headmatter.

---
hideInToc: true
---

<VideoPlayer src="clip_example.mp4" />

<!-- intentionally nonexistent: the chain must resolve to
     https://github.com/ExampleOwner/example-repo/releases/download/videos-example/clip_example.mp4 -->
