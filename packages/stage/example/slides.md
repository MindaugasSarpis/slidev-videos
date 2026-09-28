---
theme: default
colorSchema: dark
routerMode: hash
transition: fade
aspectRatio: 16/9
# The package directory is the addon (Slidev resolves a relative addon against
# the parent of the deck's directory).
addons:
  - ./
stage:
  space: data/space.json
  records: data/records.json
  palette: blue
  sound: true
title: slidev-addon-stage example
layout: cover
space:
  at: wide
---

# slidev-addon-stage

# One world, every slide

## A camera that flies from slide to slide · press c to build the body again

<div class="mt-md">The example deck</div>

---
space: { at: path, dim: 0.2 }
---

# Stations stand in the dust

<div class="world-caption caption">A station is a list of objects in <code>space.json</code>. This one is <code>tracks</code>: lines, lit tubes, a pulse running down them.</div>

---
space:
  at: marks
  stops: [first, second]
  dim: 0.3
clicks: 2
---

# A stop flies to a mark

<div class="card" style="position: absolute; left: 44px; bottom: 70px">

## Two clicks

`stops: [first, second]` — each click flies to a mark and shows its record.

</div>

---
layout: section
space: { at: far }
---

# A named pose

`poses` in space.json: `far`

---
space: { at: grid, dim: 0.7 }
---

# Content keeps its contrast

<div class="row">
<div class="card col-45">

## The scrim

`dim` sets how far the world steps back behind a slide: 0.15 on display layouts, 0.6 on content slides.

</div>
<div class="card col-45">

## The halo

Cards have no drawn edge. A fine dust stands along their outline.

</div>
</div>

<div class="src">slidev-addon-stage · packages/stage/example</div>

---
layout: statement
space: { at: [-26.5, -3.4, 0], dist: 15.5, yaw: 15, pitch: 2, sway: 9 }
---

# Back where it began

<div class="mt-md">the hero builds itself again on arrival</div>
