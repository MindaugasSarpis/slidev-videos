#!/usr/bin/env node
// Check a built deck's type against what a screen can carry: the smallest
// line on every slide and click, and text that strays where it will be cut
// or covered. With --broadcast, the rules for a picture that goes to air: no
// line under 16 canvas px, every line inside the safe box, nothing in the
// corners where a channel puts its logo, the speaker's name and the clock.
//
//   slidev-stage-safe <dist> [--broadcast] [--json] [--slides 1-12] [--size 1920x1080] [--base auto]
//
//   (default)    no line under 11 canvas px, none off the slide
//   --broadcast  no line under 16 canvas px (31 px in a 1080p frame);
//                text inside x 98–882, y 55–408 of the 980 × 551 canvas
//                (room for a squeeze-back and the lower third); nothing in
//                the logo corner (top right), the name super (bottom left)
//                or the clock (bottom right)
//   --json       the report as JSON on stdout
//
// Sizes are canvas px at Slidev's 980-wide canvas (a deck with another
// canvasWidth is scaled to it), so they read against the CSS kit. The world
// is not drawn (WebGL is off: only the type is looked at), so the stop HUD
// panels, which need the world, are not checked. Exit 0 clean, 1 problems,
// 2 the deck could not be checked (a wrong or unknown option included).
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { serve, normaliseBase, parseSlides, checkSlides, parseSize } from './lib/record-serve.mjs';
import { launch, loadPlaywright } from './lib/chromium.mjs';

const USAGE = 'usage: slidev-stage-safe <dist> [--broadcast] [--json] [--slides 1-12] [--size 1920x1080] [--base auto]';
const CANVAS_H = 980 * 9 / 16;

// Boxes are fractions of the canvas: [x0, y0, x1, y1].
export const RULES = {
  hall: { floor: 11, box: [0, 0, 1, 1], corners: {} },
  broadcast: {
    floor: 16,
    box: [98 / 980, 55 / CANVAS_H, 882 / 980, 408 / CANVAS_H],
    corners: { logo: [0.8, 0, 1, 0.15], super: [0, 0.75, 0.6, 1], clock: [0.8, 0.85, 1, 1] },
  },
};

// A malformed or unknown option throws: the run would check the wrong thing
// (a typo of --broadcast checks the hall rules), so it is a usage error.
export function parseArgs(argv) {
  const o = { dist: null, broadcast: false, json: false, slides: null, size: [1920, 1080], base: 'auto' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} wants a value`); return v; };
    if (a === '--broadcast') o.broadcast = true;
    else if (a === '--json') o.json = true;
    else if (a === '--slides') o.slides = checkSlides(value());
    else if (a === '--size') o.size = parseSize(value());
    else if (a === '--base') o.base = value();
    else if (a === '-h' || a === '--help') o.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else rest.push(a);
  }
  if (rest.length > 1) throw new Error(`one deck at a time (got ${rest.join(', ')})`);
  [o.dist] = rest;
  return o;
}

// The lines of one slide state, measured in the page: every element that
// holds visible text, its text's union box in canvas px and its font size
// (scaled to the 980 canvas, and by any transform of its own).
function measure(n) {
  const page = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`);
  if (!page) return null;
  const pr = page.getBoundingClientRect();
  const W = page.offsetWidth || 980, H = page.offsetHeight || W * 9 / 16;
  const scale = pr.width / W;
  const roots = [page, ...document.querySelectorAll('.stage .hud')];
  const seen = new Map();
  const visible = (el) => !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true });
  for (const root of roots) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || el.closest('script, style, .video-player, .katex-mathml, [aria-hidden="true"]') || !visible(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        const box = [(r.left - pr.left) / scale, (r.top - pr.top) / scale, (r.right - pr.left) / scale, (r.bottom - pr.top) / scale];
        let item = seen.get(el);
        if (!item) {
          // a scale on the element or between it and the slide shrinks its type too
          let own = 1;
          for (let a = el; a && a !== page; a = a.parentElement) {
            const t = getComputedStyle(a).transform;
            if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); own *= Math.hypot(m.a, m.b); }
          }
          const font = parseFloat(getComputedStyle(el).fontSize) * own;
          item = { text: '', font: +(font * 980 / W).toFixed(2), box, tag: el.tagName.toLowerCase() + (el.classList.length ? '.' + [...el.classList].join('.') : '') };
          seen.set(el, item);
        } else item.box = [Math.min(item.box[0], box[0]), Math.min(item.box[1], box[1]), Math.max(item.box[2], box[2]), Math.max(item.box[3], box[3])];
      }
      const item = seen.get(el);
      if (item && item.text.length < 60) item.text = (item.text + ' ' + node.textContent.trim()).trim().slice(0, 60);
    }
  }
  return { W, H, screenW: pr.width, lines: [...seen.values()].map((l) => ({ ...l, box: l.box.map((v) => +v.toFixed(1)) })) };
}

