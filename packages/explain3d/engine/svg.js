// A frame as a standalone SVG document: the golden file of an explainer, and
// the still picture a slide shows when the live one cannot be drawn.
import { color, LOOK } from './palette.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The key's ticks: pointing in from the side of its labels. */
export const keyTicks = (k) => k.ticks.map((t) => `M${k.x + k.width} ${t.y}h-${LOOK.tickLen}`).join('');

/** frame: what drawFrame returned (not live); size: { width, height }. */
export function toSVG(frame, size, { label = '', id = 'x3d' } = {}) {
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}" role="img" aria-label="${esc(label)}" font-family="${LOOK.font}">`);
  if (frame.key) o.push(`<defs><linearGradient id="${id}-key" x1="0" y1="1" x2="0" y2="0">${frame.key.stops.map((s) => `<stop offset="${s.off}" stop-color="${s.col}"/>`).join('')}</linearGradient></defs>`);
  o.push(`<g stroke="${color('hair-strong')}" stroke-width="1">${frame.edges.map((e) => `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2}" y2="${e.y2}"/>`).join('')}</g>`);
  o.push('<g stroke-linecap="round" stroke-linejoin="round">');
  for (const it of frame.items) {
    let a = `d="${it.d}" fill="${it.fill ?? 'none'}"`;
    if (it.stroke) a += ` stroke="${it.stroke}" stroke-width="${it.sw}"`;
    if (it.dash) a += ` stroke-dasharray="${it.dash}"`;
    if (it.op != null && it.op < 1) a += ` opacity="${Math.round(it.op * 1000) / 1000}"`;
    o.push(`<path ${a}/>`);
  }
  o.push('</g>');
  const fg = color('fg');
  for (const ax of frame.axes) {
    o.push(`<g font-size="${LOOK.tick}" fill="${fg}">`);
    for (const t of ax.ticks) {
      o.push(`<line x1="${t.x}" y1="${t.y}" x2="${t.x2}" y2="${t.y2}" stroke="${fg}" stroke-width="1"/>`);
      o.push(`<text x="${t.lx}" y="${t.ly}" text-anchor="${ax.anchor}" dominant-baseline="central">${esc(t.text)}</text>`);
    }
    o.push(`<text x="${ax.name.x}" y="${ax.name.y}" text-anchor="${ax.name.anchor}" dominant-baseline="central" font-size="${LOOK.name}">${esc(ax.name.text)}</text>`);
    o.push('</g>');
  }
  for (const l of frame.labels) {
    o.push(`<text x="${l.x}" y="${l.y}" text-anchor="${l.anchor}" dominant-baseline="central" font-size="${LOOK.tick}" font-weight="700" fill="${l.fill}" stroke="${color('bg')}" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke">${esc(l.text)}</text>`);
  }
  if (frame.key) {
    const k = frame.key;
    o.push(`<g font-size="${LOOK.tick}" fill="${fg}">`);
    o.push(`<text x="${k.x + k.width / 2}" y="${k.top - 18}" text-anchor="middle" font-size="${LOOK.name}">${esc(k.label)}</text>`);
    o.push(`<rect x="${k.x}" y="${k.top}" width="${k.width}" height="${k.bottom - k.top}" fill="url(#${id}-key)" stroke="${fg}" stroke-width="1"/>`);
    o.push(`<path d="${keyTicks(k)}" fill="none" stroke="${fg}" stroke-width="1"/>`);
    for (const t of k.ticks) o.push(`<text x="${k.x + k.width + LOOK.tickLen}" y="${t.y}" dominant-baseline="central">${esc(t.text)}</text>`);
    o.push('</g>');
  }
  o.push('</svg>');
  return `${o.join('\n')}\n`;
}

/**
 * Two SVG documents, compared as text with every number allowed to differ by
 * tol (a sine's last digit differs between machines, and a coordinate on the
 * edge of a rounding step then lands 0.1 px away). Returns null when they
 * agree, else the first difference as a sentence.
 */
export function diffSVG(a, b, tol = 0.11) {
  const NUM = /-?\d+(?:\.\d+)?(?:e-?\d+)?/g;
  const ta = a.replace(NUM, '#'), tb = b.replace(NUM, '#');
  if (ta !== tb) {
    let i = 0;
    while (i < ta.length && ta[i] === tb[i]) i++;
    return `the structure differs at character ${i}: …${ta.slice(Math.max(0, i - 40), i + 40)}… against …${tb.slice(Math.max(0, i - 40), i + 40)}…`;
  }
  const na = a.match(NUM) || [], nb = b.match(NUM) || [];
  for (let i = 0; i < na.length; i++) if (Math.abs(Number(na[i]) - Number(nb[i])) > tol) return `number ${i}: ${na[i]} against ${nb[i]}`;
  return null;
}
