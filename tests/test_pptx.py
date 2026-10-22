"""slidev-videos pptx: a PowerPoint file from the stage recorder's takes.

The encode's command line is checked as data; one real build runs on tiny
lavfi takes (x264, a few frames) when ffmpeg and python-pptx are here, and
the PPTX is read back as the zip it is.
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from slidev_videos import pptx as P

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")
SOUND = {"start": 0.2, "t": 0.0, "end": 0.9, "muted": False, "volume": 1, "loop": False}


# ---- the encode, as data ---------------------------------------------------------------
def test_the_pptx_profile_caps_the_rate_on_either_codec():
    nv = P.encode_args("ffmpeg", Path("01.mp4"), Path("e.mp4"), codec="h264_nvenc", profile="pptx", fps=50, seconds=8.6)
    s = " ".join(nv)
    for want in ("-c:v h264_nvenc", "-rc vbr", "-cq 24", "-b:v 0", "-maxrate 6M", "-bufsize 12M",
                 "-profile:v high", "-pix_fmt yuv420p", "-g 50", "-movflags +faststart"):
        assert want in s, want
    assert "-an" in nv and "-vf" not in nv            # silent; the take's own size
    x = " ".join(P.encode_args("ffmpeg", Path("01.mp4"), Path("e.mp4"), codec="libx264", profile="pptx", fps=50, seconds=8.6))
    assert "-c:v libx264" in x and "-crf 21" in x and "-maxrate 6M -bufsize 12M" in x
    # --cap reaches ffmpeg, the buffer twice the cap; --size scales
    c = " ".join(P.encode_args("ffmpeg", Path("01.mp4"), Path("e.mp4"), codec="libx264", profile="pptx", fps=25,
                               seconds=3, cap="4M", size=(1920, 1080)))
    assert "-maxrate 4M -bufsize 8M" in c and "-g 25" in c
    assert "scale=1920:1080:flags=lanczos" in c
    # small: the plate's rate; copy: the take as recorded
    assert "-cq 27" in " ".join(P.encode_args("ffmpeg", Path("a"), Path("b"), codec="h264_nvenc", profile="small", fps=50, seconds=1))
    cp = P.encode_args("ffmpeg", Path("a"), Path("b"), codec="libx264", profile="copy", fps=50, seconds=1)
    assert cp[cp.index("-c:v") + 1] == "copy" and "-crf" not in cp


def test_a_clip_slide_gets_the_clip_sound_where_it_played():
    a = P.encode_args("ffmpeg", Path("02.mp4"), Path("e.mp4"), codec="libx264", profile="pptx", fps=50, seconds=1.5,
                      sound=SOUND, clip=Path("dist/videos/lhcb.mp4"))
    assert a[a.index("-i") + 1] == "02.mp4"
    assert a.count("-i") == 2 and "dist/videos/lhcb.mp4" in a
    f = a[a.index("-filter_complex") + 1]
    # from the clip's own second t, for as long as it played, placed at the take's second `start`
    assert "atrim=start=0:duration=0.72" in f        # end - start + one frame
    assert "adelay=200:all=1" in f
    assert "apad" in f and "atrim=end=1.5" in f       # padded and cut to the take
    assert "volume" not in f                          # the web tier's level (-16 LUFS), no loudnorm
    s = " ".join(a)
    assert "-map 0:v:0" in s and "-map [a]" in s and "-c:a aac" in s and "-an" not in a
    # quieter clip, a clip running before the take, a loop
    b = P.encode_args("ffmpeg", Path("02-c1.mp4"), Path("e.mp4"), codec="libx264", profile="pptx", fps=50, seconds=4,
                      sound={**SOUND, "start": 0, "t": 12.5, "end": 3.98, "volume": 0.5, "loop": True}, clip=Path("c.mp4"))
    f = b[b.index("-filter_complex") + 1]
    assert "atrim=start=12.5:duration=4" in f and "adelay" not in f and "volume=0.5" in f
    assert b[b.index("c.mp4") - 3:b.index("c.mp4") - 1] == ["-stream_loop", "-1"]
    # muted, or no clip file: silent
    assert "-an" in P.encode_args("ffmpeg", Path("a"), Path("b"), codec="libx264", profile="pptx", fps=50, seconds=1,
                                  sound={**SOUND, "muted": True}, clip=Path("c.mp4"))
    assert "-an" in P.encode_args("ffmpeg", Path("a"), Path("b"), codec="libx264", profile="pptx", fps=50, seconds=1, sound=SOUND)


def test_the_clip_is_found_in_the_dist_or_beside_the_deck(tmp_path):
    dist = tmp_path / "dist"
    (dist / "videos").mkdir(parents=True)
    (dist / "videos" / "a.mp4").write_bytes(b"x")
    pub = tmp_path / "talk" / "public" / "videos"
    pub.mkdir(parents=True)
    (pub / "b.mp4").write_bytes(b"x")
    assert P.find_clip("videos/a.mp4", dist, []) == dist / "videos" / "a.mp4"
    assert P.find_clip("/videos/a.mp4", dist, []) == dist / "videos" / "a.mp4"
    assert P.find_clip("http://127.0.0.1:38201/videos/a.mp4", dist, []) == dist / "videos" / "a.mp4"
    assert P.find_clip("videos/b.mp4", dist, [pub]) == pub / "b.mp4"
    assert P.find_clip("videos/c.mp4", dist, [pub]) is None


def test_the_timing_starts_the_video_on_entry_and_holds_its_last_frame():
    x = P.autoplay_timing(pic_id=4, ms=8600)
    assert 'nodeType="tmRoot"' in x and 'nodeType="mainSeq"' in x
    assert 'presetClass="mediacall"' in x and 'cmd="playFrom(0.0)"' in x
    assert 'nodeType="afterEffect"' in x
    assert '<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' in x
    assert x.count('<p:spTgt spid="4"/>') == 2
    assert '<p:cTn id="6" dur="8600" fill="hold"/>' in x
    assert re.search(r'<p:video><p:cMediaNode vol="100000"><p:cTn id="7" fill="hold" display="0">', x)
    ids = re.findall(r'<p:cTn id="(\d+)"', x)
    assert len(ids) == len(set(ids)) == 7
    assert 'nodeType="withEffect"' in P.autoplay_timing(pic_id=4, ms=1, start="with")


# ---- a clip slide left to the clip (the recorder's --skip-clips) ------------------------
CLIP = {"vcodec": "h264", "pix_fmt": "yuv420p", "width": 1920, "height": 1080, "bit_rate": 5_000_000,
        "acodec": "aac", "duration": 148.2, "fps": 25.0}


def test_a_clip_powerpoint_plays_as_it_is_goes_in_as_it_is():
    plan = lambda info=CLIP, **k: P.clip_plan({**CLIP, **info}, **{"profile": "pptx", "cap": "6M", "size": None,  # noqa: E731
                                                                   "muted": False, "volume": 1, **k})
    assert (plan()["video"], plan()["audio"]) == ("copy", "copy")
    # the player's sound: quieter re-encodes the sound alone; muted or none, no sound
    assert (plan(volume=0.05)["video"], plan(volume=0.05)["audio"]) == ("copy", "volume")
    assert plan(muted=True)["audio"] == "none" and plan(volume=0)["audio"] == "none"
    assert plan({"acodec": None})["audio"] == "none"
    assert plan({"acodec": "opus"})["audio"] == "encode"
    # over the cap, not H.264, not 4:2:0, not 16:9, or not the --size asked for: encoded
    for info in ({"bit_rate": 9_000_000}, {"vcodec": "vp9"}, {"pix_fmt": "yuv444p"}, {"width": 1440}):
        assert plan(info)["video"] == "encode", info
    assert plan(size=(1280, 720))["video"] == "encode" and plan(size=(1920, 1080))["video"] == "copy"
    assert plan(cap="4M")["video"] == "encode"
    # an unknown rate is read as within the cap; --profile copy keeps any clip as it is
    assert plan({"bit_rate": None})["video"] == "copy"
    assert plan({"vcodec": "vp9", "bit_rate": 20_000_000}, profile="copy")["video"] == "copy"
    assert P.cap_bps("6M") == 6_000_000 and P.cap_bps("4500k") == 4_500_000


def test_the_clip_command_copies_or_encodes_each_stream():
    cp = " ".join(P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "copy", "audio": "copy"},
                               codec="libx264", profile="pptx", info=CLIP))
    assert "-i c.mp4" in cp and "-map 0:v:0 -c:v copy" in cp and "-map 0:a:0 -c:a copy" in cp
    assert "-movflags +faststart" in cp and "-an" not in cp and "-vf" not in cp
    q = " ".join(P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "copy", "audio": "volume"},
                              codec="libx264", profile="pptx", info=CLIP, volume=0.05))
    assert "-af volume=0.05" in q and "-c:a aac" in q
    assert "-an" in P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "copy", "audio": "none"},
                                 codec="libx264", profile="pptx", info=CLIP)
    # encoded: the profile under the cap, a key frame a second of the clip's own rate, cover-cropped to 16:9
    e = " ".join(P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "encode", "audio": "encode"},
                              codec="libx264", profile="pptx", info={**CLIP, "width": 1440, "fps": 30.0}, cap="6M"))
    assert "-c:v libx264 -preset medium -crf 21" in e and "-maxrate 6M -bufsize 12M" in e and "-g 30" in e
    assert "scale=1440:810:force_original_aspect_ratio=increase,crop=1440:810" in e
    assert "-c:a aac" in e
    s = " ".join(P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "encode", "audio": "none"},
                              codec="libx264", profile="pptx", info=CLIP, size=(1280, 720)))
    assert "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720" in s
    assert "-vf" not in " ".join(P.embed_args("ffmpeg", Path("c.mp4"), Path("e.mp4"), {"video": "encode", "audio": "none"},
                                              codec="libx264", profile="pptx", info=CLIP))


# ---- a real build --------------------------------------------------------------------------
needs_ffmpeg = pytest.mark.skipif(not (FFMPEG and FFPROBE and importlib.util.find_spec("pptx")),
                                  reason="needs ffmpeg and ffprobe on PATH, and python-pptx")

DECK = """---
layout: cover
---

