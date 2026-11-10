---
theme: default
colorSchema: dark
routerMode: hash
aspectRatio: 16/9
# The package directory is the addon (Slidev resolves a relative addon against
# the parent of the deck's directory).
addons:
  - ./
title: slidev-addon-explain3d example
---

# line-fit-valley

<div class="box"><Explain3D name="line-fit-valley" /></div>

<style>
.box { height: 400px; display: flex; }
.box > * { flex: 1; }
</style>

---

# The opening view only

<div class="box"><Explain3D name="line-fit-valley" still /></div>

<style>
.box { height: 400px; display: flex; }
.box > * { flex: 1; }
</style>

---

# A deck's own scene

<div class="box"><Explain3D :spec="spec" :data="data" /></div>

<script setup>
// A saddle, z = x² − y², with a second state (a flat floor) and a line along its ridge.
const n = 21
const saddle = []
const floor = []
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = -1 + i / 10, y = -1 + j / 10; saddle.push(x * x - y * y); floor.push(0) }
const t = Array.from({ length: 21 }, (_, i) => -1 + i / 10)
const data = { saddle, floor, t, tt: t.map((v) => v * v) }
const spec = {
  explain3d: 1,
  name: 'saddle',
  label: 'A saddle: z = x² − y²',
  axes: [
    { label: 'x', lo: -1, hi: 1, len: 1.4, ticks: [-1, 0, 1] },
    { label: 'y', lo: -1, hi: 1, len: 1.4, ticks: [-1, 0, 1] },
    { label: 'z', lo: -1, hi: 1, len: 1, ticks: [-1, 0, 1] },
  ],
  view: { azim: -60, elev: 28, turn: 30 },
  views: [{ id: 'above', label: 'from above', azim: -90, elev: 90 }],
  states: [{ id: 'saddle', label: 'saddle' }, { id: 'floor', label: 'floor' }],
  layers: [
    { type: 'surface', grid: { nx: n, ny: n }, z: { saddle: 'data:saddle', floor: 'data:floor' } },
    { type: 'line', x: 'data:t', y: 0, z: 'data:tt', color: 'c1', in: ['saddle'] },
    { type: 'marker', at: [0, 0, 0], label: 'the pass', in: ['saddle'] },
  ],
}
</script>

<style>
.box { height: 400px; display: flex; }
.box > * { flex: 1; }
</style>

---

# A scene that is not sound

<div class="box"><Explain3D :spec="{ explain3d: 1, name: 'broken', label: 'broken', axes: [], layers: [] }" /></div>

<style>
.box { height: 400px; display: flex; }
.box > * { flex: 1; }
</style>
