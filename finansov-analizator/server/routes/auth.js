/**
 * routes/auth.js – регистрация, вход, изход.
 *
 * POST /api/register  { username, password }
 * POST /api/login     { username, password }
 * POST /api/logout
 * GET  /api/me        → текущият потребител
 */

const { HttpError, sendJson } = require('../lib/router');
const { createUser, checkCredentials, createSession, destroySession, getUserFromRequest } = require('../lib/auth');
const { get } = require('../db');

module.exports = function (router) {
  router.post('/api/register', (req, res, { body }) => {
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!/^[\p{L}\d_.-]{3,30}$/u.test(username)) {
      throw new HttpError(400, 'Името трябва да е от 3 до 30 букви, цифри, точка, тире или долна черта');
    }
    if (password.length < 6) throw new HttpError(400, 'Паролата трябва да е поне 6 знака');
    if (get('SELECT id FROM users WHERE username = ?', username)) throw new HttpError(409, 'Това име вече е заето');

    const id = createUser(username, password);
    sendJson(res, 201, { id, username }, { 'Set-Cookie': createSession(id) });
  });

  router.post('/api/login', (req, res, { body }) => {
    const user = checkCredentials(String(body.username || '').trim(), String(body.password || ''));
    if (!user) throw new HttpError(401, 'Грешно име или парола');
    sendJson(res, 200, user, { 'Set-Cookie': createSession(user.id) });
  });

  router.post('/api/logout', (req, res) => {
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': destroySession(req) });
  });

  router.get('/api/me', (req) => {
    const user = getUserFromRequest(req);
    if (!user) throw new HttpError(401, 'Не сте влезли');
    return user;
  });
};
