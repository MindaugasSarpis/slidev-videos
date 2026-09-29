// What the players and the dust overlay share. Module scope, so there is one
// of each per page however many VideoPlayer instances a deck mounts.

// ---- the overlay ------------------------------------------------------------
// VideoDust.vue registers itself here; a player asks for it when its slide
// comes or goes. No overlay (the deck symlinks the components instead of
// loading the addon, or WebGL2 is missing) → the player falls back to `fade`.
let overlay = null;
export function registerOverlay(o) {
  overlay = o;
  return () => { if (overlay === o) overlay = null; };
}
export const getOverlay = () => overlay;

// ---- what other addons can listen to ------------------------------------------
// window events, so a listener needs no import from this package:
//   slidev-videos:transition  { phase: 'enter' | 'leave', mode, src, duration }
//   slidev-videos:cover       { covered: boolean, src }   the clip hides what is under it
// slidev-addon-stage stirs its dust on the first and rests its renderer on
// the second.
export function announce(type, detail) {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent(`slidev-videos:${type}`, { detail })); } catch { /* noop */ }
}

// ---- frame strips -------------------------------------------------------------
// `slidev-videos frames` writes public/video-frames/<clip>.jpg (a grid of
// small tiles, one every few seconds) and index.json beside them. Release
// assets are served without CORS headers, so in a deployed deck the page
// cannot read a clip's pixels; the strip is where the dust gets its colours.
let indexPromise = null;
const base = () => (import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/');

export function loadFrameIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${base()}video-frames/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j && typeof j === 'object' ? j.clips || {} : null))
      .catch(() => null);
  }
  return indexPromise;
}

const strips = new Map();   // file → Promise<HTMLImageElement | null>
function loadStrip(file) {
  if (!strips.has(file)) {
    strips.set(file, new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${base()}video-frames/${file}`;
    }));
  }
  return strips.get(file);
}

// Fetch a clip's strip ahead of its slide, so the enter does not wait on it.
export async function warmStrip(src) {
  const entry = (await loadFrameIndex())?.[src];
  if (entry) await loadStrip(entry.file);
  return !!entry;
}

// The tile at or just before `time` seconds, as its own canvas; null when the
// clip has no strip. `size` is the clip's real frame size (for the fit maths).
export async function stripFrame(src, time = 0) {
  const entry = (await loadFrameIndex())?.[src];
  if (!entry) return null;
  const img = await loadStrip(entry.file);
  if (!img) return null;
  const [tw, th] = entry.tile;
  const i = Math.min(entry.count - 1, Math.max(0, Math.floor((time + 1e-3) / entry.interval)));
  const c = document.createElement('canvas');
  c.width = tw; c.height = th;
  c.getContext('2d').drawImage(img, (i % entry.cols) * tw, Math.floor(i / entry.cols) * th, tw, th, 0, 0, tw, th);
  return { image: c, size: entry.size || [tw, th], source: 'strip' };
}

// The frame a <video> is showing right now, when the page may read it (same
// origin: dev mode, venue and portable builds). A cross-origin clip taints the
// canvas and getImageData throws; that is the signal to use the strip.
export function liveFrame(video) {
  if (!video || video.readyState < 2 || !video.videoWidth) return null;
  try {
    const w = Math.min(640, video.videoWidth);
    const h = Math.max(2, Math.round(w * video.videoHeight / video.videoWidth));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.drawImage(video, 0, 0, w, h);
    g.getImageData(0, 0, 1, 1);
    return { image: c, size: [video.videoWidth, video.videoHeight], source: 'live' };
  } catch { return null; }
}

// The mean colour of a frame, as [r, g, b] in 0..1 (null if it cannot be
// read). Weighted toward the lit and the coloured parts, so a picture that is
// mostly black sky with one blue planet says blue, not black.
export function meanColor(image) {
  try {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 9;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0, 16, 9);
    const d = g.getImageData(0, 0, 16, 9).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
      const hi = Math.max(R, G, B), lo = Math.min(R, G, B);
      const k = 0.05 + hi * (0.4 + 1.6 * (hi - lo));
      r += R * k; gr += G * k; b += B * k; w += k;
    }
    return w > 0 ? [r / w, gr / w, b / w] : null;
  } catch { return null; }
}

// Where the picture sits inside the player, and which part of the frame shows.
// box: the player's rect (screen px); size: the frame's [w, h]; fit: cover | contain.
// → { rect: {left, top, width, height}, uv: [u0, v0, du, dv] }
export function fitPicture(box, size, fit) {
  const [vw, vh] = size;
  if (!(vw > 0 && vh > 0 && box.width > 0 && box.height > 0)) {
    return { rect: { left: box.left, top: box.top, width: box.width, height: box.height }, uv: [0, 0, 1, 1] };
  }
  if (fit === 'contain') {
    const k = Math.min(box.width / vw, box.height / vh);
    const w = vw * k, h = vh * k;
    return { rect: { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h }, uv: [0, 0, 1, 1] };
  }
  const k = Math.max(box.width / vw, box.height / vh);
  const fx = box.width / (vw * k), fy = box.height / (vh * k);
  return { rect: { left: box.left, top: box.top, width: box.width, height: box.height }, uv: [(1 - fx) / 2, (1 - fy) / 2, fx, fy] };
}
