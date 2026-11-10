// The explainers this package ships, by name. Each is a folder of
//   spec.json    the scene, written by hand
//   make.mjs     reduce(source text) → input.json, make(input) → data.json
//   input.json   what the scene needs of its source file, with the file's SHA-256
//   data.json    the numbers the scene draws (generated: `explain3d make`)
//   golden.svg   its opening view, 960 × 540 (generated: `explain3d golden`)
export const EXPLAINERS = ['line-fit-valley', 'neuron-plane', 'xor-ridge', 'hours-columns'];

/** The size of every golden picture. */
export const GOLDEN = { width: 960, height: 540 };
