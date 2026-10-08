// How <StageCount> writes a number. Plain code, no DOM: the tests run it
// under node.
//
//   formatCount(55000, { lang: 'lt' })            → '55 000'  (a narrow no-break space, U+202F)
//   formatCount(1844, { lang: 'lt' })             → '1844'    (Lithuanian groups from five digits up)
//   formatCount(12.5, { lang: 'lt', decimals: 1 }) → '12,5'
//   formatCount(1844, { lang: 'en' })             → '1,844'
//   formatCount(2026, { plain: true })            → '2026'    (years: never grouped)
//
// `span` is the largest number the count passes through (from or to), so a
// count from 800 to 55 000 is grouped all the way and does not change its
// look when it passes 10 000.
const STYLE = {
  lt: { group: ' ', decimal: ',', from: 10000 },
  en: { group: ',', decimal: '.', from: 1000 },
};

export const countLang = (lang) => (String(lang || '').toLowerCase().startsWith('lt') ? 'lt' : 'en');

export function formatCount(value, { decimals = 0, lang = 'en', plain = false, span = value } = {}) {
  const st = STYLE[countLang(lang)];
  const d = Math.max(0, Math.min(10, Math.round(Number(decimals) || 0)));
  let fixed = (Number(value) || 0).toFixed(d);
  if (Number(fixed) === 0) fixed = fixed.replace(/^-/, '');   // no '-0'
  const [int, frac] = fixed.split('.');
  const grouped = !plain && Math.abs(Number(span) || 0) >= st.from ? int.replace(/\B(?=(\d{3})+(?!\d))/g, st.group) : int;
  return frac ? `${grouped}${st.decimal}${frac}` : grouped;
}
