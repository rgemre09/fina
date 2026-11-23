/**
 * views/goals.js – спестовни цели с кръгови индикатори за прогреса.
 */

import { api } from '../api.js';
import { icon } from '../icons.js';
import { eur, esc, fmtDate, todayStr, toast, showError, ring, emptyState } from '../ui.js';

export async function render(el) {
  const goals = await api.get('/api/goals');
  const totalTarget = goals.reduce((s, g) => s + g.target_amount, 0);
  const totalSaved = goals.reduce((s, g) => s + g.saved_amount, 0);
  const perMonth = goals.filter(g => !g.done && !g.overdue).reduce((s, g) => s + g.perMonth, 0);

  el.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">${icon('target', 14)} Планиране</div><h1>Спестовни цели</h1>
      <div class="sub">За какво спестяваш и колко трябва да отделяш на месец</div></div>
      <a class="btn" href="#/simulator">${icon('sliders', 16)} Отвори симулатора</a></div>

    <div class="grid three">
      <div class="card kpi"><div class="top"><span class="label">Спестено общо</span><span class="tile green">${icon('wallet', 17)}</span></div>
        <div class="value num">${eur(totalSaved)}</div><div class="delta muted">от ${eur(totalTarget)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Нужно на месец</span><span class="tile violet">${icon('calendar', 17)}</span></div>
        <div class="value num">${eur(perMonth)}</div><div class="delta muted">за всички цели навреме</div></div>
      <div class="card kpi"><div class="top"><span class="label">Активни цели</span><span class="tile amber">${icon('target', 17)}</span></div>
        <div class="value num">${goals.filter(g => !g.done).length}</div><div class="delta muted">${goals.filter(g => g.done).length} постигнати</div></div>
    </div>

    <div class="grid two">
      ${goals.length ? goals.map(goalCard).join('') : `<div class="card">${emptyState('target', 'Още нямаш цели. Добави първата отдолу!')}</div>`}
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title"><span class="tile green">${icon('plus', 18)}</span><h2>Нова цел</h2></div></div>
      <form id="goal-form" class="form row">
        <label>Име<input name="name" maxlength="60" placeholder="напр. Нов телефон" required></label>
        <label>Сума (€)<input name="target_amount" inputmode="decimal" required></label>
        <label>Вече спестени (€)<input name="saved_amount" inputmode="decimal" placeholder="0"></label>
        <label>Краен срок<input name="deadline" type="date" min="${todayStr()}" required></label>
        <button class="btn primary" type="submit">${icon('check', 16)} Добави цел</button>
      </form>
    </div>`;

  el.querySelector('#goal-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api.post('/api/goals', {
        name: f.name.value,
        target_amount: f.target_amount.value.replace(',', '.'),
        saved_amount: f.saved_amount.value.replace(',', '.'),
        deadline: f.deadline.value,
      });
      toast('Целта е добавена');
      render(el);
    } catch (err) { showError(err); }
  });

  el.querySelectorAll('[data-deposit]').forEach(btn => btn.addEventListener('click', async () => {
    const input = el.querySelector(`#dep-${btn.dataset.deposit}`);
    const amount = Number(input.value.replace(',', '.')) * Number(btn.dataset.sign);
    if (!amount) return toast('Въведи сума', 'error');
    try {
      const g = await api.post(`/api/goals/${btn.dataset.deposit}/deposit`, { amount });
      toast(g.done ? `Целта „${g.name}“ е постигната!` : 'Записано');
      render(el);
    } catch (err) { showError(err); }
  }));

  el.querySelectorAll('[data-del-goal]').forEach(btn => btn.addEventListener('click', async () => {
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Сигурен ли си?';
      return;
    }
    try {
      await api.del(`/api/goals/${btn.dataset.delGoal}`);
      render(el);
    } catch (err) { showError(err); }
  }));
}

function goalCard(g) {
  let status;
  if (g.done) status = `<span class="badge">${icon('check', 11)} Постигната</span>`;
  else if (g.overdue) status = '<span class="expense small">Срокът е изтекъл</span>';
  else status = `<span class="small">Отделяй <b>${eur(g.perMonth)}</b> на месец · остават ${g.monthsLeft} мес.</span>`;

  return `<div class="card goal-card">
    <div class="ring-row">
      ${ring(g.progress)}
      <div style="flex:1;min-width:0">
        <h3>${esc(g.name)}</h3>
        <div class="amounts"><b class="num">${eur(g.saved_amount)}</b> <span class="muted">от ${eur(g.target_amount)}</span></div>
        <div class="muted small">${icon('calendar', 13)} до ${fmtDate(g.deadline)}</div>
      </div>
    </div>
    <div>${status}</div>
    <div class="actions">
      <input id="dep-${g.id}" inputmode="decimal" placeholder="сума €" aria-label="Сума">
      <button class="btn small primary" data-deposit="${g.id}" data-sign="1">${icon('plus', 14)} Добави</button>
      <button class="btn small" data-deposit="${g.id}" data-sign="-1">Изтегли</button>
      <button class="btn small ghost danger" data-del-goal="${g.id}" style="margin-left:auto">${icon('trash', 14)}</button>
    </div>
  </div>`;
}
