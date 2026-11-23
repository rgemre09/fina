/**
 * routes/analytics.js – табло, прогноза, съвети и касови бележки.
 *
 * GET  /api/dashboard?month=YYYY-MM  → обобщение, графики, съвети
 * GET  /api/forecast                 → прогноза и предложен бюджет за следващия месец
 * POST /api/receipts/parse           { qr } или { text } → предложение за разход
 * GET  /api/health                   → индекс на финансово здраве (0–100)
 * POST /api/quick-parse              { text } → разчита изречение като "кафе 3,50 вчера"
 * GET  /api/patterns/recurring       → открити скрити абонаменти
 * POST /api/patterns/recurring/accept → превръща открит абонамент в повтарящо се плащане
 */

const { all, get, run } = require('../db');
const { HttpError } = require('../lib/router');
const { getCategory } = require('../categories');
const { currentMonth, addMonths, daysInMonth, monthRange, today, monthLabel } = require('../lib/dates');
const { processRecurring } = require('../smart/recurringEngine');
const { forecastNextMonth } = require('../smart/forecast');
const { generateInsights } = require('../smart/insights');
const { parseFiscalQR, parseReceiptText } = require('../smart/receipt');
const { suggestCategory, learn } = require('../smart/categorizer');
const { computeHealthScore } = require('../smart/healthScore');
const { quickParse } = require('../smart/quickParse');
const { detectRecurringCandidates } = require('../smart/patterns');
const v = require('../lib/validate');

const round2 = x => Math.round(x * 100) / 100;

