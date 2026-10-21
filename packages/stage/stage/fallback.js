// Where the world cannot run, what takes its place. Three layers under the
// slide's text, and which one is read as one table (fallbackLayer):
//
//   world-floor  the world, at its floor: under prefers-reduced-motion with
//                `stage.motion: floor` the deck asks for the world all the
//                same (T1 of the live fallback plan makes the engine honour the
//                floor; until then the world runs as it does)
//   plate        a recording of the slide's world (slidev-stage-record --plate:
//                NN-plate.mp4, the arrival from the slide before and a hold),
//                played muted under the text; it holds its last frame
//   living       the slide's still, breathing (stage/living.js)
//   still        the still alone: reduced motion respected (a plate and a
//                drifting still are motion too)
//
// The plates live beside the clips: public/<stage.plates>/ (default videos/,
// gitignored, served in dev and in a portable build) and on the talk's videos
// release, in the chain slidev-addon-videos builds for a clip — local first
// in dev or with VITE_VIDEOS_LOCAL_FIRST=1, the release first on a deploy.
// Pure, so node can hold it to account (test/fallback.test.mjs).

export const LAYERS = ['world', 'world-floor', 'plate', 'living', 'still'];
// the reasons a plate stands in for (diagnose.js FALLBACK_REASONS, all but reduced-motion)
export const PLATE_REASONS = ['no-webgl2', 'no-float-target', 'plugin', 'data', 'init', 'context-lost'];

const platesOn = (plates) => plates !== false && plates !== '' && plates !== null;

// reason (a FALLBACK_REASONS value, '' for none) × { motion: respect | floor,
// plates: the folder, or false } → the layer. A reason the table does not
// know is still a world that cannot run: the plate, else the living still.
export function fallbackLayer(reason, { motion = 'respect', plates = 'videos' } = {}) {
  if (!reason) return 'world';
  if (reason === 'reduced-motion') return motion === 'floor' ? 'world-floor' : 'still';
  return platesOn(plates) ? 'plate' : 'living';
}

// How slide `to`'s plate enters when the deck moves there from `from` (null:
// the layer mounting). A forward step from the slide before replays the
// arrival the recorder filmed; a back-step, a jump or a mount mid-deck holds
// the settled world, the plate's last frame: a still of the destination beats
// a flight the audience saw the other way, and after a clip slide the clip's
// end played again. The deck's opening at slide 1 is an arrival too.
export function plateEntry(from, to) {
  const f = from == null ? 0 : Number(from), t = Number(to);
  return Number.isFinite(f) && Number.isFinite(t) && t === f + 1 ? 'replay' : 'hold';
}

// One plate element's step in StagePlate's sync(): whether to seek it to its end
// now, and whether it plays or rests. The slide on screen plays unless a clip
// covers it, the tab is hidden, it has ended (play() on an ended element starts it
// over) or it was entered to hold (plateEntry): that one is seeked to its end once
// (`sought`) and rests for the whole visit, the seek in flight or landed. Letting
// go of the hold when the seek was issued played it before the seek landed (a
// back-step at Innoday read `playing`, v0.8.2). Every other slide rests.
export function plateStep({ current, hold, sought, covered, hidden, ended }) {
  const seek = !!(current && hold && !sought);
  const run = current && !covered && !hidden && !ended && !hold ? 'play' : 'pause';
  return { seek, run };
}

// `stage.plates` → the folder under public/ ('' when off), as stills.js reads `stage.stills`
export function platesDir(cfg) {
  if (cfg === false || cfg === 'false' || cfg === null) return '';
  const d = typeof cfg === 'string' && cfg.trim() ? cfg.trim() : 'videos';
  return d.replace(/^\/+|\/+$/g, '');
}

// slide no → the file the recorder wrote (bin/record.mjs: NN-plate.mp4)
export function plateName(no) {
  const n = Number(no);
  return n >= 1 ? `${String(Math.round(n)).padStart(2, '0')}-plate.mp4` : '';
}

// The URLs to try for slide no's plate, in order: the deck's own copy under
// its base (`<base>/<dir>/NN-plate.mp4`) and the release's (`<remote>/NN-plate.mp4`);
// local first where the player puts local first, else the release first (a
// deploy strips public/videos/, so a sure 404 would only delay the plate).
export function plateUrls(dir, no, { base = '/', remote = '', localFirst = false } = {}) {
  const name = plateName(no);
  const d = typeof dir === 'string' ? dir.replace(/^\/+|\/+$/g, '') : '';
  if (!name || !d) return [];
  const b = String(base || '/').replace(/\/?$/, '/');
  const local = `${b}${d}/${name}`;
  const rem = typeof remote === 'string' && remote ? `${remote.replace(/\/+$/, '')}/${name}` : '';
  const chain = localFirst ? [local, rem] : [rem, local];
  return chain.filter(Boolean);
}

// Where the plates are pulled from: `stage.platesRelease` — a URL, or
// owner/repo@tag (a GitHub release), false for none — else the videos addon's
// own release, worked out as VideoPlayer.vue does (headmatter `videos.repo`
// and `videos.release`, else VITE_VIDEO_REPO and VITE_VIDEO_RELEASE, the
// tag `videos` by default). '' when there is no repo anywhere: local only.
export function plateRelease(cfg, videos, env) {
  const dl = (repo, tag) => (repo && tag ? `https://github.com/${repo}/releases/download/${tag}` : '');
  if (cfg === false) return '';
  if (typeof cfg === 'string' && cfg.trim()) {
    const s = cfg.trim();
    if (/^https?:\/\//.test(s)) return s.replace(/\/+$/, '');
    const m = /^([^/@\s]+\/[^/@\s]+)@([^/@\s]+)$/.exec(s);
    return m ? dl(m[1], m[2]) : '';
  }
  const v = videos && typeof videos === 'object' ? videos : {};
  const e = env && typeof env === 'object' ? env : {};
  const repo = v.repo || e.VITE_VIDEO_REPO || '';
  const release = v.release || e.VITE_VIDEO_RELEASE || 'videos';
  return dl(repo, release);
}

// the player's rule: local copies first in dev, or in a build that keeps its videos
export function plateLocalFirst(env) {
  const e = env && typeof env === 'object' ? env : {};
  return !!e.DEV || e.VITE_VIDEOS_LOCAL_FIRST === '1';
}
