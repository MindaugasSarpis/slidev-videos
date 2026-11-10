// Colours: palettes for heights, and named tokens that follow a deck's theme.

// viridis at 20 evenly spaced stops.
const VIRIDIS = ['#440154', '#481567', '#482677', '#453781', '#404788', '#39568c', '#33638d', '#2d708e', '#287d8e', '#238a8d',
  '#1f968b', '#20a387', '#29af7f', '#3cbb75', '#55c667', '#73d055', '#95d840', '#b8de29', '#dce319', '#fde725'];
export const PALETTES = { viridis: VIRIDIS };

export function hexRGB(h) { return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)); }

/** A palette (a name or a list of hex stops) as `steps` RGB triples. */
export function ramp(palette = 'viridis', steps = 64) {
  const stops = (Array.isArray(palette) ? palette : PALETTES[palette]);
  if (!stops) throw new Error(`explain3d: no palette "${palette}"`);
  const rgb = stops.map(hexRGB);
  const out = [];
  for (let s = 0; s < steps; s++) {
    const t = (s / (steps - 1)) * (rgb.length - 1);
    const i = Math.min(rgb.length - 2, Math.floor(t));
    const f = t - i;
    out.push(rgb[i].map((v, k) => v + (rgb[i + 1][k] - v) * f));
  }
  return out;
}

// Tokens: the deck's CSS variable when there is one, else the value here (the
// course's dark theme), which a static SVG uses as it stands.
export const TOKENS = {
  bg: '#050507', fg: '#f2f5f9', 'fg-2': '#c3ccd8', dim: '#8b97a6', accent: '#7dd3fc',
  warn: '#fbbf24', ok: '#2dd4bf', hair: 'rgba(139,151,166,0.18)', 'hair-strong': 'rgba(139,151,166,0.34)',
  // the series colours of the course's static figures, in their order (the first is the accent)
  c0: '#7dd3fc', c1: '#f8b64f', c2: '#6edb98', c3: '#e88bc0', c4: '#8a9cfc', c5: '#f1e075', c6: '#e67502',
};

// The look of every explainer, one place: the look of the course's static
// figures (serif figure type, text and ticks in the text colour, tick labels
// 13.75 px and axis names 15.625 px on a 980 px slide, ticks 6.25 px, the
// colour key edged 1 px), with the box's edges faint. The component's CSS
// reads the same numbers through variables a deck may set.
export const LOOK = {
  font: "'Figure Serif', 'STIX Two Text', 'STIXGeneral', 'Times New Roman', serif",
  tick: 13.75, name: 15.625, tickLen: 6.25, tickOff: 13, nameOff: 34,
};

/** A colour of a spec: a token name or any CSS colour. live: as var(--token, value). */
export function color(c, live = false) {
  if (c == null) return undefined;
  if (!(c in TOKENS)) return c;
  return live ? `var(--x3d-${c}, var(--${c}, ${TOKENS[c]}))` : TOKENS[c];
}
