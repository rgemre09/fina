/**
 * quickParse.js – бързо въвеждане на естествен език.
 *
 * Потребителят пише едно изречение, а програмата извлича от него данните:
 *   "кафе 3,50 вчера"               → разход 3,50 €, вчера, Заведения
 *   "Лидл 42.80"                    → разход 42,80 €, днес, Храна
 *   "+250 хонорар за сайт 15.11"    → приход 250 €, 15.11, Допълнителни
 *   "получих заплата 1850"          → приход 1850 €, днес, Заплата
 *   "бензин 60 преди 3 дни"         → разход 60 €, преди 3 дни, Транспорт
 *
 * Как работи (правила + регулярни изрази):
 *  1. Дата: "днес", "вчера", "завчера"/"онзи ден", "преди N дни",
 *     дни от седмицата ("в понеделник" = последният понеделник), дд.мм(.гггг).
 *  2. Сума: първото число (с точка или запетая), по избор с €/eur/евро.
 *  3. Тип: приход, ако започва с "+" или има думи като "заплата", "получих"...
 *  4. Описание: остатъкът от текста без датата и сумата.
 *  5. Категория: от категоризатора (ключови думи + обучение).
 */

const { suggestCategory } = require('./categorizer');
const { isValidDate, pad } = require('../lib/dates');

const INCOME_WORDS = ['заплата', 'получих', 'приход', 'хонорар', 'стипендия', 'бонус', 'аванс', 'продадох', 'върнаха', 'подариха'];
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); };

function parseQuickText(input) {
  let text = ` ${String(input || '').trim()} `;
  const lower = () => text.toLowerCase();
  let date = daysAgo(0);
  let dateLabel = 'днес';

  // ---- 1) Дата ----
  const rules = [
    [/\s(днес)\s/i, () => [daysAgo(0), 'днес']],
    [/\s(вчера)\s/i, () => [daysAgo(1), 'вчера']],
    [/\s(завчера|онзи ден)\s/i, () => [daysAgo(2), 'завчера']],
    [/\s(преди\s+(\d{1,2})\s+дн[иея]+)\s/i, m => [daysAgo(Number(m[2])), `преди ${m[2]} дни`]],
  ];
  let matched = false;
  for (const [re, fn] of rules) {
    const m = text.match(re);
    if (m) { [date, dateLabel] = fn(m); text = text.replace(m[1], ' '); matched = true; break; }
  }
  if (!matched) {
    // "в понеделник" → последният понеделник (ако е днес – днес)
    const wd = WEEKDAYS.findIndex(w => lower().includes(w));
    if (wd >= 0) {
      const diff = (new Date().getDay() - wd + 7) % 7;
      date = daysAgo(diff);
      dateLabel = WEEKDAYS[wd];
      text = text.replace(new RegExp(`\\s(в\\s+|във\\s+)?${WEEKDAYS[wd]}`, 'i'), ' ');
      matched = true;
    }
  }
  if (!matched) {
    // 15.11 или 15.11.2026 (точката трябва да е последвана от месец 01–12)
    const m = text.match(/\s(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?(?=\s)/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) <= 31) {
      const year = m[3] || String(new Date().getFullYear());
      const candidate = `${year}-${pad(m[2])}-${pad(m[1])}`;
      if (isValidDate(candidate)) {
        date = candidate;
        dateLabel = `${pad(m[1])}.${pad(m[2])}.${year}`;
        text = text.replace(m[0], ' ');
      }
    }
  }

  // ---- 2) Тип ----
  let type = 'expense';
  if (/^\s*\+/.test(text) || INCOME_WORDS.some(w => lower().includes(w))) type = 'income';
  text = text.replace(/^\s*[+-]/, ' ');

  // ---- 3) Сума ----
  let amount = null;
  const am = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(€|eur|евро|лв\.?)?(?=\s|$)/i);
  if (am) {
    amount = Number(am[1].replace(',', '.'));
    text = text.replace(am[0], ' ');
  }

  // ---- 4) Описание ----
  const description = text.replace(/\s+/g, ' ').replace(/^\s*(за|на|от)\s+/i, '').trim();
  const clean = description.charAt(0).toUpperCase() + description.slice(1);

  return { type, amount, date, dateLabel, description: clean };
}

/** Анализира текста и добавя предложение за категория. */
function quickParse(input, userId) {
  const p = parseQuickText(input);
  const suggestion = suggestCategory(p.description, p.type, userId);
  return { ...p, category: suggestion.category, confidence: suggestion.confidence, reason: suggestion.reason, valid: p.amount > 0 };
}

module.exports = { quickParse, parseQuickText };
