/**
 * categories.js – списък с категориите за приходи и разходи.
 *
 * Всяка категория има:
 *  - id     – кратък ключ, който се пази в базата данни
 *  - label  – името, което потребителят вижда
 *  - type   – 'expense' (разход) или 'income' (приход)
 *  - group  – за разходите: 'needs' (нужди) или 'wants' (желания).
 *             Използва се от правилото 50/30/20 и при съкращаване на бюджета.
 *  - icon, color – за интерфейса и графиките
 */

const CATEGORIES = [
  // ---------- Разходи ----------
  { id: 'food',          label: 'Храна и магазин',   type: 'expense', group: 'needs', icon: '🛒', color: '#2a9d8f' },
  { id: 'housing',       label: 'Жилище',            type: 'expense', group: 'needs', icon: '🏠', color: '#264653' },
  { id: 'utilities',     label: 'Сметки',            type: 'expense', group: 'needs', icon: '💡', color: '#e9c46a' },
  { id: 'transport',     label: 'Транспорт',         type: 'expense', group: 'needs', icon: '🚗', color: '#f4a261' },
  { id: 'health',        label: 'Здраве и спорт',    type: 'expense', group: 'needs', icon: '💊', color: '#8ab17d' },
  { id: 'education',     label: 'Образование',       type: 'expense', group: 'needs', icon: '📚', color: '#5e60ce' },
  { id: 'restaurants',   label: 'Заведения',         type: 'expense', group: 'wants', icon: '🍕', color: '#e76f51' },
  { id: 'entertainment', label: 'Забавления',        type: 'expense', group: 'wants', icon: '🎬', color: '#b5179e' },
  { id: 'clothing',      label: 'Дрехи',             type: 'expense', group: 'wants', icon: '👕', color: '#4895ef' },
  { id: 'gifts',         label: 'Подаръци',          type: 'expense', group: 'wants', icon: '🎁', color: '#d62828' },
  { id: 'other',         label: 'Други разходи',     type: 'expense', group: 'wants', icon: '📦', color: '#8d99ae' },

  // ---------- Приходи ----------
  { id: 'salary',        label: 'Заплата',           type: 'income', icon: '💼', color: '#2b9348' },
  { id: 'scholarship',   label: 'Стипендия',         type: 'income', icon: '🎓', color: '#55a630' },
  { id: 'freelance',     label: 'Допълнителни',      type: 'income', icon: '💻', color: '#80b918' },
  { id: 'gift_income',   label: 'Подарени пари',     type: 'income', icon: '🎉', color: '#aacc00' },
  { id: 'other_income',  label: 'Други приходи',     type: 'income', icon: '➕', color: '#bfd200' },
];

const BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

/** Връща категорията по id (или undefined). */
function getCategory(id) {
  return BY_ID[id];
}

/** Проверява дали категорията съществува и е от правилния тип. */
function isValidCategory(id, type) {
  const c = BY_ID[id];
  return !!c && (!type || c.type === type);
}

/** Всички категории от даден тип. */
function categoriesOfType(type) {
  return CATEGORIES.filter(c => c.type === type);
}

module.exports = { CATEGORIES, getCategory, isValidCategory, categoriesOfType };
