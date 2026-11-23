/**
 * views/transactions.js – списък с приходи и разходи + форма за нов запис.
 */

import { api, getCategories } from '../api.js';
import { eur, esc, relDate, catChip, catTile, currentMonthStr, monthLabel, addMonths, toast, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { mountTxForm } from './txForm.js';

const filters = { month: currentMonthStr(), type: '', category: '', q: '' };

export async function render(el) {
  const categories = await getCategories();
  const months = Array.from({ length: 13 }, (_, i) => addMonths(currentMonthStr(), -i));

  el.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('list', 14)} Общ преглед</div><h1>Записи</h1><div class="sub">Всички приходи и разходи на едно място</div></div>
      <a class="btn" href="/api/export.csv" download>${icon('download', 16)} Експорт за Excel</a>
    </div>
    <div class="grid side">
      <div class="card">
        <div class="form row" id="filters">
          <label>Месец<select name="month">
            <option value="">Всички</option>
            ${months.map(m => `<option value="${m}" ${m === filters.month ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
          </select></label>
          <label>Тип<select name="type">
            <option value="">Всички</option>
            <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Разходи</option>
            <option value="income" ${filters.type === 'income' ? 'selected' : ''}>Приходи</option>
          </select></label>
          <label>Категория<select name="category">
            <option value="">Всички</option>
            ${categories.map(c => `<option value="${c.id}" ${c.id === filters.category ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}
          </select></label>
          <label>Търсене<input name="q" value="${esc(filters.q)}" placeholder="описание…"></label>
        </div>
        <div id="summary" class="muted small" style="margin:14px 0 4px"></div>
        <div class="table-wrap" id="list"></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><span class="tile green">${icon('plus', 18)}</span><h2 id="form-title">Нов запис</h2></div></div>
        <div id="tx-form"></div>
      </div>
    </div>`;

  const listEl = el.querySelector('#list');
  const formBox = el.querySelector('#tx-form');

  async function showNewForm() {
    el.querySelector('#form-title').textContent = 'Нов запис';
    await mountTxForm(formBox, { onSaved: () => { showNewForm(); loadList(); } });
  }

  async function loadList() {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const items = await api.get(`/api/transactions?${qs}`);
    const inc = items.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const exp = items.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    el.querySelector('#summary').innerHTML =
      `${items.length} записа · приходи <b class="income">${eur(inc)}</b> · разходи <b class="expense">${eur(exp)}</b>`;

    if (!items.length) {
      listEl.innerHTML = emptyState('search', 'Няма записи по тези критерии.');
      return;
    }
    listEl.innerHTML = `<table>
      <thead><tr><th>Описание</th><th class="hide-mobile">Категория</th><th class="right">Сума</th><th></th></tr></thead>
      <tbody>${items.map(t => `
        <tr>
          <td><div class="tx-desc">${catTile(t.category)}<div><b>${esc(t.description) || '<span class="muted">—</span>'}</b>
            <span class="muted small">${relDate(t.date)}</span>
            ${t.source === 'recurring' ? `<span class="badge">${icon('repeat', 11)} автоматично</span>` : ''}
            ${t.source === 'receipt' ? `<span class="badge violet">${icon('scan', 11)} бележка</span>` : ''}</div></div></td>
          <td class="hide-mobile">${catChip(t.category)}</td>
          <td class="right num ${t.type}"><b>${t.type === 'income' ? '+' : '−'}${eur(t.amount)}</b></td>
          <td class="right" style="white-space:nowrap">
            <button class="icon-btn" data-edit="${t.id}" title="Редактирай" aria-label="Редактирай">${icon('edit', 16)}</button>
            <button class="icon-btn danger" data-del="${t.id}" title="Изтрий" aria-label="Изтрий">${icon('trash', 16)}</button>
          </td>
        </tr>`).join('')}
      </tbody></table>`;

    listEl.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
      const t = items.find(x => x.id === Number(b.dataset.edit));
      el.querySelector('#form-title').textContent = 'Редакция';
      await mountTxForm(formBox, {
        initial: t, submitLabel: 'Запази промените',
        onSaved: () => { showNewForm(); loadList(); },
        onCancel: showNewForm,
      });
      formBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    listEl.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      // Двойно натискане за потвърждение – без системен прозорец.
      if (b.dataset.confirm !== '1') {
        b.dataset.confirm = '1';
        b.innerHTML = `<span class="small expense" style="font-weight:600">Изтрий?</span>`;
        setTimeout(() => { b.dataset.confirm = ''; b.innerHTML = icon('trash', 16); }, 2500);
        return;
      }
      try {
        await api.del(`/api/transactions/${b.dataset.del}`);
        toast('Записът е изтрит');
        loadList();
      } catch (err) { showError(err); }
    });
  }

  let timer;
  el.querySelector('#filters').addEventListener('input', e => {
    filters[e.target.name] = e.target.value;
    clearTimeout(timer);
    timer = setTimeout(loadList, e.target.name === 'q' ? 300 : 0);
  });

  await Promise.all([showNewForm(), loadList()]);
}
