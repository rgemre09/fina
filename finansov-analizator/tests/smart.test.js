/**
 * Тестове на "умните" функции.  Стартиране: npm test
 * Използват отделна временна база, за да не пипат истинските данни.
 */
const path = require('node:path');
const os = require('node:os');
process.env.DB_FILE = path.join(os.tmpdir(), `fa-test-${Date.now()}.db`);

const test = require('node:test');
const assert = require('node:assert');
const { weightedMovingAverage, linearRegression, forecastSeries } = require('../server/smart/forecast');
const { parseFiscalQR, parseReceiptText } = require('../server/smart/receipt');
const { suggestCategory, tokenize } = require('../server/smart/categorizer');
const { addMonths, daysInMonth } = require('../server/lib/dates');

test('WMA: по-новите стойности тежат повече', () => {
  // (1·100 + 2·200 + 3·300) / 6 = 233,33
  assert.strictEqual(Math.round(weightedMovingAverage([100, 200, 300]) * 100) / 100, 233.33);
});

test('Линейна регресия открива тренда', () => {
  const { a, b } = linearRegression([10, 20, 30, 40]);
  assert.strictEqual(b, 10);
  assert.strictEqual(a, 10);
});

test('Прогноза при постоянни разходи = същата стойност', () => {
  const f = forecastSeries([300, 300, 300, 300], 1);
  assert.strictEqual(Math.round(f.value), 300);
  assert.strictEqual(f.trendPct, 0);
});

test('Прогноза при растящи разходи е над средното', () => {
  const f = forecastSeries([100, 120, 140, 160, 180, 200], 1);
  assert.ok(f.value > 150);
  assert.ok(f.trendPct > 0);
});

test('QR код от касова бележка', () => {
  const r = parseFiscalQR('50163145*0001234*2026-11-08*14:23:45*23.70');
  assert.strictEqual(r.amount, 23.7);
  assert.strictEqual(r.date, '2026-11-08');
  assert.strictEqual(parseFiscalQR('https://example.com'), null);
});

test('OCR текст: открива общата сума, а не платеното в брой', () => {
  const r = parseReceiptText('ЛИДЛ БЪЛГАРИЯ\nХляб 1,20\nОБЩА СУМА 3,55 EUR\nВ БРОЙ 5,00\n08.11.2026');
  assert.strictEqual(r.amount, 3.55);
  assert.strictEqual(r.date, '2026-11-08');
});

test('Категоризатор по ключови думи', () => {
  assert.strictEqual(suggestCategory('Kaufland Младост', 'expense').category, 'food');
  assert.strictEqual(suggestCategory('Зареждане OMV', 'expense').category, 'transport');
  assert.strictEqual(suggestCategory('Заплата октомври', 'income').category, 'salary');
  assert.deepStrictEqual(tokenize('Лидл, ул. Шипка 5'), ['лидл', 'шипка']);
});

test('Дати', () => {
  assert.strictEqual(addMonths('2026-12', 1), '2027-01');
  assert.strictEqual(addMonths('2026-01', -2), '2025-11');
  assert.strictEqual(daysInMonth('2028-02'), 29);
});

const { parseQuickText } = require('../server/smart/quickParse');

test('Бързо въвеждане: сума, дата и тип от изречение', () => {
  const d = new Date(); d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const a = parseQuickText('кафе 3,50 вчера');
  assert.strictEqual(a.amount, 3.5);
  assert.strictEqual(a.date, yesterday);
  assert.strictEqual(a.type, 'expense');
  assert.strictEqual(a.description, 'Кафе');

  const b = parseQuickText('+250 хонорар за сайт 15.11.2026');
  assert.strictEqual(b.type, 'income');
  assert.strictEqual(b.amount, 250);
  assert.strictEqual(b.date, '2026-11-15');
});
