/**
 * patterns.js – откриване на скрити абонаменти и повтарящи се плащания.
 *
 * Много хора плащат абонаменти, без да ги следят. Програмата сама търси
 * в историята плащания, които:
 *   1. имат едно и също описание (сравняваме думите, не точния текст);
 *   2. се срещат в поне 3 различни месеца;
 *   3. са през ~1 месец: средният интервал е между 25 и 35 дни;
 *   4. са с почти еднаква сума: коефициент на вариация CV = σ/μ < 0,1;
 *   5. още не са добавени като повтарящи се.
 * Тогава предлага: „Изглежда, че плащаш X всеки месец – да го добавя ли?“
 */

const { all } = require('../db');
const { tokenize } = require('./categorizer');
const { addMonths, currentMonth } = require('../lib/dates');

const dayNumber = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000;
const keyOf = text => tokenize(text).sort().join(' ');

function detectRecurringCandidates(userId) {
  const since = addMonths(currentMonth(), -6) + '-01';
  const txs = all(`SELECT description, amount, category, date FROM transactions
     WHERE user_id = ? AND type = 'expense' AND source != 'recurring' AND date >= ? ORDER BY date`, userId, since);
  const existing = new Set(all('SELECT description FROM recurring WHERE user_id = ?', userId).map(r => keyOf(r.description)));

  // Групираме по "ключ" от думите в описанието
  const groups = {};
  for (const t of txs) {
    const key = keyOf(t.description);
    if (!key || existing.has(key)) continue;
    (groups[key] = groups[key] || []).push(t);
  }

  const out = [];
  for (const list of Object.values(groups)) {
    const months = new Set(list.map(t => t.date.slice(0, 7)));
    if (list.length < 3 || months.size < 3 || list.length > months.size + 1) continue;

    const amounts = list.map(t => t.amount);
    const mu = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const sigma = Math.sqrt(amounts.reduce((s, v) => s + (v - mu) ** 2, 0) / (amounts.length - 1));
    if (sigma / mu >= 0.1) continue;

    const intervals = list.slice(1).map((t, i) => dayNumber(t.date) - dayNumber(list[i].date));
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avgInterval < 25 || avgInterval > 35) continue;

    const days = list.map(t => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    out.push({
      description: list[list.length - 1].description,
      amount: Math.round(mu * 100) / 100,
      category: list[list.length - 1].category,
      day_of_month: days[Math.floor(days.length / 2)], // медиана
      occurrences: list.length,
      avgInterval: Math.round(avgInterval),
      yearly: Math.round(mu * 12 * 100) / 100,
      lastDate: list[list.length - 1].date,
    });
  }
  return out.sort((a, b) => b.yearly - a.yearly);
}

module.exports = { detectRecurringCandidates };
