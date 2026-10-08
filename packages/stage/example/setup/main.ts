// The example deck's own builder joins the engine's registry before the stage
// boots. A deck imports 'slidev-addon-stage'; this example lives inside the
// package, so it imports the package's own entry.
//
// A plain function: Slidev calls a setup/main.ts default export with
// { app, router }. (defineAppSetup from @slidev/types is the identity, and
// @slidev/types is not a package a deck can import under pnpm.)
import { registerBuilder } from '../../index.js'
import { buildTally } from './tally.js'

export default () => {
  registerBuilder('tally', buildTally, { fields: ['pos', 'name'] })
}
