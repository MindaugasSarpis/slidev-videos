#!/usr/bin/env node
// explain3d — the explainers' files, made again from their sources.
//
//   explain3d list
//   explain3d reduce <name> <source file>   source → explainers/<name>/input.json
//   explain3d make   [name]                 input.json → data.json
//   explain3d golden [name]                 spec + data → golden.svg (the opening view)
//   explain3d check  [name]                 data.json and golden.svg are what make and golden give (exit 1 if not)
//   explain3d render <name> [--azim A] [--elev E] [--state S] [--width W] [--height H] [--left L]   one view to stdout
//                                           (--left: pixels kept free at the left, as a slide keeps for its buttons)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { EXPLAINERS, GOLDEN } from '../explainers/index.js';
import { prepareScene, drawFrame } from '../engine/scene.js';
import { toSVG, diffSVG } from '../engine/svg.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'explainers');
const dir = (name) => join(ROOT, name);
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJSON = (p, v) => writeFileSync(p, `${JSON.stringify(v)}\n`);
const module_ = (name) => import(pathToFileURL(join(dir(name), 'make.mjs')).href);

export async function reduceOne(name, file) {
  const m = await module_(name);
  const bytes = readFileSync(file);
  const input = { source: { ...m.source, sha256: createHash('sha256').update(bytes).digest('hex') }, ...m.reduce(bytes.toString('utf8')) };
  writeFileSync(join(dir(name), 'input.json'), `${JSON.stringify(input, null, 1)}\n`);
  return input;
}
export async function makeData(name) {
  const m = await module_(name);
  return m.make(readJSON(join(dir(name), 'input.json')));
}
export function renderOne(name, view = {}, size = GOLDEN, opts = {}) {
  const spec = readJSON(join(dir(name), 'spec.json'));
  const scene = prepareScene(spec, readJSON(join(dir(name), 'data.json')));
  return toSVG(drawFrame(scene, view, size, opts), size, { label: spec.label, id: `x3d-${name}` });
}
/** What is stale in one explainer's generated files: [] when nothing. */
export async function checkOne(name) {
  const bad = [];
  const dataFile = join(dir(name), 'data.json'), goldenFile = join(dir(name), 'golden.svg');
  if (!existsSync(dataFile)) return [`${name}: no data.json (explain3d make ${name})`];
  if (JSON.stringify(await makeData(name)) !== JSON.stringify(readJSON(dataFile))) bad.push(`${name}: data.json is not what make.mjs gives from input.json (explain3d make ${name})`);
  if (!existsSync(goldenFile)) bad.push(`${name}: no golden.svg (explain3d golden ${name})`);
  else {
    const d = diffSVG(readFileSync(goldenFile, 'utf8'), renderOne(name));
    if (d) bad.push(`${name}: golden.svg differs from the opening view: ${d} (explain3d golden ${name}, then look at it)`);
  }
  return bad;
}

async function main(argv) {
  const [verb, ...rest] = argv;
  const flags = {};
  const args = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]; else args.push(rest[i]); }
  const names = args[0] ? [args[0]] : EXPLAINERS;
  for (const n of names) if (!EXPLAINERS.includes(n)) { console.error(`explain3d: no explainer "${n}" (${EXPLAINERS.join(', ')})`); return 2; }
  if (verb === 'list') { for (const n of EXPLAINERS) console.log(n); return 0; }
  if (verb === 'reduce') {
    if (args.length !== 2) { console.error('explain3d reduce <name> <source file>'); return 2; }
    const input = await reduceOne(args[0], args[1]);
    console.log(`${args[0]}: input.json from ${args[1]} (sha256 ${input.source.sha256.slice(0, 12)}…)`);
    return 0;
  }
  if (verb === 'make') { for (const n of names) { writeJSON(join(dir(n), 'data.json'), await makeData(n)); console.log(`${n}: data.json`); } return 0; }
  if (verb === 'golden') { for (const n of names) { writeFileSync(join(dir(n), 'golden.svg'), renderOne(n)); console.log(`${n}: golden.svg`); } return 0; }
  if (verb === 'check') {
    let bad = [];
    for (const n of names) bad = bad.concat(await checkOne(n));
    for (const b of bad) console.error(`✗ ${b}`);
    if (!bad.length) console.log(`✓ ${names.length} explainer(s): data and golden pictures are current`);
    return bad.length ? 1 : 0;
  }
  if (verb === 'render') {
    const view = {};
    if (flags.azim) view.azim = Number(flags.azim);
    if (flags.elev) view.elev = Number(flags.elev);
    if (flags.state) view.state = { a: flags.state };
    process.stdout.write(renderOne(args[0], view, { width: Number(flags.width || GOLDEN.width), height: Number(flags.height || GOLDEN.height) }, { left: Number(flags.left || 0) }));
    return 0;
  }
  console.error('explain3d list | reduce <name> <file> | make [name] | golden [name] | check [name] | render <name> [--azim --elev --state --width --height --left]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main(process.argv.slice(2));
