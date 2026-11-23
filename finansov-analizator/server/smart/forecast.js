/**
 * forecast.js – прогноза за следващия месец и предложение за бюджет.
 *
 * АЛГОРИТЪМ (за всяка категория поотделно):
 *
 *  1. Разделяме разходите на две части:
 *     - фиксирани – идват от повтарящите се плащания (наем, абонаменти).
 *       Тях ги знаем точно, не ги прогнозираме.
 *     - променливи – всичко останало (храна, заведения, гориво...).
 *
 *  2. За променливата част използваме историята по месеци и смятаме:
 *     а) Претеглена плъзгаща се средна (WMA): по-новите месеци тежат повече.
 *        WMA = Σ (i · xᵢ) / Σ i
 *     б) Линейна регресия (метод на най-малките квадрати): откриваме тренда –
 *        дали разходите растат или намаляват – и го продължаваме напред.
 *        y = a + b·x,  b = Σ(x-x̄)(y-ȳ) / Σ(x-x̄)²
 *     в) Сезонност: ако имаме данни отпреди година, гледаме с колко същият
 *        месец тогава е бил над или под средното (напр. декември с подаръците)
 *        и добавяме 60% от тази разлика.
 *
 *     Прогноза = 0,6·WMA + 0,4·Регресия + сезонна корекция.
 *
 *  3. Интервал на увереност: ± стандартното отклонение на грешките,
 *     т.е. "вероятно между X и Y €".
 *
 *  4. Предложение за бюджет: ако очакваният остатък (приходи − разходи)
 *     е по-малък от нужното за спестовните цели, програмата предлага
 *     съкращения – първо в "желанията" (заведения, забавления, дрехи),
 *     после леко в "нуждите" (храна, транспорт).
 */

const { all } = require('../db');
const { CATEGORIES, getCategory } = require('../categories');
const { currentMonth, addMonths, monthRange, monthDiff, daysInMonth, today, monthLabel } = require('../lib/dates');

const round2 = x => Math.round(x * 100) / 100;
const mean = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** Претеглена плъзгаща се средна – последните стойности тежат повече. */
function weightedMovingAverage(values) {
  let num = 0, den = 0;
  values.forEach((v, i) => { num += (i + 1) * v; den += i + 1; });
  return den ? num / den : 0;
}

