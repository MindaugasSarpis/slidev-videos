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
//
// A look can also be asked for on its own, over any palette (`stage.look`).
// `broadcast` is for a deck that is filmed, recorded or streamed: an encoder
// at a few Mbit/s turns film grain, colour fringes, fine dust and twinkle into
// block noise, so the finish is clean, the dust fewer and larger, the flights
// slower, the halo off; the ground is lifted off near-black, which bands on a
// stream; and the frame-rate guard is off, so a slow moment never drops the
// resolution mid-take. `max` caps what the palette's own look brings (blue's
// nebula is 0.8). Keys the engine does not know are read by the Stage
// component: `halo` (the dust borders), `lift` (see liftGround).
export const LOOKS = {
  classic: { nebula: 0 },
  blue: { nebula: 0.8 },
  ember: { nebula: 0.7 },
  broadcast: {
    grain: 0, aberration: 0,
    density: 0.6, dustSize: 2.85,   // 1.5 × the default 1.9: a grain still reads at 720p
    streak: 0.4, bloom: 0.45, flight: [2.5, 5],
    twinkle: 0.35, guard: false, halo: false,
    lift: 0.06,                     // blue's #03050d → #090f1d, the ground the banding was measured on
    max: { nebula: 0.3 },
  },
};

// The options a deck's palette and look give it: the palette's look, then the
// named look over it, then that look's caps. `stage.options` win over both
// (the Stage component lays them on last).
export function resolveLook(palette, look) {
  const name = typeof palette === 'string' ? palette : (palette && typeof palette === 'object' ? palette.base : null);
  const { max: _, ...out } = LOOKS[name] || {};
  const named = typeof look === 'string' ? LOOKS[look] : null;
  if (named) {
    const { max, ...set } = named;
    Object.assign(out, set);
    for (const [k, cap] of Object.entries(max || {})) {
      if (Number.isFinite(Number(out[k]))) out[k] = Math.min(Number(out[k]), cap);
    }
  }
  return out;
}

export const DEFAULT_PALETTE = PALETTES.classic;

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

// definePalette('venue', { accent: '#…', … }, { nebula: 0.5 }): the third
// argument, when given, is the look that comes with the name.
export function definePalette(name, colours, look) {
  PALETTES[name] = { ...DEFAULT_PALETTE, ...colours };
  if (look && typeof look === 'object') LOOKS[name] = { ...look };
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

// sRGB (0..1) ↔ OKLab, Björn Ottosson's: L is the lightness as seen, a and b
// the colour.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ].map(fromLinear);
}

// The ground raised `amount` (0..1) of the way to white in lightness, its
// hue and saturation kept: the same colour under more light, whatever the
// accent and the dust are. Blue's #03050d at 0.06 is #090f1d; a near-neutral
// ground stays near-neutral, a warm one warm. Near white the colour would
// leave sRGB, and gives up as much of its colour as it must to stay in (at 1
// the ground is white). The page, the scrim and the cards all take their
// dark from `bg`, so all of them are lifted together.
export function liftGround(p, amount) {
  const k = Math.min(1, Math.max(0, Number(amount) || 0));
  if (!k) return p;
  const [L, a, b] = toOklab(hexToRgb(p.bg));
  const L2 = L + (1 - L) * k;
  // a and b grow with L (the colour's share of its lightness held), unless
  // that falls outside sRGB
  const fits = (c) => fromOklab([L2, a * c, b * c]).every((v) => v > -1e-6 && v < 1 + 1e-6);
  let c = L > 1e-6 ? L2 / L : 0;
  if (!fits(c)) {
    let lo = 0, hi = c;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    c = lo;
  }
  const hex = fromOklab([L2, a * c, b * c]).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
  return { ...p, bg: `#${hex}` };
}

// The palette as CSS custom properties.
export function paletteVars(p) {
  return {
    '--stage-bg': p.bg,
    '--stage-fg': p.fg,
    '--stage-dim': p.dim,
    '--stage-accent': p.accent,
    '--stage-dust': p.dust,
    '--stage-nebula': p.nebula,
    '--stage-bg-rgb': rgbTriplet(p.bg),
    '--stage-accent-rgb': rgbTriplet(p.accent),
  };
}
