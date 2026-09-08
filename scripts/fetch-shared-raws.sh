#!/usr/bin/env bash
# Populate videos/raw/ with a master for every shared.toml entry.
# Sources are the paths each entry's `notes` records. Idempotent: rclone
# skips size+modtime matches, gh only runs when the file is absent.
# Usage: scripts/fetch-shared-raws.sh   (from the package repo root)
set -euo pipefail
RCLONE="${RCLONE:-$HOME/micromamba/envs/outreach_talks/bin/rclone}"
BASE="gdrive:work/outreach/resources/videos"
RAW="$(cd "$(dirname "$0")/.." && pwd)/videos/raw"
mkdir -p "$RAW"

# "<gdrive folder>/<source name>  <library name>"
MAP='
released/skylapse.mp4                               skylapse.mp4
released/drone_climbing_mountain.mp4                drone_climbing_mountain.mp4
released/nasa_mars_mariner_4_pan_audio.mp4          nasa_mars_mariner_4_pan_audio.mp4
released/webb_reel.mp4                              webb_reel.mp4
released/milky_way_sim_audio.mp4                    milky_way_sim_audio.mp4
released/qgp_formation.mp4                          qgp_formation.mp4
released/voyage_in_to_the_world_of_atoms.mp4        voyage_in_to_the_world_of_atoms.mp4
released/cloud_chamber_audio.mp4                    cloud_chamber_audio.mp4
released/cern_overview_short.mp4                    cern_overview_short.mp4
released/lhcb.mp4                                   lhcb.mp4
released/beyond_cmb.mp4                             beyond_cmb.mp4
released/mars_surface.mp4                           mars_surface.mp4
released/blue_ghost_lunar_orbit.mp4                 blue_ghost_lunar_orbit.mp4
released/saturn_v_launch_nasa.mp4                   saturn_v_launch_nasa.mp4
released/cmb_sonification_drone.mp4                 cmb_sonification_drone.mp4
released/expansion_funnel_h264_1080p.webm           expansion_funnel.webm
released/lhcb_aciu.mov                              lhcb_aciu.mp4
released/sm.mov                                     standard_model.mp4
released/atoms.mov                                  atoms.mp4
released/mountain.mov                               mountain.mp4
science/perseverence_rover_landing_nasa.mp4         perseverance_rover_landing_nasa.mp4
science/telescope.mp4                               telescope.mp4
cosmology/cassini_grand_finale_no_vo.mp4            cassini_grand_finale.mp4
cosmology/sdss_universe_zoom_trim_3.mp4             sdss_universe_zoom.mp4
cern/cern_footage_2015_006_001.mov                  cern_footage_2015_006_001.mp4
cern/cern_footage_2022_013_001_1080p_lhc.mp4        cern_footage_2022_013_001.mp4
cern/atlas_footage_2022_004_002_1080p_shaft.mp4     atlas_footage_2022_004_002.mp4
cern/atlas_video_2021_001_001_1080ph265.mp4         atlas_video_2021_001_001.mp4
cern/cms.mp4                                        cms.mp4
cern/cern_footage_2022_042_001.mov                  cern_footage_2022_042_001.mp4
cern/uploaded_cern_footage_2024_006_012.mp4         cern_footage_2024_006_012.mp4
cern/atlas_video_2023_013_001_1080p_event_display.mp4 atlas_video_2023_013_001.mp4
cern/cern_footage_2022_013_006_1080p_data_center.mp4  cern_footage_2022_013_006.mp4
cern/cern_footage_2025_048_001.mp4                  cern_footage_2025_048_001.mp4
cern/cern_footage_2025_049_001.mp4                  cern_footage_2025_049_001.mp4
cern/cern_video_2015_024_001_1080p.mp4              cern_video_2015_024_001.mp4
cern/cern_footage_2024_006_001.mp4                  cern_footage_2024_006_001.mp4
cern/cern_video_2025_029_001_1080p.mp4              cern_video_2025_029_001.mp4
cern/cern_video_2019_050_008_1080ph265.mp4          cern_video_2019_050_008.mp4
cern/cern_footage_2025_014_002.mp4                  cern_footage_2025_014_002.mp4
cern/cern_footage_2024_010_002.mp4                  cern_footage_2024_010_002.mp4
'
while read -r src dst; do
  [[ -z "${src:-}" ]] && continue
  echo "== $dst  <-  $src"
  "$RCLONE" copyto "$BASE/$src" "$RAW/$dst" --stats-one-line --stats 30s
done <<< "$MAP"

# Two clips have no Drive original; the course's archived release copy is the raw.
COURSE=MindaugasSarpis/CERN_lessons_on_data_analysis
for pair in "Stars_Pan_Audio.mp4 stars_pan_audio.mp4" "Hubble.mp4 hubble.mp4"; do
  set -- $pair
  if [[ ! -f "$RAW/$2" ]]; then
    echo "== $2  <-  course release videos/$1"
    gh release download videos -R "$COURSE" -p "$1" -O "$RAW/$2"
  fi
done

echo; echo "raw bank: $(ls "$RAW" | wc -l) files, $(du -sh "$RAW" | cut -f1)"