# Viršelis

<!-- facts: x -->

<!--
Kalbėtojui. **Laba diena**, čia — pradžia.
-->

---

<VideoPlayer src="clip.mp4" />

<!--
Klipas su garsu: ąčęėįšųūž.
-->
"""


def _lavfi(out: Path, *inputs: str, seconds=0.6):
    args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y"]
    for i in inputs:
        args += ["-f", "lavfi", "-i", i]
    args += ["-t", str(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)]
    subprocess.run(args, check=True)


def _recording(tmp_path: Path, *, skip=False, embed=None) -> tuple[Path, Path]:
    rec, dist = tmp_path / "rec", tmp_path / "dist"
    rec.mkdir()
    (dist / "videos").mkdir(parents=True)
    _lavfi(dist / "videos" / "clip.mp4", "testsrc=s=64x36:r=10", "sine=frequency=440:sample_rate=48000", seconds=2)
    segs = []
    for name, color, slide, clicks, sound in [("01", "red", 1, 0, None), ("02", "green", 2, 0, SOUND), ("02-c1", "blue", 2, 1, None)]:
        _lavfi(rec / f"{name}.mp4", f"color=c={color}:s=64x36:r=10", seconds=1.5)
        seg = {"slide": slide, "clicks": clicks, "file": f"{name}.mp4", "plate": None, "frames": 15, "seconds": 1.5,
               "settle": 0.5, "capped": False, "clip": None}
        if sound:
            seg["clip"] = {"src": "videos/clip.mp4", "recorded": True, "sound": sound}
        segs.append(seg)
    if skip:
        segs.append({"slide": 3, "clicks": 0, "skipped": True, "note": "another origin",
                     "clip": {"src": "https://github.com/o/r/releases/download/t/far.mp4"}})
    if embed is not None:
        segs.append({"slide": 3, "clicks": 0, "file": None, "plate": None, "embed": True,
                     "clip": {"src": "videos/clip.mp4", "recorded": False, "embed": True, "duration": 2,
                              "loop": False, "muted": False, "volume": 1, **embed}})
    (rec / "index.json").write_text(json.dumps({"deck": str(dist), "size": [64, 36], "fps": 10, "hold": 1,
                                                 "encoder": "libx264", "segments": segs}), encoding="utf-8")
    deck = tmp_path / "deck.md"
    deck.write_text(DECK, encoding="utf-8")
    return rec, deck


def _slide_media(z: zipfile.ZipFile, n: int) -> tuple[str, str | None]:
    """(the mp4 part, the notes part or None) slide n relates to."""
    rels = z.read(f"ppt/slides/_rels/slide{n}.xml.rels").decode()
    mp4 = re.search(r'Target="\.\./media/(media\d+\.mp4)"', rels).group(1)
    notes = re.search(r'Target="\.\./notesSlides/(notesSlide\d+\.xml)"', rels)
    return f"ppt/media/{mp4}", f"ppt/notesSlides/{notes.group(1)}" if notes else None


def _audio_streams(data: bytes, tmp: Path) -> int:
    f = tmp / "probe.mp4"
    f.write_bytes(data)
    r = subprocess.run([FFPROBE, "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                        "-of", "csv=p=0", str(f)], capture_output=True, text=True, check=True)
    return len(r.stdout.split())


@needs_ffmpeg
def test_a_pptx_of_one_autoplaying_video_per_segment(tmp_path, capsys):
    from slidev_videos import pipeline
    rec, deck = _recording(tmp_path)
    out = tmp_path / "talk.pptx"
    rc = pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264", "--json"])
    report = json.loads(capsys.readouterr().out)
    assert rc == 0, report
    assert report["ok"] and report["command"] == "pptx"
    assert (report["slides"], report["segments"], report["skipped"]) == (3, 3, [])
    assert report["bytes"] == out.stat().st_size and report["seconds"] == 4.5
    assert (report["profile"], report["encoder"], report["cap"]) == ("pptx", "libx264", "6M")
    assert report["sound"] == [{"file": "02.mp4", "clip": "videos/clip.mp4", "start": 0.2}]
    assert not (tmp_path / "talk.enc").exists()          # the encodes go unless --keep-encodes

    z = zipfile.ZipFile(out)
    names = z.namelist()
    assert sorted(n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)) == [f"ppt/slides/slide{i}.xml" for i in (1, 2, 3)]
    assert len([n for n in names if n.startswith("ppt/media/") and n.endswith(".mp4")]) == 3
    assert len([n for n in names if n.startswith("ppt/media/") and n.endswith((".jpg", ".jpeg"))]) >= 1   # posters
    assert 'ContentType="video/mp4"' in z.read("[Content_Types].xml").decode()
    pres = z.read("ppt/presentation.xml").decode()
    assert '<p:sldSz cx="12192000" cy="6858000"' in pres                        # 16:9
    props = z.read("ppt/presProps.xml").decode()
    assert re.search(r'<p:showPr[^>]*>.*<p14:showMediaCtrls[^>]*val="0"', props)
    assert "{2FDB2607-1784-4EEB-B798-7EB5836EED8A}" in props

    for n in (1, 2, 3):
        x = z.read(f"ppt/slides/slide{n}.xml").decode()
        pic = re.search(r'<p:cNvPr id="(\d+)"[^>]*>\s*<a:hlinkClick[^>]*action="ppaction://media"', x).group(1)
        assert 'presetClass="mediacall"' in x and 'cmd="playFrom(0.0)"' in x
        assert f'<p:spTgt spid="{pic}"/>' in x and '<p:video>' in x and 'fill="hold" display="0"' in x
        assert '<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>' in x             # full bleed
        assert 'dur="1500"' in x
    notes = {n: z.read(_slide_media(z, n)[1]).decode() for n in (1, 2, 3)}
    assert "Kalbėtojui. Laba diena, čia — pradžia." in notes[1] and "facts" not in notes[1]
    assert "Klipas su garsu: ąčęėįšųūž." in notes[2]
    assert "[click 1/1]" in notes[3] and "Klipas su garsu" in notes[3]
    # the clip's sound on the clip slide only
    assert [_audio_streams(z.read(_slide_media(z, n)[0]), tmp_path) for n in (1, 2, 3)] == [0, 1, 0]


@needs_ffmpeg
def test_a_skipped_clip_stops_the_build_unless_allowed(tmp_path, capsys):
    from slidev_videos import pipeline
    rec, deck = _recording(tmp_path, skip=True)
    out = tmp_path / "talk.pptx"
    assert pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264"]) == 1
    err = capsys.readouterr().err
    assert "far.mp4" in err and "pull --include-shared" in err and not out.exists()
    rc = pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264",
                        "--allow-skips", "--keep-encodes", "--json"])
    report = json.loads(capsys.readouterr().out)
    assert rc == 0 and report["slides"] == 4
    assert report["skipped"] == [{"slide": 3, "clicks": 0, "clip": "https://github.com/o/r/releases/download/t/far.mp4"}]
    z = zipfile.ZipFile(out)
    x = z.read("ppt/slides/slide4.xml").decode()
    assert "far.mp4" in x and "<p:video>" not in x
    assert (tmp_path / "talk.enc" / "01.mp4").is_file()          # kept, and reused on the next run
    before = (tmp_path / "talk.enc" / "01.mp4").stat().st_mtime_ns
    assert pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264",
                          "--allow-skips", "--keep-encodes"]) == 0
    assert (tmp_path / "talk.enc" / "01.mp4").stat().st_mtime_ns == before


def _probe(data: bytes, tmp: Path) -> dict:
    f = tmp / "probe.mp4"
    f.write_bytes(data)
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height",
                        "-of", "json", str(f)], capture_output=True, text=True, check=True)
    return {s["codec_type"]: s for s in json.loads(r.stdout)["streams"]}


@needs_ffmpeg
def test_a_clip_slide_left_to_the_clip_embeds_the_clip_itself(tmp_path, capsys):
    from slidev_videos import pipeline
    rec, deck = _recording(tmp_path, embed={})
    out = tmp_path / "talk.pptx"
    rc = pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264", "--json"])
    report = json.loads(capsys.readouterr().out)
    assert rc == 0, report
    assert (report["slides"], report["segments"], report["skipped"]) == (4, 4, [])
    [em] = report["embedded"]
    assert (em["slide"], em["clip"], em["video"], em["audio"]) == (3, "videos/clip.mp4", "copy", "copy")
    assert 1.9 < em["seconds"] < 2.2
    z = zipfile.ZipFile(out)
    x = z.read("ppt/slides/slide4.xml").decode()
    assert 'cmd="playFrom(0.0)"' in x and '<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>' in x
    assert re.search(r'<p:cTn id="6" dur="(19|20|21)\d\d" fill="hold"/>', x)          # the clip's own length
    assert 'vol="100000"' in x
    st = _probe(z.read(_slide_media(z, 4)[0]), tmp_path)
    assert (st["video"]["codec_name"], st["audio"]["codec_name"]) == ("h264", "aac")


@needs_ffmpeg
def test_a_muted_or_odd_shaped_clip(tmp_path, capsys):
    from slidev_videos import pipeline
    rec, deck = _recording(tmp_path, embed={"muted": True, "volume": 0})
    dist = tmp_path / "dist"
    _lavfi(dist / "videos" / "clip.mp4", "testsrc=s=64x48:r=10", "sine=frequency=440:sample_rate=48000", seconds=2)
    out = tmp_path / "talk.pptx"
    rc = pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264", "--json"])
    report = json.loads(capsys.readouterr().out)
    assert rc == 0, report
    assert (report["embedded"][0]["video"], report["embedded"][0]["audio"]) == ("encode", "none")
    st = _probe(zipfile.ZipFile(out).read(_slide_media(zipfile.ZipFile(out), 4)[0]), tmp_path)
    assert "audio" not in st and (st["video"]["width"], st["video"]["height"]) == (64, 36)   # cover-cropped to 16:9


@needs_ffmpeg
def test_a_clip_not_on_disk_comes_from_its_url_or_stops_the_build(tmp_path, capsys):
    import http.server
    import threading
    from functools import partial
    from slidev_videos import pipeline
    far = tmp_path / "far"
    far.mkdir()
    _lavfi(far / "remote.mp4", "testsrc=s=64x36:r=10", "sine=frequency=330:sample_rate=48000", seconds=1)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0),
                                          partial(http.server.SimpleHTTPRequestHandler, directory=str(far)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{srv.server_address[1]}/remote.mp4"
        rec, deck = _recording(tmp_path, embed={"src": url})
        out = tmp_path / "talk.pptx"
        rc = pipeline.main(["pptx", str(rec), "--deck", str(deck), "--out", str(out), "--encoder", "x264", "--json"])
        report = json.loads(capsys.readouterr().out)
        assert rc == 0, report
        assert report["embedded"][0]["clip"] == url and report["embedded"][0]["from"] == "url"
        assert 0.9 < report["embedded"][0]["seconds"] < 1.2
        (tmp_path / "b").mkdir()
        rec2, _ = _recording(tmp_path / "b", embed={"src": url.replace("remote", "gone")})
        assert pipeline.main(["pptx", str(rec2), "--deck", str(deck), "--out", str(tmp_path / "b.pptx"), "--encoder", "x264"]) == 1
        assert "gone.mp4" in capsys.readouterr().err
    finally:
        srv.shutdown()


def test_usage_failures_exit_2(tmp_path, monkeypatch, capsys):
    from slidev_videos import pipeline
    monkeypatch.chdir(tmp_path)                                   # no videos.toml: pptx needs none
    assert pipeline.main(["pptx", str(tmp_path / "nowhere")]) == 2
    assert "index.json" in capsys.readouterr().err
    (tmp_path / "rec").mkdir()
    (tmp_path / "rec" / "index.json").write_text('{"segments": []}', encoding="utf-8")
    monkeypatch.setitem(sys.modules, "pptx", None)                # python-pptx missing
    assert pipeline.main(["pptx", str(tmp_path / "rec")]) == 2
    assert 'pip install "slidev-videos[pptx]"' in capsys.readouterr().err
