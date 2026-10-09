"""--prune against the whole manifest: --only never widens what it deletes.

`publish --only a.mp4 --prune` once pruned against the --only subset and
deleted every other asset of the talk's release; a dry run also created the
release. gh is replaced by a recorder here, so nothing touches the network.
"""
import json
import types
from pathlib import Path

import pytest

from slidev_videos import config, pipeline


def make_talk(root: Path, release_exists: bool = True) -> Path:
    (root / "videos" / "raw").mkdir(parents=True)
    (root / "public" / "videos").mkdir(parents=True)
    (root / "videos.toml").write_text(
        '[defaults]\nrepo = "o/r"\nrelease_tag = "videos-t"\nshared = false\n', encoding="utf-8")
    (root / "videos" / "manifest.toml").write_text(
        "".join(f'[[videos]]\nname = "{n}.mp4"\nprofile = "standard"\n' for n in "abc"),
        encoding="utf-8")
    for n in "abc":
        (root / "public" / "videos" / f"{n}.mp4").write_bytes(b"x" * 10)
    (root / "deck.md").write_text(
        "".join(f'<VideoPlayer src="{n}.mp4" />\n' for n in "abc"), encoding="utf-8")
    pipeline._init_paths(config.load_project(str(root)))
    return root


class FakeGh:
    """Records every subprocess call; answers `gh release view` from `assets`."""

    def __init__(self, assets: dict[str, int] | None):
        self.assets = assets          # None = the release does not exist
        self.calls: list[list[str]] = []

    def run(self, cmd, *a, **k):
        self.calls.append(list(cmd))
        if cmd[:3] == ["gh", "release", "view"]:
            if self.assets is None:
                return types.SimpleNamespace(returncode=1, stdout="", stderr="release not found")
            if "--json" in cmd:
                listing = {"assets": [{"name": n, "size": s, "url": f"https://x/{n}"}
                                      for n, s in self.assets.items()]}
                return types.SimpleNamespace(returncode=0, stdout=json.dumps(listing), stderr="")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    def call(self, cmd, *a, **k):
        self.calls.append(list(cmd))
        return 0

    def gh(self, verb: str) -> list[list[str]]:
        return [c for c in self.calls if c[:3] == ["gh", "release", verb]]


@pytest.fixture
def fake(monkeypatch):
    def install(assets):
        gh = FakeGh(assets)
        monkeypatch.setattr(pipeline.subprocess, "run", gh.run)
        monkeypatch.setattr(pipeline.subprocess, "call", gh.call)
        monkeypatch.setattr(pipeline.shutil, "which", lambda name: f"/usr/bin/{name}")
        return gh
    return install


def run(root: Path, *argv: str) -> int:
    return pipeline.main(["--project", str(root), *argv])


# --- publish -----------------------------------------------------------------

def test_publish_only_with_prune_is_refused(tmp_path, fake, capsys):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10})
    assert run(root, "publish", "--only", "a.mp4", "--prune", "--dry-run") == 2
    assert "--only" in capsys.readouterr().err
    assert gh.calls == []


def test_publish_prune_dry_run_lists_only_true_orphans(tmp_path, fake, capsys):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10, "old.mp4": 5})
    assert run(root, "publish", "--prune", "--dry-run") == 0
    out = capsys.readouterr().out
    assert "old.mp4: deleting" in out
    for n in "abc":
        assert f"{n}.mp4: deleting" not in out
    assert gh.gh("delete-asset") == []
    assert gh.gh("upload") == []


def test_publish_prune_needs_yes(tmp_path, fake, capsys):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "old.mp4": 5})
    assert run(root, "publish", "--prune") == 2
    assert "--yes" in capsys.readouterr().err
    assert gh.calls == []


def test_publish_prune_yes_deletes_only_orphans(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10, "old.mp4": 5})
    assert run(root, "publish", "--prune", "--yes") == 0
    deleted = [c[c.index("--repo") + 2] for c in gh.gh("delete-asset")]
    assert deleted == ["old.mp4"]


def test_publish_tier_keeps_the_whole_manifest_even_given_a_subset(tmp_path, fake):
    # defence in depth: a caller passing an --only subset still prunes by `keep`
    make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10, "old.mp4": 5})
    _, videos = pipeline.load_manifest()
    rc = pipeline._publish_tier(
        [v for v in videos if v.name == "a.mp4"], pipeline.WEB_DIR, tag="videos-t",
        release_title="t", release_notes="n", force=False, dry_run=False, prune=True,
        keep={v.name for v in videos},
    )
    assert rc == 0
    assert [c[c.index("--repo") + 2] for c in gh.gh("delete-asset")] == ["old.mp4"]


def test_publish_dry_run_does_not_create_the_release(tmp_path, fake, capsys):
    root = make_talk(tmp_path)
    gh = fake(None)
    assert run(root, "publish", "--dry-run") == 0
    assert gh.gh("create") == []
    assert gh.gh("upload") == []
    assert "Would create release 'videos-t'" in capsys.readouterr().out


def test_publish_creates_a_missing_release_for_real(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake(None)
    assert run(root, "publish") == 0
    assert len(gh.gh("create")) == 1
    assert len(gh.gh("upload")) == 1


def test_publish_hq_only_with_prune_is_refused(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10})
    assert run(root, "publish-hq", "--only", "a.mp4", "--prune", "--yes") == 2
    assert gh.calls == []


# --- pull --------------------------------------------------------------------

def test_pull_only_with_prune_is_refused_and_keeps_local_files(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10})
    assert run(root, "pull", "--only", "a.mp4", "--prune", "--yes") == 2
    assert gh.calls == []
    assert sorted(p.name for p in (root / "public" / "videos").iterdir()) == ["a.mp4", "b.mp4", "c.mp4"]


def test_pull_prune_dry_run_spares_manifest_files(tmp_path, fake, capsys):
    root = make_talk(tmp_path)
    (root / "public" / "videos" / "stray.mp4").write_bytes(b"s")
    fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10})
    assert run(root, "pull", "--prune", "--dry-run") == 0
    out = capsys.readouterr().out
    assert "stray.mp4: pruning local" in out
    for n in "abc":
        assert f"{n}.mp4: pruning" not in out
    assert (root / "public" / "videos" / "stray.mp4").exists()


def test_pull_prune_yes_removes_only_the_stray(tmp_path, fake):
    root = make_talk(tmp_path)
    (root / "public" / "videos" / "stray.mp4").write_bytes(b"s")
    fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10})
    assert run(root, "pull", "--prune", "--yes") == 0
    assert sorted(p.name for p in (root / "public" / "videos").iterdir()) == ["a.mp4", "b.mp4", "c.mp4"]


def test_pull_hq_only_with_prune_is_refused(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10})
    assert run(root, "pull-hq", "--only", "a.mp4", "--prune", "--dry-run") == 2
    assert gh.calls == []


def test_pnpm_delimiter_reaches_the_prune_flags(tmp_path, fake):
    # `pnpm videos:publish -- --prune --yes` forwards the `--` verbatim
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10, "b.mp4": 10, "c.mp4": 10, "old.mp4": 5})
    assert run(root, "publish", "--", "--prune", "--yes") == 0
    assert len(gh.gh("delete-asset")) == 1
