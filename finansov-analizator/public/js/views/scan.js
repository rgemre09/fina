/**
 * views/scan.js – сканиране на касова бележка.
 *
 * Стъпки:
 *  1. Потребителят снима бележката (на телефон се отваря камерата) или избира файл.
 *  2. Рисуваме снимката в <canvas> и търсим QR код с jsQR.
 *     Българските бележки имат QR с: ФП*№*дата*час*сума  → точен резултат.
 *  3. Ако няма QR код – пускаме OCR (Tesseract.js) на български + английски
 *     и изпращаме разпознатия текст на сървъра, който открива сумата и датата.
 *  4. Показваме попълнена форма – потребителят проверява и записва.
 */

import { api } from '../api.js';
import { esc, eur, fmtDate, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { mountTxForm } from './txForm.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

export async function render(el) {
  el.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('scan', 14)} Въвеждане</div><h1>Сканирай касова бележка</h1><div class="sub">Снимай бележката – програмата разчита сумата, датата и магазина</div></div>
    </div>
    <div class="grid two">
      <div class="card">
        <label class="dropzone" id="drop">
          <span class="tile green">${icon('camera', 26)}</span>
          <b>Снимай или избери снимка на бележка</b>
          <span class="muted small">Първо търсим QR кода, а ако го няма – разпознаваме текста (OCR)</span>
          <input type="file" accept="image/*" id="file" hidden>
        </label>
        <div id="steps" class="steps"></div>
        <img id="preview" class="preview" alt="" hidden>
        <details>
          <summary>Нямаш бележка подръка? Въведи текста от QR кода ръчно</summary>
          <form id="qr-form" class="form" style="margin-top:10px">
            <input name="qr" placeholder="50163145*0001234*2026-11-08*14:23:45*23.70">
            <div style="display:flex;gap:8px">
              <button class="btn" type="submit">Разчети</button>
              <button class="btn ghost" type="button" id="sample">Пример</button>
            </div>
          </form>
        </details>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><span class="tile violet">${icon('sparkles', 18)}</span><h2>Резултат</h2></div></div>
        <div id="result">${emptyState('scan', 'Все още няма сканирана бележка.<br><span class="small">QR код → точни данни · без QR → OCR разпознаване на текст</span>')}</div>
      </div>
    </div>`;

  const fileInput = el.querySelector('#file');
  const drop = el.querySelector('#drop');
  const stepsEl = el.querySelector('#steps');
  const resultEl = el.querySelector('#result');

  const step = (icon, text) => {
    const d = document.createElement('div');
    d.innerHTML = `<span>${icon}</span><span>${esc(text)}</span>`;
    stepsEl.append(d);
    return d;
  };

  fileInput.addEventListener('change', () => fileInput.files[0] && processImage(fileInput.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) processImage(e.dataTransfer.files[0]);
  });

  el.querySelector('#sample').onclick = () => {
    const d = new Date();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    el.querySelector('[name=qr]').value = `50163145*0001234*${date}*14:23:45*23.70`;
  };
  el.querySelector('#qr-form').addEventListener('submit', async e => {
    e.preventDefault();
    stepsEl.innerHTML = '';
    try {
      showResult(await api.post('/api/receipts/parse', { qr: e.target.qr.value }));
    } catch (err) { showError(err); }
  });

  /** Основната обработка на снимката. */
  async function processImage(file) {
    stepsEl.innerHTML = '';
    resultEl.innerHTML = '<p class="muted">Обработка…</p>';
    const img = await loadImage(file);
    const preview = el.querySelector('#preview');
    preview.src = img.src;
    preview.hidden = false;

    // --- 1) QR код ---
    const s1 = step('⏳', 'Търся QR код…');
    const qr = findQR(img);
    let parsed = null;
    if (qr) {
      try {
        parsed = await api.post('/api/receipts/parse', { qr });
        s1.innerHTML = '<span>✅</span><span>QR кодът е разчетен</span>';
      } catch {
        s1.innerHTML = '<span>⚠️</span><span>Намерен е QR код, но не е от касова бележка</span>';
      }
    } else {
      s1.innerHTML = '<span>➖</span><span>Не е намерен QR код</span>';
    }

    // --- 2) OCR, ако QR не е помогнал ---
    if (!parsed) {
      const s2 = step('⏳', 'Разпознаване на текста (OCR)… първия път може да отнеме до минута');
      try {
        const text = await runOCR(img, pct => {
          s2.innerHTML = `<span>⏳</span><span>Разпознаване на текста: ${pct}%</span>`;
        });
        s2.innerHTML = '<span>✅</span><span>Текстът е разпознат</span>';
        parsed = await api.post('/api/receipts/parse', { text });
        parsed.rawText = text;
      } catch (err) {
        s2.innerHTML = `<span>❌</span><span>${esc(err.message)}</span>`;
        resultEl.innerHTML = '<p class="empty">Не успяхме да разчетем бележката. Опитай с по-ясна снимка или въведи разхода ръчно от „Записи“.</p>';
        return;
      }
    }
    showResult(parsed);
  }

  /** Показва разчетените данни и форма за потвърждение. */
  async function showResult(p) {
    const how = p.method === 'qr' ? `${icon('check', 15)} Разчетено от QR кода` : `${icon('info', 15)} Разпознат текст (OCR) – провери сумата`;
    resultEl.innerHTML = `
      <div class="suggestion" style="margin-bottom:12px">
        <span>${how}</span>
        <span class="confidence"><i style="width:${Math.round(p.confidence * 100)}%"></i></span>
        <span class="muted small">Сума ${eur(p.amount)} · ${fmtDate(p.date)}${p.time ? ' ' + esc(p.time) : ''}</span>
      </div>
      <div id="confirm-form"></div>
      ${p.rawText ? `<details><summary>Разпознат текст</summary><pre class="ocr">${esc(p.rawText)}</pre></details>` : ''}`;

    await mountTxForm(resultEl.querySelector('#confirm-form'), {
      initial: {
        type: 'expense',
        amount: String(p.amount),
        date: p.date,
        description: p.description,
        category: p.suggestion?.confidence ? p.suggestion.category : undefined,
        source: 'receipt',
      },
      submitLabel: 'Добави разхода',
      onSaved: () => { location.hash = '#/transactions'; },
    });
  }
}

/* ---------------- Помощни функции ---------------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Файлът не е изображение'));
    img.src = URL.createObjectURL(file);
  });
}

/** Рисува изображението в canvas с максимална ширина. */
function toCanvas(img, maxSize) {
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Търси QR код при няколко размера на снимката (помага при големи/малки кодове). */
function findQR(img) {
  if (!window.jsQR) return null;
  for (const size of [1600, 1000, 700]) {
    const c = toCanvas(img, size);
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    const code = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
    if (code?.data) return code.data;
  }
  return null;
}

/** Зарежда Tesseract.js само при нужда (библиотеката е голяма). */
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не може да се зареди OCR библиотеката (нужен е интернет)'));
    document.head.append(s);
  });
}

/** OCR: снимка → текст. Подобряваме контраста (сиво + праг) за по-добро разпознаване. */
async function runOCR(img, onProgress) {
  await loadTesseract();
  const c = toCanvas(img, 2000);
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const gray = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
    const v = gray > 150 ? 255 : gray < 90 ? 0 : gray; // засилваме контраста
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);

  const result = await Tesseract.recognize(c, 'bul+eng', {
    logger: m => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
  });
  return result.data.text;
}
