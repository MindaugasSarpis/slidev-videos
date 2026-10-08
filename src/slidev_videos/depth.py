"""`slidev-videos depth`: a depth map per photograph, for StagePhoto's `depth`.

    slidev-videos depth public/figures/a.jpg public/figures/b.jpg [--size 1024] [--force]

Writes <image>.depth.png beside each image: 8-bit grey, white = near, the
image's aspect, its long side at most --size. The browser only reads it; the
picture itself is never changed. Depth Anything V2 Small (Apache-2.0), the
ONNX export from onnx-community, runs on the CPU through onnxruntime: one
image takes seconds, so run it once per image through the render slot
(`pnpm talk render -- slidev-videos depth …`) and commit the maps.

Needs the `depth` extra: onnxruntime, numpy, pillow, huggingface_hub
(`pip install "slidev-videos[depth]"`). The model (~100 MB) is fetched once
into the Hugging Face cache.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

MODEL_REPO = "onnx-community/depth-anything-v2-small"
MODEL_FILE = "onnx/model.onnx"
LOWER = 518            # the model's input: both sides at least this, multiples of 14
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)


def depth_path(image: Path) -> Path:
    return image.with_name(image.stem + ".depth.png")


def _need():
    try:
        import numpy as np  # noqa: F401
        import onnxruntime  # noqa: F401
        from PIL import Image  # noqa: F401
        from huggingface_hub import hf_hub_download  # noqa: F401
    except ImportError as e:
        raise SystemExit(f"slidev-videos depth needs the depth extra ({e.name} is missing): "
                         'pip install "slidev-videos[depth]"  (onnxruntime numpy pillow huggingface_hub)')


def _session(threads: int):
    import onnxruntime as ort
    from huggingface_hub import hf_hub_download
    model = hf_hub_download(MODEL_REPO, MODEL_FILE)
    so = ort.SessionOptions()
    if threads > 0:
        so.intra_op_num_threads = threads
    return ort.InferenceSession(model, sess_options=so, providers=["CPUExecutionProvider"])


def _input_size(w: int, h: int) -> tuple[int, int]:
    # keep the aspect, both sides at least LOWER, each a multiple of 14
    k = max(LOWER / w, LOWER / h)
    return (max(LOWER, int(round(w * k / 14)) * 14), max(LOWER, int(round(h * k / 14)) * 14))


def estimate(sess, image_path: Path, size: int):
    """→ a PIL 'L' image: relative depth, white = near, the image's aspect, long side ≤ size."""
    import numpy as np
    from PIL import Image
    img = Image.open(image_path).convert("RGB")
    w, h = img.size
    iw, ih = _input_size(w, h)
    x = np.asarray(img.resize((iw, ih), Image.BICUBIC), dtype=np.float32) / 255.0
    x = (x - np.array(MEAN, np.float32)) / np.array(STD, np.float32)
    x = x.transpose(2, 0, 1)[None]
    name = sess.get_inputs()[0].name
    d = sess.run(None, {name: x})[0][0]          # relative inverse depth: larger is nearer
    lo, hi = np.percentile(d, 1), np.percentile(d, 99)
    d = np.clip((d - lo) / max(hi - lo, 1e-6), 0, 1)
    k = min(1.0, size / max(w, h))
    out = (max(1, round(w * k)), max(1, round(h * k)))
    dm = Image.fromarray((d * 255).astype(np.uint8), "L").resize(out, Image.BICUBIC)
    return dm


def cmd_depth(args: argparse.Namespace) -> int:
    images = [Path(p) for p in args.images]
    missing = [p for p in images if not p.is_file()]
    if missing:
        print("error: no such image: " + ", ".join(map(str, missing)), file=sys.stderr)
        return 2
    _need()
    from PIL import PngImagePlugin
    todo = []
    for p in images:
        out = depth_path(p)
        if not args.force and out.is_file() and out.stat().st_mtime >= p.stat().st_mtime:
            print(f"{out}: up to date")
            continue
        todo.append(p)
    if not todo:
        return 0
    threads = args.threads or int(os.environ.get("SLURM_CPUS_PER_TASK") or 0)
    sess = _session(threads)
    for p in todo:
        t0 = time.monotonic()
        dm = estimate(sess, p, args.size)
        meta = PngImagePlugin.PngInfo()
        meta.add_text("slidev-videos", f"depth of {p.name}; {MODEL_REPO}; white = near")
        out = depth_path(p)
        dm.save(out, pnginfo=meta, optimize=True)
        print(f"{out}: {dm.size[0]}x{dm.size[1]} in {time.monotonic() - t0:.1f} s")
    return 0


def add_parser(sub) -> None:
    p = sub.add_parser("depth", help="depth maps for StagePhoto's depth: <image>.depth.png beside each image (CPU, Depth Anything V2 Small)")
    p.add_argument("images", nargs="+", help="photographs, e.g. public/figures/*.jpg")
    p.add_argument("--size", type=int, default=1024, help="long side of the map in px (default 1024)")
    p.add_argument("--force", action="store_true", help="redo maps that are newer than their image")
    p.add_argument("--threads", type=int, default=0, help="CPU threads (default: SLURM_CPUS_PER_TASK, else all)")
    p.set_defaults(func=cmd_depth)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="slidev-videos")
    add_parser(parser.add_subparsers(dest="cmd", required=True))
    args = parser.parse_args(["depth", *argv])
    return args.func(args)
