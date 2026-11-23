/**
 * insights.js – предупреждения и съвети за текущия месец.
 *
 * Проверки:
 *  1. Лимити по категории – превишен (червено) или над 80% (жълто).
 *  2. Темпо на харчене – "при това темпо до края на месеца ще похарчиш X".
 *     Прогноза = похарчено / изминали дни × дни в месеца.
 *  3. Необичаен разход (откриване на аномалии) – z-оценка:
 *        z = (сума − средна) / стандартно отклонение
 *     Ако z > 2,5 – сумата е много над обичайното за категорията.
 *  4. Ръст спрямо предишните 3 месеца (> 25%).
 *  5. Правилото 50/30/20: 50% нужди, 30% желания, 20% спестявания.
 *  6. Абонаменти – колко струват на година.
 *  7. Спестовни цели – успяваме ли навреме.
 *
 * Всеки съвет: { level: 'danger'|'warning'|'info'|'success', icon, title, text }
 */

const { all, get } = require('../db');
const { getCategory } = require('../categories');
const { currentMonth, addMonths, daysInMonth, today, monthDiff } = require('../lib/dates');

const eur = x => `${(Math.round(x * 100) / 100).toFixed(2).replace('.', ',')} €`;

function generateInsights(userId) {
  const month = currentMonth();
  const day = Number(today().slice(8, 10));
  const dim = daysInMonth(month);
  const insights = [];

  // Разходи този месец по категории
  const spentRows = all(`SELECT category, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ? GROUP BY category`, userId, month);
  const spent = Object.fromEntries(spentRows.map(r => [r.category, r.total]));

  // Фиксираните (повтарящи се) разходи не се "разтеглят" при прогнозата за темпото.
  const fixedRows = all(`SELECT category, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND type = 'expense' AND source = 'recurring' AND substr(date,1,7) = ? GROUP BY category`, userId, month);
  const fixedNow = Object.fromEntries(fixedRows.map(r => [r.category, r.total]));
  const pendingFixed = Object.fromEntries(all(`SELECT category, SUM(amount) AS total FROM recurring
     WHERE user_id = ? AND type = 'expense' AND active = 1 AND day_of_month > ? GROUP BY category`, userId, day)
    .map(r => [r.category, r.total]));

  // Сметките (ток, вода, парно) се плащат веднъж месечно – тях не ги "разтягаме" по дни.
  const LUMPY = ['utilities', 'housing'];
  const projectFor = cat => {
    const fixed = fixedNow[cat] || 0;
    const variable = (spent[cat] || 0) - fixed;
    if (LUMPY.includes(cat)) return (spent[cat] || 0) + (pendingFixed[cat] || 0);
    return fixed + (pendingFixed[cat] || 0) + variable / day * dim;
  };

  // ---------- 1 и 2: лимити ----------
  const budgets = all('SELECT category, monthly_limit FROM budgets WHERE user_id = ?', userId);
  for (const b of budgets) {
    const cat = getCategory(b.category);
    if (!cat) continue;
    const s = spent[b.category] || 0;
    const pct = s / b.monthly_limit * 100;
    const projected = projectFor(b.category);
    if (s > b.monthly_limit + 0.005) {
      insights.push({ level: 'danger', icon: '⛔', title: `Превишен лимит: ${cat.label}`,
        text: `Похарчени са ${eur(s)} от ${eur(b.monthly_limit)} (${Math.round(pct)}%). Опитайте да не харчите повече в тази категория до края на месеца.` });
    } else if (pct >= 80) {
      insights.push({ level: 'warning', icon: '⚠️', title: `Близо до лимита: ${cat.label}`,
        text: `Използвани са ${Math.round(pct)}% от лимита. Остават ${eur(b.monthly_limit - s)} за ${dim - day} дни.` });
    } else if (projected > b.monthly_limit * 1.05 && day >= 5) {
      insights.push({ level: 'warning', icon: '📈', title: `Бързо темпо: ${cat.label}`,
        text: `При сегашното темпо до края на месеца ще похарчите около ${eur(projected)} при лимит ${eur(b.monthly_limit)}. Препоръчително е до ${eur((b.monthly_limit - s) / Math.max(1, dim - day))} на ден.` });
    }
  }

  // ---------- 3: необичайни разходи (z-оценка) ----------
  const since = addMonths(month, -12) + '-01';
  const history = all(`SELECT category, amount FROM transactions
     WHERE user_id = ? AND type = 'expense' AND source != 'recurring' AND date >= ? AND substr(date,1,7) < ?`, userId, since, month);
  const byCat = {};
  for (const h of history) (byCat[h.category] = byCat[h.category] || []).push(h.amount);

  const recent = all(`SELECT * FROM transactions WHERE user_id = ? AND type = 'expense' AND source != 'recurring'
     AND substr(date,1,7) = ? ORDER BY amount DESC`, userId, month);
  let anomalies = 0;
  for (const t of recent) {
    const arr = byCat[t.category];
    if (!arr || arr.length < 5) continue;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
    if (sd === 0) continue;
    const z = (t.amount - m) / sd;
    if (z > 2.5 && t.amount - m > 20 && anomalies < 3) {
      anomalies++;
      insights.push({ level: 'warning', icon: '🔍', title: 'Необичаен разход',
        text: `„${t.description || getCategory(t.category)?.label}“ за ${eur(t.amount)} на ${t.date.split('-').reverse().join('.')} е ${(t.amount / m).toFixed(1).replace('.', ',')} пъти над обичайното за „${getCategory(t.category)?.label}“ (средно ${eur(m)}).` });
    }
  }

  // ---------- 4: ръст спрямо предишните 3 месеца ----------
  const prevFrom = addMonths(month, -3), prevTo = addMonths(month, -1);
  const prevRows = all(`SELECT category, SUM(amount) / 3.0 AS avg FROM transactions
     WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) BETWEEN ? AND ? GROUP BY category`, userId, prevFrom, prevTo);
  const growth = [];
  for (const r of prevRows) {
    const projected = projectFor(r.category);
    if (r.avg > 0 && projected > r.avg * 1.25 && projected - r.avg > 25) {
      growth.push({ cat: r.category, pct: Math.round((projected / r.avg - 1) * 100), projected, avg: r.avg });
    }
  }
  growth.sort((a, b) => b.pct - a.pct).slice(0, 2).forEach(g => {
    if (budgets.some(b => b.category === g.cat)) return; // вече има съвет за лимита
    insights.push({ level: 'info', icon: '📊', title: `Повече разходи за ${getCategory(g.cat)?.label}`,
      text: `Очаква се този месец да похарчите ${eur(g.projected)} – с ${g.pct}% повече от средното за последните 3 месеца (${eur(g.avg)}).` });
  });

  // ---------- 5: правилото 50/30/20 (за последния завършен месец) ----------
  const last = addMonths(month, -1);
  const lastRows = all(`SELECT type, category, SUM(amount) AS total FROM transactions
     WHERE user_id = ? AND substr(date,1,7) = ? GROUP BY type, category`, userId, last);
  const income = lastRows.filter(r => r.type === 'income').reduce((s, r) => s + r.total, 0);
  if (income > 0) {
    let needs = 0, wants = 0;
    for (const r of lastRows.filter(r => r.type === 'expense')) {
      if (getCategory(r.category)?.group === 'needs') needs += r.total; else wants += r.total;
    }
    const savings = income - needs - wants;
    const p = x => Math.round(x / income * 100);
    const rate = p(savings);
    if (rate >= 20) {
      insights.push({ level: 'success', icon: '🏆', title: 'Отлично спестяване',
        text: `Миналия месец сте спестили ${rate}% от приходите (${eur(savings)}). Правилото 50/30/20 препоръчва поне 20% – справяте се!` });
    } else {
      insights.push({ level: rate < 0 ? 'danger' : 'info', icon: '⚖️', title: 'Правилото 50/30/20',
        text: `Миналия месец: нужди ${p(needs)}% (препоръка 50%), желания ${p(wants)}% (30%), спестено ${rate}% (20%).` +
          (p(wants) > 30 ? ` Ако намалите желанията до 30%, ще спестите още около ${eur(wants - income * 0.3)} на месец.` : '') });
    }
  }

  // ---------- 6: абонаменти ----------
  const subs = get(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM recurring
     WHERE user_id = ? AND type = 'expense' AND active = 1 AND category = 'entertainment'`, userId);
  if (subs.n >= 2) {
    insights.push({ level: 'info', icon: '🔁', title: 'Абонаменти',
      text: `Имате ${subs.n} абонамента за забавления за ${eur(subs.total)} на месец, т.е. ${eur(subs.total * 12)} на година. Проверете дали ползвате всички.` });
  }

  // ---------- 7: спестовни цели ----------
  const goals = all('SELECT * FROM goals WHERE user_id = ? AND saved_amount < target_amount', userId);
  for (const g of goals) {
    const monthsLeft = monthDiff(month, g.deadline.slice(0, 7));
    const need = g.target_amount - g.saved_amount;
    if (monthsLeft < 0) {
      insights.push({ level: 'danger', icon: '🎯', title: `Изтекъл срок: ${g.name}`,
        text: `Срокът е минал, а остават ${eur(need)}. Задайте нов срок.` });
    } else {
      const perMonth = need / Math.max(1, monthsLeft);
      insights.push({ level: 'info', icon: '🎯', title: `Цел „${g.name}“`,
        text: `За да съберете ${eur(g.target_amount)} навреме, отделяйте по ${eur(perMonth)} на месец (остават ${eur(need)}).` });
    }
  }

  // Подреждаме по важност.
  const order = { danger: 0, warning: 1, info: 2, success: 3 };
  insights.sort((a, b) => order[a.level] - order[b.level]);
  return insights;
}

module.exports = { generateInsights };
