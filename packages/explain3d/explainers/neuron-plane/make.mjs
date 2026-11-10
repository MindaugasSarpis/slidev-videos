// neuron-plane: z = w₁x₁ + w₂x₂ + b of one neuron is a plane over the two
// inputs of an evening (the temperature and the humidity at 18:00); where the
// plane crosses the height z = 0 is the neuron's decision boundary, a
// straight line (Lecture 10, "The Decision Boundary Is a Line").
//
//   reduce(text)  weather.csv → input.json: every evening's two inputs and whether frost followed
//   make(input)   input.json  → data.json: the evenings, the two planes, the counts
//
// Deterministic: no clock, no random numbers, no network.

export const source = {
  file: 'lectures/workbook/docs/data/weather.csv',
  repo: 'https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis',
  what: "the course's weather log: one row per hour, 2016 to 2025; a temperature of −999 marks a missing hour",
};

const MISSING = -999;
// The two neurons of the lecture: "frost below 3.8 °C", and the same with a weight on the humidity.
export const NEURONS = { upright: { w: [-1, 0], b: 3.8 }, tilted: { w: [-1, 4], b: 0.6 } };
export const TONIGHT = '2025-12-08';
export const GRID = { nx: 17, ny: 17, x: [-15, 32], y: [0.4, 1] };

// An evening: 18:00 of a day beside 06:00 of the next; frost: that morning below 0 °C.
export function reduce(text) {
  const lines = text.split('\n').filter(Boolean).slice(1);
  const out = { temp: [], humidity: [], frost: [], tonight: null };
  for (let i = 18; i < lines.length - 12; i += 24) {
    const evening = lines[i].split(','), morning = lines[i + 12].split(',');
    if (evening[0].slice(11) !== '18:00' || morning[0].slice(11) !== '06:00') throw new Error(`neuron-plane: row ${i + 2} is not 18:00 beside 06:00`);
    const temp = Number(evening[1]), next = Number(morning[1]);
    if (temp === MISSING || next === MISSING) continue;
    if (evening[0].slice(0, 10) === TONIGHT) out.tonight = out.temp.length;
    out.temp.push(temp); out.humidity.push(Number(evening[2])); out.frost.push(next < 0 ? 1 : 0);
  }
  return out;
}

export const z = (n, x1, x2) => n.w[0] * x1 + n.w[1] * x2 + n.b;
// z > 0 says frost; decided on z rounded to 9 decimals, as the lecture counts an evening on the line as "no frost"
export const saysFrost = (v) => Math.round(v * 1e9) / 1e9 > 0;

const round = (v, d) => Number(v.toFixed(d));

export function make(input) {
  const x1 = input.temp, x2 = input.humidity.map((h) => h / 100);
  const data = { x1, x2, frost: input.frost, numbers: { evenings: x1.length, frost: input.frost.reduce((a, b) => a + b, 0) } };
  const t = input.tonight;
  data.numbers.tonight = { date: TONIGHT, x1: x1[t], x2: x2[t], frost: input.frost[t] };
  for (const [id, n] of Object.entries(NEURONS)) {
    const plane = [];
    for (let j = 0; j < GRID.ny; j++) {
      const h = GRID.y[0] + ((GRID.y[1] - GRID.y[0]) * j) / (GRID.ny - 1);
      for (let i = 0; i < GRID.nx; i++) plane.push(round(z(n, GRID.x[0] + ((GRID.x[1] - GRID.x[0]) * i) / (GRID.nx - 1), h), 6));
    }
    data[`z_${id}`] = plane;
    let right = 0;
    for (let i = 0; i < x1.length; i++) if ((saysFrost(z(n, x1[i], x2[i])) ? 1 : 0) === input.frost[i]) right++;
    const zt = round(z(n, x1[t], x2[t]), 6);
    data.numbers[id] = { w: n.w, b: n.b, right, z_tonight: zt };
    // the stem of tonight's evening: from the height 0 up to the plane
    data[`stem_${id}_z`] = [0, zt];
  }
  data.stem_x1 = [x1[t], x1[t]];
  data.stem_x2 = [x2[t], x2[t]];
  // the height z = 0 over the floor: its outline
  data.level_x1 = [GRID.x[0], GRID.x[1], GRID.x[1], GRID.x[0]];
  data.level_x2 = [GRID.y[0], GRID.y[0], GRID.y[1], GRID.y[1]];
  return data;
}
