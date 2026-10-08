// ffmpeg for the recorder: which binary, which H.264 encoder, and a pipe that
// takes PNG frames and writes a broadcast-tagged MP4.
//
// The binary: $SLIDEV_VIDEOS_FFMPEG_DIR, the active conda/mamba env, every
// env under ~/micromamba/envs (or $MAMBA_ROOT_PREFIX/envs), then PATH. A
// candidate that does not answer `ffmpeg -version` cleanly (some static
// builds crash) is passed over. The encoder: NVENC when a test encode works,
// else x264 at CRF 14 (visually lossless at 1080p; the broadcaster
// re-encodes anyway); NVENC at a constant QP of 16, as for the OBS path.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { homedir } from 'node:os';

export function ffmpegCandidates(env = process.env) {
  const dirs = [];
  if (env.SLIDEV_VIDEOS_FFMPEG_DIR) dirs.push(env.SLIDEV_VIDEOS_FFMPEG_DIR);
  if (env.CONDA_PREFIX) dirs.push(join(env.CONDA_PREFIX, 'bin'));
  for (const root of [env.MAMBA_ROOT_PREFIX, join(homedir(), 'micromamba')].filter(Boolean)) {
    try { for (const e of readdirSync(join(root, 'envs')).sort()) dirs.push(join(root, 'envs', e, 'bin')); } catch {}
  }
  dirs.push(...String(env.PATH || '').split(delimiter).filter(Boolean));
  const seen = new Set();
  return dirs.map((d) => join(d, 'ffmpeg')).filter((p) => !seen.has(p) && seen.add(p) && existsSync(p));
}

const answers = (bin) => {
  const r = spawnSync(bin, ['-hide_banner', '-version'], { timeout: 10000, encoding: 'utf8' });
  return r.status === 0 && !r.signal && /^ffmpeg version/m.test(r.stdout || '');
};

export function resolveFfmpeg(env = process.env) {
  for (const bin of ffmpegCandidates(env)) if (answers(bin)) return bin;
  throw new Error('no working ffmpeg (set SLIDEV_VIDEOS_FFMPEG_DIR to the directory of one)');
}

// A five-frame test encode: NVENC needs the driver and a free session, not just the build flag.
function encodes(bin, codec) {
  const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x144:r=50', '-frames:v', '5', '-c:v', codec, '-f', 'null', '-'], { timeout: 20000 });
  return r.status === 0 && !r.signal;
}

// pickEncoder(bin, 'auto' | 'nvenc' | 'x264') → { name, args }
export function pickEncoder(bin, want = 'auto') {
  if (want !== 'x264' && encodes(bin, 'h264_nvenc')) {
    return { name: 'h264_nvenc', args: ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'constqp', '-qp', '16'] };
  }
  if (want === 'nvenc') throw new Error('h264_nvenc does not work with this ffmpeg');
  return { name: 'libx264', args: ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14'] };
}

// encoder(bin, enc, { fps, out }) → { write(png), close() → Promise }: PNG
// frames in on stdin (image2pipe), BT.709 limited-range 4:2:0 out, a key
// frame every second so an editor can cut anywhere near.
export function encoder(bin, enc, { fps, out }) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv',
    ...enc.args,
    '-g', String(fps), '-movflags', '+faststart', out,
  ];
  const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const done = new Promise((ok, fail) => {
    p.on('error', fail);
    p.on('close', (code, signal) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${signal || code}: ${err.trim().split('\n').slice(-2).join(' ')}`))));
  });
  done.catch(() => {});
  return {
    async write(png) {
      if (!p.stdin.write(png)) await new Promise((ok) => p.stdin.once('drain', ok));
    },
    async close() { p.stdin.end(); return done; },
    kill() { p.kill('SIGKILL'); },
  };
}

// The frames of a video, small and as RGB, for the flash check.
export function decodeSmall(bin, file, { w = 48, h = 27 } = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', `scale=${w}:${h}:flags=area:in_color_matrix=bt709:in_range=tv,format=rgb24`, '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', fail);
    p.on('close', (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg could not decode ${file}`));
      const all = Buffer.concat(chunks), size = w * h * 3, frames = [];
      for (let o = 0; o + size <= all.length; o += size) frames.push(all.subarray(o, o + size));
      ok(frames);
    });
  });
}
