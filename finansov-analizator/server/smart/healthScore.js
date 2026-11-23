/**
 * healthScore.js – „Индекс на финансово здраве“ от 0 до 100.
 *
 * Обобщава финансите в една оценка, която се обяснява сама: виждаш от кои
 * компоненти идват точките и какво да подобриш. Подобни индекси ползват
 * банките и финтех приложенията.
 *
 * Компоненти (максимум 100 точки):
 *  1. Норма на спестяване (30 т.) – (приходи − разходи) / приходи за последните
 *     3 завършени месеца. Пълен брой точки при ≥ 20%.
 *  2. Финансова възглавница (20 т.) – натрупаните спестявания, разделени на
 *     средните месечни разходи. Пълен брой точки при ≥ 3 месеца.
 *  3. Стабилност на разходите (15 т.) – коефициент на вариация
 *     CV = σ / μ на месечните разходи. По-малко колебания = повече точки.
 *  4. Баланс нужди/желания (15 т.) – дял на „желанията“ от приходите.
 *     Пълен брой точки при ≤ 30% (правилото 50/30/20).
 *  5. Спазване на бюджета (20 т.) – каква част от лимитите не е надвишена
 *     миналия месец.
 */

const { all } = require('../db');
const { getCategory } = require('../categories');
const { currentMonth, addMonths, monthRange } = require('../lib/dates');

const clamp01 = x => Math.max(0, Math.min(1, x));
const round = (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d;
const eur = x => `${round(x, 2).toFixed(2).replace('.', ',')} €`;

function computeHealthScore(userId) {
  const now = currentMonth();
  const last = addMonths(now, -1);
  const months3 = monthRange(addMonths(now, -3), last);
  const months6 = monthRange(addMonths(now, -6), last);

  const rows = all(`SELECT substr(date,1,7) AS m, type, category, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND substr(date,1,7) < ? GROUP BY m, type, category`, userId, now);

  const sum = (ms, filter) => rows.filter(r => ms.includes(r.m) && filter(r)).reduce((s, r) => s + r.total, 0);
  const isIncome = r => r.type === 'income';
  const isExpense = r => r.type === 'expense';

  const income3 = sum(months3, isIncome);
  const expense3 = sum(months3, isExpense);
  if (!income3 && !expense3) {
    return { score: null, grade: 'Няма данни', components: [], message: 'Нужен е поне един завършен месец с данни.' };
  }

  const components = [];

  // 1) Норма на спестяване
  const savingsRate = income3 > 0 ? (income3 - expense3) / income3 : -1;
  components.push({
    id: 'savings', label: 'Норма на спестяване', max: 30,
    points: 30 * clamp01(savingsRate / 0.2),
    value: `${round(savingsRate * 100)}%`,
    tip: savingsRate >= 0.2 ? 'Спестяваш повече от препоръчителните 20%.' : 'Целта е поне 20% от приходите.',
  });

  // 2) Финансова възглавница: всичко спестено досега / средни месечни разходи
  const allIncome = rows.filter(isIncome).reduce((s, r) => s + r.total, 0);
  const allExpense = rows.filter(isExpense).reduce((s, r) => s + r.total, 0);
  const avgMonthlyExpense = expense3 / months3.length;
  const bufferMonths = avgMonthlyExpense > 0 ? Math.max(0, allIncome - allExpense) / avgMonthlyExpense : 0;
  components.push({
    id: 'buffer', label: 'Финансова възглавница', max: 20,
    points: 20 * clamp01(bufferMonths / 3),
    value: `${round(bufferMonths, 1).toString().replace('.', ',')} мес.`,
    tip: bufferMonths >= 3 ? 'Имаш резерв за поне 3 месеца разходи.' : 'Препоръчва се резерв за 3–6 месеца разходи.',
  });

  // 3) Стабилност: коефициент на вариация на месечните разходи
  const monthly = months6.map(m => sum([m], isExpense)).filter(v => v > 0);
  let cv = 0;
  if (monthly.length >= 2) {
    const mu = monthly.reduce((a, b) => a + b, 0) / monthly.length;
    const sigma = Math.sqrt(monthly.reduce((s, v) => s + (v - mu) ** 2, 0) / (monthly.length - 1));
    cv = sigma / mu;
  }
  components.push({
    id: 'stability', label: 'Стабилност на разходите', max: 15,
    points: 15 * clamp01((0.5 - cv) / 0.4), // CV ≤ 0,1 → 15 т.; CV ≥ 0,5 → 0 т.
    value: `CV ${round(cv, 2).toString().replace('.', ',')}`,
    tip: cv <= 0.15 ? 'Разходите ти са предвидими от месец на месец.' : 'Разходите се колебаят силно – трудно се планира.',
  });

  // 4) Желания като дял от приходите
  const wants = sum(months3, r => isExpense(r) && getCategory(r.category)?.group === 'wants');
  const wantsShare = income3 > 0 ? wants / income3 : 1;
  components.push({
    id: 'wants', label: 'Нужди и желания', max: 15,
    points: 15 * clamp01((0.6 - wantsShare) / 0.3), // ≤ 30% → 15 т.; ≥ 60% → 0 т.
    value: `${round(wantsShare * 100)}% желания`,
    tip: wantsShare <= 0.3 ? 'Желанията са в рамките на 30% от приходите.' : `Намали желанията с около ${eur((wantsShare - 0.3) * income3 / 3)} на месец.`,
  });

  // 5) Спазване на лимитите миналия месец
  const budgets = all('SELECT category, monthly_limit FROM budgets WHERE user_id = ?', userId);
  let budgetPoints = 10;
  let budgetValue = 'няма лимити';
  let budgetTip = 'Задай лимити от екрана „Прогноза“.';
  if (budgets.length) {
    const ok = budgets.filter(b => sum([last], r => isExpense(r) && r.category === b.category) <= b.monthly_limit).length;
    budgetPoints = 20 * ok / budgets.length;
    budgetValue = `${ok} от ${budgets.length}`;
    budgetTip = ok === budgets.length ? 'Всички лимити са спазени миналия месец.' : 'Някои лимити са надвишени миналия месец.';
  }
  components.push({ id: 'budget', label: 'Спазване на бюджета', max: 20, points: budgetPoints, value: budgetValue, tip: budgetTip });

  for (const c of components) c.points = round(c.points, 1);
  const score = Math.round(components.reduce((s, c) => s + c.points, 0));
  const grade = score >= 80 ? 'Отлично' : score >= 60 ? 'Добро' : score >= 40 ? 'Средно' : 'Слабо';
  return { score, grade, components };
}

module.exports = { computeHealthScore };
