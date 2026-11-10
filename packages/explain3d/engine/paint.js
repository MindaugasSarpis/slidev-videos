// A frame's paths into an SVG group of the page: a pool of <path> elements,
// each given the item at its place in the order (no node moves, and an
// attribute is written only when it changes).
const SVGNS = 'http://www.w3.org/2000/svg';
const ATTRS = [['fill', 'fill', 'none'], ['stroke', 'stroke', null], ['sw', 'stroke-width', null], ['dash', 'stroke-dasharray', null], ['op', 'opacity', null]];

export function createPainter(g, doc = g.ownerDocument) {
  const pool = [];
  let shown = 0;
  return {
    paint(items) {
      while (pool.length < items.length) {
        const el = doc.createElementNS(SVGNS, 'path');
        g.appendChild(el);
        pool.push({ el, has: {} });
      }
      for (let k = 0; k < items.length; k++) {
        const it = items[k];
        const p = pool[k];
        p.el.setAttribute('d', it.d);
        for (const [key, attr, dflt] of ATTRS) {
          let v = it[key] ?? dflt;
          if (key === 'op' && v >= 1) v = null;
          if (p.has[key] === v) continue;
          p.has[key] = v;
          if (v == null) p.el.removeAttribute(attr); else p.el.setAttribute(attr, v);
        }
        if (k >= shown) p.el.style.display = '';
      }
      for (let k = items.length; k < shown; k++) pool[k].el.style.display = 'none';
      shown = items.length;
    },
    count: () => shown,
  };
}
