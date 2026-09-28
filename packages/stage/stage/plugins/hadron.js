import {
  Group, Mesh, MeshBasicMaterial, PlaneGeometry, SphereGeometry, BufferGeometry, Line, LineDashedMaterial,
  Vector3, DoubleSide, AdditiveBlending,
} from 'three';
import { buildConstellation, v3 } from '../builders.js';
import { makeLabel } from '../labels.js';
import { marble, orb, shell, setOrb } from '../materials.js';
import { subscriptSegments } from './hadron-names.js';

// The hadron plugin: what Startertalk ("Pentaquarks at LHCb") adds to the
// general stage. Quarks coloured by flavour; clusters, molecules and the
// particle pentaquark; state markers laid out by mass; and particle names set
// with their flavour as a subscript in every world label.
//
//   stage:
//     plugins: [hadron]
//
// Object types: pentaquark | cluster | molecule | spheres | planes.

export const QUARK = { c: '#3987e5', cbar: '#3987e5', u: '#e6e9ee', d: '#c9d1da', s: '#d95926', sbar: '#d95926', b: '#7bd88f', bbar: '#7bd88f' };
export const FLAVOUR = {
  c: { grain: '#4f9cff', core: '#dff0ff' }, cbar: { grain: '#8e7dff', core: '#efe9ff' },
  u: { grain: '#dfe6ee', core: '#ffffff' }, d: { grain: '#b9c4d0', core: '#ffffff' },
  s: { grain: '#f0925c', core: '#fff1e6' }, sbar: { grain: '#f0b07c', core: '#fff1e6' },
};

function quarkBall(q, r = 0.42, { ghost = false } = {}) {
  const color = QUARK[q.flavour] || '#e6e9ee';
  const charm = q.flavour === 'c' || q.flavour === 'cbar';
  const m = new Mesh(new SphereGeometry(r, 32, 24), ghost ? orb(color, { opacity: 0.55, core: 0.22 }) : marble(color, { glow: charm ? 0.35 : 0.16 }));
  m.position.copy(v3(q.pos));
  if (!ghost) m.add(shell(r * 1.22, color, 0.14));   // a thin rim of glow around the marble
  if (/bar$/.test(q.flavour || '')) m.add(shell(r * 1.14, '#ffffff', ghost ? 0.08 : 0.16));   // antiquark: a thin white rim
  return m;
}

// the particle pentaquark: a constellation whose nodes are quarks
function pentaquark(o, ctx) {
  const nodes = (o.quarks || []).map((q) => { const f = FLAVOUR[q.flavour] || FLAVOUR.u; return { pos: q.pos, color: f.grain, core: f.core }; });
  return buildConstellation({ ...o, nodes, nodeRadius: o.quarkRadius ?? o.nodeRadius }, ctx);
}

function cluster(o, ctx) {
  // `ghost: true` draws the cluster as a state that went away (the Θ⁺):
  // faint orbs that breathe apart and back together and never quite hold.
  const g = new Group(); const labels = []; const balls = new Group();
  const home = [];
  for (const q of o.quarks) { const b = quarkBall(q, 0.42 * (o.radius / 1.9) * (o.quarkScale || 1), { ghost: !!o.ghost }); balls.add(b); home.push(b.position.clone()); }
  g.add(balls);
  if (o.shell) g.add(shell(o.radius, ctx.palette.accent, o.ghost ? 0.07 : 0.16));
  if (o.core) g.add(shell(o.radius * 0.38, ctx.palette.accent, 0.14));   // an inner glow, the binding
  // `orbit: true`: each quark rides its own tilted ring through its home
  // position, at its own pace — the cluster lives instead of turning as a block
  const rings = o.orbit ? home.map((h, i) => {
    const n = new Vector3(Math.sin(i * 2.1), 0.8 + 0.6 * Math.cos(i * 1.3), Math.sin(i * 0.7)).normalize();
    const u = h.clone().sub(n.clone().multiplyScalar(h.dot(n))).normalize();
    const w = new Vector3().crossVectors(n, u);
    return { r: h.length(), u, w, speed: 0.22 + 0.11 * (i % 3), phase: i * 1.7 };
  }) : null;
  if (o.label) { const l = makeLabel(o.label, { worldH: 0.4, color: ctx.palette.fg, letterSpacing: 0.08 }); l.position.set(0, o.radius + 0.7, 0); g.add(l); labels.push(l); }
  g.position.copy(v3(o.pos));
  const anchors = o.id ? new Map([[o.id, new Vector3(0, 0, 0)]]) : undefined;   // a cluster can stand for a state (Θ⁺)
  return { group: g, labels, anchors, update(t) {
    balls.rotation.y = t * (o.spin || 0); balls.rotation.x = Math.sin(t * 0.3) * 0.15;
    if (rings) balls.children.forEach((b, i) => {
      const k = rings[i], a = k.phase + t * k.speed;
      b.position.copy(k.u).multiplyScalar(k.r * Math.cos(a)).addScaledVector(k.w, k.r * Math.sin(a));
    });
    if (o.ghost) {
      // a slow breath (5.5 s) pulls the quarks apart to twice their spacing and lets them fall back;
      // the orbs are dimmest when farthest apart — a bound state that will not stay bound
      const u = 0.5 - 0.5 * Math.cos(t * 1.15);
      balls.children.forEach((b, i) => {
        b.position.copy(home[i]).multiplyScalar(1 + 1.1 * u + 0.08 * Math.sin(t * 2.1 + i));
        setOrb(b.material, 'uOpacity', 0.6 - 0.35 * u);
      });
    }
  } };
}

