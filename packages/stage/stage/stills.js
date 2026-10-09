// A still of the world per slide, for where the live world cannot run: print
// and PDF export (Slidev mounts the stage once per page there, and a deck of
// thirty pages would ask for thirty WebGL contexts), and the static fallback
// (no float targets, reduced motion, a lost context). `slidev-stage-shots
// --stills` writes them from a real render, without the slide's own text,
// which the page draws over them as usual: public/stills/01.jpg, 02.jpg, …
//
//   stage:
//     stills: stills        # the folder under public/ (default); false: none
//
// A slide without a still shows the static gradient, as before.

// `stage.stills` → the folder ('' when off)
export function stillsDir(cfg) {
  if (cfg === false || cfg === 'false' || cfg === null) return '';
  const d = typeof cfg === 'string' && cfg.trim() ? cfg.trim() : 'stills';
  return d.replace(/^\/+|\/+$/g, '');
}

// slide no → its still's URL under the deck's base
export function stillUrl(dir, no, base = '/') {
  if (!dir || !(Number(no) >= 1)) return '';
  const b = String(base || '/').replace(/\/?$/, '/');
  return `${b}${dir}/${String(Math.round(Number(no))).padStart(2, '0')}.jpg`;
}

// the file a slide's still is written to
export const stillName = (no) => `${String(no).padStart(2, '0')}.jpg`;

// Is this stage a print page? Slidev's print route renders every slide in a
// .print-slide-container, each with its own global layers; ?print marks the
// export's own load.
export function inPrint(el, loc = globalThis.location, doc = globalThis.document) {
  if (el?.closest?.('.print-slide-container')) return true;
  if (doc?.documentElement?.classList?.contains('print')) return true;
  try { return new URLSearchParams(loc?.search || '').has('print'); } catch { return false; }
}

// `--range` as Slidev reads it: "3-5", "1,4,7-9", "5-" (to the end), "all"
export function rangeList(spec, total) {
  const s = String(spec ?? '').trim();
  if (!s || s === 'all' || s === '*') return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (const part of s.split(/[,\s]+/)) {
    const m = /^(\d+)?(?:(-)(\d+)?)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) continue;
    const a = m[1] ? Number(m[1]) : 1, b = m[2] ? (m[3] ? Number(m[3]) : total) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= total) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}
