---
theme: default
colorSchema: dark
routerMode: hash
transition: fade
aspectRatio: 16/9
# The lhcb plugin's example: LHCb's real geometry as grains (`src: lhcb`, fetched
# at build time from the geometry-lhcb release, GPL-3.0 data; see its NOTICE).
addons:
  - ./
stage:
  space: data/space.json
  palette: blue
  plugins: [lhcb]
title: slidev-addon-stage lhcb example
layout: default
space: { at: lhcb }
---

<StageSteps :set="{ det: 0, ltFlag: 0 }" />

---
space: { at: lhcb }
---

<StageSteps :set="{ det: 1 }" />

---
space: { at: lhcb }
---

<StageSteps :set="{ det: 2 }" />

---
space: { at: lhcb }
---

<StageSteps :set="{ det: 1, ltFlag: 1 }" />
