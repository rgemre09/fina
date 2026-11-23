/**
 * categorizer.js – автоматично разпознаване на категорията по описанието.
 *
 * Работи на два етапа и комбинира резултатите:
 *
 * 1) ПРАВИЛА (речник с ключови думи)
 *    "Лидл", "Kaufland" → Храна;  "OMV", "бензин" → Транспорт и т.н.
 *    Сравняваме по началото на думата, за да хващаме и формите:
 *    "лекарств" хваща "лекарства", "лекарство".
 *
 * 2) ОБУЧЕНИЕ ОТ ПОТРЕБИТЕЛЯ (опростен наивен Бейсов класификатор)
 *    Всеки път, когато потребителят запише транзакция, запомняме
 *    в таблица category_learning коя дума в коя категория е била.
 *    Ако потребителят поправи категорията, следващия път програмата
 *    ще предложи неговия избор. Така тя "се учи" от навиците му.
 *
 *    За всяка категория c смятаме:
 *      score(c) = Σ по думите w:  log( (count(w,c) + 1) / (total(w) + K) )
 *    (изглаждане на Лаплас, за да няма log(0)). Нормализираме резултатите
 *    до вероятности със softmax.
 *
 * Крайната увереност е комбинация от двата етапа.
 */

const { all, run } = require('../db');
const { categoriesOfType, getCategory } = require('../categories');

/* Речник: категория → ключови думи (малки букви, може и части от думи). */
const KEYWORDS = {
  food: ['лидл', 'lidl', 'кауфланд', 'kaufland', 'билла', 'billa', 'фантастико', 'fantastico', 'т маркет', 't market',
    'метро кеш', 'супермаркет', 'магазин', 'хранителн', 'хляб', 'мляко', 'плод', 'зеленчук', 'месо', 'пазар', 'хали',
    'вилтон', 'cba', 'лекси', 'аванти', 'хранa', 'храна', 'бакалия', 'кашкавал', 'сирене', 'яйца'],
  restaurants: ['ресторант', 'пицар', 'пица', 'pizza', 'кафе', 'coffee', 'starbucks', 'макдоналдс', 'mcdonald', 'kfc',
    'бургер', 'burger', 'дюнер', 'доставка', 'foodpanda', 'glovo', 'wolt', 'takeaway', 'бира', 'бар ', 'механа',
    'заведение', 'суши', 'sushi', 'закуска', 'баничка', 'happy'],
  transport: ['бензин', 'гориво', 'дизел', 'shell', 'omv', 'lukoil', 'лукойл', 'петрол', 'eko', 'ромпетрол', 'такси',
    'taxi', 'uber', 'bolt', 'метро', 'автобус', 'трамвай', 'градски транспорт', 'карта за транспорт', 'паркинг',
    'parking', 'бдж', 'влак', 'винетка', 'автосервиз', 'гуми', 'преглед на кола', 'застраховка кола', 'flixbus'],
  housing: ['наем', 'ипотека', 'входна такса', 'вход ', 'ремонт', 'мебел', 'ikea', 'икеа', 'жилище', 'квартира'],
  utilities: ['ток', 'електро', 'evn', 'енерго', 'енерджи', 'чез', 'вода', 'вик', 'софийска вода', 'парно',
    'топлофикация', 'интернет', 'vivacom', 'виваком', 'a1', 'yettel', 'теленор', 'телефон', 'мобилен', 'сметка за',
    'газ', 'булсатком', 'кабелна'],
  entertainment: ['кино', 'cinema', 'netflix', 'spotify', 'hbo', 'max ', 'disney', 'youtube', 'игра', 'игри', 'steam',
    'playstation', 'xbox', 'nintendo', 'концерт', 'театър', 'боулинг', 'билет за', 'музей', 'фестивал', 'apple music',
    'twitch', 'епик', 'epic games'],
  health: ['аптека', 'sopharmacy', 'софарма', 'субра', 'марешки', 'лекар', 'зъболекар', 'стоматолог', 'лекарств',
    'преглед', 'изследван', 'болница', 'клиника', 'витамин', 'фитнес', 'gym', 'фитнес карта', 'pulse', 'басейн',
    'тренировк', 'multisport', 'мултиспорт'],
  education: ['книга', 'книжарница', 'хеликон', 'сиела', 'курс', 'учебник', 'университет', 'училищ', 'семестър',
    'такса за обучение', 'udemy', 'coursera', 'тетрад', 'химикал', 'канцелар', 'частни уроци', 'урок', 'изпит'],
  clothing: ['дрехи', 'обувки', 'маратонки', 'h&m', 'zara', 'lc waikiki', 'waikiki', 'reserved', 'decathlon', 'декатлон',
    'sinsay', 'pepco', 'яке', 'тениска', 'дънки', 'панталон', 'рокля', 'answear', 'about you', 'шал', 'ботуши'],
  gifts: ['подарък', 'подаръци', 'цветя', 'букет', 'рожден ден', 'имен ден', 'коледа', 'сватба'],
  other: ['техномаркет', 'technomarket', 'технополис', 'technopolis', 'emag', 'зора', 'ozone', 'jysk', 'praktiker',
    'практикер', 'фризьор', 'козметик', 'дрогерия', 'dm ', 'лили', 'temu', 'aliexpress', 'amazon', 'такса банка'],

  salary: ['заплата', 'salary', 'възнаграждение', 'аванс', 'работодател', 'трудово'],
  scholarship: ['стипендия', 'scholarship'],
  freelance: ['хонорар', 'freelance', 'фрийланс', 'поръчка', 'проект', 'частен урок', 'продажба', 'olx', 'bazar',
    'upwork', 'fiverr', 'бонус'],
  gift_income: ['подарък', 'от баба', 'от дядо', 'от мама', 'от татко', 'рожден ден', 'джобни'],
  other_income: ['лихва', 'връщане', 'възстановяване', 'кешбек', 'cashback', 'данъчно'],
};

