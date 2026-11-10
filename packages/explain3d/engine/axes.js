// The box of a scene: its twelve edges, and for each axis the edge it is read
// on, with ticks and a name on the side away from the box.
import { boxCorners, toScreen, clamp } from './camera.js';
import { LOOK } from './palette.js';

export const fmt = (v, d = 0) => {
  const s = Number(v).toFixed(d);
  return (/^-0\.?0*$/.test(s) ? s.slice(1) : s).replace('-', '−');
};

/** A data value of an axis { lo, hi, len } in box units. */
export const axisMap = (a) => (v) => ((v - a.lo) / (a.hi - a.lo) - 0.5) * a.len;

/**
 * axes: three of { lo, hi, len, ticks, label, decimals }. Returns the edges in
 * pixels, and for every axis its ticks and name; the height axis is left
 * out when the scene is seen from above (a tilt over 75°), and any axis seen end-on.
 */
export function boxFrame(axes, cam, vp, size) {
  const lens = axes.map((a) => a.len);
  const corners = boxCorners(lens);
  const pc = corners.map((c) => toScreen(cam, vp, c[0], c[1], c[2]));
  const edges = [];
  for (let i = 0; i < 8; i++) {
    for (let j = i + 1; j < 8; j++) {
      let diff = 0;
      for (let k = 0; k < 3; k++) if (corners[i][k] !== corners[j][k]) diff++;
      if (diff === 1) edges.push({ x1: pc[i].x, y1: pc[i].y, x2: pc[j].x, y2: pc[j].y });
    }
  }
  const centre = toScreen(cam, vp, 0, 0, 0);
  const h = lens.map((l) => l / 2);
  const fromAbove = cam.v[2] > 0.966;                        // tilted more than 75°
  const pick = (k) => {
    let best = null;
    const others = [0, 1, 2].filter((q) => q !== k);
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        const at = (t) => { const p = [0, 0, 0]; p[k] = t; p[others[0]] = s1 * h[others[0]]; p[others[1]] = s2 * h[others[1]]; return p; };
        const a = toScreen(cam, vp, ...at(-h[k]));
        const b = toScreen(cam, vp, ...at(h[k]));
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: (a.d + b.d) / 2 };
        // the two floor axes: a bottom edge in front; the height: the leftmost upright edge
        // (seen from above, a top edge: the floor's edges lie inside the picture of the top)
        const score = k < 2 ? ((at(0)[2] < 0) !== fromAbove ? 1000 : 0) + mid.d * 10 + (mid.y - centre.y) * 0.001 : -mid.x;
        if (!best || score > best.score) best = { score, at, a, b, mid };
      }
    }
    if (k === 2 && fromAbove) return null;
    const edgeLen = Math.hypot(best.b.x - best.a.x, best.b.y - best.a.y);
    if (edgeLen < 60) return null;                           // an axis seen end-on
    // outward: the edge's normal on the screen, on the side away from the centre
    let ox = -(best.b.y - best.a.y), oy = best.b.x - best.a.x;
    const n = Math.hypot(ox, oy) || 1;
    ox /= n; oy /= n;
    if ((best.mid.x - centre.x) * ox + (best.mid.y - centre.y) * oy < 0) { ox = -ox; oy = -oy; }
    if (k === 2) { ox = -1; oy = 0; }
    const anchor = ox < -0.45 ? 'end' : ox > 0.45 ? 'start' : 'middle';
    const ax = axes[k];
    const map = axisMap(ax);
    const ticks = (ax.ticks || []).map((t) => {
      const p = toScreen(cam, vp, ...best.at(map(t)));
      return { text: fmt(t, ax.decimals ?? 0), x: p.x, y: p.y, x2: p.x + ox * LOOK.tickLen, y2: p.y + oy * LOOK.tickLen, lx: p.x + ox * LOOK.tickOff, ly: p.y + oy * LOOK.tickOff };
    });
    // … or nearly: its tick labels would lie on one another
    for (let t = 1; t < ticks.length; t++) if (Math.hypot(ticks[t].x - ticks[t - 1].x, ticks[t].y - ticks[t - 1].y) < 17) return null;
    const label = ax.label || '';
    const width = label.length * LOOK.name * 0.55;            // about the name's width, rather more than less
    let name;
    if (k === 2) name = { x: best.b.x, y: best.b.y - 18, anchor: 'middle' };
    else {
      // beside the tick labels, not over them; under a slanted edge, far enough for the name's ends to clear it
      const far = anchor === 'middle' ? LOOK.nameOff + (Math.abs(best.b.y - best.a.y) / edgeLen) * width * 0.5 : Math.min(96, Math.max(LOOK.nameOff + 24, 50 / Math.abs(ox)));
      name = { x: best.mid.x + ox * far, y: best.mid.y + oy * far, anchor };
    }
    const lo = name.anchor === 'start' ? 4 : name.anchor === 'end' ? 4 + width : 4 + width / 2;
    const hi = size.width - 4 - (name.anchor === 'start' ? width : name.anchor === 'end' ? 0 : width / 2);
    name.x = clamp(name.x, lo, Math.max(lo, hi));
    name.y = clamp(name.y, 12, size.height - 12);
    name.text = label;
    return { k, ticks, anchor, name };
  };
  return { edges, axes: [pick(0), pick(1), pick(2)].filter(Boolean) };
}
