"""A Slidev deck's slides and speaker notes, as `slidev-videos pptx` needs them.

Slides are cut by Slidev's grammar: a `---` line, with a frontmatter block
when the next line is not blank; a `---` inside a code fence is no
separator. A slide with `hide` or `disabled` in its frontmatter is not
numbered (Slidev drops it from the route), so the numbers here are the ones
the recorder's `index.json` uses. A slide's notes are its last HTML comment
when that comment ends the slide (a `<!-- facts: … -->` comment above them is
not the notes). Ported from outreach_talks' scripts/talk_deck.py.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

_COMMENT = re.compile(r"<!--([\s\S]*?)-->")
_HIDDEN = re.compile(r"^(hide|disabled)\s*:\s*(true|yes|on)\s*(#.*)?$", re.M | re.I)
_CLICK = re.compile(r"\[click(?::(\d+))?\]")


@dataclass
class Slide:
    index: int                 # 0-based position in the file
    number: int | None         # as Slidev numbers it; None when hidden
    frontmatter: str           # the raw YAML block ("" when none)
    content: str               # everything after the frontmatter
    notes: str                 # the raw notes comment's inside ("" when none)

    @property
    def hidden(self) -> bool:
        return bool(_HIDDEN.search(self.frontmatter))


def parse(path: Path) -> list[Slide]:
    lines = Path(path).read_text(encoding="utf-8").split("\n")
    spans: list[tuple[int, int, int, tuple[int, int] | None]] = []   # (start, content start, end, frontmatter)
    start = content_start = 0
    fm: tuple[int, int] | None = None

    def cut(end: int) -> None:
        nonlocal start, content_start, fm
        if start != end:
            spans.append((start, content_start, end, fm))
        start = content_start = end + 1
        fm = None

    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if line.startswith("---"):
            cut(i)
            nxt = lines[i + 1] if i + 1 < len(lines) else None
            if line[3:4] != "-" and nxt is not None and nxt.strip():
                start = i
                j = i + 1
                while j < len(lines) and lines[j].rstrip() != "---":
                    j += 1
                fm = (i + 1, j)
                i = j
                content_start = i + 1
        elif line.lstrip().startswith("```"):
            fence = re.match(r"^\s*`+", line).group(0).strip()
            j = i + 1
            while j < len(lines) and not lines[j].lstrip().startswith(fence):
                j += 1
            if j != len(lines):
                i = j
        i += 1
    if start <= len(lines) - 1:
        cut(len(lines))

    slides: list[Slide] = []
    number = 0
    for idx, (s, cs, e, f) in enumerate(spans):
        content = "\n".join(lines[cs:e])
        comments = list(_COMMENT.finditer(content))
        notes = ""
        if comments and comments[-1].end() >= len(content.rstrip()):
            notes = comments[-1].group(1).strip()
        slide = Slide(idx, None, "\n".join(lines[f[0]:f[1]]) if f else "", content, notes)
        if not slide.hidden:
            number += 1
            slide.number = number
        slides.append(slide)
    return slides


def notes_text(md: str) -> str:
    """Notes as plain text: the comment marks, HTML tags, emphasis, code
    ticks and link targets dropped; lines and paragraphs kept; the words
    (Lithuanian included) untouched."""
    t = md.replace("<!--", "").replace("-->", "")
    t = re.sub(r"</?[A-Za-z][^<>]*>", "", t)
    t = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"\*\*(\S(?:.*?\S)?)\*\*", r"\1", t)
    t = re.sub(r"(?<!\w)__(\S(?:.*?\S)?)__(?!\w)", r"\1", t)
    t = re.sub(r"(?<![\w*])\*(\S(?:[^*]*?\S)?)\*(?![\w*])", r"\1", t)
    t = re.sub(r"(?<!\w)_(\S(?:[^_]*?\S)?)_(?!\w)", r"\1", t)
    t = re.sub(r"`+([^`]*)`+", r"\1", t)
    lines = [ln.rstrip() for ln in t.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def notes_by_slide(path: Path) -> dict[int, str]:
    """{slide number: its raw notes} for every numbered slide ("" when none)."""
    return {s.number: s.notes for s in parse(path) if s.number is not None}


def split_clicks(raw: str) -> dict[int, str]:
    """Raw notes cut at Slidev's `[click]` / `[click:N]` markers → {click: plain text}."""
    parts: dict[int, str] = {}
    at, pos = 0, 0
    for m in _CLICK.finditer(raw):
        parts[at] = raw[pos:m.start()]
        at = int(m.group(1)) if m.group(1) else at + 1
        pos = m.end()
    parts[at] = raw[pos:]
    return {k: notes_text(v) for k, v in parts.items() if notes_text(v) or k == 0}


def notes_for(notes: dict[int, str], slide: int, click: int, clicks: int) -> str:
    """The notes of one segment: the slide's own at click 0; at click K of N
    a `[click K/N]` line, then the part from the markers (the last part at or
    before K), or the whole notes again when there are none."""
    raw = notes.get(slide, "")
    if not click:
        return split_clicks(raw).get(0, "") if _CLICK.search(raw) else notes_text(raw)
    if _CLICK.search(raw):
        parts = split_clicks(raw)
        body = parts[max(k for k in parts if k <= click)]
    else:
        body = notes_text(raw)
    head = f"[click {click}/{max(clicks, click)}]"
    return f"{head}\n{body}" if body else head
