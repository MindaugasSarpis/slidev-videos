// xor-ridge: the output ŷ of a trained 2-2-1 network of sigmoid neurons over
// the whole plane of its two inputs: a ridge, high at (0, 1) and (1, 0), low at
// (0, 0) and (1, 1); and its two hidden neurons, each one slope (Lecture 11,
// "XOR Learned from Random Weights").
//
//   reduce(text)  the nine starting weights, as the course draws them → input.json
//   make(input)   input.json → data.json: 2000 steps of gradient descent, then the three surfaces
//
// The nine starting weights are those of the course's figures/src/language.py,
// xor_trained(seed=0): Python's random.Random(0), nine draws of uniform(-1, 1),
// in the order V11, V12, V21, V22, c1, c2, w1, w2, b. Print them with
//   python3 -c "import random; r = random.Random(0); print([r.uniform(-1, 1) for _ in range(9)])"
// and give the printed line to `explain3d reduce xor-ridge <file>`.
// Deterministic: no clock, no random numbers here, no network.

export const source = {
  file: 'figures/src/language.py',
  repo: 'https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis',
  what: 'the nine starting weights of xor_trained(seed=0): random.Random(0), nine draws of uniform(-1, 1), printed as a list',
};

export const ETA = 2;
export const STEPS = 2000;
export const GATE = [[0, 0], [0, 1], [1, 0], [1, 1]];
export const XOR = [0, 1, 1, 0];
export const GRID = { nx: 49, ny: 49, x: [-0.25, 1.25], y: [-0.25, 1.25] };

export function reduce(text) {
  const start = JSON.parse(text);
  if (!Array.isArray(start) || start.length !== 9 || start.some((v) => typeof v !== 'number')) throw new Error('xor-ridge: nine numbers are needed');
  return { start };
}

const sigma = (z) => 1 / (1 + Math.exp(-z));

/** The network: hidden h = σ(V x + c), output ŷ = σ(w · h + b). */
export function forward(net, x1, x2) {
  const h = [0, 1].map((j) => sigma(net.V[j][0] * x1 + net.V[j][1] * x2 + net.c[j]));
  return { h, y: sigma(net.w[0] * h[0] + net.w[1] * h[1] + net.b) };
}

/** Gradient descent on the mean cross-entropy of the four points, all four per step. */
export function train(start, eta = ETA, steps = STEPS) {
  const net = { V: [[start[0], start[1]], [start[2], start[3]]], c: [start[4], start[5]], w: [start[6], start[7]], b: start[8] };
  const loss = [];
  for (let k = 0; k <= steps; k++) {
    const gV = [[0, 0], [0, 0]], gc = [0, 0], gw = [0, 0];
    let gb = 0, L = 0;
    GATE.forEach(([x1, x2], i) => {
      const { h, y } = forward(net, x1, x2);
      L += -(XOR[i] * Math.log(y) + (1 - XOR[i]) * Math.log(1 - y));
      const d = y - XOR[i];
      gb += d;
      for (let j = 0; j < 2; j++) {
        gw[j] += d * h[j];
        const dj = d * net.w[j] * h[j] * (1 - h[j]);
        gV[j][0] += dj * x1; gV[j][1] += dj * x2; gc[j] += dj;
      }
    });
    loss.push(L / 4);
    if (k === steps) break;
    for (let j = 0; j < 2; j++) {
      net.w[j] -= (eta * gw[j]) / 4; net.c[j] -= (eta * gc[j]) / 4;
      net.V[j][0] -= (eta * gV[j][0]) / 4; net.V[j][1] -= (eta * gV[j][1]) / 4;
    }
    net.b -= (eta * gb) / 4;
  }
  return { net, loss };
}

const round = (v, d) => Number(v.toFixed(d));

export function make(input) {
  const { net, loss } = train(input.start);
  const h1 = [], h2 = [], y = [];
  for (let j = 0; j < GRID.ny; j++) {
    const x2 = GRID.y[0] + ((GRID.y[1] - GRID.y[0]) * j) / (GRID.ny - 1);
    for (let i = 0; i < GRID.nx; i++) {
      const f = forward(net, GRID.x[0] + ((GRID.x[1] - GRID.x[0]) * i) / (GRID.nx - 1), x2);
      h1.push(round(f.h[0], 4)); h2.push(round(f.h[1], 4)); y.push(round(f.y, 4));
    }
  }
  const at = GATE.map(([a, b]) => forward(net, a, b));
  return {
    h1, h2, y,
    numbers: {
      loss_start: round(loss[0], 4), loss_end: round(loss[STEPS], 4), steps: STEPS, eta: ETA,
      h1: at.map((f) => round(f.h[0], 2)), h2: at.map((f) => round(f.h[1], 2)), y: at.map((f) => round(f.y, 3)),
      weights: { V: net.V.map((r) => r.map((v) => round(v, 3))), c: net.c.map((v) => round(v, 3)), w: net.w.map((v) => round(v, 3)), b: round(net.b, 3) },
    },
  };
}
