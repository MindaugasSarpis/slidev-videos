// The dust overlay's renderer: plain WebGL2, one draw call per sheet, no
// dependencies. A *sheet* is a grid of points over a clip's picture; every
// point has a home (its cell of the picture) and a scattered place out in the
// frame. `progress` blends the two, so 0 → 1 condenses the picture out of the
// dust (enter) and 1 → 0 breaks it back into dust (leave). Points carry the
// dust colour while they fly and take their pixel's colour as they land.
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
uniform float uProgress, uFade, uTime, uLeave;
uniform vec3 uDust;
out vec4 vColor;
out float vLanded;

float ease(float x) { return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }

void main() {
  vec2 home = uRect.xy + aCell * uRect.zw;
  vec2 centre = uRect.xy + 0.5 * uRect.zw;
  // Stagger: a point starts late by its own random and by its distance from
  // the picture's centre, so the image condenses from the middle outward (and
  // on the way out breaks up from the edges in).
  float ring = clamp(length((aCell - 0.5) * vec2(1.0, uRect.w / max(uRect.z, 1.0))) / 0.6, 0.0, 1.0);
  float late = 0.55 * aSeed.x + 0.45 * ring;
  float p = ease(clamp((uProgress * 1.6 - late * 0.6), 0.0, 1.0));
  float fly = 1.0 - p;

  // The scattered place: out along a random bearing, swirled about the
  // centre, and spread in depth so the cloud has a near and a far side.
  float a = aSeed.y * 6.2831853;
  float reach = (0.30 + 0.85 * aSeed.z) * max(uCanvas.x, uCanvas.y);
  vec2 out2 = vec2(cos(a), sin(a)) * reach;
  // leaving: bias the bearing away from the centre, so the picture bursts outward
  out2 = mix(out2, normalize(home - centre + vec2(0.001)) * reach, 0.55 * uLeave);
  float turn = (0.9 + 1.4 * aSeed.w) * fly * fly * (aSeed.x > 0.5 ? 1.0 : -1.0);
  float c = cos(turn), s = sin(turn);
  vec2 rel = home - centre + out2 * fly;
  rel = vec2(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  // a slow drift while flying, so a held cloud is never still
  rel += fly * 14.0 * vec2(sin(uTime * 0.9 + aSeed.w * 40.0), cos(uTime * 0.7 + aSeed.z * 40.0));
  float depth = (aSeed.w * 2.0 - 1.0) * fly;            // -1 far .. +1 near
  float persp = 1.0 / (1.0 - 0.45 * depth);
  vec2 pos = centre + rel * persp;

  gl_Position = vec4(pos.x / uCanvas.x * 2.0 - 1.0, 1.0 - pos.y / uCanvas.y * 2.0, 0.0, 1.0);
  // landed: a touch wider than the cell, so the sheet closes into one picture
  float flying = mix(0.34, 0.7, aSeed.z) * persp;
  gl_PointSize = max(uCellPx * mix(flying, 1.3, smoothstep(0.55, 1.0, p)), 1.5);

  vec3 pix = texture(uTex, uUv.xy + aCell * uUv.zw).rgb;
  vec3 dust = uDust * (0.55 + 0.9 * aSeed.x);
  vec3 col = mix(dust, pix, smoothstep(0.30, 0.92, p));
  float alpha = uFade * smoothstep(0.0, 0.12, uProgress) * mix(0.5 + 0.4 * aSeed.y, 1.0, smoothstep(0.4, 1.0, p));
  vColor = vec4(col, alpha);
  vLanded = smoothstep(0.94, 1.0, p);   // square only on the last step home: a square in flight reads as confetti
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
  loc = Object.fromEntries(['uTex', 'uRect', 'uUv', 'uCanvas', 'uCellPx', 'uProgress', 'uFade', 'uTime', 'uLeave', 'uDust']
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
        s.fade = 1 - smooth(Math.max(0, (u - 0.55) / 0.45));
        if (u >= 1) { drop(s); continue; }
      }
      // the picture's rect, from screen px to buffer px relative to the canvas
      const r = s.rect;
      gl.uniform4f(loc.uRect, (r.left - box.left) * k, (r.top - box.top) * k, r.width * k, r.height * k);
      gl.uniform4f(loc.uUv, s.uv[0], s.uv[1], s.uv[2], s.uv[3]);
      gl.uniform1f(loc.uCellPx, (r.width * k) / grid.cols);
      gl.uniform1f(loc.uProgress, s.progress);
      gl.uniform1f(loc.uFade, s.fade);
      gl.uniform1f(loc.uLeave, s.mode === 'leave' ? 1 : 0);
      gl.uniform3f(loc.uDust, s.dust[0], s.dust[1], s.dust[2]);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.drawArrays(gl.POINTS, 0, grid.count);
    }
    gl.bindVertexArray(null);
    if (sheets.size) raf = requestAnimationFrame(frame);
    else { canvas.dataset.dust = 'idle'; onIdle?.(); }
  }

  let onIdle = null;
  function add(mode, { image, rect, uv = [0, 0, 1, 1], dust, duration, source = '' }) {
    if (disposed || gl.isContextLost()) return null;
    resize();
    const cols = Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(bufW / PX_PER_CELL)));
    const rows = Math.max(1, Math.round(cols * rect.height / Math.max(rect.width, 1)));
    let tex;
    try { buildGrid(cols, rows); tex = texture(image); } catch { return null; }
    const sheet = {
      mode, tex, rect, uv, dust: parseColor(dust), duration,
      start: performance.now(), progress: mode === 'enter' ? 0 : 1, fade: 1,
      assembled: false, releaseAt: null, releaseMs: 450,
    };
    sheets.add(sheet);
    canvas.dataset.dust = [...sheets].map((s) => s.mode).join(' ');
    canvas.dataset.dustSource = source;   // where the last sheet's colours came from: live | strip
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
      const sheet = add('enter', { duration: 1400, ...opts });
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
      const sheet = add('leave', { duration: 1000, ...opts });
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
