"""deck.py: slides as Slidev numbers them, and each slide's speaker notes as plain text."""
from slidev_videos import deck

DECK = '''---
theme: ../../theme
layout: cover
space: { at: wide }
---

# Innoday

<!-- facts: a, b -->

<!--
Kalbėtojui. **Pavadinimo** skaidrė: „Laba diena.“
Sakyti: _trumpai_ apie `nftmc_zoom_web.mp4` ir [CERN](https://home.cern).

Antra pastraipa, ąčęėįšųūž.
-->

---
hide: true
---

# Hidden

<!-- not counted -->

---

<VideoPlayer src="lhcb.mp4" />

<!--
Klipas.
-->

---
clicks: 2
---

```md
---
not a separator inside a fence
---
```

<!--
Prieš paspaudimą.
[click] Pirmas paspaudimas.
[click] Antras <b>paspaudimas</b>.
-->

---

No notes here. <!-- an inline comment that does not end the slide --> trailing text
'''


def test_slides_are_numbered_as_slidev_numbers_them(tmp_path):
    p = tmp_path / "deck.md"
    p.write_text(DECK, encoding="utf-8")
    slides = deck.parse(p)
    assert [s.number for s in slides] == [1, None, 2, 3, 4]
    assert [s.hidden for s in slides] == [False, True, False, False, False]
    by = deck.notes_by_slide(p)
    assert sorted(by) == [1, 2, 3, 4]
    assert by[4] == ""                       # the comment does not end the slide


def test_notes_are_the_last_comment_and_plain_text(tmp_path):
    p = tmp_path / "deck.md"
    p.write_text(DECK, encoding="utf-8")
    by = deck.notes_by_slide(p)                 # the raw comment, markers and all
    assert by[1].startswith("Kalbėtojui. **Pavadinimo**")
    assert deck.notes_for(by, 1, 0, 0) == ("Kalbėtojui. Pavadinimo skaidrė: „Laba diena.“\n"
                     "Sakyti: trumpai apie nftmc_zoom_web.mp4 ir CERN.\n"
                     "\n"
                     "Antra pastraipa, ąčęėįšųūž.")
    assert deck.notes_for(by, 2, 0, 0) == "Klipas."
    assert "facts" not in by[1]


def test_click_notes_split_on_markers_or_repeat_with_a_click_line(tmp_path):
    p = tmp_path / "deck.md"
    p.write_text(DECK, encoding="utf-8")
    by = deck.notes_by_slide(p)
    assert deck.notes_for(by, 3, 0, 2) == "Prieš paspaudimą."
    assert deck.notes_for(by, 3, 1, 2) == "[click 1/2]\nPirmas paspaudimas."
    assert deck.notes_for(by, 3, 2, 2) == "[click 2/2]\nAntras paspaudimas."
    # no markers: the whole notes again, under the click line
    assert deck.notes_for(by, 2, 1, 1) == "[click 1/1]\nKlipas."
    # [click:N] places a part at click N; clicks without a part repeat the last
    raw = "Pradžia.\n[click:2] Antras.\n"
    assert deck.split_clicks(raw) == {0: "Pradžia.", 2: "Antras."}
    assert deck.notes_for({7: raw}, 7, 1, 3) == "[click 1/3]\nPradžia."
    assert deck.notes_for({7: raw}, 7, 3, 3) == "[click 3/3]\nAntras."
    assert deck.notes_for({}, 9, 0, 0) == ""     # a slide past the deck's end


def test_notes_text_strips_markdown_and_html_only():
    md = "<!--\n**Bold**, *em*, __b__, _i_, `code`, [t](u), <span class=\"x\">tag</span>, a_b_c, 2 * 3\n-->"
    assert deck.notes_text(md) == "Bold, em, b, i, code, t, tag, a_b_c, 2 * 3"
