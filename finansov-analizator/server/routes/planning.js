/**
 * routes/planning.js – бюджети (лимити) и спестовни цели.
 *
 * GET    /api/budgets
 * PUT    /api/budgets                 { category, monthly_limit }  (0 = премахване)
 * POST   /api/budgets/apply-forecast  → приема предложените от прогнозата лимити
 *
 * GET    /api/goals
 * POST   /api/goals                   { name, target_amount, deadline, saved_amount? }
 * PUT    /api/goals/:id
 * POST   /api/goals/:id/deposit       { amount }  → добавя спестени пари
 * DELETE /api/goals/:id
 */

const { all, get, run, transaction } = require('../db');
const { HttpError } = require('../lib/router');
const v = require('../lib/validate');
const { currentMonth, monthDiff, today } = require('../lib/dates');
const { forecastNextMonth } = require('../smart/forecast');

/** Добавя изчислени полета към цел: процент, оставащи месеци, нужно на месец. */
function enrichGoal(g) {
  const remaining = Math.max(0, g.target_amount - g.saved_amount);
  const monthsLeft = monthDiff(currentMonth(), g.deadline.slice(0, 7));
  return {
    ...g,
    progress: Math.min(100, Math.round(g.saved_amount / g.target_amount * 100)),
    remaining: Math.round(remaining * 100) / 100,
    monthsLeft,
    perMonth: Math.round(remaining / Math.max(1, monthsLeft) * 100) / 100,
    done: remaining === 0,
    overdue: monthsLeft < 0 && remaining > 0,
  };
}

module.exports = function (router) {
  // ---------- Бюджети ----------
  router.get('/api/budgets', (req, res, { user }) =>
    all('SELECT category, monthly_limit FROM budgets WHERE user_id = ?', user.id), { auth: true });

  router.put('/api/budgets', (req, res, { body, user }) => {
    const category = v.category(body.category, 'expense');
    const limit = Number(body.monthly_limit);
    if (!limit) {
      run('DELETE FROM budgets WHERE user_id = ? AND category = ?', user.id, category);
      return { ok: true };
    }
    const amount = v.amount(limit, 'Лимитът');
    run(`INSERT INTO budgets (user_id, category, monthly_limit) VALUES (?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit`, user.id, category, amount);
    return { category, monthly_limit: amount };
  }, { auth: true });

  router.post('/api/budgets/apply-forecast', (req, res, { user }) => {
    const f = forecastNextMonth(user.id);
    // Пропускаме категориите само с фиксирани плащания (напр. наем) – за тях лимит няма смисъл.
    const items = f.categories.filter(c => c.type === 'expense' && c.suggestedLimit > 0 && c.variable >= 1);
    transaction(() => {
      for (const c of items) {
        run(`INSERT INTO budgets (user_id, category, monthly_limit) VALUES (?, ?, ?)
             ON CONFLICT(user_id, category) DO UPDATE SET monthly_limit = excluded.monthly_limit`,
          user.id, c.category, c.suggestedLimit);
      }
    });
    return { applied: items.length };
  }, { auth: true });

  // ---------- Цели ----------
  router.get('/api/goals', (req, res, { user }) =>
    all('SELECT * FROM goals WHERE user_id = ? ORDER BY deadline', user.id).map(enrichGoal), { auth: true });

  router.post('/api/goals', (req, res, { body, user }) => {
    const name = v.text(body.name, 60, 'Името', true);
    const target = v.amount(body.target_amount, 'Целевата сума');
    const deadline = v.date(body.deadline);
    if (deadline <= today()) throw new HttpError(400, 'Крайният срок трябва да е в бъдещето');
    const saved = body.saved_amount ? v.amount(body.saved_amount, 'Спестената сума') : 0;
    const info = run('INSERT INTO goals (user_id, name, target_amount, saved_amount, deadline) VALUES (?, ?, ?, ?, ?)',
      user.id, name, target, Math.min(saved, target), deadline);
    res.statusCode = 201;
    return enrichGoal(get('SELECT * FROM goals WHERE id = ?', Number(info.lastInsertRowid)));
  }, { auth: true });

  router.put('/api/goals/:id', (req, res, { params, body, user }) => {
    const id = v.id(params.id);
    const g = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', id, user.id);
    if (!g) throw new HttpError(404, 'Целта не е намерена');
    const m = { ...g, ...body };
    run('UPDATE goals SET name = ?, target_amount = ?, deadline = ? WHERE id = ?',
      v.text(m.name, 60, 'Името', true), v.amount(m.target_amount, 'Целевата сума'), v.date(m.deadline), id);
    return enrichGoal(get('SELECT * FROM goals WHERE id = ?', id));
  }, { auth: true });

  router.post('/api/goals/:id/deposit', (req, res, { params, body, user }) => {
    const id = v.id(params.id);
    const g = get('SELECT * FROM goals WHERE id = ? AND user_id = ?', id, user.id);
    if (!g) throw new HttpError(404, 'Целта не е намерена');
    // Може и отрицателна сума (теглене), но не под 0.
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, 'Невалидна сума');
    const saved = Math.max(0, Math.min(g.target_amount, g.saved_amount + amount));
    run('UPDATE goals SET saved_amount = ? WHERE id = ?', Math.round(saved * 100) / 100, id);
    return enrichGoal(get('SELECT * FROM goals WHERE id = ?', id));
  }, { auth: true });

  router.delete('/api/goals/:id', (req, res, { params, user }) => {
    const info = run('DELETE FROM goals WHERE id = ? AND user_id = ?', v.id(params.id), user.id);
    if (!info.changes) throw new HttpError(404, 'Целта не е намерена');
    return { ok: true };
  }, { auth: true });
};

module.exports.enrichGoal = enrichGoal;