/** Линейна регресия по метода на най-малките квадрати. Връща { a, b }. */
function linearRegression(values) {
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xMean = mean(xs), yMean = mean(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const b = den ? num / den : 0;
  return { a: yMean - b * xMean, b };
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

/**
 * Прогнозира следващата стойност на поредица.
 * @param {number[]} series  – стойности по месеци (най-старата първа)
 * @param {number} horizon   – след колко месеца е целевият (1 = следващият)
 * @param {number|null} seasonal – сезонна корекция в € (+/−) или null
 */
function forecastSeries(series, horizon = 1, seasonal = null) {
  const recent = series.slice(-6);           // за тренда гледаме последните 6 месеца
  const n = recent.length;
  if (!n) return { value: 0, low: 0, high: 0, trendPct: 0, wma: 0, regression: 0, seasonal: null };

  const wma = weightedMovingAverage(recent);
  let regression = wma;
  let value;
  let slope = 0;
  if (n >= 3) {
    const { a, b } = linearRegression(recent);
    slope = b;
    regression = Math.max(0, a + b * (n - 1 + horizon));
    value = 0.6 * wma + 0.4 * regression;
  } else {
    value = mean(recent);
  }

  if (seasonal) value += seasonal;

  // Грешката: колко се отклоняват реалните стойности от средната.
  const spread = stdDev(recent);
  const m = mean(recent);
  return {
    value: Math.max(0, value),
    low: Math.max(0, value - spread),
    high: value + spread,
    trendPct: m > 0 ? round2((slope / m) * 100) : 0, // промяна на месец в %
    wma: round2(wma),
    regression: round2(regression),
    seasonal: seasonal ? round2(seasonal) : null,
  };
}

/** Данни: суми по месец/тип/категория, разделени на фиксирани и променливи. */
function loadMonthlyData(userId) {
  const rows = all(
    `SELECT substr(date, 1, 7) AS month, type, category,
            SUM(CASE WHEN source = 'recurring' THEN amount ELSE 0 END) AS fixed,
            SUM(CASE WHEN source = 'recurring' THEN 0 ELSE amount END) AS variable
     FROM transactions WHERE user_id = ?
     GROUP BY month, type, category`, userId);
  const data = {}; // data[category][month] = { fixed, variable }
  let firstMonth = null;
  for (const r of rows) {
    data[r.category] = data[r.category] || {};
    data[r.category][r.month] = { fixed: r.fixed, variable: r.variable };
    if (!firstMonth || r.month < firstMonth) firstMonth = r.month;
  }
  return { data, firstMonth };
}

/** Сума на активните повтарящи се плащания по категория. */
function loadRecurringTotals(userId) {
  const rows = all(`SELECT category, SUM(amount) AS total FROM recurring
                    WHERE user_id = ? AND active = 1 GROUP BY category`, userId);
  return Object.fromEntries(rows.map(r => [r.category, r.total]));
}

/** Колко трябва да се спестява месечно за всички активни цели. */
function goalsMonthlyNeed(userId, fromMonth) {
  const goals = all('SELECT * FROM goals WHERE user_id = ? AND saved_amount < target_amount', userId);
  let total = 0;
  for (const g of goals) {
    const months = Math.max(1, monthDiff(fromMonth, g.deadline.slice(0, 7)) + 1);
    total += (g.target_amount - g.saved_amount) / months;
  }
  return round2(total);
}

/**
 * Главна функция: прогноза за следващия месец.
 */
function forecastNextMonth(userId) {
  const thisMonth = currentMonth();
  const target = addMonths(thisMonth, 1);
  const lastComplete = addMonths(thisMonth, -1);
  const { data, firstMonth } = loadMonthlyData(userId);
  const recurringTotals = loadRecurringTotals(userId);

  // Кои месеци използваме: всички завършени, но най-много 12.
  let months = [];
  if (firstMonth && firstMonth <= lastComplete) {
    const from = firstMonth < addMonths(lastComplete, -11) ? addMonths(lastComplete, -11) : firstMonth;
    months = monthRange(from, lastComplete);
  }
  const horizon = monthDiff(lastComplete, target); // = 2

  // Ако още няма завършени месеци, ползваме текущия, "разтеглен" до цял месец.
  const dayNow = Number(today().slice(8, 10));
  const paceFactor = daysInMonth(thisMonth) / dayNow;
  const usingPace = months.length === 0;

  const result = { month: target, monthLabel: monthLabel(target), basedOnMonths: months.length, usingPace, categories: [] };

  for (const cat of CATEGORIES) {
    const catData = data[cat.id] || {};
    let series;
    if (usingPace) {
      series = [(catData[thisMonth]?.variable || 0) * paceFactor];
    } else {
      series = months.map(m => catData[m]?.variable || 0);
    }

    // Сезонност: само ако имаме същия месец от миналата година и поне 12 месеца.
    // Корекция = 60% от разликата между онзи месец и средното за годината.
    let seasonal = null;
    const sameMonthLastYear = addMonths(target, -12);
    if (months.length >= 12 && months.includes(sameMonthLastYear)) {
      const past = catData[sameMonthLastYear]?.variable || 0;
      const delta = 0.6 * (past - mean(series));
      if (Math.abs(delta) >= 1) seasonal = delta;
    }

    const f = forecastSeries(series, horizon, seasonal);
    const fixed = recurringTotals[cat.id] || 0;
    const total = f.value + fixed;
    if (total < 0.5 && !fixed) continue; // категорията не се използва

    const history = months.slice(-6).map(m => ({
      month: m,
      amount: round2((catData[m]?.variable || 0) + (catData[m]?.fixed || 0)),
    }));

    result.categories.push({
      category: cat.id,
      label: cat.label,
      icon: cat.icon,
      color: cat.color,
      type: cat.type,
      group: cat.group || null,
      fixed: round2(fixed),
      variable: round2(f.value),
      forecast: round2(total),
      low: round2(f.low + fixed),
      high: round2(f.high + fixed),
      trendPct: f.trendPct,
      method: { wma: f.wma, regression: f.regression, seasonal: f.seasonal },
      history,
    });
  }

  const sumOf = type => round2(result.categories.filter(c => c.type === type).reduce((s, c) => s + c.forecast, 0));
  result.income = sumOf('income');
  result.expenses = sumOf('expense');
  result.surplus = round2(result.income - result.expenses);

  // ---------- Предложение за бюджет ----------
  const goalsNeed = goalsMonthlyNeed(userId, target);
  const savingsTarget = round2(Math.max(goalsNeed, result.income * 0.1));
  result.savingsTarget = savingsTarget;
  result.goalsNeed = goalsNeed;

  let deficit = Math.max(0, savingsTarget - result.surplus);
  const expenseCats = result.categories.filter(c => c.type === 'expense');
  for (const c of expenseCats) c.suggestedLimit = c.forecast;

  // Първо "желанията" – до 30% от променливата част, после "нуждите" – до 10%.
  for (const [group, maxCut] of [['wants', 0.3], ['needs', 0.1]]) {
    if (deficit <= 0) break;
    const pool = expenseCats.filter(c => c.group === group && c.variable > 0);
    const capacity = pool.reduce((s, c) => s + c.variable * maxCut, 0);
    if (capacity <= 0) continue;
    const share = Math.min(1, deficit / capacity);
    for (const c of pool) {
      const cut = c.variable * maxCut * share;
      c.suggestedLimit = c.forecast - cut;
      c.cut = round2(cut);
    }
    deficit -= Math.min(deficit, capacity);
  }

  // Закръгляме лимитите нагоре до 5 €, за да са удобни.
  for (const c of expenseCats) c.suggestedLimit = Math.ceil(c.suggestedLimit / 5) * 5;

  result.suggestedTotal = expenseCats.reduce((s, c) => s + c.suggestedLimit, 0);
  result.expectedSavings = round2(result.income - result.suggestedTotal);
  result.targetReachable = deficit <= 0.01;
  result.categories.sort((a, b) => b.forecast - a.forecast);
  return result;
}

module.exports = { forecastNextMonth, forecastSeries, weightedMovingAverage, linearRegression, stdDev, goalsMonthlyNeed };
