/**
 * recurringEngine.js – автоматично добавяне на повтарящите се плащания.
 *
 * За всяко активно повтарящо се плащане проверяваме за кои месеци
 * още няма създаден запис (от last_generated + 1 до текущия месец)
 * и ги създаваме. За текущия месец – само ако денят вече е настъпил.
 * Ако денят е 31, а месецът има 30 дни – записът е на последния ден.
 *
 * Функцията се вика автоматично при отваряне на таблото и транзакциите,
 * затова потребителят не трябва да прави нищо ръчно.
 */

const { all, run, transaction } = require('../db');
const { currentMonth, addMonths, daysInMonth, today, pad } = require('../lib/dates');

function processRecurring(userId) {
  const now = currentMonth();
  const todayDay = Number(today().slice(8, 10));
  const items = all('SELECT * FROM recurring WHERE user_id = ? AND active = 1', userId);
  let created = 0;

  transaction(() => {
    for (const r of items) {
      let month = r.last_generated ? addMonths(r.last_generated, 1) : r.start_month;
      let lastDone = r.last_generated;
      while (month <= now) {
        const day = Math.min(r.day_of_month, daysInMonth(month));
        if (month === now && day > todayDay) break; // още не е дошъл денят
        run(`INSERT INTO transactions (user_id, type, amount, category, description, date, source, recurring_id)
             VALUES (?, ?, ?, ?, ?, ?, 'recurring', ?)`,
          userId, r.type, r.amount, r.category, r.description, `${month}-${pad(day)}`, r.id);
        created++;
        lastDone = month;
        month = addMonths(month, 1);
      }
      if (lastDone !== r.last_generated) {
        run('UPDATE recurring SET last_generated = ? WHERE id = ?', lastDone, r.id);
      }
    }
  });
  return created;
}

module.exports = { processRecurring };
