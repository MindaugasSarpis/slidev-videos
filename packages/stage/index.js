// slidev-addon-stage — what a deck can import.
//
//   // setup/main.ts in the deck
//   import { defineAppSetup } from '@slidev/types'
//   import { registerBuilder, definePalette, usePlugin } from 'slidev-addon-stage'
//
//   export default defineAppSetup(() => {
//     definePalette('venue', { accent: '#ff5c8a', dust: '#b03060' })
//     registerBuilder('beacon', (o, ctx) => { … return { group } }, { fields: ['pos'] })
//   })
//
// Everything registered before the Stage component boots is available to the
// deck's space.json.

import { registerBuilder, hasBuilder, builderTypes, builderFields, buildStation, buildConstellation, helpers } from './stage/builders.js';
import { buildGalaxy, buildCollider } from './stage/forms.js';
import { setLabelSegmenter, setLabelFont, makeLabel, makeText } from './stage/labels.js';
import { orb, marble, shell, ball, setOrb } from './stage/materials.js';
import { PALETTES, DEFAULT_PALETTE, LOOKS, definePalette, resolvePalette, resolveLook, liftGround, paletteVars } from './stage/palette.js';
import { createSpace } from './stage/space.js';
import { warmAudio, playCollision, playWhoosh, playRise, startHum, stopHum, humProbe } from './stage/sound.js';

// Plugins shipped with the package, loaded on demand by name
// (`stage.plugins: [hadron]`), so a deck that does not want one never
// downloads it.
const SHIPPED = {
  hadron: () => import('./stage/plugins/hadron.js'),
};
const installed = new Set();
const api = { registerBuilder, setLabelSegmenter, setLabelFont, definePalette, helpers };

// usePlugin('hadron') | usePlugin({ name, install(api) }) → Promise<boolean>
export async function usePlugin(plugin) {
  let mod = plugin;
  if (typeof plugin === 'string') {
    if (installed.has(plugin)) return true;
    const load = SHIPPED[plugin];
    if (!load) { console.warn(`stage: no plugin named "${plugin}" (shipped: ${Object.keys(SHIPPED).join(', ')})`); return false; }
    mod = await load();
  }
  if (!mod || typeof mod.install !== 'function') { console.warn('stage: a plugin must export install(api)'); return false; }
  const key = mod.name || plugin;
  if (installed.has(key)) return true;
  mod.install(api);
  installed.add(key);
  return true;
}
export const shippedPlugins = () => Object.keys(SHIPPED);

export {
  createSpace,
  registerBuilder, hasBuilder, builderTypes, builderFields, buildStation, buildConstellation, buildGalaxy, buildCollider, helpers,
  setLabelSegmenter, setLabelFont, makeLabel, makeText,
  orb, marble, shell, ball, setOrb,
  PALETTES, DEFAULT_PALETTE, LOOKS, definePalette, resolvePalette, resolveLook, liftGround, paletteVars,
  warmAudio, playCollision, playWhoosh, playRise, startHum, stopHum, humProbe,
};
