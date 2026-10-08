// How <StageCount> writes a number and how its count runs. Plain code, no
// DOM: the tests run it under node.
//
//   formatCount(55000, { lang: 'lt' })            → '55 000'  (a narrow no-break space, U+202F)
//   formatCount(1844, { lang: 'lt' })             → '1844'    (Lithuanian groups from five digits up)
//   formatCount(1844, { lang: 'en' })             → '1 844'   (English from four)
//   formatCount(12.5, { lang: 'lt', decimals: 1 }) → '12,5'
//   formatCount(12.5, { lang: 'en', decimals: 1 }) → '12.5'
//   formatCount(1844, { lang: 'lt', group: true }) → '1 844'   (grouped from four digits in any language)
//   formatCount(2026, { group: false })           → '2026'    (years: never grouped; `plain` says the same)
//
// Both languages set groups of three apart with the same narrow space, the
// SI way, so an English deck reads 600 000 as the Lithuanian one does; only
// the decimal sign and where grouping starts differ. `span` is the largest
// number the count passes through while it runs (countSpan below), so a
// count from 800 to 55 000 is grouped all the way and does not change its
// look when it passes 10 000.
const GROUP = ' ';
const STYLE = {
  lt: { decimal: ',', from: 10000 },
  en: { decimal: '.', from: 1000 },
};

export const countLang = (lang) => (String(lang || '').toLowerCase().startsWith('lt') ? 'lt' : 'en');

// group: 'auto' (the language's rule) | true (from four digits) | false (never);
// the strings 'true' and 'false' count as the booleans
const groupFrom = (group, plain, st) => {
  if (plain || group === false || group === 'false') return Infinity;
  if (group === true || group === 'true' || group === '') return 1000;
  return st.from;
};

export function formatCount(value, { decimals = 0, lang = 'en', group = 'auto', plain = false, span = 0 } = {}) {
  const st = STYLE[countLang(lang)];
  const d = Math.max(0, Math.min(10, Math.round(Number(decimals) || 0)));
  let fixed = (Number(value) || 0).toFixed(d);
  if (Number(fixed) === 0) fixed = fixed.replace(/^-/, '');   // no '-0'
  const [int, frac] = fixed.split('.');
  // decided on what is written (9999.6 is written 10 000), and on the span
  const big = Math.max(Math.abs(Number(span) || 0), Math.abs(Number(fixed)));
  const grouped = big >= groupFrom(group, plain, st) ? int.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP) : int;
  return frac ? `${grouped}${st.decimal}${frac}` : grouped;
}

// How a count runs when its slide arrives. `last` is what the count of the
// same `name` showed when its slide last arrived (undefined: never), and the
// count starts there instead of at `from`: a form that stays as it was shows
// its number at once, and going back to a smaller number counts down at once
// and fast (1.1 s, easing out), with the grains scattering. Counting up, it
// waits `delay` and runs `ms` on a smoothstep: the pace at which the grains
// of a step arrive.
export const COUNT_DOWN_MS = 1100;

export function countRun({ from = 0, to, ms = 2900, delay = 1000, last } = {}) {
  const start = Number.isFinite(last) ? last : from;
  if (start === to) return { from: to, to, delay: 0, ms: 0, down: false };
  const down = to < start;
  return { from: start, to, delay: down ? 0 : delay, ms: down ? COUNT_DOWN_MS : ms, down };
}

// what a count shows `t` ms after its slide arrived
export function countAt(run, t) {
  if (!run.ms) return run.to;
  const u = Math.min(Math.max((t - run.delay) / run.ms, 0), 1);
  const e = run.down ? 1 - (1 - u) ** 3 : u * u * (3 - 2 * u);
  return u >= 1 ? run.to : run.from + (run.to - run.from) * e;
}

// the `span` a count is written with when it shows `value`: while it runs,
// the larger of where it started and where it lands, so 800 → 55 000 is
// grouped throughout; landed, the number alone, so going back from 55 000
// to 4000 lands on 4000 in Lithuanian, as the number is written by itself
export const countSpan = (run, value) => (value === run.to ? Math.abs(run.to) : Math.max(Math.abs(run.from), Math.abs(run.to)));
