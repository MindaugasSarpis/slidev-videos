"""Keep the CLI's caches (tools.json, probe.json) out of the real ~/.cache."""
import pytest


@pytest.fixture(autouse=True, scope="session")
def _private_cache(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    mp.setenv("XDG_CACHE_HOME", str(tmp_path_factory.mktemp("cache")))
    yield
    mp.undo()
