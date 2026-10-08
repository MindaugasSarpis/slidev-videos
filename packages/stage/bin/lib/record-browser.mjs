// A headless Chromium for the recorder, on the fastest software renderer it
// can reach. Mesa's llvmpipe (ANGLE over desktop GL) draws a 1080p stage frame
// several times faster than SwiftShader; recent headless Chromium builds no
// longer reach it in WSL, while an older headless shell in the Playwright
// cache still does. So: the browser named by --chromium or
// $SLIDEV_STAGE_CHROMIUM, then Playwright's own, then the cached headless
// shells, newest first, each on GL; SwiftShader when none of them gets a GL
// renderer. The renderer string goes into the report: two recordings are only
// comparable frame for frame on the same one.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const GL_ARGS = {
  gl: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};
const COMMON = ['--mute-audio', '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars'];

export async function loadChromium(tool = 'this tool') {
  try { return (await import('playwright-chromium')).chromium; } catch {
    throw new Error(`${tool} needs playwright-chromium: pnpm add -D playwright-chromium && pnpm exec playwright install chromium`);
  }
}

// Headless shells in the Playwright cache, newest first.
export function cachedShells() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');
  let dirs = [];
  try { dirs = readdirSync(root).filter((d) => /^chromium_headless_shell-\d+$/.test(d)); } catch { return []; }
  return dirs
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .map((d) => join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'))
    .filter((p) => existsSync(p));
}

// The WebGL2 renderer a page gets, or null without WebGL2 float targets.
export async function rendererOf(page) {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null;
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(r);
  });
}
const software = (r) => /swiftshader/i.test(r || '');

// launchBrowser({ gl: 'auto' | 'gl' | 'swiftshader', executable }) →
//   { browser, renderer, executablePath, args, version }
export async function launchBrowser(chromium, { gl = 'auto', executable = process.env.SLIDEV_STAGE_CHROMIUM || '' } = {}) {
  const tries = [];
  if (gl !== 'swiftshader') {
    if (executable) tries.push({ executablePath: executable, args: GL_ARGS.gl });
    tries.push({ executablePath: undefined, args: GL_ARGS.gl });
    if (!executable) for (const p of cachedShells()) tries.push({ executablePath: p, args: GL_ARGS.gl });
  }
  if (gl !== 'gl') tries.push({ executablePath: executable || undefined, args: GL_ARGS.swiftshader });
  let last = null;
  for (const t of tries) {
    let browser = null;
    try {
      browser = await chromium.launch({ executablePath: t.executablePath, args: [...t.args, ...COMMON], timeout: 30000 });
      const page = await browser.newPage();
      const renderer = await rendererOf(page);
      await page.close();
      const swift = t.args === GL_ARGS.swiftshader;
      if (renderer && (swift || !software(renderer))) {
        return { browser, renderer, executablePath: t.executablePath || chromium.executablePath(), args: t.args, version: browser.version() };
      }
      last = renderer || 'no WebGL2';
    } catch (e) { last = e.message.split('\n')[0]; }
    await browser?.close().catch(() => {});
  }
  throw new Error(`no browser with WebGL2 float render targets (last: ${last})`);
}
