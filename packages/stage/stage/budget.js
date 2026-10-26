// How many grains a slide lights, for slidev-stage-check's `grain-budget`
// warning. Užsikrauk karjerai's finale (Oct 2026) drew ~1.1M additive grains at
// tier 0 on an M2 and went white; ~600k is what a laptop GPU carries there.
// An estimate from the space and the deck alone: the dust field, every object
// no step drives, and each stepped object on the slides where its step is above 0.
// Plain data, no three.js: the validator reads it under node; test/budget.test.mjs
// holds the tables to the engine's (space.js TIERS, clock.js BUDGETS).

// lit grains a slide may carry, by tier
export const GRAIN_BUDGET = [600000, 320000, 120000, 60000];
// space.js TIERS[].sim: the dust field's side at most, by tier
export const TIER_SIM = [448, 256, 192, 128];
// clock.js BUDGETS: the grains one builder may draw, by tier
export const FORM_BUDGET = [300000, 160000, 60000, 30000];
// the lhcb plugin's data by name (plugins/lhcb.js DATA): grains in the file
export const DATA_GRAINS = { lhcb: 93000, 'lhcb-dense': 446400 };
// what a step of these types follows when the object names no `of` (plugins/lhcb.js)
const STEP_KEY = { floor: 'det', supports: 'det' };

const tierOf = (t) => Math.max(0, Math.min(GRAIN_BUDGET.length - 1, Math.round(Number(t) || 0)));
// the most a desktop builds (space.js pickTexSize: 352 on the most cores), at most the tier's side
export const dustGrains = (tier) => Math.min(TIER_SIM[tierOf(tier)], 352) ** 2;
// readGrains' every k-th grain, k to keep within the budget
const thinned = (n, budget) => { const k = Math.max(1, Math.ceil(n / Math.max(1, budget))); return Math.ceil(n / k); };

// One object's grains at a tier, or null when nothing says (a deck's own type
// without `grains`). fileBytes(src) → bytes of a deck's own .bin, or null.
export function grainsOf(o, { tier = 0, fileBytes = () => null } = {}) {
  const t = tierOf(tier), budget = FORM_BUDGET[t];
  switch (o?.type) {
    case 'detector': {
      const src = o.src || 'lhcb';
      const n = DATA_GRAINS[src] ?? Math.floor((fileBytes(src) || 0) / 8);
      return thinned(n, budget);
    }
    case 'emblem': return Math.round((o.grains ?? 26000) * Math.min(1, budget / 300000) ** 0.5);
    case 'floor': return o.grains ?? 18000;
    case 'supports': return o.grains ?? 16000;
    case 'galaxy': return Math.max(2000, Math.min(160000, Math.round(o.grains || 80000)));
    default: return Number.isFinite(Number(o?.grains)) && o.grains !== null ? Number(o.grains) : null;
  }
}
// the step key an object follows: its `of`, its `name`, or its type's default
export const stepKey = (o) => o?.of ?? STEP_KEY[o?.type] ?? o?.name ?? null;

// The steps in force on each slide, from <StageSteps :set="{…}"> and a talk's own
// <Grains :set="{…}">, carried forward; a :clicks="{ k: {…} }" part counts at the slide's
// last click (the heaviest it gets). bodies: each slide's text → [{ name: step }, …]
const TAG = /<(?:StageSteps|Grains)\b([^>]*?)\/?>/g;
const PAIR = /([A-Za-z_$][\w$]*|'[^']*'|"[^"]*")\s*:\s*(-?\d+(?:\.\d+)?)/g;
const pairs = (s) => Object.fromEntries([...String(s).matchAll(PAIR)].map((m) => [m[1].replace(/^['"]|['"]$/g, ''), Number(m[2])]));
export function slideSteps(bodies) {
  const out = [];
  let now = {};
  for (const body of bodies) {
    const text = String(body ?? '').replace(/<!--[\s\S]*?-->/g, '');
    now = { ...now };
    for (const [, attrs] of text.matchAll(TAG)) {
      const set = /:set="([^"]*)"/.exec(attrs);
      if (set) Object.assign(now, pairs(set[1]));
      const clicks = /:clicks="([^"]*)"/.exec(attrs);
      if (clicks) {
        const parts = [...clicks[1].matchAll(/(\d+)\s*:\s*\{([^}]*)\}/g)].sort((a, b) => Number(a[1]) - Number(b[1]));
        for (const [, , inner] of parts) Object.assign(now, pairs(inner));
      }
    }
    out.push(now);
  }
  return out;
}

// The grains lit on a slide: the dust, every object no step drives (its key never
// stepped in the deck: `stepped`), and the stepped ones whose step is above 0.
// → { total, top: [{ name, grains }] heaviest first, uncounted: [type, …] }
export function litGrains({ objects = [], steps = {}, tier = 0, stepped = new Set(), fileBytes } = {}) {
  const parts = [{ name: 'dust', grains: dustGrains(tier) }];
  const uncounted = [];
  for (const o of objects) {
    const key = stepKey(o);
    if (key != null && stepped.has(key) && !(Number(steps[key]) > 0)) continue;
    const n = grainsOf(o, { tier, fileBytes });
    if (n == null) { uncounted.push(o.type); continue; }
    parts.push({ name: o.name ?? o.id ?? o.type, grains: n });
  }
  parts.sort((a, b) => b.grains - a.grains);
  return { total: parts.reduce((s, p) => s + p.grains, 0), top: parts, uncounted };
}

// 1 100 000 → '1.1M', 223 200 → '223k'
export const grainCount = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1000)}k`);
