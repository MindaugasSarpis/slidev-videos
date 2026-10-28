"""shared.toml: names are unique snake_case, profiles valid, the 2026-09-08 outreach promotions present."""
import re
import tomllib

from slidev_videos import config, pipeline

SNAKE = re.compile(r"^[a-z0-9_]+\.(mp4|webm)$")

PROMOTED_2026_09_08 = {
    "lhcb_aciu.mp4", "standard_model.mp4", "beyond_cmb.mp4", "mars_surface.mp4",
    "atoms.mp4", "blue_ghost_lunar_orbit.mp4", "saturn_v_launch_nasa.mp4",
    "cmb_sonification_drone.mp4", "mountain.mp4",
}


def _entries():
    with config.shared_registry_path().open("rb") as f:
        return tomllib.load(f)["videos"]


def test_names_unique_and_snake_case():
    names = [v["name"] for v in _entries()]
    assert len(names) == len(set(names))
    bad = [n for n in names if not SNAKE.match(n)]
    assert bad == []


def test_profiles_valid():
    bad = [v["name"] for v in _entries() if v["profile"] not in pipeline.PROFILE_NAMES]
    assert bad == []


def test_outreach_promotions_present():
    names = {v["name"] for v in _entries()}
    assert PROMOTED_2026_09_08 <= names
    assert "lis_flag.mp4" in names   # v0.9.0: the light injection system's hand-over clip
    assert len(names) == 48


# Cuts several decks share (Užsikrauk karjerai's, copied byte for byte by MasterTalk, wanted by
# Tokyo): in the library under names of their own, so the full-length clips keep theirs.
SHARED_CUTS = {
    "cern_footage_2022_013_001_tunnel_cut.mp4": ("cern_footage_2022_013_001.mp4", ["2:35", "2:53"]),
    "cern_video_2019_050_008_dipole.mp4": ("cern_video_2019_050_008.mp4", ["0:00", "0:10.8"]),
}


def test_shared_cuts_have_their_trim_beside_the_full_clip():
    by = {v["name"]: v for v in _entries()}
    for cut, (full, trim) in SHARED_CUTS.items():
        assert cut in by and full in by, cut
        assert by[cut]["trim"] == trim, cut
    assert "vilnius_zoom.mp4" in by
    assert by["cern_footage_2022_013_001_tunnel_cut.mp4"]["loudnorm"] is False   # the tunnel's own hum, at its level


def test_lis_flag_module_beside_the_short_render():
    # Innoday's 21 Oct 20 s render (the whole SciFi module, then the flag): a render of its own,
    # not a cut, so it takes a name of its own beside the library's 10 s lis_flag.mp4
    by = {v["name"]: v for v in _entries()}
    assert "lis_flag.mp4" in by and "lis_flag_module.mp4" in by
    assert "trim" not in by["lis_flag_module.mp4"]
