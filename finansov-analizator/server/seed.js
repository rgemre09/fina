/**
 * seed.js – създава демо профил с реалистични данни за последните 12 месеца.
 *
 * Нужно е, за да може прогнозата да работи веднага при представянето пред
 * комисията (тя се учи от историята). Данните са генерирани с фиксиран
 * генератор на случайни числа, затова всеки път са еднакви.
 *
 * Ръчно пресъздаване:  npm run seed
 * Профил:  demo / demo1234
 */

const { get, run, transaction } = require('./db');
const { createUser } = require('./lib/auth');
const { currentMonth, addMonths, daysInMonth, today, pad } = require('./lib/dates');
const { processRecurring } = require('./smart/recurringEngine');
const { learn } = require('./smart/categorizer');

/** Генератор на псевдослучайни числа (Mulberry32) – с еднакво "семе" дава еднакви числа. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed() {
  const rnd = mulberry32(2026);
  const between = (a, b) => Math.round((a + rnd() * (b - a)) * 100) / 100;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const now = currentMonth();
  const todayDay = Number(today().slice(8, 10));
  const start = addMonths(now, -12);

  transaction(() => {
    const existing = get('SELECT id FROM users WHERE username = ?', 'demo');
    if (existing) run('DELETE FROM users WHERE id = ?', existing.id); // каскадно изтрива всичко
  });

  const userId = createUser('demo', 'demo1234');
  const txs = [];
  const add = (type, amount, category, description, date) => txs.push({ type, amount, category, description, date });

  // ---------- Променливи разходи и приходи по месеци ----------
  for (let i = 0; i <= 12; i++) {
    const m = addMonths(start, i);
    const monthNum = Number(m.slice(5));
    const lastDay = m === now ? todayDay : daysInMonth(m);
    const day = () => pad(1 + Math.floor(rnd() * lastDay));
    const d = dd => `${m}-${dd}`;
    const winter = [11, 12, 1, 2].includes(monthNum);

    // Храна – около 10 пазарувания на месец (за текущия месец – пропорционално)
    const shops = ['Лидл', 'Kaufland', 'Билла', 'Фантастико', 'Т Маркет', 'Лидл', 'Kaufland'];
    const groceryCount = Math.round((9 + rnd() * 3) * lastDay / daysInMonth(m));
    for (let k = 0; k < groceryCount; k++) add('expense', between(12, 62), 'food', pick(shops), d(day()));

    // Заведения – леко нарастващ тренд през годината
    const restCount = Math.round((4 + i * 0.25 + rnd() * 2) * lastDay / daysInMonth(m));
    const places = ['Happy бар и грил', 'Пицария Виа Верди', 'Кафе Starbucks', 'Glovo доставка', 'McDonald\'s', 'Механа Чучура'];
    for (let k = 0; k < restCount; k++) add('expense', between(7, 32), 'restaurants', pick(places), d(day()));

    // Транспорт
    for (let k = 0; k < 3; k++) if (m !== now || k < 2) add('expense', between(42, 72), 'transport', pick(['OMV гориво', 'Shell бензин', 'Лукойл']), d(day()));
    if (rnd() < 0.7) add('expense', between(6, 16), 'transport', pick(['Bolt такси', 'Uber', 'Паркинг център']), d(day()));

    // Сметки – зимата токът и парното са по-скъпи
    if (lastDay >= 18) add('expense', between(winter ? 85 : 40, winter ? 120 : 60), 'utilities', 'EVN ток', d('18'));
    if (lastDay >= 20) add('expense', between(16, 24), 'utilities', 'Софийска вода', d('20'));
    if (winter && lastDay >= 22) add('expense', between(60, 105), 'utilities', 'Топлофикация парно', d('22'));

    // Забавления
    if (rnd() < 0.8) add('expense', between(12, 19), 'entertainment', 'Кино Арена', d(day()));
    if (rnd() < 0.3) add('expense', between(20, 60), 'entertainment', 'Steam игра', d(day()));

    // YouTube Premium – плаща се ръчно с карта всеки месец. Програмата ще го открие
    // като "скрит абонамент" и ще предложи да го добави към повтарящите се.
    if (i >= 6 && lastDay >= 8) add('expense', 11.99, 'entertainment', 'YouTube Premium', d(pad(6 + (i % 3))));

    // Здраве
    if (rnd() < 0.7) add('expense', between(8, 32), 'health', pick(['Аптека Sopharmacy', 'Аптеки Марешки']), d(day()));

    // Дрехи
    if (rnd() < 0.5 && m !== now) add('expense', between(30, 95), 'clothing', pick(['H&M', 'Zara', 'Decathlon', 'LC Waikiki']), d(day()));

    // Образование
    if (i % 2 === 0 && m !== now) add('expense', between(14, 32), 'education', pick(['Книжарница Хеликон', 'Курс Udemy', 'Учебник']), d(day()));

    // Декември – подаръци и повече покупки (сезонност)
    if (monthNum === 12) {
      for (let k = 0; k < 5; k++) add('expense', between(25, 70), 'gifts', pick(['Подаръци за Коледа', 'Подарък за мама', 'Коледни подаръци']), d(pad(8 + k * 3)));
      add('expense', between(80, 120), 'clothing', 'Zara зимно яке', d('12'));
      add('expense', between(40, 70), 'restaurants', 'Ресторант коледна вечеря', d('23'));
    } else if (rnd() < 0.25 && m !== now) {
      add('expense', between(20, 45), 'gifts', 'Подарък рожден ден', d(day()));
    }

    // Други
    if (rnd() < 0.3 && m !== now) add('expense', between(25, 80), 'other', pick(['Техномаркет', 'eMAG поръчка', 'Фризьор']), d(day()));

    // Допълнителни приходи
    if (rnd() < 0.45 && m !== now) add('income', between(120, 350), 'freelance', pick(['Хонорар уебсайт', 'Частни уроци', 'Продажба OLX']), d(day()));
    if (monthNum === 12) add('income', 100, 'gift_income', 'Подарък от баба за Коледа', d('24'));
  }

  // Необичаен разход в текущия месец – за да покажем откриването на аномалии
  add('expense', 168.4, 'restaurants', 'Ресторант рожден ден с приятели', `${now}-${pad(Math.min(todayDay, 8))}`);

  transaction(() => {
    for (const t of txs) {
      run(`INSERT INTO transactions (user_id, type, amount, category, description, date, source)
           VALUES (?, ?, ?, ?, ?, ?, 'manual')`, userId, t.type, t.amount, t.category, t.description, t.date);
      learn(userId, t.description, t.category);
    }

    // ---------- Повтарящи се плащания ----------
    const recurring = [
      ['income', 1850, 'salary', 'Заплата', 5],
      ['expense', 520, 'housing', 'Наем квартира', 1],
      ['expense', 32.5, 'utilities', 'Vivacom интернет и телефон', 15],
      ['expense', 12.99, 'entertainment', 'Netflix', 10],
      ['expense', 6.99, 'entertainment', 'Spotify', 20],
      ['expense', 45, 'health', 'Фитнес Pulse карта', 3],
    ];
    for (const [type, amount, category, description, dayOfMonth] of recurring) {
      run(`INSERT INTO recurring (user_id, type, amount, category, description, day_of_month, start_month)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, userId, type, amount, category, description, dayOfMonth, start);
      learn(userId, description, category);
    }

    // ---------- Лимити и цели ----------
    for (const [cat, limit] of [['food', 380], ['restaurants', 140], ['transport', 220], ['entertainment', 70], ['clothing', 80]]) {
      run('INSERT INTO budgets (user_id, category, monthly_limit) VALUES (?, ?, ?)', userId, cat, limit);
    }
    run('INSERT INTO goals (user_id, name, target_amount, saved_amount, deadline) VALUES (?, ?, ?, ?, ?)',
      userId, 'Нов лаптоп', 1400, 520, `${addMonths(now, 5)}-28`);
    run('INSERT INTO goals (user_id, name, target_amount, saved_amount, deadline) VALUES (?, ?, ?, ?, ?)',
      userId, 'Лятна почивка', 900, 150, `${addMonths(now, 8)}-15`);
  });

  processRecurring(userId);
  console.log(`  ✔ Демо профилът е създаден (${txs.length} записа + повтарящи се плащания).`);
  return userId;
}

module.exports = { seed };

// Ако файлът е пуснат директно: node server/seed.js
if (require.main === module) seed();
