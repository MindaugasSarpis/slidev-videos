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
    assert len(names) == 43
