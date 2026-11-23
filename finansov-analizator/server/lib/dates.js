/**
 * dates.js – помощни функции за дати.
 *
 * В базата пазим датите като текст във формат 'YYYY-MM-DD',
 * а месеците като 'YYYY-MM'. Така сравненията и сортирането
 * работят директно като текст и няма проблеми с часовите зони.
 */

const pad = n => String(n).padStart(2, '0');

/** Днешна дата като 'YYYY-MM-DD' (по местно време). */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Текущ месец като 'YYYY-MM'. */
function currentMonth() {
  return today().slice(0, 7);
}

/** Добавя (или изважда) месеци: addMonths('2026-01', -2) → '2025-11'. */
function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Брой дни в месеца 'YYYY-MM'. */
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** Брой месеци между два месеца (b - a). */
function monthDiff(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

/** Списък от месеци от `from` до `to` включително. */
function monthRange(from, to) {
  const out = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Проверява дали текстът е валидна дата 'YYYY-MM-DD'. */
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const MONTH_NAMES = ['януари', 'февруари', 'март', 'април', 'май', 'юни',
  'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

/** '2026-12' → 'декември 2026' */
function monthLabel(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

module.exports = { pad, today, currentMonth, addMonths, daysInMonth, monthDiff, monthRange, isValidDate, monthLabel, MONTH_NAMES };
