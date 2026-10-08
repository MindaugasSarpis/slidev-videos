// The dust overlay's renderer: plain WebGL2, two draw calls per sheet, no
// dependencies. A *sheet* is a grid of grains, one for each cell of a clip's
// picture, and it lives in a small world of its own seen through a camera
// like the stage's (the same 50° field of view), so that over the stage it
// reads as part of that world and not as a layer on the slide.
//
//   arriving   (style `frame`, the default) grains in the picture's own
//              colours fill the whole frame, scattered in depth, and swirl
//              in to condense into the picture exactly where the <video>
//              sits: no card, no flight. (style `flight`) grains adrift in
//              depth gather onto a plane that stands some way off, turned
//              aside; as the picture comes whole the plane swings square and
//              flies to the camera until it fills the frame. Its grains carry
//              the dust's colour adrift and take their pixel's colour as
//              they land.
//   leaving    the picture breaks up from its edges in, its grains thrown
//              toward and past the camera, so the viewer goes through them.
//              They keep the picture's colours. In `flight` the picture first
//              stands back a little, turned aside.
//
// Several sheets can run at once: stepping from one clip straight to the next
// scatters the first while the second assembles.

const VERT = `#version 300 es
precision highp float;
in vec2 aCell;          // cell centre in the picture, 0..1, y down
in vec4 aSeed;          // four independent randoms per point
uniform sampler2D uTex;
uniform vec4 uRect;     // the picture in canvas px: x, y (top-left), w, h
uniform vec4 uUv;       // the part of the frame that is visible: offset.xy, scale.xy
uniform vec2 uCanvas;   // canvas size in px
uniform float uCellPx;  // one cell's width in px
uniform float uU;       // 0..1 through the arrival or the leaving
uniform float uFade, uTime, uLeave;
uniform float uGlow;    // 1: the glow pass — the same grains again, wide and faint, added over
uniform float uFlight;  // 1: style flight, the picture as a card off in the world; 0: frame, in place
uniform vec3 uDust;
out vec4 vColor;
out float vLanded;

const float F = 2.1445;   // 1 / tan(25°): a plane at depth F with half-height 1 fills the frame

float ease(float x) { return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
vec3 turnY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
vec3 turnX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, c * v.y - s * v.z, s * v.y + c * v.z); }
float hash(vec4 s, float k) { return fract(sin(dot(s, vec4(12.9898, 78.233, 37.719, 93.989)) + k) * 43758.5453); }

void main() {
  float A = uCanvas.x / uCanvas.y;
  // the grain's cell and the picture's centre, in the units of the plane at depth F
  vec2 homePx = uRect.xy + aCell * uRect.zw, midPx = uRect.xy + 0.5 * uRect.zw;
  vec3 home = vec3((homePx.x / uCanvas.x * 2.0 - 1.0) * A, 1.0 - homePx.y / uCanvas.y * 2.0, 0.0);
  vec3 mid = vec3((midPx.x / uCanvas.x * 2.0 - 1.0) * A, 1.0 - midPx.y / uCanvas.y * 2.0, 0.0);

  // A grain sets out late by its own random and by its distance from the
  // picture's centre: the image condenses from the middle outward, and
  // breaks up from the edges in.
  float ring = clamp(length((aCell - 0.5) * vec2(1.0, uRect.w / max(uRect.z, 1.0))) / 0.6, 0.0, 1.0);
  float late = 0.55 * aSeed.x + 0.45 * ring;

  float p;        // how far the grain is home: 0 adrift … 1 in its cell
  float away;     // how far the plane stands from the frame: 1 out in the world … 0 filling the frame
  bool frame = uFlight < 0.5;
  bool arriving = uLeave < 0.5;
  if (arriving && frame) {
    p = ease(clamp(uU * 1.35 - late * 0.35, 0.0, 1.0));                // the centre is home by 0.74, the corners by 1
    away = 0.0;
  } else if (arriving) {
    p = ease(clamp(uU / 0.64 * 1.6 - late * 0.6, 0.0, 1.0));           // gathered by 0.64
    away = 1.0 - ease(clamp((uU - 0.36) / 0.64, 0.0, 1.0));            // then the flight to the frame
  } else {
    float v = max(uU - 0.08, 0.0) / 0.92;                              // the sheet comes up first
    p = 1.0 - ease(clamp(v * 1.7 - (1.0 - late) * 0.7, 0.0, 1.0));
    away = frame ? 0.0 : 0.42 * ease(clamp(v / 0.7, 0.0, 1.0));        // flight steps back first
  }
  float fly = 1.0 - p;

  // where the plane stands: off to the right and turned aside when arriving, to the left when leaving
  float side = uLeave < 0.5 ? 1.0 : -1.0;
  vec3 onPlane = turnX(turnY(home - mid, side * 0.62 * away), -0.10 * away);
  vec3 P = mid + onPlane + vec3(side * 0.62 * A * away, 0.10 * away, -F - 3.4 * away);

  // adrift: out along a random bearing, swirled about the view axis, deep
  // behind the plane when arriving, thrown at the camera when leaving
  float a = aSeed.y * 6.2831853, b = aSeed.w * 2.0 - 1.0;
  vec3 out3 = vec3(cos(a) * sqrt(1.0 - b * b), sin(a) * sqrt(1.0 - b * b), b) * (1.3 + 2.9 * aSeed.z);
  out3.z = uLeave < 0.5 ? -abs(out3.z) * 1.2 - 0.4 : abs(out3.z) * 1.5 + 2.2;
  float turn = (0.7 + 1.2 * aSeed.w) * fly * fly * (aSeed.x > 0.5 ? 1.0 : -1.0);
  float c = cos(turn), s = sin(turn);
  vec3 drift = out3 * fly;
  drift.xy = vec2(drift.x * c - drift.y * s, drift.x * s + drift.y * c);
  // never still while adrift
  drift += fly * 0.05 * vec3(sin(uTime * 0.9 + aSeed.w * 40.0), cos(uTime * 0.7 + aSeed.z * 40.0), sin(uTime * 0.6 + aSeed.x * 40.0));
  if (arriving && frame) {
    // Scattered evenly over the whole frame (a little past its edges) at
    // depths in front of and behind the picture: the spot is where the grain
    // shows on screen, so it is scaled by its depth. Then home along a swirl
    // about the frame's centre that unwinds as the grain lands.
    vec2 spot = vec2((hash(aSeed, 1.0) * 2.0 - 1.0) * A, hash(aSeed, 2.0) * 2.0 - 1.0) * 1.08;
    float z = (hash(aSeed, 3.0) - 0.5) * 2.4;
    vec3 from = vec3(mix(home.xy, spot, 0.92) * (F - z) / F, z);
    vec3 d = (from - home) * fly;
    float w = (0.15 + 0.3 * aSeed.w) * fly * (aSeed.x > 0.5 ? 1.0 : -1.0);
    float cw = cos(w), sw = sin(w);
    d.xy = vec2(d.x * cw - d.y * sw, d.x * sw + d.y * cw);
    P = home + vec3(0.0, 0.0, -F) + d + fly * 0.05 * vec3(sin(uTime * 0.9 + aSeed.w * 40.0), cos(uTime * 0.7 + aSeed.z * 40.0), 0.0);
  } else {
    P += drift;
  }

  // through the camera
  float depth = -P.z;
  if (depth < 0.14) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColor = vec4(0.0); vLanded = 0.0; return; }
  float persp = F / depth;
  gl_Position = vec4(P.x * persp / A, P.y * persp, 0.0, 1.0);

  // in its cell a grain is a touch wider than the cell, so the sheet closes
  // into one picture; adrift it is a mote. Close to the camera it is large
  // and out of focus: wide and faint.
  float flying = mix(0.34, 0.7, aSeed.z);
  float size = uCellPx * persp * mix(flying, 1.3, smoothstep(0.55, 1.0, p));
  float blur = smoothstep(1.5, 5.0, persp) * fly;
  gl_PointSize = clamp(size * (1.0 + 1.6 * blur), 1.5, 96.0);

  vec3 pix = texture(uTex, uUv.xy + aCell * uUv.zw).rgb;
  vec3 dust = uDust * (0.55 + 0.9 * aSeed.x);
  // arriving, a grain takes its pixel's colour as it lands; leaving, it
  // keeps it (lifted a little, so a dark frame still leaves lit grains)
  // In frame the scattered grains are already the picture's colours, tinted
  // by the dust, so the screen fills with the clip's own palette.
  vec3 col = !arriving
    ? mix(pix, pix * 0.7 + dust * 0.3 + 0.05, smoothstep(0.0, 0.8, fly))
    : frame
      ? mix(mix(pix, dust, 0.12) + 0.05, pix, smoothstep(0.35, 0.95, p))
      : mix(dust, pix, smoothstep(0.30, 0.92, p));
  float alpha = uFade * mix(0.5 + 0.4 * aSeed.y, 1.0, smoothstep(0.4, 1.0, p)) * (1.0 - 0.72 * blur);
  // Standing off in the world the picture is made of light: its dark parts
  // are see-through, or a night sky arrives as a black slab in front of the
  // dust. As the plane comes to the frame they fill in, and what lands is the
  // whole picture.
  float lum = max(pix.r, max(pix.g, pix.b));
  alpha *= mix(1.0, 0.12 + 0.88 * smoothstep(0.03, 0.42, lum), smoothstep(0.0, 0.55, away));
  // Scattered over the frame, the same: a dark grain adrift is faint, and the
  // dark parts of the picture fill in as their grains land.
  if (arriving && frame) alpha *= mix(1.0, 0.15 + 0.85 * smoothstep(0.03, 0.42, lum), smoothstep(0.2, 0.9, fly));
  // Arriving, the grains come up out of nothing. Leaving, the sheet comes up
  // over the picture as the <video> under it goes (0.2 s): the sheet is the
  // picture at a strip's resolution, and put up all at once over a sharp
  // frame it showed as a drop in quality before anything had moved.
  alpha *= smoothstep(0.0, uLeave < 0.5 ? 0.10 : 0.12, uU);
  vColor = vec4(col, alpha);
  vLanded = smoothstep(0.94, 1.0, p);   // square only on the last step home: a square in flight reads as confetti
  if (uGlow > 0.5) {
    // A halo round every fourth grain, brightest in mid-flight and gone by
    // the time it lands, so the settled picture is the picture and nothing more.
    float on = step(0.75, fract(aSeed.x * 7.0 + aSeed.y * 3.0));
    float airborne = smoothstep(0.0, 0.25, fly) * (1.0 - smoothstep(0.85, 1.0, fly) * 0.5);
    gl_PointSize = min(uCellPx * (3.2 + 3.0 * aSeed.z) * persp, 72.0) * on;
    vColor = vec4(mix(col, dust, 0.35), alpha * 0.14 * airborne * on);
    vLanded = 0.0;
  }
}`;

