---
theme: default
colorSchema: dark
routerMode: hash
transition: fade
aspectRatio: 16/9
# The example deck under the broadcast look: the same slides (src), filmed or
# streamed. pnpm build:broadcast writes it to example/dist/broadcast.
addons:
  - ./
stage:
  space: data/space.json
  records: data/records.json
  palette: blue
  look: broadcast
  sound: true
title: slidev-addon-stage example (broadcast)
src: ./slides.md
---