const RULE_WEIGHT = 0.65;   // колко "тежат" правилата спрямо обучението
const STOPWORDS = new Set(['за', 'от', 'на', 'и', 'в', 'с', 'по', 'до', 'ул', 'еоод', 'оод', 'ад', 'ет', 'бг', 'bg',
  'българия', 'bulgaria', 'гр', 'софия', 'ltd', 'eood', 'ood']);

/** Разделя текста на думи (кирилица/латиница, поне 2 знака, без числа и шумни думи). */
function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-zа-яё&]{2,}/giu) || [])
    .filter(t => !STOPWORDS.has(t));
}

/** Етап 1: правила. Връща { категория: точки } и коя дума е съвпаднала. */
function ruleScores(text, type) {
  const lower = ' ' + String(text || '').toLowerCase() + ' ';
  const tokens = tokenize(text);
  const scores = {};
  const matched = {};
  for (const cat of categoriesOfType(type)) {
    for (const kw of KEYWORDS[cat.id] || []) {
      // Ключови думи с интервал търсим в целия текст, а единичните – по началото на думите.
      const hit = kw.includes(' ') || kw.length <= 2
        ? lower.includes(kw.length <= 2 ? ` ${kw} ` : kw)
        : tokens.some(t => t.startsWith(kw));
      if (hit) {
        scores[cat.id] = (scores[cat.id] || 0) + 1;
        matched[cat.id] = matched[cat.id] || kw;
      }
    }
  }
  return { scores, matched };
}