const FRAG = `#version 300 es
precision highp float;
in vec4 vColor;
in float vLanded;
out vec4 frag;
void main() {
  // a soft round grain in flight, a full square once landed
  float d = length(gl_PointCoord - 0.5);
  float grain = smoothstep(0.5, 0.12, d);
  float a = vColor.a * mix(grain, 1.0, vLanded);
  frag = vec4(vColor.rgb * a, a);     // premultiplied
}`;

const MAX_BUFFER_W = 2560;    // drawing-buffer cap, as in the stage
const MIN_COLS = 200, MAX_COLS = 448, PX_PER_CELL = 6;

const smooth = (x) => x * x * (3 - 2 * x);

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh); gl.deleteShader(sh);
    throw new Error(`video-dust shader: ${log}`);
  }
  return sh;
}

export function parseColor(value, fallback = [0.49, 0.83, 0.99]) {
  if (Array.isArray(value) && value.length >= 3) return value.slice(0, 3).map(Number);
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

// createDust(canvas) → { enter, leave, cancelAll, active, dispose } or null
// when WebGL2 is not to be had.
export function createDust(canvas) {
  let gl;
  try {
    gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  } catch { return null; }
  if (!gl) return null;

  let prog, loc, vao = null, cellBuf = null, seedBuf = null, grid = { cols: 0, rows: 0, count: 0 };
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'aCell'); gl.bindAttribLocation(prog, 1, 'aSeed');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) {
    console.warn('[slidev-addon-videos]', e.message || e);
    return null;
  }
  loc = Object.fromEntries(['uTex', 'uRect', 'uUv', 'uCanvas', 'uCellPx', 'uU', 'uFade', 'uTime', 'uLeave', 'uGlow', 'uFlight', 'uDust']
    .map((n) => [n, gl.getUniformLocation(prog, n)]));

  // One grid serves every sheet: cells are in picture fractions, so the same
  // buffers fit any rect. Rebuilt only when the canvas width class changes.
  function buildGrid(cols, rows) {
    if (grid.cols === cols && grid.rows === rows) return;
    const n = cols * rows;
    const cells = new Float32Array(n * 2), seeds = new Float32Array(n * 4);
    for (let j = 0, k = 0; j < rows; j++) for (let i = 0; i < cols; i++, k++) {
      cells[k * 2] = (i + 0.5) / cols; cells[k * 2 + 1] = (j + 0.5) / rows;
      seeds[k * 4] = Math.random(); seeds[k * 4 + 1] = Math.random(); seeds[k * 4 + 2] = Math.random(); seeds[k * 4 + 3] = Math.random();
    }
    if (!vao) { vao = gl.createVertexArray(); cellBuf = gl.createBuffer(); seedBuf = gl.createBuffer(); }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, cellBuf); gl.bufferData(gl.ARRAY_BUFFER, cells, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    grid = { cols, rows, count: n };
  }

  const sheets = new Set();
  let raf = 0, disposed = false, t0 = performance.now();
  let bufW = 1, bufH = 1, cssW = 1, cssH = 1;

  function resize() {
    const r = canvas.getBoundingClientRect();
    cssW = Math.max(1, r.width); cssH = Math.max(1, r.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2, MAX_BUFFER_W / cssW);
    const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (w !== bufW || h !== bufH || canvas.width !== w || canvas.height !== h) {
      bufW = w; bufH = h; canvas.width = w; canvas.height = h;
    }
    return r;
  }

  function texture(image) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);   // throws on a tainted source
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  function drop(sheet) {
    if (!sheets.delete(sheet)) return;
    try { gl.deleteTexture(sheet.tex); } catch { /* context gone */ }
    sheet.settle?.();
  }

  function frame(now) {
    raf = 0;
    if (disposed) return;
    const box = resize();
    const k = bufW / cssW;
    gl.viewport(0, 0, bufW, bufH);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(loc.uCanvas, bufW, bufH);
    gl.uniform1f(loc.uTime, (now - t0) / 1000);
    gl.uniform1i(loc.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    for (const s of [...sheets]) {
      const u = Math.min(1, (now - s.start) / s.duration);
      if (s.mode === 'enter') {
        s.progress = u;
        if (u >= 1 && !s.assembled) { s.assembled = true; s.onAssembled?.(); }
        if (s.releaseAt != null) {
          s.fade = 1 - smooth(Math.min(1, (now - s.releaseAt) / s.releaseMs));
          if (s.fade <= 0) { drop(s); continue; }
        }
      } else {
        s.progress = 1 - u;
        s.fade = 1 - smooth(Math.max(0, (u - 0.6) / 0.4));
        if (u >= 1) { drop(s); continue; }
      }
      // the picture's rect, from screen px to buffer px relative to the canvas
      const r = s.rect;
      gl.uniform4f(loc.uRect, (r.left - box.left) * k, (r.top - box.top) * k, r.width * k, r.height * k);
      gl.uniform4f(loc.uUv, s.uv[0], s.uv[1], s.uv[2], s.uv[3]);
      gl.uniform1f(loc.uCellPx, (r.width * k) / grid.cols);
      gl.uniform1f(loc.uU, u);
      gl.uniform1f(loc.uFade, s.fade);
      gl.uniform1f(loc.uLeave, s.mode === 'leave' ? 1 : 0);
      gl.uniform1f(loc.uFlight, s.style === 'flight' ? 1 : 0);
      gl.uniform3f(loc.uDust, s.dust[0], s.dust[1], s.dust[2]);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform1f(loc.uGlow, 0);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, grid.count);
      // the glow, added over; nothing to add once the whole sheet has landed
      if (s.mode === 'leave' || u < 0.98) {
        gl.uniform1f(loc.uGlow, 1);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, grid.count);
      }
    }
    gl.bindVertexArray(null);
    if (sheets.size) raf = requestAnimationFrame(frame);
    else { canvas.dataset.dust = 'idle'; onIdle?.(); }
  }

  let onIdle = null;
  function add(mode, { image, rect, uv = [0, 0, 1, 1], dust, duration, source = '', style = 'frame' }) {
    if (disposed || gl.isContextLost()) return null;
    resize();
    const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(bufW / PX_PER_CELL)));
    const rows = Math.max(1, Math.round(cols * rect.height / Math.max(rect.width, 1)));
    let tex;
    try { buildGrid(cols, rows); tex = texture(image); } catch { return null; }
    const sheet = {
      mode, style: style === 'flight' ? 'flight' : 'frame', tex, rect, uv, dust: parseColor(dust), duration,
      start: performance.now(), progress: mode === 'enter' ? 0 : 1, fade: 1,
      assembled: false, releaseAt: null, releaseMs: 450,
    };
    sheets.add(sheet);
    canvas.dataset.dust = [...sheets].map((s) => s.mode).join(' ');
    canvas.dataset.dustSource = source;   // where the last sheet's colours came from: live | strip
    canvas.dataset.dustStyle = sheet.style;
    canvas.dataset.dustCount = String(Number(canvas.dataset.dustCount || 0) + 1);
    if (!raf) raf = requestAnimationFrame(frame);
    return sheet;
  }

  return {
    get active() { return sheets.size > 0; },
    set onIdle(fn) { onIdle = fn; },
    // Condense the picture out of the dust. Returns a handle:
    //   assembled  resolves true when the sheet is whole (false if it was cancelled first)
    //   release(ms) fades the sheet out over ms — call it as the <video> fades in
    //   cancel()    drops the sheet now
    enter(opts) {
      const sheet = add('enter', { duration: 1900, ...opts });
      if (!sheet) return null;
      let done;
      const assembled = new Promise((res) => { done = res; });
      sheet.onAssembled = () => done(true);
      sheet.settle = () => done(false);
      return {
        assembled,
        release(ms = 450) { if (sheet.releaseAt == null) { sheet.releaseMs = Math.max(1, ms); sheet.releaseAt = performance.now(); } },
        cancel() { drop(sheet); },
      };
    },
    // Break the picture into dust. `done` resolves when the last grain is gone.
    leave(opts) {
      const sheet = add('leave', { duration: 1700, ...opts });
      if (!sheet) return null;
      let done;
      const gone = new Promise((res) => { done = res; });
      sheet.settle = () => done(true);
      return { done: gone, cancel() { drop(sheet); } };
    },
    cancelAll() { for (const s of [...sheets]) drop(s); },
    dispose() {
      if (disposed) return;
      for (const s of [...sheets]) drop(s);
      disposed = true;
      cancelAnimationFrame(raf);
      try {
        gl.deleteProgram(prog);
        if (vao) { gl.deleteVertexArray(vao); gl.deleteBuffer(cellBuf); gl.deleteBuffer(seedBuf); }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* noop */ }
    },
  };
}
