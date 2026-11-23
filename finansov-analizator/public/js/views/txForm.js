/**
 * views/txForm.js – формата за приход/разход.
 * Използва се на два екрана: "Записи" и "Сканирай" (за потвърждение на бележка).
 *
 * Умната част: докато потребителят пише описанието, след кратка пауза
 * питаме сървъра за категория (/api/categorize) и я избираме автоматично.
 * Ако потребителят сам смени категорията, повече не я пипаме.
 */

import { api, getCategories, categoryById } from '../api.js';
import { esc, todayStr, categoryOptions, toast, showError } from '../ui.js';
import { icon } from '../icons.js';

/**
 * @param {HTMLElement} container
 * @param {object} opts
 *   initial   – начални стойности { type, amount, description, category, date, id, source }
 *   onSaved   – функция, извикана след успешно записване
 *   onCancel  – (по избор) бутон "Отказ"
 *   submitLabel
 */
export async function mountTxForm(container, opts = {}) {
  const categories = await getCategories();
  const init = { type: 'expense', amount: '', description: '', date: todayStr(), ...opts.initial };
  let type = init.type;
  let userPicked = !!init.category; // ако има зададена категория – не я сменяме автоматично
  let timer = null;

  container.innerHTML = `
    <form class="form" novalidate>
      <div class="tabs" style="margin:0">
        <button type="button" class="tab expense" data-type="expense">${icon('up', 15)} Разход</button>
        <button type="button" class="tab income" data-type="income">${icon('down', 15)} Приход</button>
      </div>
      <div class="form row">
        <label>Сума (€)<input name="amount" class="amount-input" inputmode="decimal" placeholder="0,00" value="${esc(init.amount)}" required></label>
        <label>Дата<input name="date" type="date" value="${esc(init.date)}" max="${todayStr()}" required></label>
      </div>
      <label>Описание<input name="description" maxlength="200" placeholder="напр. Лидл, OMV, кино…" value="${esc(init.description)}" autocomplete="off"></label>
      <div class="suggestion" hidden></div>
      <label>Категория<select name="category"></select></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" type="submit" style="flex:1">${icon('check', 16)} ${esc(opts.submitLabel || 'Запиши')}</button>
        ${opts.onCancel ? '<button class="btn" type="button" data-cancel>Отказ</button>' : ''}
      </div>
    </form>`;

  const form = container.querySelector('form');
  const select = form.category;
  const sugEl = form.querySelector('.suggestion');

  function setType(t) {
    type = t;
    form.querySelectorAll('[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === t));
    const keep = categoryById(select.value)?.type === t ? select.value : init.category;
    select.innerHTML = categoryOptions(categories, t, keep);
    if (!userPicked) suggest();
  }

  /** Пита сървъра за категория по описанието. */
  async function suggest() {
    const text = form.description.value.trim();
    if (text.length < 2) { sugEl.hidden = true; return; }
    try {
      const s = await api.get(`/api/categorize?type=${type}&text=${encodeURIComponent(text)}`);
      if (!s.confidence) { sugEl.hidden = true; return; }
      const c = categoryById(s.category);
      sugEl.innerHTML = `${icon('sparkles', 16)} <span>Предложение: <b>${c.icon} ${esc(c.label)}</b></span>
        <span class="confidence" title="Увереност"><i style="width:${Math.round(s.confidence * 100)}%"></i></span>
        <span class="muted small">${Math.round(s.confidence * 100)}% · ${esc(s.reason)}</span>`;
      sugEl.hidden = false;
      if (!userPicked) select.value = s.category;
    } catch { /* предложението не е задължително */ }
  }

  form.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => setType(b.dataset.type)));
  form.description.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(suggest, 300); // изчакваме потребителят да спре да пише
  });
  select.addEventListener('change', () => { userPicked = true; });
  form.querySelector('[data-cancel]')?.addEventListener('click', opts.onCancel);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = {
      type,
      amount: form.amount.value.replace(',', '.'),
      description: form.description.value,
      category: select.value,
      date: form.date.value,
      source: init.source,
    };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const saved = init.id ? await api.put(`/api/transactions/${init.id}`, body) : await api.post('/api/transactions', body);
      toast(init.id ? 'Записът е обновен' : 'Записът е добавен ✔');
      opts.onSaved?.(saved);
    } catch (err) {
      showError(err);
    } finally {
      btn.disabled = false;
    }
  });

  setType(type);
  if (init.description && !init.category) suggest();
  return form;
}
