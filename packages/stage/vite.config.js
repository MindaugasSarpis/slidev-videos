// Slidev merges a vite.config from every root: the theme, each addon, the
// deck (@slidev/cli resolveViteConfigs). So this one reaches every deck that
// uses the addon. (Plain code: 'vite' does not resolve from a deck's install
// of the addon.)
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Does `three` resolve from the deck's directory: its own node_modules, or a
// workspace's above it?
export function deckHasThree(root) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules', 'three', 'package.json'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

export default {
  // In `slidev dev` Vite would pre-bundle 'slidev-addon-stage' for a deck's
  // setup/main.ts while the addon's components import its source: two copies
  // of the engine, and a builder or palette the deck registers lands in the
  // copy the world does not read. Kept out of the pre-bundle, the deck, its
  // own builders and the engine share one module of each.
  optimizeDeps: { exclude: ['slidev-addon-stage', 'three'] },
  plugins: [{
    name: 'slidev-addon-stage:one-three',
    // A deck whose builders import three has its own copy, and when the addon
    // comes from elsewhere (a checkout linked in, or an install that resolved
    // another three) the engine imports a second one: 'Multiple instances of
    // Three.js being imported', and a builder's objects made by one copy in a
    // scene drawn by the other. Resolve three from the deck for both. A deck
    // with no three of its own keeps the addon's (dedupe would leave the
    // engine's import unresolved).
    config: (config) => (deckHasThree(config.root || process.cwd()) ? { resolve: { dedupe: ['three'] } } : null),
  }],
};