/** Етап 2: научени вероятности от историята на потребителя. */
function learnedScores(userId, tokens, type) {
  if (!userId || !tokens.length) return null;
  const cats = categoriesOfType(type).map(c => c.id);
  const placeholders = tokens.map(() => '?').join(',');
  const rows = all(
    `SELECT token, category, count FROM category_learning
     WHERE user_id = ? AND token IN (${placeholders})`, userId, ...tokens);
  const relevant = rows.filter(r => cats.includes(r.category));
  if (!relevant.length) return null;

  // count[token][category]
  const counts = {};
  for (const r of relevant) {
    counts[r.token] = counts[r.token] || {};
    counts[r.token][r.category] = r.count;
  }
  const knownTokens = Object.keys(counts);
  const K = cats.length;
  const logScores = {};
  for (const c of cats) {
    let s = 0;
    for (const t of knownTokens) {
      const total = Object.values(counts[t]).reduce((a, b) => a + b, 0);
      s += Math.log(((counts[t][c] || 0) + 1) / (total + K));
    }
    logScores[c] = s;
  }
  return { probs: softmax(logScores), evidence: knownTokens.length };
}

function softmax(obj) {
  const max = Math.max(...Object.values(obj));
  const exps = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.exp(v - max)]));
  const sum = Object.values(exps).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(exps).map(([k, v]) => [k, v / sum]));
}

/**
 * Основна функция: предлага категория за описание.
 * Връща { category, confidence (0..1), reason, alternatives: [{category, confidence}] }
 */
function suggestCategory(text, type = 'expense', userId = null) {
  const fallback = type === 'income' ? 'other_income' : 'other';
  const tokens = tokenize(text);
  const { scores, matched } = ruleScores(text, type);
  const learned = learnedScores(userId, tokens, type);

  // Превръщаме точките от правилата във вероятности.
  const ruleTotal = Object.values(scores).reduce((a, b) => a + b, 0);
  const ruleProbs = ruleTotal ? Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v / ruleTotal])) : null;

  let combined = {};
  if (ruleProbs && learned) {
    // Колкото повече научени думи има, толкова повече вярваме на обучението.
    const lw = Math.min(0.7, 0.3 + 0.15 * learned.evidence);
    for (const c of categoriesOfType(type).map(x => x.id)) {
      combined[c] = (1 - lw) * (ruleProbs[c] || 0) + lw * (learned.probs[c] || 0);
    }
  } else if (ruleProbs) {
    combined = ruleProbs;
  } else if (learned) {
    combined = learned.probs;
  }

  const ranked = Object.entries(combined).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 0.2) {
    return { category: fallback, confidence: 0, reason: 'Няма разпознати думи – изберете категория ръчно.', alternatives: [] };
  }

  const [best, bestP] = ranked[0];
  // Увереността отчита и колко "доказателства" имаме.
  const strength = ruleProbs && learned ? 1 : ruleProbs ? RULE_WEIGHT + 0.1 * Math.min(3, scores[best] || 0) : 0.6 + 0.1 * Math.min(3, learned.evidence);
  const confidence = Math.round(Math.min(0.99, bestP * strength) * 100) / 100;

  let reason;
  if (learned && learned.probs[best] >= 0.5) reason = 'Научено от предишните ви записи.';
  else if (matched[best]) reason = `Разпозната ключова дума „${matched[best].trim()}“.`;
  else reason = 'Комбинация от правила и вашата история.';

  return {
    category: best,
    label: getCategory(best)?.label,
    confidence,
    reason,
    alternatives: ranked.slice(1, 3).filter(([, p]) => p > 0.05).map(([c, p]) => ({ category: c, confidence: Math.round(p * 100) / 100 })),
  };
}

/** Запомня, че думите от описанието принадлежат на категорията (обучение). */
function learn(userId, text, category, delta = 1) {
  const tokens = [...new Set(tokenize(text))];
  for (const t of tokens) {
    run(`INSERT INTO category_learning (user_id, token, category, count) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, token, category) DO UPDATE SET count = MAX(0, count + excluded.count)`,
      userId, t, category, delta);
  }
}

module.exports = { suggestCategory, learn, tokenize, KEYWORDS };
