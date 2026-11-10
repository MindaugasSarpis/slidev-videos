// line-fit-valley: S(a, b) = Σ (a·x + b − y)² of a straight line through the
// ten yearly means of the course's weather log, and the path of gradient
// descent on it (Lecture 9, "The Path Downhill").
//
//   reduce(text)  weather.csv → input.json: the mean of each year's measured hours
//   make(input)   input.json  → data.json: the surface, the path, the numbers
//
// Deterministic: no clock, no random numbers, no network.

export const source = {
  file: 'lectures/workbook/docs/data/weather.csv',
  repo: 'https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis',
  what: "the course's weather log: one row per hour, 2016 to 2025; a temperature of −999 marks a missing hour",
};

const MISSING = -999;
export const ETA = 0.003;          // the step size of the slide
export const START = [0, 7];       // slope (°C per year), intercept (°C)
export const STEPS = 500;
// The floor of the box: slope in °C per decade, intercept in °C (the axes of the slide's map).
export const GRID = { nx: 97, ny: 97, x: [-1.2, 0.5], y: [6.85, 7.75] };

export function reduce(text) {
  const sums = new Map();
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(',');
    const t = Number(cells[1]);
    if (t === MISSING) continue;
    const year = cells[0].slice(0, 4);
    const s = sums.get(year) || [0, 0];
    s[0] += t; s[1] += 1;
    sums.set(year, s);
  }
  const years = [...sums.keys()].sort();
  return { years: years.map(Number), hours: years.map((y) => sums.get(y)[1]), means: years.map((y) => sums.get(y)[0] / sums.get(y)[1]) };
}

export function S(a, b, x, y) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (a * x[i] + b - y[i]) ** 2;
  return s;
}

export function fit(x, y) {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxx += x[i] * x[i]; sxy += x[i] * y[i]; }
  const d = n * sxx - sx * sx;
  return { a: (n * sxy - sx * sy) / d, b: (sxx * sy - sx * sxy) / d };
}

export function descent(x, y, start = START, eta = ETA, steps = STEPS) {
  let [a, b] = start;
  const rows = [[a, b, S(a, b, x, y)]];
  for (let k = 0; k < steps; k++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < x.length; i++) { const r = a * x[i] + b - y[i]; ga += 2 * r * x[i]; gb += 2 * r; }
    a -= eta * ga; b -= eta * gb;
    rows.push([a, b, S(a, b, x, y)]);
  }
  return rows;
}

const round = (v, d) => Number(v.toFixed(d));

export function make(input) {
  const y = input.means;
  const x = y.map((_, i) => i);                     // years since the first
  const f = fit(x, y);
  const smin = S(f.a, f.b, x, y);
  const rows = descent(x, y);
  const z = [];
  for (let j = 0; j < GRID.ny; j++) {
    const b = GRID.y[0] + ((GRID.y[1] - GRID.y[0]) * j) / (GRID.ny - 1);
    for (let i = 0; i < GRID.nx; i++) {
      const a10 = GRID.x[0] + ((GRID.x[1] - GRID.x[0]) * i) / (GRID.nx - 1);
      z.push(round(S(a10 / 10, b, x, y), 4));
    }
  }
  return {
    S: z,
    path_a: rows.map((r) => round(10 * r[0], 5)),
    path_b: rows.map((r) => round(r[1], 5)),
    path_S: rows.map((r) => round(r[2], 5)),
    numbers: {
      slope_per_decade: round(10 * f.a, 4), intercept: round(f.b, 4), S_min: round(smin, 4),
      S_start: round(rows[0][2], 4), S_end: round(rows[STEPS][2], 6), steps: STEPS, eta: ETA,
      end: [round(10 * rows[STEPS][0], 4), round(rows[STEPS][1], 4)],
    },
  };
}
