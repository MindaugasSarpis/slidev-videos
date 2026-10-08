"""Every version string in the repo names the same release.

Read from the files, not imported: from a worktree, `slidev_videos` would
import from wherever the editable install points.
"""
import ast
import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")


def version() -> str:
    with (ROOT / "pyproject.toml").open("rb") as f:
        return tomllib.load(f)["project"]["version"]


def test_pyproject_version_is_semver():
    assert SEMVER.match(version())


def test_package_json_matches_pyproject():
    assert json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"] == version()


def test_init_matches_pyproject():
    tree = ast.parse((ROOT / "src/slidev_videos/__init__.py").read_text(encoding="utf-8"))
    found = [n.value.value for n in tree.body if isinstance(n, ast.Assign)
             and any(getattr(t, "id", None) == "__version__" for t in n.targets)]
    assert found == [version()]


def test_readme_install_lines_name_this_version():
    for rel in ("README.md", "packages/stage/README.md"):
        tags = re.findall(r"slidev-videos[@#]v(\d+\.\d+\.\d+)", (ROOT / rel).read_text(encoding="utf-8"))
        assert tags, f"{rel} has no install line"
        assert set(tags) == {version()}, rel


def test_changelog_has_this_version_with_its_stage():
    stage = json.loads((ROOT / "packages/stage/package.json").read_text(encoding="utf-8"))["version"]
    assert SEMVER.match(stage)
    changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    heading = re.search(rf"^## v{re.escape(version())} .*$", changelog, re.M)
    assert heading, f"CHANGELOG.md has no '## v{version()}' section"
    assert f"(stage {stage})" in heading.group(0)
