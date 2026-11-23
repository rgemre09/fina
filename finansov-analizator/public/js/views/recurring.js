/**
 * views/recurring.js – повтарящи се плащания (наем, абонаменти, заплата).
 * Те се добавят автоматично всеки месец на зададения ден.
 */

import { api, getCategories } from '../api.js';
import { eur, esc, catChip, catTile, categoryOptions, toast, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';

export async function render(el) {
  const [items, categories] = await Promise.all([api.get('/api/recurring'), getCategories()]);
  const active = items.filter(r => r.active);
  const monthlyIn = active.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const monthlyOut = active.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);

  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${icon('repeat', 14)} Планиране</div><h1>Абонаменти и повтарящи се плащания</h1>
      <div class="sub">Добавят се автоматично всеки месец – не е нужно да ги въвеждаш ръчно</div></div></div>

    <div class="grid kpis">
      <div class="card kpi"><div class="top"><span class="label">Фиксирани приходи</span><span class="tile green">${icon('down', 17)}</span></div><div class="value income num">${eur(monthlyIn)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Фиксирани разходи</span><span class="tile red">${icon('up', 17)}</span></div><div class="value expense num">${eur(monthlyOut)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Остават за месеца</span><span class="tile blue">${icon('wallet', 17)}</span></div><div class="value num">${eur(monthlyIn - monthlyOut)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Разходи на година</span><span class="tile amber">${icon('calendar', 17)}</span></div><div class="value num">${eur(monthlyOut * 12)}</div></div>
    </div>

    <div class="grid side">
      <div class="card table-wrap">
        ${items.length ? `<table>
          <thead><tr><th>Описание</th><th class="hide-mobile">Категория</th><th>Ден</th><th class="right">Сума</th><th></th></tr></thead>
          <tbody>${items.map(r => `
            <tr style="${r.active ? '' : 'opacity:.5'}">
              <td><div class="tx-desc">${catTile(r.category)}<div><b>${esc(r.description)}</b>${r.active ? '' : ' <span class="badge">на пауза</span>'}</div></div></td>
              <td class="hide-mobile">${catChip(r.category)}</td>
              <td>${r.day_of_month}-о</td>
              <td class="right num ${r.type}">${r.type === 'income' ? '+' : '−'}${eur(r.amount)}</td>
              <td class="right" style="white-space:nowrap">
                <button class="icon-btn" data-toggle="${r.id}" title="${r.active ? 'Пауза' : 'Включи'}" aria-label="${r.active ? 'Пауза' : 'Включи'}">${icon(r.active ? 'pause' : 'play', 15)}</button>
                <button class="icon-btn danger" data-del="${r.id}" title="Изтрий" aria-label="Изтрий">${icon('trash', 16)}</button>
              </td>
            </tr>`).join('')}
          </tbody></table>` : emptyState('repeat', 'Няма повтарящи се плащания.')}
      </div>

      <div class="card">
        <div class="card-head"><div class="card-title"><span class="tile green">${icon('plus', 18)}</span><h2>Ново повтарящо се</h2></div></div>
        <form id="rec-form" class="form">
          <label>Тип<select name="type">
            <option value="expense">Разход</option><option value="income">Приход</option>
          </select></label>
          <label>Описание<input name="description" maxlength="100" placeholder="напр. Наем, Netflix, Заплата" required></label>
          <label>Категория<select name="category">${categoryOptions(categories, 'expense')}</select></label>
          <div class="form row">
            <label>Сума (€)<input name="amount" inputmode="decimal" required></label>
            <label>Ден от месеца<input name="day_of_month" type="number" min="1" max="31" value="1" required></label>
          </div>
          <button class="btn primary" type="submit">Добави</button>
        </form>
      </div>
    </div>`;

  const form = el.querySelector('#rec-form');
  form.type.addEventListener('change', () => {
    form.category.innerHTML = categoryOptions(categories, form.type.value);
  });
  // Автоматично предлагане на категория и тук.
  let timer;
  form.description.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const s = await api.get(`/api/categorize?type=${form.type.value}&text=${encodeURIComponent(form.description.value)}`).catch(() => null);
      if (s?.confidence) form.category.value = s.category;
    }, 300);
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api.post('/api/recurring', {
        type: form.type.value,
        description: form.description.value,
        category: form.category.value,
        amount: form.amount.value.replace(',', '.'),
        day_of_month: Number(form.day_of_month.value),
      });
      toast('Добавено ✔');
      render(el);
    } catch (err) { showError(err); }
  });

  el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const r = items.find(x => x.id === Number(b.dataset.toggle));
    try {
      await api.put(`/api/recurring/${r.id}`, { active: r.active ? 0 : 1 });
      render(el);
    } catch (err) { showError(err); }
  });

  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (b.dataset.confirm !== '1') {
      b.dataset.confirm = '1';
      b.innerHTML = '<span class="small expense" style="font-weight:600">Изтрий?</span>';
      return;
    }
    try {
      await api.del(`/api/recurring/${b.dataset.del}`);
      toast('Изтрито. Вече създадените записи остават.');
      render(el);
    } catch (err) { showError(err); }
  });
}
