"""slidev-videos depth: where maps go and what size the model sees (no model needed)."""
from pathlib import Path

from slidev_videos import depth


def test_depth_map_sits_beside_its_image():
    assert depth.depth_path(Path("public/figures/hero_tunnel.jpg")) == Path("public/figures/hero_tunnel.depth.png")
    assert depth.depth_path(Path("a.b.png")) == Path("a.b.depth.png")


def test_input_keeps_the_aspect_at_multiples_of_14():
    for w, h in [(2400, 1600), (1920, 1281), (800, 1200), (518, 518)]:
        iw, ih = depth._input_size(w, h)
        assert iw % 14 == 0 and ih % 14 == 0 and min(iw, ih) >= depth.LOWER
        assert abs(iw / ih - w / h) < 0.03


def test_the_cli_routes_depth_without_a_project(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)                     # no videos.toml anywhere
    from slidev_videos import pipeline
    assert pipeline.main(["depth", "missing.jpg"]) == 2      # no videos.toml needed; stops before the model
