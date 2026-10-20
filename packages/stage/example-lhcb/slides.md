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

---
space:
  at: lhcb
  path:   # from the still's own view (tools/lis/lis_pose.py lis.json --anchor 2.975,3.06,0.96) back to the whole detector
    - [0, { at: [2.975, 2.758, 0.96], dist: 2.236, yaw: -90, pitch: -29.74 }]
    - [9, { at: [4, 0, 0], dist: 26, yaw: -55, pitch: 14 }]
---

<StageSteps :set="{ det: 0, ltFlag: 0 }" />

<StageDepthGrains src="stage-data/lis_last.jpg" depth="stage-data/lis_last.depth.png" camera="stage-data/lis.json"
  :anchor="[2.975, 3.06, 0.96]" :s-end="1.2" :hole="{ name: 'det', r: 0.1 }"
  :cues="[{ dist: 3.2, set: { det: 1 } }, { stopped: true, set: { ltFlag: 1 }, fadeOut: 1500 }]"
  :reset="{ set: { det: 0, ltFlag: 0 } }" :end="{ set: { det: 1, ltFlag: 1 } }"
  alt="A SciFi module's end, the Lithuanian flag engraved on its cold box" />
