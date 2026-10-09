// Which groups of photo places show on a slide (StagePhoto mode="place"
// group="…"). A slide's frontmatter says it, and it holds from there on:
//
//   places: { inventions: true }     # show the group from this slide on
//   places: { inventions: false }    # hide it from this slide on
//   places: inventions               # = { inventions: true }; a list shows several
//
// Before the first slide that names a group, the group is the opposite of
// what that slide says: one `places: { inventions: true }` on Part II's first
// slide keeps Part I clear of them. A group no slide names always shows. The
// state is worked out from the slide list, not from the way the deck got
// there, so going back or jumping lands on the right one.
const OFF = new Set(['false', 'off', 'hide', 'hidden', 'no', '0']);

// a slide's `places:` → { group: boolean }, or null
export function placesDecl(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return Object.fromEntries(v.split(/[\s,]+/).filter(Boolean).map((g) => [g, true]));
  if (Array.isArray(v)) return Object.fromEntries(v.map((g) => [String(g), true]));
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([g, on]) => [g, !(on === false || on === 0 || OFF.has(String(on).toLowerCase()))]));
  return null;
}

// decls: one per slide, in order (null where the slide says nothing).
// no: the slide's 1-based number. → { group: boolean } for every group named anywhere.
export function placeGroupsAt(decls, no) {
  const out = {}, first = {};
  decls.forEach((d, i) => {
    for (const [g, on] of Object.entries(placesDecl(d) || {})) {
      if (!(g in first)) first[g] = on;
      if (i < no) out[g] = on;
    }
  });
  for (const g of Object.keys(first)) if (!(g in out)) out[g] = !first[g];
  return out;
}
