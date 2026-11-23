/**
 * auth.js – регистрация, вход и сесии.
 *
 * Сигурност:
 *  - Паролите се хешират със scrypt (бавен алгоритъм, устойчив на налучкване)
 *    и случайна "сол" за всеки потребител.
 *  - Сравнението става с timingSafeEqual, за да не издава информация по времето.
 *  - Сесията е случаен 256-битов токен в HttpOnly бисквитка
 *    (JavaScript в браузъра не може да я прочете).
 */

const crypto = require('node:crypto');
const { get, run } = require('../db');

const SESSION_DAYS = 7;
const COOKIE_NAME = 'fa_session';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

/** Създава нов потребител. Връща id или хвърля грешка, ако името е заето. */
function createUser(username, password) {
  const { hash, salt } = hashPassword(password);
  const info = run('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)', username, hash, salt);
  return Number(info.lastInsertRowid);
}

/** Проверява име и парола. Връща потребителя или null. */
function checkCredentials(username, password) {
  const user = get('SELECT * FROM users WHERE username = ?', username);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) return null;
  return { id: user.id, username: user.username };
}

/** Създава сесия и връща заглавката Set-Cookie. */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires);
  // Почистваме изтеклите сесии от време на време.
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 3600}`;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').map(p => p.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, v.join('=')])
  );
}

/** Намира потребителя по бисквитката на заявката. */
function getUserFromRequest(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  return get(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`, token, Date.now()) || null;
}

/** Изтрива сесията и връща бисквитка, която я изчиства в браузъра. */
function destroySession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

module.exports = { createUser, checkCredentials, createSession, getUserFromRequest, destroySession, hashPassword };
