/**
 * routes/transactions.js – приходи и разходи.
 *
 * GET    /api/transactions?month=YYYY-MM&type=&category=&q=   → списък
 * POST   /api/transactions                                     → нов запис
 * PUT    /api/transactions/:id                                 → редакция
 * DELETE /api/transactions/:id                                 → изтриване
 * GET    /api/categorize?text=...&type=expense                 → предложение за категория
 * GET    /api/categories                                       → всички категории
 * GET    /api/export.csv                                       → изтегляне като CSV (за Excel)
 */

const { all, get, run } = require('../db');
const { HttpError } = require('../lib/router');
const v = require('../lib/validate');
const { CATEGORIES, getCategory } = require('../categories');
const { suggestCategory, learn } = require('../smart/categorizer');
const { processRecurring } = require('../smart/recurringEngine');

/** Проверява данните на транзакция от формата. */
function readTransaction(body) {
  const type = v.type(body.type);
  return {
    type,
    amount: v.amount(body.amount),
    category: v.category(body.category, type),
    description: v.text(body.description, 200, 'Описанието'),
    date: v.date(body.date),
    source: body.source === 'receipt' ? 'receipt' : 'manual',
  };
}

module.exports = function (router) {
  router.get('/api/categories', () => CATEGORIES);

  router.get('/api/categorize', (req, res, { query, user }) => {
    const type = query.type === 'income' ? 'income' : 'expense';
    return suggestCategory(query.text || '', type, user.id);
  }, { auth: true });

  router.get('/api/transactions', (req, res, { query, user }) => {
    processRecurring(user.id);
    const where = ['user_id = ?'];
    const params = [user.id];
    if (query.month) { where.push('substr(date,1,7) = ?'); params.push(query.month); }
    if (query.type) { where.push('type = ?'); params.push(query.type); }
    if (query.category) { where.push('category = ?'); params.push(query.category); }
    if (query.q) { where.push('description LIKE ?'); params.push(`%${query.q}%`); }
    return all(`SELECT * FROM transactions WHERE ${where.join(' AND ')}
                ORDER BY date DESC, id DESC LIMIT 1000`, ...params);
  }, { auth: true });

  router.post('/api/transactions', (req, res, { body, user }) => {
    const t = readTransaction(body);
    const info = run(`INSERT INTO transactions (user_id, type, amount, category, description, date, source)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`, user.id, t.type, t.amount, t.category, t.description, t.date, t.source);
    // Обучаваме категоризатора с избора на потребителя.
    learn(user.id, t.description, t.category);
    res.statusCode = 201;
    return get('SELECT * FROM transactions WHERE id = ?', Number(info.lastInsertRowid));
  }, { auth: true });

  router.put('/api/transactions/:id', (req, res, { params, body, user }) => {
    const id = v.id(params.id);
    const old = get('SELECT * FROM transactions WHERE id = ? AND user_id = ?', id, user.id);
    if (!old) throw new HttpError(404, 'Записът не е намерен');
    const t = readTransaction({ ...old, ...body });
    run(`UPDATE transactions SET type = ?, amount = ?, category = ?, description = ?, date = ? WHERE id = ?`,
      t.type, t.amount, t.category, t.description, t.date, id);
    // Ако потребителят е сменил категорията – "отучваме" старата и учим новата.
    if (old.category !== t.category || old.description !== t.description) {
      learn(user.id, old.description, old.category, -1);
      learn(user.id, t.description, t.category, 1);
    }
    return get('SELECT * FROM transactions WHERE id = ?', id);
  }, { auth: true });

  router.delete('/api/transactions/:id', (req, res, { params, user }) => {
    const info = run('DELETE FROM transactions WHERE id = ? AND user_id = ?', v.id(params.id), user.id);
    if (!info.changes) throw new HttpError(404, 'Записът не е намерен');
    return { ok: true };
  }, { auth: true });

  router.get('/api/export.csv', (req, res, { user }) => {
    const rows = all('SELECT * FROM transactions WHERE user_id = ? ORDER BY date', user.id);
    const esc = s => `"${String(s).replace(/"/g, '""')}"`;
    const lines = ['Дата;Тип;Категория;Описание;Сума (EUR);Източник'];
    for (const r of rows) {
      lines.push([r.date, r.type === 'income' ? 'Приход' : 'Разход', getCategory(r.category)?.label || r.category,
        esc(r.description), r.amount.toFixed(2).replace('.', ','), r.source].join(';'));
    }
    // ﻿ (BOM) – за да отвори Excel кирилицата правилно.
    const csv = '﻿' + lines.join('\r\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="finansi.csv"',
    });
    res.end(csv);
  }, { auth: true });
};
