// Slidev merges a vite.config from every root: the theme, each addon, the
// deck (@slidev/cli resolveViteConfigs). So this one reaches every deck that
// uses the addon.
//
// In `slidev dev` Vite would pre-bundle 'slidev-addon-stage' for a deck's
// setup/main.ts while the addon's components import its source: two copies
// of the engine, and three.js twice ('Multiple instances of Three.js being
// imported'). Kept out of the pre-bundle, the deck, its own builders and the
// engine share one module of each. (A plain object: 'vite' does not resolve
// from a deck's install of the addon.)
export default { optimizeDeps: { exclude: ['slidev-addon-stage', 'three'] } };
