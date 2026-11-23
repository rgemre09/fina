/**
 * palette.js – команден панел за бързо добавяне (Ctrl+K / ⌘K).
 *
 * Потребителят пише изречение като "кафе 3,50 вчера", а сървърът
 * (/api/quick-parse) го разбира: сума, дата, тип и категория.
 * Резултатът се показва веднага, докато пишеш, и с Enter се записва.
 */

import { api, categoryById } from './api.js';
import { icon } from './icons.js';
import { esc, eur, fmtDate, toast, showError } from './ui.js';

const EXAMPLES = ['кафе 3,50 вчера', 'Лидл 42,80', 'бензин 60 преди 3 дни', '+250 хонорар за сайт', 'кино в петък 14 €'];
let overlay = null;

export function openPalette(onSaved) {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="palette" role="dialog" aria-modal="true" aria-label="Бързо добавяне">
      <div class="inp">${icon('sparkles', 20)}
        <input id="qp-input" placeholder="Опиши разхода или прихода…" autocomplete="off" spellcheck="false">
        <button class="icon-btn" data-close aria-label="Затвори">${icon('x', 18)}</button>
      </div>
      <div class="body">
        <div id="qp-preview"></div>
        <div>
          <div class="muted small" style="margin-bottom:8px">Пробвай:</div>
          <div class="examples">${EXAMPLES.map(e => `<button type="button">${esc(e)}</button>`).join('')}</div>
        </div>
      </div>
      <div class="foot"><span><kbd>Enter</kbd> запиши</span><span><kbd>Esc</kbd> затвори</span>
        <span style="margin-left:auto">Разбира: днес, вчера, преди N дни, дни от седмицата, 15.11, „+“ за приход</span></div>
    </div>`;
  document.body.append(overlay);

  const input = overlay.querySelector('#qp-input');
  const preview = overlay.querySelector('#qp-preview');
  let parsed = null;
  let timer = null;
  let reqId = 0;

  const close = () => { overlay?.remove(); overlay = null; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
  overlay.querySelectorAll('.examples button').forEach(b => b.addEventListener('click', () => {
    input.value = b.textContent;
    input.dispatchEvent(new Event('input'));
    input.focus();
  }));

  async function update() {
    const text = input.value.trim();
    if (!text) { preview.innerHTML = ''; parsed = null; return; }
    const id = ++reqId;
    try {
      const p = await api.post('/api/quick-parse', { text });
      if (id !== reqId) return; // по-стар отговор – игнорираме
      parsed = p;
      const c = categoryById(p.category);
      preview.innerHTML = `
        <div class="parse-preview">
          <div><small>Тип</small><b class="${p.type}">${p.type === 'income' ? '＋ Приход' : '− Разход'}</b></div>
          <div><small>Сума</small><b>${p.amount ? eur(p.amount) : '<span class="muted">—</span>'}</b></div>
          <div><small>Дата</small><b>${esc(p.dateLabel)}</b><span class="muted small">${fmtDate(p.date)}</span></div>
          <div><small>Категория</small><b>${c.icon} ${esc(c.label)}</b><span class="muted small">${Math.round(p.confidence * 100)}% сигурност</span></div>
        </div>
        <div class="muted small" style="margin-top:8px">Описание: <b style="color:var(--text)">${esc(p.description) || '—'}</b>
          ${p.valid ? '' : ' · <span class="expense">липсва сума</span>'}</div>`;
    } catch { /* игнорираме при писане */ }
  }

  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 180); });
  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer);
    await update();
    if (!parsed?.valid) return toast('Напиши и сума, напр. „кафе 3,50“', 'error');
    try {
      await api.post('/api/transactions', {
        type: parsed.type, amount: parsed.amount, description: parsed.description,
        category: parsed.category, date: parsed.date,
      });
      toast(`Добавено: ${parsed.description || categoryById(parsed.category).label} · ${eur(parsed.amount)}`);
      close();
      onSaved?.();
    } catch (err) { showError(err); }
  });

  setTimeout(() => input.focus(), 30);
}
