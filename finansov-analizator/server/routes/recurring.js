/**
 * routes/recurring.js – повтарящи се плащания и приходи.
 *
 * GET    /api/recurring
 * POST   /api/recurring        { type, amount, category, description, day_of_month }
 * PUT    /api/recurring/:id    (напр. { active: 0 } за пауза)
 * DELETE /api/recurring/:id    (вече създадените записи остават)
 */

const { all, get, run } = require('../db');
const { HttpError } = require('../lib/router');
const v = require('../lib/validate');
const { currentMonth, today, addMonths } = require('../lib/dates');
const { processRecurring } = require('../smart/recurringEngine');
const { learn } = require('../smart/categorizer');

module.exports = function (router) {
  router.get('/api/recurring', (req, res, { user }) =>
    all('SELECT * FROM recurring WHERE user_id = ? ORDER BY type DESC, day_of_month', user.id), { auth: true });

  router.post('/api/recurring', (req, res, { body, user }) => {
    const type = v.type(body.type);
    const r = {
      amount: v.amount(body.amount),
      category: v.category(body.category, type),
      description: v.text(body.description, 100, 'Описанието', true),
      day: v.intInRange(body.day_of_month, 1, 31, 'Денят от месеца'),
    };
    // Започваме от текущия месец. Ако денят вече е минал – първият запис се създава веднага.
    const info = run(`INSERT INTO recurring (user_id, type, amount, category, description, day_of_month, start_month)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`, user.id, type, r.amount, r.category, r.description, r.day, currentMonth());
    learn(user.id, r.description, r.category);
    processRecurring(user.id);
    res.statusCode = 201;
    return get('SELECT * FROM recurring WHERE id = ?', Number(info.lastInsertRowid));
  }, { auth: true });

  router.put('/api/recurring/:id', (req, res, { params, body, user }) => {
    const id = v.id(params.id);
    const old = get('SELECT * FROM recurring WHERE id = ? AND user_id = ?', id, user.id);
    if (!old) throw new HttpError(404, 'Не е намерено');
    const merged = { ...old, ...body };
    const active = merged.active ? 1 : 0;
    // При повторно включване не създаваме записи за месеците на паузата.
    let lastGenerated = old.last_generated;
    if (active && !old.active) {
      const day = old.day_of_month;
      lastGenerated = Number(today().slice(8, 10)) >= day ? currentMonth() : addMonths(currentMonth(), -1);
    }
    run(`UPDATE recurring SET amount = ?, category = ?, description = ?, day_of_month = ?, active = ?, last_generated = ?
         WHERE id = ?`,
      v.amount(merged.amount), v.category(merged.category, old.type), v.text(merged.description, 100, 'Описанието', true),
      v.intInRange(merged.day_of_month, 1, 31, 'Денят от месеца'), active, lastGenerated, id);
    return get('SELECT * FROM recurring WHERE id = ?', id);
  }, { auth: true });

  router.delete('/api/recurring/:id', (req, res, { params, user }) => {
    const info = run('DELETE FROM recurring WHERE id = ? AND user_id = ?', v.id(params.id), user.id);
    if (!info.changes) throw new HttpError(404, 'Не е намерено');
    return { ok: true };
  }, { auth: true });
};
