#!/usr/bin/env node
// Validate a deck's stage: the space file, the headmatter `stage:` block, and
// every pose and stop the deck's slides ask for. Run it after editing any.
//
//   slidev-stage-check [deck-dir] [--deck deck.md] [--space data/space.json]
//                      [--records data/records.json] [--plugins hadron] [--types beacon,arc] [--json]
//
// Without flags it reads the headmatter's `stage:` block, and finds the
// object types the deck registers itself in its setup/*.{js,ts,mjs,mts}:
// registerBuilder('<type>', fn, { fields: [...] }) gives the type and its
// fields. `--types` names more (each needing `pos` only).
//
// A problem names its slide when it has one (slides counted as Slidev counts
// them: hidden ones are not) and carries a code:
//
//   unknown-type        an object whose type has no builder: core, plugin or the deck's own
//   missing-field       an object without a field its type needs
//   bad-vector          a pos or look.target that is not [x, y, z]
//   bad-src, missing-file   a page's image: not written /…, or not under public/
//   duplicate-station   a station id missing or used twice
//   missing-look        a station without look.dist
//   unknown-record      an object standing for a record the records file lacks
//   unknown-station     space.hero, a named pose or a slide's `at` names nothing
//                       (a slide's `at` is `unknown-pose` when the nearest name is a named pose)
//   unknown-pose
//   missing-anchor      a stop that is no anchor in the space
//   bad-pose            a slide's dist, yaw, pitch, sway or dim out of range
//   unknown-plugin      stage.plugins names a plugin the package does not ship
//   unknown-palette     stage.palette (or its base, or a key of it) is no palette
//   bad-colour          a palette colour that is not #rgb or #rrggbb
//   unknown-option      a stage.options key the engine does not read
//   camera-inside-form  (warning) a slide's camera stands inside an object's radius
//   unknown-key         (warning) a key of `stage:` or of a slide's `space:` nothing reads
//   unknown-component   (warning) a <Count> tag, and no Count the deck registers itself:
//                       the addon's counter is <StageCount> (a talk's own Count.vue removed, a tag not renamed)
//
// Exit 1 on any error; warnings do not fail. --json prints
// { ok, problems: [{ slide?, line?, station?, code, level, msg }], stats } to stdout.
import { readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CORE_TYPES, PLUGIN_TYPES, STAGE_KEYS, OPTION_KEYS, SPACE_KEYS, anchorIds } from '../stage/types.js';
import { PALETTES, DEFAULT_PALETTE } from '../stage/palette.js';

const DECK_NAMES = ['deck.md', 'slides.md'];
const SETUP_FILE = /\.(js|ts|mjs|mts)$/;