const inside = (b, [x0, y0, x1, y1], W, H, tol = 0.5) => b[0] >= x0 * W - tol && b[1] >= y0 * H - tol && b[2] <= x1 * W + tol && b[3] <= y1 * H + tol;
const overlaps = (b, [x0, y0, x1, y1], W, H) => b[0] < x1 * W && b[2] > x0 * W && b[1] < y1 * H && b[3] > y0 * H;

// The rules over one state's lines → problems.
export function judge(state, rules) {
  const out = [];
  for (const l of state.lines) {
    const why = [];
    if (l.font < rules.floor - 0.01) why.push({ kind: 'small', detail: `${l.font} px < ${rules.floor}` });
    if (!inside(l.box, rules.box, state.W, state.H)) why.push({ kind: 'outside', detail: 'outside the safe box' });
    for (const [name, c] of Object.entries(rules.corners)) if (overlaps(l.box, c, state.W, state.H)) why.push({ kind: 'corner', detail: `in the ${name} corner` });
    if (why.length) out.push({ text: l.text, tag: l.tag, font: l.font, box: l.box, problems: why });
  }
  return out;
}

export async function check(o) {
  const { chromium } = loadPlaywright('slidev-stage-safe');
  const dist = resolve(o.dist);
  const base = normaliseBase(o.base, dist);
  const rules = o.broadcast ? RULES.broadcast : RULES.hall;
  const { server, url } = await serve(dist, { base });
  // the shared launcher's browser and flags, with no WebGL at all
  const { browser } = await launch({ chromium, backend: 'none', tool: 'slidev-stage-safe' });
  const report = { deck: dist, rules: o.broadcast ? 'broadcast' : 'hall', floor: rules.floor, size: o.size, look: null, states: [], smallest: null, problems: 0 };
  try {
    const page = await browser.newPage({ viewport: { width: o.size[0], height: o.size[1] }, deviceScaleFactor: 1 });
    await page.goto(`${url}#/1`);
    await page.waitForSelector('.slidev-layout', { state: 'attached', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    report.look = await page.evaluate(() => document.documentElement.dataset.stageLook || null);
    for (const n of parseSlides(o.slides, 500)) {
      let total = 0;
      for (let k = 0; k <= total; k++) {
        await page.evaluate(([n, k]) => { location.hash = k ? `#/${n}?clicks=${k}` : `#/${n}`; }, [n, k]);
        const there = await page.waitForFunction(([n, k]) => {
          const pg = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`);
          const st = document.querySelector('.stage');
          return Number((/^#\/(\d+)/.exec(location.hash) || [])[1]) === n && pg && getComputedStyle(pg).display !== 'none'
            && (!st || Number(st.dataset.clicks || 0) === k);
        }, [n, k], { polling: 20, timeout: 5000 }).then(() => true, () => false);
        if (!there) { if (k === 0) return report; break; }   // past the last slide
        // every rise-in and fade at its end state, then a frame for Vue to tidy up
        await page.evaluate(async () => {
          for (let i = 0; i < 3; i++) {
            for (const a of document.getAnimations()) { const end = a.effect?.getComputedTiming().endTime; if (Number.isFinite(end)) try { a.finish(); } catch {} }
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
        });
        if (k === 0) total = await page.evaluate(() => Number(document.querySelector('.stage')?.dataset.clicksTotal || 0));
        const st = await page.evaluate(measure, n);
        if (!st) continue;
        const problems = judge(st, rules);
        const small = st.lines.reduce((m, l) => (!m || l.font < m.font ? l : m), null);
        if (small && (!report.smallest || small.font < report.smallest.font)) {
          report.smallest = { slide: n, clicks: k, font: small.font, screenPx: +(small.font * st.screenW / 980).toFixed(1), text: small.text, tag: small.tag };
        }
        report.states.push({ slide: n, clicks: k, smallest: small ? small.font : null, problems });
        report.problems += problems.length;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`${e.message}\n${USAGE}`); return 2; }
  if (o.help || !o.dist) { console.log(USAGE); return o.help ? 0 : 2; }
  let r;
  try { r = await check(o); } catch (e) { console.error(e.message || e); return 2; }
  if (!r.states.length) { console.error('no slide could be checked'); return 2; }
  if (o.json) console.log(JSON.stringify(r, null, 2));
  else {
    for (const s of r.states) {
      const label = `slide ${s.slide}${s.clicks ? `.${s.clicks}` : ''}`.padEnd(11);
      if (!s.problems.length) { console.log(`${label} smallest ${s.smallest ?? '-'} px  ok`); continue; }
      console.log(`${label} smallest ${s.smallest} px`);
      for (const p of s.problems) console.log(`  ${p.tag} "${p.text}"  ${p.font} px  box ${p.box.map(Math.round).join(',')}  ${p.problems.map((x) => x.detail).join(' · ')}`);
    }
    const m = r.smallest;
    if (m) console.log(`\nsmallest type: ${m.font} canvas px on slide ${m.slide}${m.clicks ? ` (click ${m.clicks})` : ''}, "${m.text}" (${m.screenPx} px at ${r.size.join('×')})`);
    console.log(`${r.problems} problem(s) under the ${r.rules} rules${r.look ? ` (deck look: ${r.look})` : ''}`);
  }
  return r.problems ? 1 : 0;
}

const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(await main());
