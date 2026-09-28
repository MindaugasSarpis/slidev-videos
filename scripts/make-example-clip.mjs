// Generate the example deck's one real clip and its frame strip:
//   example/public/videos/clip_dust.webm        (gitignored; VP9, 6 s, silent tone)
//   example/public/video-frames/clip_dust.webm.jpg + index.json   (committed)
// The smoke test plays it to watch the `dust` transition end to end. VP9/Opus
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

if (process.argv.includes('--strip') || !existsSync(`${root}video-frames/index.json`)) {
  mkdirSync(`${root}video-frames`, { recursive: true })
  run([
    '-i', clip, '-an', '-vf',
    "select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,4)',scale=320:180,setsar=1,tile=2x1:color=black",
    '-fps_mode', 'vfr', '-frames:v', '1', '-q:v', '5', '-update', '1', `${root}video-frames/clip_dust.webm.jpg`,
  ])
  writeFileSync(`${root}video-frames/index.json`, JSON.stringify({
    version: 1,
    clips: {
      'clip_dust.webm': { file: 'clip_dust.webm.jpg', tile: [320, 180], cols: 2, count: 2, interval: 4, size: [640, 360], duration: 6 },
    },
  }, null, 2) + '\n')
  console.log('wrote the frame strip and index.json')
}
