# tools

Scripts that make the stage's data and clips. They run in Blender (4.5 LTS,
headless) or plain Python, outside the packages: nothing here ships in
slidev-addon-stage or the slidev-videos CLI.

## lhcb/

- `bake_grains.py`: LHCb's Run 3 geometry as grains, the data behind the lhcb
  plugin's `detector`. Input: HSF Phoenix's `LHCb.glb` (kept outside git).
  Output: little-endian Int16 `[x, y, z, part]` per grain, in mm, LHCb's frame
  (z along the beam, y up); parts by index: velo, pipe, rich1, ut, magnet,
  scifi, rich2, ecal, hcal, muon. Seeded, so each run writes the same file.

  ```sh
  blender -b --factory-startup --python tools/lhcb/bake_grains.py -- LHCb_light-draco.glb lhcb-grains.bin        # src: lhcb
  blender -b --factory-startup --python tools/lhcb/bake_grains.py -- LHCb_light-draco.glb lhcb-grains-dense.bin 4.8  # src: lhcb-dense
  ```

  The files live on the `geometry-lhcb` release with `lhcb-grains.NOTICE.txt`,
  and `packages/stage/stage/data.mjs` pins their sha256. They are GPL-3.0:
  derived from LHCb's DD4hep description (© CERN for the benefit of the LHCb
  Collaboration) through Phoenix's glTF (Apache-2.0). A deck that shows them
  credits both. A new bake gets a new file name and a new pin; a published
  asset is never replaced.

- `build_scene.py`: a hero shot's Blender scene, the geometry plus an event's
  tracks grown to `--t` ns by light time. Its `SHOTS` are MasterTalk's cameras.

## lis/

- `lis_scene.py`: the light injection system clip, the end of a SciFi module
  with a laser engraving the Lithuanian flag on the cold box. It writes the
  frames, then, with `--meta` and `--depth`, the last frame's camera (JSON) and
  its depth (a 16-bit PNG, red high and green low). From those,
  `<StageDepthGrains>` turns the last frame into grains in depth.
- `lis_pose.py`: the stage pose of the clip's last view, for path[0] of the
  hand-over slide.
