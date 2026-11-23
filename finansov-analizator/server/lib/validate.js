/**
 * validate.js – проверка на данните от потребителя.
 * Никога не вярваме на данните от браузъра – проверяваме всичко на сървъра.
 */

const { HttpError } = require('./router');
const { isValidCategory } = require('../categories');
const { isValidDate } = require('./dates');

function amount(value, field = 'Сумата') {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > 10_000_000) throw new HttpError(400, `${field} трябва да е положително число`);
  return Math.round(n * 100) / 100;
}

function type(value) {
  if (value !== 'income' && value !== 'expense') throw new HttpError(400, 'Типът трябва да е приход или разход');
  return value;
}

function category(value, t) {
  if (!isValidCategory(value, t)) throw new HttpError(400, 'Невалидна категория');
  return value;
}

function date(value) {
  if (!isValidDate(value)) throw new HttpError(400, 'Невалидна дата');
  return value;
}

function text(value, max = 200, field = 'Текстът', required = false) {
  const s = String(value ?? '').trim();
  if (required && !s) throw new HttpError(400, `${field} е задължително поле`);
  if (s.length > max) throw new HttpError(400, `${field} е твърде дълъг (макс. ${max} знака)`);
  return s;
}

function intInRange(value, min, max, field) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${field} трябва да е между ${min} и ${max}`);
  return n;
}

function id(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Невалиден идентификатор');
  return n;
}

module.exports = { amount, type, category, date, text, intInRange, id };
