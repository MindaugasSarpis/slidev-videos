// hours-columns: every measured hour of the weather log counted in cells of
// temperature × humidity, each cell a column as high as its count: a histogram
// of two columns of the file at once. The ridge of the columns slants: warm
// hours are drier, r = −0.70 (Lecture 8, "Temperature and Humidity of Every Hour").
//
//   reduce(text)  weather.csv → input.json: the count of every cell, and the sums behind r
//   make(input)   input.json  → data.json: the columns, r, the tallest cell
//
// Deterministic: no clock, no random numbers, no network.

export const source = {
  file: 'lectures/workbook/docs/data/weather.csv',
  repo: 'https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis',
  what: "the course's weather log: one row per hour, 2016 to 2025; a temperature of −999 marks a missing hour",
};

const MISSING = -999;
// Cells 2 °C wide and 5 % high. Humidity is a whole number of percent, so each
// cell holds five values: 26 to 30, …, 96 to 100.
export const CELLS = { nx: 27, ny: 15, x: [-20, 34], y: [25.5, 100.5] };

export function reduce(text) {
  const { nx, ny, x, y } = CELLS;
  const counts = new Array(nx * ny).fill(0);
  let n = 0, outside = 0, st = 0, sh = 0, stt = 0, shh = 0, sth = 0;
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = lines[i].split(',');
    const t = Number(cells[1]), h = Number(cells[2]);
    if (t === MISSING) continue;
    n++; st += t; sh += h; stt += t * t; shh += h * h; sth += t * h;
    const a = Math.floor(((t - x[0]) / (x[1] - x[0])) * nx), b = Math.floor(((h - y[0]) / (y[1] - y[0])) * ny);
    if (a < 0 || a >= nx || b < 0 || b >= ny) { outside++; continue; }
    counts[b * nx + a]++;
  }
  return { hours: n, outside, sums: { t: st, h: sh, tt: stt, hh: shh, th: sth }, counts };
}

const round = (v, d) => Number(v.toFixed(d));

export function make(input) {
  const { nx, ny, x, y } = CELLS;
  const { hours: n, sums: s, counts } = input;
  const r = (s.th - (s.t * s.h) / n) / Math.sqrt((s.tt - (s.t * s.t) / n) * (s.hh - (s.h * s.h) / n));
  let top = 0;
  counts.forEach((c, k) => { if (c > counts[top]) top = k; });
  const wx = (x[1] - x[0]) / nx, wy = (y[1] - y[0]) / ny;
  const i = top % nx, j = Math.floor(top / nx);
  return {
    counts,
    numbers: {
      hours: n, in_cells: counts.reduce((a, b) => a + b, 0), outside: input.outside, cells_with_hours: counts.filter((c) => c > 0).length,
      r: round(r, 3), mean_t: round(s.t / n, 2), mean_h: round(s.h / n, 1),
      tallest: { count: counts[top], t: [x[0] + wx * i, x[0] + wx * (i + 1)], h: [Math.ceil(y[0] + wy * j), Math.floor(y[0] + wy * (j + 1))], at: [x[0] + wx * (i + 0.5), y[0] + wy * (j + 0.5)] },
    },
  };
}
