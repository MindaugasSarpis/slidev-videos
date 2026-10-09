"""Web-tier encode args: one quality target per profile, built per encoder."""
from slidev_videos import config, pipeline
from slidev_videos.pipeline import NVENC_WEB_TUNING, WEB_PROFILES, _web_args


def has_run(args: list[str], run: tuple[str, ...]) -> bool:
    n = len(run)
    return any(tuple(args[i:i + n]) == run for i in range(len(args) - n + 1))


def test_nvenc_web_args_carry_the_profile_cq_and_the_tuning():
    for name, spec in WEB_PROFILES.items():
        args = _web_args(spec, 1920, "nvenc")
        assert has_run(args, ("-c:v", "h264_nvenc")), name
        assert has_run(args, ("-cq", str(spec["cq"]))), name
        assert has_run(args, NVENC_WEB_TUNING), name
        assert has_run(args, ("-maxrate", spec["maxrate"], "-bufsize", spec["bufsize"])), name
        assert "-crf" not in args and "-spatial-aq" not in args, name


def test_cpu_web_args_use_crf_and_no_nvenc_options():
    for name, spec in WEB_PROFILES.items():
        args = _web_args(spec, 1920, "cpu")
        assert has_run(args, ("-c:v", "libx264", "-preset", "slow", "-crf", str(spec["crf"]))), name
        assert "-cq" not in args and "-multipass" not in args and "-rc-lookahead" not in args, name


def test_a_gpu_that_cannot_run_the_tuning_encodes_on_the_cpu(machine, tmp_path, monkeypatch, fake_build):
    # the runtime test encode carries the web tier's options, so a build
    # that rejects them is not picked for nvenc and the encode does not fail
    log = tmp_path / "log"
    gpu = fake_build(tmp_path / "old-gpu", log, nvenc=True)
    ff = gpu / "ffmpeg"
    shebang, logline, rest = ff.read_text().split("\n", 2)   # keep the run logged
    ff.write_text(f'{shebang}\n{logline}\ncase "$*" in *rc-lookahead*) exit 1 ;; esac\n{rest}')
    monkeypatch.setenv("PATH", str(gpu))
    talk = tmp_path / "talk"
    (talk / "videos").mkdir(parents=True)
    (talk / "videos.toml").write_text("[defaults]\n", encoding="utf-8")
    (talk / "videos" / "manifest.toml").write_text("", encoding="utf-8")
    pipeline._init_paths(config.load_project(str(talk)))
    pipeline._encodes_with.cache_clear()
    assert pipeline.select_encoder(None) == "cpu"
    assert pipeline.select_encoder("nvenc") == "cpu"
    assert any("-c:v h264_nvenc -multipass fullres -rc-lookahead 20" in line
               for line in log.read_text().splitlines())