function molecule(o, ctx) {
  const g = new Group(); const labels = [];
  const A = new Group(), B = new Group();
  for (const q of o.a.quarks) A.add(quarkBall(q, 0.42)); A.add(shell(o.a.radius, ctx.palette.accent)); A.position.x = -o.separation / 2;
  for (const q of o.b.quarks) B.add(quarkBall(q, 0.42)); B.add(shell(o.b.radius, ctx.palette.accent)); B.position.x = o.separation / 2;
  g.add(A, B);
  let link = null;
  if (o.link) {
    // exchange glow: a faint additive dashed line between the shells, pulsing
    const geo = new BufferGeometry().setFromPoints([new Vector3(-o.separation / 2 + o.a.radius, 0, 0), new Vector3(o.separation / 2 - o.b.radius, 0, 0)]);
    link = new LineDashedMaterial({ color: ctx.palette.accent, transparent: true, opacity: 0.6, dashSize: 0.3, gapSize: 0.2, blending: AdditiveBlending, depthWrite: false });
    const line = new Line(geo, link); line.computeLineDistances(); g.add(line);
  }
  if (o.label) { const l = makeLabel(o.label, { worldH: 0.4, color: ctx.palette.fg, letterSpacing: 0.08 }); l.position.set(0, Math.max(o.a.radius, o.b.radius) + 0.7, 0); g.add(l); labels.push(l); }
  g.position.copy(v3(o.pos));
  return { group: g, labels, update(t) { A.rotation.y = t * 0.12; B.rotation.y = -t * 0.15; if (link) link.opacity = 0.35 + 0.25 * Math.sin(t * 1.3); } };
}

function spheres(o, ctx) {
  // state markers placed by mass: an observed state is a full marble, an
  // evidence / candidate / superseded one the same marble at a third of the light
  const g = new Group(); const labels = []; const anchors = new Map();
  o.ids.forEach((id, i) => {
    const s = ctx.records.get(id); if (!s) return;
    const row = id.startsWith('Pcs') ? 'Pcs' : 'Pc';
    const x = (s.mass - o.origin) * o.scale, z = o.rows[row];
    const established = s.status === 'observed';
    const color = row === 'Pcs' ? '#d95926' : '#3987e5';
    const m = new Mesh(new SphereGeometry(0.26, 32, 24), established ? marble(color, { glow: 0.45 }) : marble(color, { glow: 0.08, opacity: 0.5 }));
    m.position.set(x, 0, z); g.add(m);
    if (established) { const halo = shell(0.4, color, 0.12); halo.position.set(x, 0, z); g.add(halo); }
    anchors.set(id, new Vector3(x, 0, z));
    if (o.labels) { const l = makeLabel(s.label || id, { worldH: 0.3, color: ctx.palette.ink, letterSpacing: 0.02, upper: false }); l.position.set(x, 0.75 + (i % 2) * 0.32, z); g.add(l); labels.push(l); }
  });
  g.position.copy(v3(o.pos));
  return { group: g, labels, anchors };
}

function planes(o, ctx) {
  const g = new Group(); const labels = [];
  for (const p of o.planes) {
    const x = (p.mass - o.origin) * o.scale, z = (o.rows && o.rows[p.row]) ?? 0;
    const m = new Mesh(new PlaneGeometry(o.depth, o.height), new MeshBasicMaterial({ color: ctx.palette.accent, transparent: true, opacity: 0.07, side: DoubleSide, depthWrite: false, blending: AdditiveBlending }));
    m.rotation.y = Math.PI / 2; m.position.set(x, 0, z); g.add(m);
    const l = makeLabel(p.label, { worldH: 0.26, color: ctx.palette.dim, letterSpacing: 0.02, upper: false }); l.position.set(x, o.height / 2 + 0.25, z); g.add(l); labels.push(l);
  }
  g.position.copy(v3(o.pos));
  return { group: g, labels };
}

export const name = 'hadron';
// The object types this plugin adds, with the fields each must carry (the
// validator reads this without running any three.js).
export const types = {
  pentaquark: ['pos', 'radius', 'quarks'],
  cluster: ['pos', 'radius', 'quarks'],
  molecule: ['pos', 'separation', 'a', 'b'],
  spheres: ['pos', 'ids', 'origin', 'scale', 'rows'],
  planes: ['pos', 'planes', 'origin', 'scale', 'height', 'depth'],
};
export function install({ registerBuilder, setLabelSegmenter }) {
  const fns = { pentaquark, cluster, molecule, spheres, planes };
  for (const [type, fields] of Object.entries(types)) registerBuilder(type, fns[type], { fields });
  setLabelSegmenter(subscriptSegments);
}
export { subscriptHtml, subscriptSegments } from './hadron-names.js';