// ---- YAML, as far as frontmatter goes -------------------------------------------
// Block maps and lists by indentation, flow maps and lists, plain and quoted
// scalars, numbers, booleans, null, `#` comments, `|` and `>` blocks (kept as
// text). Not a YAML parser: no anchors, tags or multi-line flow collections.
export function readYaml(text) {
  const lines = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const t = stripComment(raw);
    if (t.trim()) lines.push({ ind: t.length - t.trimStart().length, text: t.trim() });
  }
  return lines.length ? block(lines, 0, 0)[0] : null;
}
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { if (i === 0 || /[\s[{,:]/.test(line[i - 1])) q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i).trimEnd();
  }
  return line.trimEnd();
}
const KEY = /^("[^"]*"|'[^']*'|[^\s"'#[{,][^:]*?):(?:\s+(.*))?$/;
const isItem = (t) => t === '-' || t.startsWith('- ');
function block(ls, i, min) {
  if (i >= ls.length || ls[i].ind < min) return [null, i];
  const ind = ls[i].ind;
  if (isItem(ls[i].text)) {
    const out = [];
    while (i < ls.length && ls[i].ind === ind && isItem(ls[i].text)) {
      const rest = ls[i].text.slice(1).trim();
      if (!rest) { const [v, j] = block(ls, i + 1, ind + 1); out.push(v); i = j; continue; }
      if (KEY.test(rest) && !/^[[{]/.test(rest)) {
        // `- key: value` opens a map; its other keys sit deeper than the dash
        const sub = [{ ind: 0, text: rest }];
        let j = i + 1;
        for (; j < ls.length && ls[j].ind > ind; j++) sub.push({ ind: ls[j].ind - ind - 2, text: ls[j].text });
        out.push(block(sub, 0, 0)[0]); i = j; continue;
      }
      out.push(value(rest)); i++;
    }
    return [out, i];
  }
  const out = {};
  while (i < ls.length && ls[i].ind === ind) {
    const m = KEY.exec(ls[i].text);
    if (!m) { i++; continue; }
    const key = unquote(m[1].trim()), rest = (m[2] ?? '').trim();
    if (rest === '') { const [v, j] = block(ls, i + 1, ind + 1); out[key] = v; i = j; continue; }
    if (/^[|>][+-]?$/.test(rest)) {
      let j = i + 1; const parts = [];
      for (; j < ls.length && ls[j].ind > ind; j++) parts.push(ls[j].text);
      out[key] = parts.join(rest[0] === '|' ? '\n' : ' '); i = j; continue;
    }
    out[key] = value(rest); i++;
  }
  return [out, i];
}
// a scalar, or a flow collection: { at: [1, 2, 3], dist: 7 }
function value(s) {
  s = s.trim();
  if (!/^[[{]/.test(s)) return scalar(s);
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const token = (stops) => {
    ws();
    if (s[i] === '"' || s[i] === "'") { const q = s[i]; const j = s.indexOf(q, i + 1); const t = s.slice(i, j < 0 ? s.length : j + 1); i = j < 0 ? s.length : j + 1; ws(); return t; }
    let j = i;
    while (j < s.length && !stops.includes(s[j])) j++;
    const t = s.slice(i, j).trim(); i = j; return t;
  };
  const node = (stops) => {
    ws();
    if (s[i] === '{') {
      i++; const o = {};
      for (ws(); i < s.length && s[i] !== '}'; ws()) {
        const k = token(':,}');
        if (s[i] !== ':') { if (k) o[unquote(k)] = null; if (s[i] === ',') i++; continue; }
        i++; o[unquote(k)] = node(',}'); ws();
        if (s[i] === ',') i++;
      }
      i++; return o;
    }
    if (s[i] === '[') {
      i++; const a = [];
      for (ws(); i < s.length && s[i] !== ']'; ws()) {
        const start = i;
        a.push(node(',]')); ws();
        if (s[i] === ',') i++;
        else if (i === start) i++;   // malformed: move on
      }
      i++; return a;
    }
    return scalar(token(stops));
  };
  return node('');
}
function scalar(t) {
  if (/^(['"]).*\1$/s.test(t)) return t.slice(1, -1);
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}
const unquote = (s) => String(s).replace(/^(['"])(.*)\1$/s, '$2');

// ---- the deck --------------------------------------------------------------------
// The deck's slides as Slidev's parser cuts them (@slidev/parser parse()): a
// `---` line ends a slide, and opens a frontmatter when the next line has
// text; fenced code and HTML comments are skipped. Hidden and disabled
// slides take no number. → [{ no, line, fm }], `line` the 1-based line of
// the slide's first `---` (or of its first line).
export function deckSlides(deck) {
  const lines = String(deck ?? '').split(/\r?\n/);
  const raw = [];
  let start = 0, fm = null, fmLine = 0, inComment = false;
  const slice = (end) => { if (start === end) return; raw.push({ line: (fm != null ? fmLine : start) + 1, fm }); start = end + 1; fm = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (inComment) { inComment = commentOpen(lines[i], true); continue; }
    if (line.startsWith('---')) {
      slice(i);
      if (line[3] !== '-' && lines[i + 1]?.trim()) {
        start = i; fmLine = i;
        const from = i + 1;
        for (i += 1; i < lines.length; i++) if (lines[i].trimEnd() === '---') break;
        fm = lines.slice(from, i).join('\n');
      }
    } else if (line.trimStart().startsWith('```')) {
      const fence = /^\s*`+/.exec(line)[0];
      let j = i + 1;
      for (; j < lines.length; j++) if (lines[j].startsWith(fence)) break;
      if (j !== lines.length) i = j;
    } else inComment = commentOpen(lines[i], false);
  }
  if (start <= lines.length - 1) slice(lines.length);
  const out = [];
  for (const r of raw) {
    let parsed = null;
    try { parsed = r.fm != null ? readYaml(r.fm) : null; } catch { parsed = null; }
    const f = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    if (f.hide === true || f.disabled === true) continue;
    out.push({ no: out.length + 1, line: r.line, fm: f });
  }
  return out;
}
function commentOpen(line, open) {
  let at = 0;
  while (at < line.length) {
    if (open) { const e = line.indexOf('-->', at); if (e < 0) return true; open = false; at = e + 3; }
    else { const s = line.indexOf('<!--', at); if (s < 0) return false; const e = line.indexOf('-->', s + 4); if (e < 0) return true; at = e + 3; }
  }
  return open;
}

// The headmatter's `stage:` block, or null.
export function readStageConfig(deck) {
  const first = deckSlides(deck)[0];
  const cfg = first?.fm?.stage;
  return cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : null;
}

// Every pose and stop the deck names, slide by slide. `at` as written: a
// word, or [x, y, z] as text.
export function deckPoses(source) {
  const at = [], stops = [];
  for (const s of deckSlides(source)) {
    const sp = s.fm.space;
    if (!sp || typeof sp !== 'object') continue;
    if (sp.at != null) at.push(Array.isArray(sp.at) ? `[${sp.at.join(', ')}]` : String(sp.at));
    if (Array.isArray(sp.stops)) stops.push(...sp.stops.map(String));
  }
  return { at, stops };
}

// The object types a deck registers itself: registerBuilder('<type>', fn,
// { fields: [...] }) in its setup files. Fields come along when the builder
// is passed by name; for one written inline, the type needs `pos` only.
export function deckTypes(sources) {
  const types = {}, palettes = [];
  for (const src of [].concat(sources)) {
    for (const m of String(src).matchAll(/registerBuilder\(\s*(['"])([\w-]+)\1\s*(?:,\s*[\w$.]+\s*,\s*\{\s*fields\s*:\s*\[([^\]]*)\])?/g)) {
      const fields = m[3] != null ? [...m[3].matchAll(/(['"])([\w-]+)\1/g)].map((f) => f[2]) : null;
      types[m[2]] = fields && fields.length ? fields : (types[m[2]] || ['pos']);
    }
    for (const m of String(src).matchAll(/definePalette\(\s*(['"])([\w-]+)\1/g)) palettes.push(m[2]);
  }
  return { types, palettes };
}
// The components a deck registers itself: app.component('<Name>', …) in its
// setup files, and its components/<Name>.vue.
export function deckComponents(sources, dir = null) {
  const names = new Set();
  for (const src of [].concat(sources)) for (const m of String(src).matchAll(/\.component\(\s*(['"])([\w-]+)\1\s*,/g)) names.add(m[2]);
  const own = dir && join(dir, 'components');
  if (own && existsSync(own)) for (const f of readdirSync(own)) if (f.endsWith('.vue')) names.add(f.slice(0, -4));
  return [...names];
}
export function readSetup(dir) {
  const setup = join(dir, 'setup');
  if (!existsSync(setup)) return [];
  return readdirSync(setup).filter((f) => SETUP_FILE.test(f)).sort().map((f) => readFileSync(join(setup, f), 'utf8'));
}

// ---- the check -------------------------------------------------------------------
const STOP_OFFSET = [0.6, -0.35, 0];   // space.js DEFAULTS.stopOffset
const POSE = { dist: 9, yaw: -20, pitch: 6 };   // space.js DEFAULTS.pose
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const COLOUR_KEYS = Object.keys(DEFAULT_PALETTE);

export function checkStage({ space, records = null, deck = '', plugins = null, extraTypes = [], deckOwn = {}, palettes = [], publicDir = null, components = null } = {}) {
  const issues = [];
  const add = (code, msg, where = {}, level = 'error') => issues.push({ ...where, code, level, msg });
  const types = { ...CORE_TYPES };
  const slides = deckSlides(deck);
  const cfg = (slides[0]?.fm?.stage && typeof slides[0].fm.stage === 'object') ? slides[0].fm.stage : {};
  for (const p of plugins ?? [].concat(cfg.plugins || []).map(String)) {
    if (PLUGIN_TYPES[p]) Object.assign(types, PLUGIN_TYPES[p]);
    else add('unknown-plugin', `unknown plugin: ${p} (shipped: ${Object.keys(PLUGIN_TYPES).join(', ')})`);
  }
  for (const [t, fields] of Object.entries(deckOwn)) types[t] = fields;
  for (const t of extraTypes) types[t] ??= ['pos'];
  checkConfig(cfg, palettes, add, { slide: 1, line: slides[0]?.line ?? 1 });
  if (components) checkCount(deck, slides, components, add);

  const recordIds = new Set(((records && (records.records || records.states)) || []).map((r) => String(r.id)));
  if (!space || !Array.isArray(space.stations) || !space.stations.length) {
    add('no-stations', 'space: no stations');
    return result(issues, { stations: 0, objects: 0 });
  }
  const stations = new Map(), anchors = new Map(), forms = [];
  let objects = 0;
  for (const st of space.stations) {
    const name = st.id ?? '(no id)', where = { station: String(name) };
    if (st.id == null || stations.has(String(st.id))) add('duplicate-station', `station id missing or duplicate: ${name}`, where);
    stations.set(String(st.id), st);
    const sp = isVec(st.pos) ? st.pos : null;
    if (!sp) add('bad-vector', `${name}: pos must be [x, y, z]`, where);
    if (!st.look || typeof st.look.dist !== 'number') add('missing-look', `${name}: look.dist missing`, where);
    if (st.look?.target && !isVec(st.look.target)) add('bad-vector', `${name}: look.target must be [x, y, z]`, where);
    for (const o of st.objects || []) {
      objects++;
      const req = types[o.type];
      if (!req) { add('unknown-type', `${name}: unknown object type ${o.type} (registered in the deck's setup/, or --types ${o.type})`, where); continue; }
      for (const k of req) if (o[k] === undefined) add('missing-field', `${name}/${o.type}: missing ${k}`, where);
      const op = o.pos === undefined ? [0, 0, 0] : (isVec(o.pos) ? o.pos : null);
      if (!op) add('bad-vector', `${name}/${o.type}: pos must be [x, y, z]`, where);
      if (o.type === 'page' && typeof o.src === 'string') {
        if (!o.src.startsWith('/')) add('bad-src', `${name}/page: src must start with / (it is resolved against the deck's base): ${o.src}`, where);
        else if (publicDir && !existsSync(join(publicDir, o.src))) add('missing-file', `${name}/page: no such file under public: ${o.src}`, where);
      }
      const at = sp && op ? plus(sp, op) : null;
      if (at && typeof o.radius === 'number' && o.radius > 0 && o.type !== 'ring') forms.push({ station: String(name), type: o.type, at, radius: o.radius });
      for (const id of anchorIds(o)) {
        anchors.set(id, anchorAt(o, id, at));
        if (records && o.type !== 'orbs' && !recordIds.has(id)) add('unknown-record', `${name}/${o.type}: no record with id ${id}`, where);
      }
    }
  }
  if (space.hero != null && !stations.has(String(space.hero))) add('unknown-station', `space.hero is not a station: ${space.hero}`);
  const firstId = space.stations[0].id;
  const heroId = [space.hero, cfg.hero, 'hero'].find((h) => h != null && stations.has(String(h)));
  const poses = { wide: { station: heroId ?? firstId }, ...(space.poses || {}) };
  for (const [k, p] of Object.entries(space.poses || {})) {
    const s = p?.station ?? p?.at;
    if (s != null && !Array.isArray(s) && !stations.has(String(s))) add('unknown-station', `pose ${k}: station ${s} does not exist`);
  }

  // what a name stands for, and where the camera stands for a pose: space.js
  // resolve() and applyPose(), without the idle sway
  const names = [...stations.keys()].map((n) => [n, 'station']).concat([...anchors.keys()].map((n) => [n, 'anchor']), Object.keys(poses).map((n) => [n, 'pose']));
  const camera = (p) => {
    let at = p.at, { dist, yaw, pitch } = p, offset = null;
    if (typeof at === 'string' && poses[at] && !stations.has(at)) {
      const n = poses[at] || {};
      dist ??= n.dist; yaw ??= n.yaw; pitch ??= n.pitch; offset = isVec(n.offset) ? n.offset : null;
      at = n.station ?? n.at ?? firstId;
    }
    let t;
    if (Array.isArray(at)) { if (!isVec(at)) return null; t = at; }
    else if (stations.has(String(at))) {
      const st = stations.get(String(at)), look = st.look || {};
      if (!isVec(st.pos)) return null;
      t = plus(st.pos, offset || (isVec(look.target) ? look.target : [0, 0, 0]));
      dist ??= look.dist; yaw ??= look.yaw; pitch ??= look.pitch;
    } else if (anchors.get(String(at))) t = plus(anchors.get(String(at)), STOP_OFFSET);
    else return null;
    const d = num(dist, POSE.dist), y = num(yaw, POSE.yaw) * Math.PI / 180, q = num(pitch, POSE.pitch) * Math.PI / 180;
    return plus(t, [d * Math.sin(y) * Math.cos(q), d * Math.sin(q), d * Math.cos(y) * Math.cos(q)]);
  };
  let nPoses = 0, nStops = 0;
  for (const s of slides) {
    const sp = s.fm.space;
    if (sp == null) continue;
    const where = { slide: s.no, line: s.line };
    if (typeof sp !== 'object' || Array.isArray(sp)) { add('bad-pose', `slide ${s.no}: space must be a map ({ at: …, dist: … })`, where); continue; }
    for (const k of Object.keys(sp)) if (!SPACE_KEYS.includes(k)) add('unknown-key', `slide ${s.no}: space.${k} is read by nothing (space keys: ${SPACE_KEYS.join(', ')})`, where, 'warning');
    for (const k of ['dist', 'yaw', 'pitch', 'sway', 'dim', 'asof']) if (sp[k] != null && typeof sp[k] !== 'number') add('bad-pose', `slide ${s.no}: space.${k} must be a number: ${sp[k]}`, where);
    if (typeof sp.dist === 'number' && !(sp.dist > 0)) add('bad-pose', `slide ${s.no}: space.dist must be above 0: ${sp.dist}`, where);
    if (typeof sp.pitch === 'number' && Math.abs(sp.pitch) >= 90) add('bad-pose', `slide ${s.no}: space.pitch must lie within ±90: ${sp.pitch}`, where);
    if (typeof sp.dim === 'number' && (sp.dim < 0 || sp.dim > 1)) add('bad-pose', `slide ${s.no}: space.dim must lie within 0..1: ${sp.dim}`, where);
    const looks = [];
    if (sp.at != null) {
      nPoses++;
      if (Array.isArray(sp.at)) { if (!isVec(sp.at)) add('bad-vector', `slide ${s.no}: space.at must be [x, y, z] or a name: [${sp.at.join(', ')}]`, where); }
      else if (!names.some(([n]) => n === String(sp.at))) {
        const near = nearest(String(sp.at), names);
        add(near?.[1] === 'pose' ? 'unknown-pose' : 'unknown-station', `slide ${s.no}: space.at does not resolve: ${sp.at} (not a station, anchor or named pose${near ? `; did you mean ${near[0]}?` : ''})`, where);
      }
      looks.push(sp.at);
    }
    for (const id of Array.isArray(sp.stops) ? sp.stops : []) {
      nStops++;
      if (!anchors.has(String(id))) {
        const near = nearest(String(id), names.filter(([, k]) => k === 'anchor'));
        add('missing-anchor', `slide ${s.no}: stop is not an anchor in the space: ${id}${near ? ` (did you mean ${near[0]}?)` : ''}`, where);
      } else looks.push(id);
    }
    // the camera of each pose this slide takes: the slide's own, then one per stop
    for (const at of looks) {
      const cam = camera({ ...sp, at });
      if (!cam) continue;
      for (const f of forms) {
        const d = Math.hypot(cam[0] - f.at[0], cam[1] - f.at[1], cam[2] - f.at[2]);
        if (d < f.radius) add('camera-inside-form', `slide ${s.no}: the camera at ${Array.isArray(at) ? `[${at.join(', ')}]` : at} stands inside ${f.type} of station ${f.station} (${d.toFixed(1)} from its centre, radius ${f.radius}): every grain of it is drawn across the screen`, where, 'warning');
      }
    }
  }
  return result(issues, { stations: stations.size, objects, poses: nPoses, stops: nStops, slides: slides.length });
}

// A deck that dropped its own Count.vue for the addon's <StageCount> and kept
// a <Count> tag: Vue resolves it to nothing, and the number is gone. (A tag
// quoted in backticks, as in a deck's `info:`, is prose.)
function checkCount(deck, slides, components, add) {
  if (components.includes('Count')) return;
  const lines = String(deck).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/(^|[^`])<Count[\s/>]/.test(lines[i])) continue;
    const s = slides.filter((x) => x.line <= i + 1).at(-1);
    add('unknown-component', `slide ${s?.no ?? 1}: <Count> is registered nowhere in the deck (no app.component('Count', …) in setup/, no components/Count.vue); the addon's counter is <StageCount>: rename the tag`, { slide: s?.no ?? 1, line: i + 1 }, 'warning');
  }
}

function checkConfig(cfg, palettes, add, head) {
  for (const k of Object.keys(cfg)) if (!STAGE_KEYS.includes(k)) add('unknown-key', `stage.${k} is read by nothing (stage keys: ${STAGE_KEYS.join(', ')})`, head, 'warning');
  const known = new Set([...Object.keys(PALETTES), ...palettes]);
  const named = (n, what) => { if (!known.has(n)) add('unknown-palette', `${what} is no palette: ${n} (palettes: ${[...known].join(', ')}; a deck adds its own with definePalette in setup/)`, head); };
  const p = cfg.palette;
  if (typeof p === 'string') named(p, 'stage.palette');
  else if (p && typeof p === 'object' && !Array.isArray(p)) {
    if (p.base != null) named(String(p.base), 'stage.palette.base');
    for (const [k, v] of Object.entries(p)) {
      if (k === 'base') continue;
      if (!COLOUR_KEYS.includes(k)) add('unknown-palette', `stage.palette.${k} is no colour of a palette (${COLOUR_KEYS.join(', ')})`, head);
      else if (typeof v !== 'string' || !HEX.test(v.trim())) add('bad-colour', `stage.palette.${k} must be #rgb or #rrggbb: ${v}`, head);
    }
  }
  const o = cfg.options;
  if (o != null && (typeof o !== 'object' || Array.isArray(o))) add('unknown-option', 'stage.options must be a map ({ bloom: 0.5, … })', head);
  else for (const k of Object.keys(o || {})) if (!OPTION_KEYS.includes(k)) {
    const near = nearest(k, OPTION_KEYS.map((n) => [n, 'option']));
    add('unknown-option', `stage.options.${k} is no engine option${near ? ` (did you mean ${near[0]}?)` : ''}; options: ${OPTION_KEYS.join(', ')}`, head);
  }
}

const format = (p) => (p.slide != null && !/^slide \d+:/.test(p.msg) ? `slide ${p.slide}: ${p.msg}` : p.msg);
function result(issues, stats) {
  const errors = issues.filter((p) => p.level === 'error'), warnings = issues.filter((p) => p.level !== 'error');
  return { ...stats, issues, problems: errors.map(format), warnings: warnings.map(format) };
}
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const plus = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
// where an anchor stands: an orb's own pos, or the object itself
function anchorAt(o, id, at) {
  if (!at) return null;
  if (o.type === 'orbs') { const it = (o.items || []).find((x) => x && String(x.id) === id); return it && isVec(it.pos) ? plus(at, it.pos) : at; }
  return at;
}
// the closest of `names` to `s`, if it is close enough to be a typo
function nearest(s, names) {
  let best = null, bd = Infinity;
  for (const n of names) { const d = edits(s.toLowerCase(), n[0].toLowerCase()); if (d < bd) { bd = d; best = n; } }
  return best && bd <= Math.max(1, Math.floor(s.length / 3)) ? best : null;
}
// edits between two names, a swap of neighbours counting one (mrak → mark)
function edits(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

function parseArgs(argv) {
  const out = { dir: '.', deck: null, space: null, records: null, plugins: null, types: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deck') out.deck = argv[++i];
    else if (a === '--space') out.space = argv[++i];
    else if (a === '--records') out.records = argv[++i];
    else if (a === '--plugins') out.plugins = argv[++i].split(',').filter(Boolean);
    else if (a === '--types') out.types = argv[++i].split(',').filter(Boolean);
    else if (a === '--json') out.json = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-')) out.dir = a;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('usage: slidev-stage-check [deck-dir] [--deck deck.md] [--space data/space.json] [--records data/records.json] [--plugins hadron] [--types a,b] [--json]');
    return 0;
  }
  const fail = (msg) => { if (args.json) console.log(JSON.stringify({ ok: false, error: msg })); else console.error(msg); return 2; };
  const dir = resolve(args.dir);
  const deckFile = args.deck ? resolve(dir, args.deck) : DECK_NAMES.map((n) => join(dir, n)).find(existsSync);
  if (!deckFile || !existsSync(deckFile)) return fail(`no deck found in ${dir} (looked for ${DECK_NAMES.join(', ')})`);
  const deck = readFileSync(deckFile, 'utf8');
  const cfg = readStageConfig(deck) || {};
  const publicDir = join(dir, 'public');
  const spacePath = join(publicDir, args.space || (typeof cfg.space === 'string' ? cfg.space : 'data/space.json'));
  const recordsRel = args.records || (typeof cfg.records === 'string' ? cfg.records : null);
  let space, records = null;
  try { space = JSON.parse(readFileSync(spacePath, 'utf8')); } catch (e) { return fail(`cannot read ${spacePath}: ${e.message}`); }
  if (recordsRel) {
    try { records = JSON.parse(readFileSync(join(publicDir, recordsRel), 'utf8')); } catch (e) { return fail(`cannot read ${recordsRel}: ${e.message}`); }
  }
  const plugins = args.plugins || [].concat(cfg.plugins || []).map(String);
  const setup = readSetup(dir);
  const own = deckTypes(setup);
  const r = checkStage({ space, records, deck, plugins, extraTypes: args.types, deckOwn: own.types, palettes: own.palettes, publicDir, components: deckComponents(setup, dir) });
  const stats = { stations: r.stations, objects: r.objects, poses: r.poses, stops: r.stops, slides: r.slides, deckTypes: Object.keys(own.types) };
  if (args.json) {
    console.log(JSON.stringify({ ok: r.problems.length === 0, deck: deckFile, problems: r.issues, stats }, null, 2));
    return r.problems.length ? 1 : 0;
  }
  if (r.warnings.length) console.error(r.warnings.map((w) => `warning: ${w}`).join('\n'));
  if (r.problems.length) {
    console.error(r.problems.join('\n'));
    console.error(`\n${r.problems.length} problem(s) in the stage.`);
    return 1;
  }
  const own_ = stats.deckTypes.length ? `; the deck's own types: ${stats.deckTypes.join(', ')}` : '';
  console.log(`stage ok: ${r.stations} station(s), ${r.objects} object(s); ${r.poses} pose(s) and ${r.stops} stop(s) in the deck resolve${own_}`);
  return 0;
}

// run as a script (through a package manager's shim too: compare real paths)
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(main());
