// The music's level at the presenter's hand (from Innoday's and Užsikrauk
// karjerai's setup/soundLevel.js, Oct 2026): `+` (or `=`) and `-` (or `_`) step
// every <StageSoundtrack> level by a tenth of what is written, from silent to
// twice it. On a slide with a clip the same keys are the clip's own (the videos
// addon's player marks the press handled): this steps only when nothing else
// took it, except on a page `musicKeys(n)` gives to the music. The level sticks
// in this browser and crosses windows (a press in the presenter's window sets
// the audience window's music, where it plays); the presenter's window shows it
// for a moment, the audience sees nothing.
import { shared } from './shared.js';

const KEY = 'slidev-stage:sound';
const state = shared('sound-level', () => ({ level: read(), subs: new Set(), pages: new Set(), installed: false }));

function read() {
  try {
    const v = parseFloat(localStorage.getItem(KEY));
    return Number.isFinite(v) && v >= 0 && v <= 2 ? v : 1;
  } catch { return 1; }
}
function apply(v) {
  state.level = v;
  for (const f of state.subs) { try { f(v); } catch { /* a listener */ } }
}
// the multiplier on every written level (1: as written)
export const soundLevel = () => state.level;
// f(level) on every change → unsubscribe
export function onSoundLevel(f) { state.subs.add(f); return () => state.subs.delete(f); }
// a page where the keys are the music's even over a clip
export const musicKeys = (n) => { state.pages.add(Number(n)); };
// one step, 0..2 in tenths
export const stepLevel = (v, up) => Math.max(0, Math.min(2, Math.round((v + (up ? 0.1 : -0.1)) * 10) / 10));

const pageNow = () => Number((location.hash.match(/(\d+)(?:\?.*)?$/) || location.pathname.match(/\/(\d+)\/?$/) || [])[1] || 0);
function step(up) {
  const v = stepLevel(state.level, up);
  try { localStorage.setItem(KEY, String(v)); } catch { /* private mode */ }
  apply(v);
  flash(v);
}
let badge = null, badgeTimer = 0;
function flash(v) {
  if (!/presenter/.test(location.hash + location.pathname)) return;
  if (!badge) {
    badge = document.createElement('div');
    badge.className = 'stage-sound-badge';
    badge.setAttribute('aria-live', 'polite');
    Object.assign(badge.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: 1000, padding: '6px 12px', borderRadius: '6px',
      font: '600 14px/1.2 system-ui, sans-serif', color: '#fff', background: 'rgba(0,0,0,0.7)', transition: 'opacity 0.3s', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(badge);
  }
  badge.textContent = `♪ ${Math.round(v * 100)} %`;
  badge.style.opacity = '1';
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => { badge.style.opacity = '0'; }, 1200);
}
const isKey = (e) => {
  const up = e.key === '+' || e.key === '=', down = e.key === '-' || e.key === '_';
  if ((!up && !down) || e.metaKey || e.ctrlKey || e.altKey) return null;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return null;
  return { up };
};
export function installSoundKeys() {
  if (typeof window === 'undefined' || state.installed) return;
  state.installed = true;
  addEventListener('storage', (e) => { if (e.key === KEY) apply(read()); });
  // after every other listener: a clip's player takes the press first
  addEventListener('keydown', (e) => { const k = isKey(e); if (k) setTimeout(() => { if (!e.defaultPrevented) step(k.up); }); });
  // on a music page the press is the music's before the clip's player sees it
  addEventListener('keydown', (e) => {
    const k = isKey(e);
    if (!k || !state.pages.has(pageNow())) return;
    e.preventDefault(); e.stopImmediatePropagation();
    step(k.up);
  }, true);
}
