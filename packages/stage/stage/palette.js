// The stage's colours, in one place. A deck picks a named palette or gives its
// own keys over one:
//
//   stage:
//     palette: blue                      # a name from PALETTES
//     palette: { base: blue, accent: '#6aa2ff' }   # or a base with overrides
//
// Every colour the engine draws with comes from here: the page ground and its
// two glows, the dust at rest and at speed, the lights, the rims and halos,
// the label inks. The same values reach CSS as --stage-* custom properties on
// <html>, so slide styles, panels and the halo layer stay in step.

export const PALETTES = {
  // Startertalk's: near-black ground, cyan accent, dust from dim cyan to white.
  classic: {
    bg: '#050507',
    fg: '#f2f5f9',
    dim: '#8b97a6',
    accent: '#7dd3fc',
    dust: '#4d8cb8',
    dustBright: '#fafcff',
    sky: '#7dd3fc',        // hemisphere light from above
    ground: '#0a0c14',     // … and from below
    fill: '#9fd8ff',       // the point light that rides the look target
    highlight: '#dff1ff',  // the shell round a lit stop
    ink: '#e6e9ee',        // labels on objects
    paper: '#5c6066',      // a page's albedo tint
    nebula: '#3a7fa8',     // far clouds behind the dust (drawn when the look's `nebula` > 0) …
    nebulaAlt: '#5a4a9c',  // … shading into this
  },
  // Deeper and bluer: an ultramarine dust over a blue-black ground.
  blue: {
    bg: '#03050d',
    fg: '#f1f5ff',
    dim: '#8794b3',
    accent: '#5b93ff',
    dust: '#2c5fe0',
    dustBright: '#d6e4ff',
    sky: '#4f86ff',
    ground: '#05070f',
    fill: '#7fa8ff',
    highlight: '#d9e6ff',
    ink: '#e3eaf8',
    paper: '#565d6e',
    nebula: '#2447c8',
    nebulaAlt: '#6a3fd0',
  },
  // Warm: amber dust over a brown-black ground.
  ember: {
    bg: '#080504',
    fg: '#fbf4ec',
    dim: '#a8988a',
    accent: '#ffb168',
    dust: '#b8683a',
    dustBright: '#fff3e2',
    sky: '#ffb877',
    ground: '#120a07',
    fill: '#ffc998',
    highlight: '#ffe9d2',
    ink: '#f1e7dc',
    paper: '#66605a',
    nebula: '#c4562a',
    nebulaAlt: '#8a2f4f',
  },
};

// What goes with a palette besides its colours: engine options a deck gets
// with the name unless it sets them itself (`stage.options`). The classic
// look is Startertalk's, and stays as it was: no nebula.
export const LOOKS = {
  classic: { nebula: 0 },
  blue: { nebula: 0.8 },
  ember: { nebula: 0.7 },
};
export function resolveLook(input) {
  const name = typeof input === 'string' ? input : (input && typeof input === 'object' ? input.base : null);
  return { ...(LOOKS[name] || {}) };
}

export const DEFAULT_PALETTE = PALETTES.classic;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function definePalette(name, colours) {
  PALETTES[name] = { ...DEFAULT_PALETTE, ...colours };
  return PALETTES[name];
}

// 'blue' | { base?: 'blue', accent: '#…', … } | undefined → a full palette.
// Unknown names and malformed colours fall back, key by key, to the base.
export function resolvePalette(input) {
  let base = DEFAULT_PALETTE, over = {};
  if (typeof input === 'string') base = PALETTES[input] || DEFAULT_PALETTE;
  else if (input && typeof input === 'object') {
    if (typeof input.base === 'string' && PALETTES[input.base]) base = PALETTES[input.base];
    over = input;
  }
  const out = { ...DEFAULT_PALETTE, ...base };
  for (const k of Object.keys(DEFAULT_PALETTE)) {
    const v = over[k];
    if (typeof v === 'string' && HEX.test(v.trim())) out[k] = v.trim();
  }
  return out;
}

export function hexToRgb(hex) {
  const m = HEX.exec(String(hex || '').trim());
  if (!m) return [1, 1, 1];
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// '#7dd3fc' → '125, 211, 252', for rgba(var(--stage-accent-rgb), a)
export const rgbTriplet = (hex) => hexToRgb(hex).map((v) => Math.round(v * 255)).join(', ');

// The palette as CSS custom properties.
export function paletteVars(p) {
  return {
    '--stage-bg': p.bg,
    '--stage-fg': p.fg,
    '--stage-dim': p.dim,
    '--stage-accent': p.accent,
    '--stage-bg-rgb': rgbTriplet(p.bg),
    '--stage-accent-rgb': rgbTriplet(p.accent),
  };
}
