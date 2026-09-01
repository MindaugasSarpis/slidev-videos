"""Project discovery and configuration for slidev-videos.

A *project* is any directory tree with a `videos.toml` at its root. The
`[project]` table declares the layout (defaults reproduce the classic
talk layout); `[defaults]` feeds the pipeline and merges over the
`[defaults]` of every `videos.toml` found in ancestor directories
(nearest ancestor wins over farther ones; the project's own file wins
over all ancestors; a manifest's `[defaults]` — merged later by the
pipeline — wins over everything here).
"""
from __future__ import annotations

import re
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

CONFIG_NAME = "videos.toml"


@dataclass
class Project:
    root: Path
    slides_dir: Path
    public_dir: Path
    raw_dir: Path
    hq_dir: Path
    manifest: Path
    defaults: dict


def _read(path: Path) -> dict:
    try:
        with path.open("rb") as f:
            return tomllib.load(f)
    except OSError:
        return {}


def find_project(start: Path) -> Path:
    start = Path(start).resolve()
    for p in [start, *start.parents]:
        if (p / CONFIG_NAME).is_file():
            return p
    raise SystemExit(
        f"error: no {CONFIG_NAME} found from {start} upward — "
        f"create one at the project root (see the slidev-videos README)"
    )


def _ancestor_defaults(root: Path) -> dict:
    """[defaults] of every videos.toml strictly above root, nearest wins."""
    chain: list[dict] = []
    for p in root.parents:
        cfg = p / CONFIG_NAME
        if cfg.is_file():
            chain.append(_read(cfg).get("defaults", {}))
    merged: dict = {}
    for d in reversed(chain):   # farthest first, nearest overwrites
        merged.update(d)
    return merged


def repo_from_git(root: Path) -> str | None:
    try:
        url = subprocess.run(
            ["git", "-C", str(root), "remote", "get-url", "origin"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    m = re.search(r"github\.com[:/]([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else None


def parse_shared(value) -> tuple[str, str] | None:
    """'owner/repo@tag' -> (owner/repo, tag); false-y or malformed -> None."""
    if not value or not isinstance(value, str):
        return None
    repo, sep, tag = value.partition("@")
    if not sep or "/" not in repo or not tag:
        return None
    return repo, tag


def load_project(cli_project: str | None = None) -> Project:
    start = Path(cli_project) if cli_project else Path.cwd()
    root = find_project(start)
    data = _read(root / CONFIG_NAME)
    proj = data.get("project", {})
    defaults = {**_ancestor_defaults(root), **data.get("defaults", {})}
    defaults.setdefault("shared", "MindaugasSarpis/slidev-videos@videos-shared")
    if "repo" not in defaults:
        r = repo_from_git(root)
        if r:
            defaults["repo"] = r
    return Project(
        root=root,
        slides_dir=root / proj.get("slides_dir", "."),
        public_dir=root / proj.get("public_dir", "public"),
        raw_dir=root / proj.get("raw_dir", "videos/raw"),
        hq_dir=root / proj.get("hq_dir", "videos/hq"),
        manifest=root / proj.get("manifest", "videos/manifest.toml"),
        defaults=defaults,
    )


def shared_registry_path() -> Path:
    from importlib.resources import files
    return Path(str(files("slidev_videos") / "shared.toml"))