module.exports = function (router) {
  router.get('/api/dashboard', (req, res, { query, user }) => {
    processRecurring(user.id);
    const month = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : currentMonth();
    const prev = addMonths(month, -1);

    // Суми по тип и категория за избрания месец
    const rows = all(`SELECT type, category, SUM(amount) AS total, COUNT(*) AS n FROM transactions
       WHERE user_id = ? AND substr(date,1,7) = ? GROUP BY type, category`, user.id, month);
    const income = round2(rows.filter(r => r.type === 'income').reduce((s, r) => s + r.total, 0));
    const expenses = round2(rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.total, 0));

    const prevRows = all(`SELECT type, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND substr(date,1,7) = ? GROUP BY type`, user.id, prev);
    const prevExpenses = prevRows.find(r => r.type === 'expense')?.total || 0;
    const prevIncome = prevRows.find(r => r.type === 'income')?.total || 0;

    const byCategory = rows.filter(r => r.type === 'expense').map(r => {
      const c = getCategory(r.category) || {};
      return { category: r.category, label: c.label, icon: c.icon, color: c.color, total: round2(r.total), count: r.n };
    }).sort((a, b) => b.total - a.total);

    // Последните 12 месеца – приходи и разходи
    const from = addMonths(month, -11);
    const monthly = all(`SELECT substr(date,1,7) AS m, type, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND substr(date,1,7) BETWEEN ? AND ? GROUP BY m, type`, user.id, from, month);
    const trend = monthRange(from, month).map(m => ({
      month: m,
      income: round2(monthly.find(r => r.m === m && r.type === 'income')?.total || 0),
      expenses: round2(monthly.find(r => r.m === m && r.type === 'expense')?.total || 0),
    }));

    // Натрупани разходи по дни: този месец срещу предишния
    const daily = (m) => {
      const d = all(`SELECT CAST(substr(date,9,2) AS INTEGER) AS day, SUM(amount) AS total FROM transactions
         WHERE user_id = ? AND type = 'expense' AND substr(date,1,7) = ? GROUP BY day`, user.id, m);
      const map = Object.fromEntries(d.map(r => [r.day, r.total]));
      let acc = 0;
      const limitDay = m === currentMonth() ? Number(today().slice(8, 10)) : daysInMonth(m);
      return Array.from({ length: daysInMonth(m) }, (_, i) => {
        if (i + 1 > limitDay) return null;
        acc += map[i + 1] || 0;
        return round2(acc);
      });
    };

    // ---- Прогноза до края на месеца (само за текущия месец) ----
    // Очакван баланс = сегашен баланс + предстоящи повтарящи се приходи
    //                  − предстоящи повтарящи се разходи − среден дневен променлив разход × оставащи дни
    let projection = null;
    const cumulative = { current: daily(month), previous: daily(prev) };
    if (month === currentMonth()) {
      const todayDay = Number(today().slice(8, 10));
      const dim = daysInMonth(month);
      const hist = all(`SELECT SUM(amount) AS total FROM transactions WHERE user_id = ? AND type = 'expense'
         AND source != 'recurring' AND substr(date,1,7) BETWEEN ? AND ?`, user.id, addMonths(month, -3), prev);
      const histDays = [1, 2, 3].reduce((s, i) => s + daysInMonth(addMonths(month, -i)), 0);
      const dailyVariable = (hist[0]?.total || 0) / histDays;
      const pending = all(`SELECT type, amount, day_of_month FROM recurring WHERE user_id = ? AND active = 1
         AND day_of_month > ? AND start_month <= ?`, user.id, todayDay, month);
      const pendingIn = pending.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
      const pendingOut = pending.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
      const daysLeft = dim - todayDay;
      projection = {
        dailyVariable: round2(dailyVariable),
        pendingIncome: round2(pendingIn),
        pendingExpenses: round2(pendingOut),
        daysLeft,
        endExpenses: round2(expenses + pendingOut + dailyVariable * daysLeft),
        endBalance: round2(income - expenses + pendingIn - pendingOut - dailyVariable * daysLeft),
      };
      // Пунктирана линия на графиката: от днес до края на месеца
      let acc = cumulative.current[todayDay - 1] || 0;
      cumulative.projected = Array.from({ length: dim }, (_, i) => {
        const day = i + 1;
        if (day < todayDay) return null;
        if (day > todayDay) {
          acc += dailyVariable + pending.filter(r => r.type === 'expense' && Math.min(r.day_of_month, dim) === day)
            .reduce((s, r) => s + r.amount, 0);
        }
        return round2(acc);
      });
    }

    // ---- Топлинна карта: разходи по дни за последните 53 седмици ----
    const heatFrom = new Date();
    heatFrom.setDate(heatFrom.getDate() - 7 * 53);
    const hf = `${heatFrom.getFullYear()}-${String(heatFrom.getMonth() + 1).padStart(2, '0')}-${String(heatFrom.getDate()).padStart(2, '0')}`;
    const heatmap = all(`SELECT date, SUM(amount) AS total FROM transactions
       WHERE user_id = ? AND type = 'expense' AND source != 'recurring' AND date >= ? GROUP BY date`, user.id, hf)
      .map(r => ({ date: r.date, total: round2(r.total) }));

    const pct = (a, b) => (b ? Math.round((a / b - 1) * 100) : null);
    return {
      month,
      monthLabel: monthLabel(month),
      isCurrent: month === currentMonth(),
      income,
      expenses,
      balance: round2(income - expenses),
      savingsRate: income ? Math.round((income - expenses) / income * 100) : null,
      expensesChangePct: pct(expenses, prevExpenses),
      incomeChangePct: pct(income, prevIncome),
      byCategory,
      trend,
      cumulative,
      projection,
      heatmap,
      insights: month === currentMonth() ? generateInsights(user.id) : [],
    };
  }, { auth: true });

  router.get('/api/forecast', (req, res, { user }) => {
    processRecurring(user.id);
    return forecastNextMonth(user.id);
  }, { auth: true });

  router.get('/api/health', (req, res, { user }) => computeHealthScore(user.id), { auth: true });

  router.post('/api/quick-parse', (req, res, { body, user }) => {
    const text = v.text(body.text, 200, 'Текстът', true);
    return quickParse(text, user.id);
  }, { auth: true });

  router.get('/api/patterns/recurring', (req, res, { user }) => detectRecurringCandidates(user.id), { auth: true });

  router.post('/api/patterns/recurring/accept', (req, res, { body, user }) => {
    const description = v.text(body.description, 100, 'Описанието', true);
    const amount = v.amount(body.amount);
    const category = v.category(body.category, 'expense');
    const day = v.intInRange(body.day_of_month, 1, 31, 'Денят');
    const month = currentMonth();
    // Ако този месец вече е платено ръчно – не създаваме втори запис за него.
    const paidThisMonth = String(body.lastDate || '').slice(0, 7) === month;
    const info = run(`INSERT INTO recurring (user_id, type, amount, category, description, day_of_month, start_month, last_generated)
       VALUES (?, 'expense', ?, ?, ?, ?, ?, ?)`, user.id, amount, category, description, day, month, paidThisMonth ? month : null);
    learn(user.id, description, category);
    processRecurring(user.id);
    return get('SELECT * FROM recurring WHERE id = ?', Number(info.lastInsertRowid));
  }, { auth: true });

  router.post('/api/receipts/parse', (req, res, { body, user }) => {
    let parsed = null;
    if (body.qr) parsed = parseFiscalQR(body.qr);
    if (!parsed && body.text) parsed = parseReceiptText(body.text);
    if (!parsed) {
      throw new HttpError(422, body.qr && !body.text
        ? 'QR кодът не е от българска касова бележка'
        : 'Не успяхме да открием сума в бележката. Опитайте с по-ясна снимка или въведете ръчно.');
    }
    // Ако OCR е разчел името на магазина – предлагаме и категория.
    const suggestion = suggestCategory(parsed.description, 'expense', user.id);
    return { ...parsed, suggestion };
  }, { auth: true });
};
