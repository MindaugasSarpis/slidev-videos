#!/usr/bin/env node
// Validate a deck's stage: the space file, and every pose and stop the deck
// asks for. Run it after editing either.
//
//   slidev-stage-check [deck-dir] [--deck deck.md] [--space data/space.json]
//                      [--records data/records.json] [--plugins hadron] [--types beacon,arc]
//
// Without flags it reads the deck's headmatter `stage:` block. `--types`
// names object types the deck registers itself (registerBuilder), which the
// validator cannot know. Exit 1 on any problem.
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CORE_TYPES, PLUGIN_TYPES, anchorIds } from '../stage/types.js';

const DECK_NAMES = ['deck.md', 'slides.md'];

// The headmatter's `stage:` block, as far as the validator needs it: scalar
// keys one level down and `plugins` as a flow or block list. Not a YAML parser.
export function readStageConfig(deck) {
  const head = /^---\r?\n([\s\S]*?)\r?\n---/.exec(deck);
  if (!head) return null;
  const lines = head[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^stage:\s*(#.*)?$/.test(l));
  if (start < 0) return null;
  const cfg = {};
  let listKey = null;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    if (!line.trim() || /^\s*#/.test(line)) continue;
    const item = /^\s+-\s+(.+?)\s*$/.exec(line);
    if (item && listKey) { cfg[listKey].push(unquote(item[1])); continue; }
    const kv = /^ {2}([\w-]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!kv) continue;
    listKey = null;
    const [, key, value] = kv;
    if (value === '') { cfg[key] = []; listKey = key; continue; }
    const flow = /^\[(.*)\]$/.exec(value);
    cfg[key] = flow ? flow[1].split(',').map((s) => unquote(s.trim())).filter(Boolean) : unquote(value);
  }
  return cfg;
}
const unquote = (s) => s.replace(/^(['"])(.*)\1$/, '$2');

// The frontmatter blocks of a deck (the headmatter first), joined. A block is
// what stands between two `---` lines when every line of it reads as YAML;
// slide text that merely quotes `stops: [...]` is not a pose.
export function frontmatters(deck) {
  const lines = String(deck).split(/\r?\n/);
  const yamlish = (l) => !l.trim() || /^\s*#/.test(l) || /^\s*-\s/.test(l) || /^\s*[\w.-]+\s*:(\s|$)/.test(l) || /^\s+\S/.test(l);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^---\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^---\s*$/.test(lines[j])) j++;
    const body = lines.slice(i + 1, j);
    if (j < lines.length && body.some((l) => l.trim()) && body.every(yamlish)) { blocks.push(body.join('\n')); i = j; }
  }
  return blocks.join('\n');
}

// Every pose and stop the deck names. `at` is a word, a quoted string or [x, y, z].
export function deckPoses(source) {
  const deck = frontmatters(source) + '\n';
  const at = [], stops = [];
  for (const m of deck.matchAll(/^[ \t]+at:[ \t]*([^\n#]+)/gm)) at.push(m[1].trim());
  for (const m of deck.matchAll(/space:[ \t]*\{[^}\n]*?\bat:[ \t]*(\[[^\]]*\]|[^,}\n]+)/g)) at.push(m[1].trim());
  for (const m of deck.matchAll(/\bstops:[ \t]*\[([^\]]*)\]/g)) stops.push(...m[1].split(',').map((s) => unquote(s.trim())).filter(Boolean));
  return { at: at.map(unquote), stops };
}

export function checkStage({ space, records = null, deck = '', plugins = [], extraTypes = [], publicDir = null } = {}) {
  const problems = [];
  const types = { ...CORE_TYPES };
  for (const p of plugins) {
    if (PLUGIN_TYPES[p]) Object.assign(types, PLUGIN_TYPES[p]);
    else problems.push(`unknown plugin: ${p} (shipped: ${Object.keys(PLUGIN_TYPES).join(', ')})`);
  }
  for (const t of extraTypes) types[t] ??= ['pos'];

  const recordIds = new Set(((records && (records.records || records.states)) || []).map((r) => String(r.id)));
  const stations = new Set(), anchors = new Set();
  if (!space || !Array.isArray(space.stations) || !space.stations.length) {
    problems.push('space: no stations');
    return { problems, stations: 0, objects: 0 };
  }
  let objects = 0;
  for (const st of space.stations) {
    const name = st.id ?? '(no id)';
    if (st.id == null || stations.has(String(st.id))) problems.push(`station id missing or duplicate: ${name}`);
    stations.add(String(st.id));
    if (!isVec(st.pos)) problems.push(`${name}: pos must be [x, y, z]`);
    if (!st.look || typeof st.look.dist !== 'number') problems.push(`${name}: look.dist missing`);
    if (st.look?.target && !isVec(st.look.target)) problems.push(`${name}: look.target must be [x, y, z]`);
    for (const o of st.objects || []) {
      objects++;
      const req = types[o.type];
      if (!req) { problems.push(`${name}: unknown object type ${o.type} (a deck's own type: --types ${o.type})`); continue; }
      for (const k of req) if (o[k] === undefined) problems.push(`${name}/${o.type}: missing ${k}`);
      if (o.pos !== undefined && !isVec(o.pos)) problems.push(`${name}/${o.type}: pos must be [x, y, z]`);
      if (o.type === 'page' && typeof o.src === 'string') {
        if (!o.src.startsWith('/')) problems.push(`${name}/page: src must start with / (it is resolved against the deck's base): ${o.src}`);
        else if (publicDir && !existsSync(join(publicDir, o.src))) problems.push(`${name}/page: no such file under public: ${o.src}`);
      }
      for (const id of anchorIds(o)) {
        anchors.add(id);
        if (records && o.type !== 'orbs' && !recordIds.has(id)) problems.push(`${name}/${o.type}: no record with id ${id}`);
      }
    }
  }
  if (space.hero != null && !stations.has(String(space.hero))) problems.push(`space.hero is not a station: ${space.hero}`);
  const named = new Set(['wide', ...Object.keys(space.poses || {})]);
  for (const [k, p] of Object.entries(space.poses || {})) {
    const s = p.station ?? p.at;
    if (s != null && !Array.isArray(s) && !stations.has(String(s))) problems.push(`pose ${k}: station ${s} does not exist`);
  }

  const resolves = (at) => /^\[.*\]$/.test(at) || stations.has(at) || anchors.has(at) || named.has(at);
  const { at, stops } = deckPoses(deck);
  for (const a of at) if (!resolves(a)) problems.push(`deck space.at does not resolve: ${a}`);
  for (const s of stops) if (!anchors.has(s)) problems.push(`deck stop is not an anchor in the space: ${s}`);
  return { problems, stations: stations.size, objects, poses: at.length, stops: stops.length };
}
const isVec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

function parseArgs(argv) {
  const out = { dir: '.', deck: null, space: null, records: null, plugins: null, types: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--deck') out.deck = argv[++i];
    else if (a === '--space') out.space = argv[++i];
    else if (a === '--records') out.records = argv[++i];
    else if (a === '--plugins') out.plugins = argv[++i].split(',').filter(Boolean);
    else if (a === '--types') out.types = argv[++i].split(',').filter(Boolean);
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-')) out.dir = a;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('usage: slidev-stage-check [deck-dir] [--deck deck.md] [--space data/space.json] [--records data/records.json] [--plugins hadron] [--types a,b]');
    return 0;
  }
  const dir = resolve(args.dir);
  const deckFile = args.deck ? resolve(dir, args.deck) : DECK_NAMES.map((n) => join(dir, n)).find(existsSync);
  if (!deckFile || !existsSync(deckFile)) { console.error(`no deck found in ${dir} (looked for ${DECK_NAMES.join(', ')})`); return 2; }
  const deck = readFileSync(deckFile, 'utf8');
  const cfg = readStageConfig(deck) || {};
  const publicDir = join(dir, 'public');
  const spacePath = join(publicDir, args.space || (typeof cfg.space === 'string' ? cfg.space : 'data/space.json'));
  const recordsRel = args.records || (typeof cfg.records === 'string' && cfg.records !== 'false' ? cfg.records : null);
  let space, records = null;
  try { space = JSON.parse(readFileSync(spacePath, 'utf8')); } catch (e) { console.error(`cannot read ${spacePath}: ${e.message}`); return 2; }
  if (recordsRel) {
    try { records = JSON.parse(readFileSync(join(publicDir, recordsRel), 'utf8')); } catch (e) { console.error(`cannot read ${recordsRel}: ${e.message}`); return 2; }
  }
  const plugins = args.plugins || (Array.isArray(cfg.plugins) ? cfg.plugins : []);
  const r = checkStage({ space, records, deck, plugins, extraTypes: args.types, publicDir });
  if (r.problems.length) {
    console.error(r.problems.join('\n'));
    console.error(`\n${r.problems.length} problem(s) in the stage.`);
    return 1;
  }
  console.log(`stage ok: ${r.stations} station(s), ${r.objects} object(s); ${r.poses} pose(s) and ${r.stops} stop(s) in the deck resolve`);
  return 0;
}

// run as a script (through a package manager's shim too: compare real paths)
const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(main());
