// A rough flash check on a recording, after the broadcast rule (ITU-R
// BT.1702, Ofcom): no more than three flashes in any one second where the
// change covers more than a quarter of the screen. A flash is a pair of
// opposing changes in luminance of 20 cd/m² or more (a tenth of a 200 cd/m²
// screen) with the darker state under 160 cd/m². This is a warning light for
// the engine's bursts, not a certificate: run the finished programme through
// a real analyser (EA's IRIS is free) before it goes out.
//
//   findFlashes(frames, { w, h, fps }) → { transitions: [{ frame, t, dir, area }], warnings: [{ t, flashes }] }
//
// `frames` are w × h RGB24 buffers (the video scaled down, decodeSmall).

const DELTA = 0.1;       // the luminance change that counts, of full white
const DARK = 0.8;        // the darker of the two states must be below this
const AREA = 0.25;       // of the screen
const GATHER = 3;        // frames a change may take to cover its area
const PER_SECOND = 3;    // flashes allowed in any one second

const lin = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2));
export function luminance(rgb, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.2126 * lin[rgb[i * 3]] + 0.7152 * lin[rgb[i * 3 + 1]] + 0.0722 * lin[rgb[i * 3 + 2]];
  return out;
}

export function findFlashes(frames, { w, h, fps }) {
  const n = w * h;
  const ext = new Float32Array(n), dir = new Int8Array(n);    // each cell's last turning point and where it is heading
  const recent = [];                                          // per frame: cells that turned, by direction
  const transitions = [];
  let primed = false;
  frames.forEach((rgb, f) => {
    const L = luminance(rgb, n);
    if (!primed) { ext.set(L); primed = true; recent.push({ up: 0, down: 0 }); return; }
    let up = 0, down = 0;
    for (let i = 0; i < n; i++) {
      const v = L[i];
      if (dir[i] === 0) {
        // from the first frame's level: the first change either way
        if (v >= ext[i] + DELTA && ext[i] < DARK) { up++; dir[i] = 1; ext[i] = v; }
        else if (v <= ext[i] - DELTA && v < DARK) { down++; dir[i] = -1; ext[i] = v; }
      } else if (dir[i] > 0) {
        // heading up: follow the peak, turn on a fall of DELTA from it
        if (v > ext[i]) ext[i] = v;
        else if (v <= ext[i] - DELTA && v < DARK) { down++; dir[i] = -1; ext[i] = v; }
      } else {
        if (v < ext[i]) ext[i] = v;
        else if (v >= ext[i] + DELTA && ext[i] < DARK) { up++; dir[i] = 1; ext[i] = v; }
      }
    }
    recent.push({ up, down });
    if (recent.length > GATHER) recent.shift();
    // a change that takes a few frames to sweep the screen still counts once
    for (const d of ['up', 'down']) {
      const area = recent.reduce((s, r) => s + r[d], 0) / n;
      if (area > AREA) {
        transitions.push({ frame: f, t: +(f / fps).toFixed(3), dir: d, area: +area.toFixed(3) });
        for (const r of recent) r[d] = 0;
      }
    }
  });
  // two opposing transitions make a flash; count them in every one-second window
  const flashesIn = (a, b) => {
    const ts = transitions.filter((x) => x.t >= a && x.t < b);
    let k = 0;
    for (let i = 1; i < ts.length; i++) if (ts[i].dir !== ts[i - 1].dir) k++;
    return Math.floor((k + 1) / 2);
  };
  const warnings = [];
  for (const x of transitions) {
    const k = flashesIn(x.t, x.t + 1);
    if (k > PER_SECOND && !warnings.some((w) => x.t - w.t < 1)) warnings.push({ t: x.t, flashes: k });
  }
  return { transitions, warnings };
}
