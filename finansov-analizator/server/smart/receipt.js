/**
 * receipt.js – разчитане на касова бележка.
 *
 * Два начина:
 *
 * 1) QR КОД (точен)
 *    Според Наредба Н-18 всяка българска касова бележка има QR код с текст:
 *       <номер на фискалната памет>*<номер на бележката>*<дата>*<час>*<сума>
 *    Пример: 50163145*0001234*2026-11-08*14:23:45*23.70
 *    Браузърът чете QR кода (библиотека jsQR), а тук разделяме текста по '*'.
 *
 * 2) OCR – разпознаване на текст от снимка (по-малко точно)
 *    Браузърът превръща снимката в текст (Tesseract.js), а тук търсим:
 *     - сумата: ред с "ОБЩА СУМА", "ОБЩО", "СУМА", "TOTAL"...
 *       ако няма такъв ред – най-голямото число с 2 знака след десетичната запетая;
 *     - датата: формат дд.мм.гггг или дд-мм-гггг;
 *     - магазина: първият ред, който съдържа букви (обикновено името на фирмата).
 */

const { isValidDate, today } = require('../lib/dates');

/** Разчита текста от QR кода на касова бележка. Връща null, ако форматът не пасва. */
function parseFiscalQR(text) {
  const parts = String(text || '').trim().split('*');
  if (parts.length < 5) return null;
  const [fiscalMemory, receiptNo, date, time, amountStr] = parts;
  const amount = Number(String(amountStr).replace(',', '.'));
  if (!/^\d+$/.test(fiscalMemory) || !isValidDate(date) || !(amount > 0)) return null;
  return {
    method: 'qr',
    amount: Math.round(amount * 100) / 100,
    date,
    time,
    fiscalMemory,
    receiptNo,
    description: `Касова бележка №${receiptNo.replace(/^0+/, '') || receiptNo}`,
    confidence: 0.99,
  };
}

const TOTAL_WORDS = ['обща сума', 'общо', 'сума', 'всичко', 'total', 'за плащане', 'в брой', 'карта'];
// Числа като 23.70, 23,70, 1 234,50
const AMOUNT_RE = /(\d{1,3}(?:[  ]\d{3})*|\d+)[.,](\d{2})(?!\d)/g;

function amountsIn(line) {
  const out = [];
  for (const m of line.matchAll(AMOUNT_RE)) {
    out.push(Number(m[1].replace(/[  ]/g, '') + '.' + m[2]));
  }
  return out;
}

/** Разчита текст, получен от OCR. */
function parseReceiptText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  // OCR често бърка: О↔0, l↔1. Нормализираме за търсене на ключови думи.
  const norm = l => l.toLowerCase().replace(/0(?=[а-я])/g, 'о');

  // --- сума ---
  let amount = null;
  let foundBy = 'largest';
  for (const word of TOTAL_WORDS) {
    // Търсим отдолу нагоре – общата сума обикновено е в края.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!norm(lines[i]).includes(word)) continue;
      // Сумата обикновено е на същия ред, понякога – на следващия.
      let nums = amountsIn(lines[i]);
      if (!nums.length && lines[i + 1]) nums = amountsIn(lines[i + 1]);
      if (nums.length) {
        amount = Math.max(...nums);
        foundBy = word;
        break;
      }
    }
    if (amount) break;
  }
  if (!amount) {
    const all = lines.flatMap(amountsIn).filter(n => n < 100000);
    if (all.length) amount = Math.max(...all);
  }

  // --- дата ---
  let date = null;
  const dm = String(text).match(/(\d{2})[.\-/](\d{2})[.\-/](\d{4})/);
  if (dm) {
    const candidate = `${dm[3]}-${dm[2]}-${dm[1]}`;
    if (isValidDate(candidate)) date = candidate;
  }

  // --- магазин: първият ред с поне 3 букви подред ---
  const store = lines.find(l => /[a-zа-я]{3,}/i.test(l)) || '';

  if (!amount) return null;
  return {
    method: 'ocr',
    amount: Math.round(amount * 100) / 100,
    date: date || today(),
    description: store.replace(/\s+/g, ' ').slice(0, 60),
    foundBy,
    confidence: foundBy === 'largest' ? 0.5 : 0.8,
  };
}

module.exports = { parseFiscalQR, parseReceiptText };
