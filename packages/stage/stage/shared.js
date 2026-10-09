// State that must be one per page, however many copies of the package the
// page has loaded. In `slidev dev`, a deck's setup/main.ts imports
// 'slidev-addon-stage' as a dependency, which Vite may pre-bundle, while the
// addon's own components import its source: two module copies. A builder,
// palette or plugin registered through one must be what the engine reads
// through the other, so each registry lives on globalThis under a symbol,
// made by whichever copy loads first.
//
//   shared('registry', () => new Map())  →  globalThis[Symbol.for('slidev-addon-stage/registry')]
export const shared = (name, make) => (globalThis[Symbol.for(`slidev-addon-stage/${name}`)] ??= make());
