// Generate the example deck's real clips and their frame strips:
//   example/public/videos/clip_dust.webm        (gitignored; VP9, 6 s, a tone)
//   example/public/videos/clip_dark.webm        (gitignored; 5 s of black, then 7 s of picture)
//   example/public/video-frames/*.jpg + index.json   (committed; clip_dark also has its
//     poster, the first lit frame, which print shows; clip_dust has none, so print uses its strip)
// The smoke test plays them to watch the `dust` transition end to end, and a
// clip that opens on black arrive as its first lit frame. VP9/Opus
// because Playwright's Chromium ships without the H.264 and AAC decoders.
// Usage: node scripts/make-example-clip.mjs [--strip]   (--strip also rewrites the committed strip)
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

const root = new URL('../example/public/', import.meta.url).pathname
const clip = `${root}videos/clip_dust.webm`
const run = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
  if (r.error || r.status !== 0) {
    console.error(r.error ? `ffmpeg not found: ${r.error.message}` : `ffmpeg exited ${r.status}`)
    process.exit(r.error ? 3 : 1)
  }
}

mkdirSync(`${root}videos`, { recursive: true })
run([
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=6',
  '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6',
  '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p',
  '-c:a', 'libopus', '-b:a', '32k', clip,
])
console.log(`wrote ${clip}`)

const dark = `${root}videos/clip_dark.webm`
run([
  '-f', 'lavfi', '-i', 'color=c=black:size=640x360:rate=25:duration=5',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=7',
  '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]', '-map', '[v]',
  '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-cpu-used', '8', '-an', dark,
])
console.log(`wrote ${dark}`)

if (process.argv.includes('--strip') || !existsSync(`${root}video-frames/index.json`)) {
  mkdirSync(`${root}video-frames`, { recursive: true })
  run([
    '-i', clip, '-an', '-vf',
    "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,4)',scale=320:180,setsar=1,tile=2x1:color=black",
    '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '5', '-update', '1', `${root}video-frames/clip_dust.webm.jpg`,
  ])
  run([
    '-i', dark, '-an', '-vf',
    "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,4)',scale=320:180,setsar=1,tile=3x1:color=black",
    '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '5', '-update', '1', `${root}video-frames/clip_dark.webm.jpg`,
  ])
  run(['-ss', '5.04', '-i', dark, '-an', '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', '-update', '1', `${root}video-frames/clip_dark.webm.poster.jpg`])
  writeFileSync(`${root}video-frames/index.json`, JSON.stringify({
    version: 1,
    clips: {
      'clip_dark.webm': { file: 'clip_dark.webm.jpg', tile: [320, 180], cols: 3, count: 3, interval: 4, size: [640, 360], duration: 12, poster: 'clip_dark.webm.poster.jpg', lit: 5 },
      'clip_dust.webm': { file: 'clip_dust.webm.jpg', tile: [320, 180], cols: 2, count: 2, interval: 4, size: [640, 360], duration: 6 },
    },
  }, null, 2) + '\n')
  console.log('wrote the frame strip and index.json')
}
