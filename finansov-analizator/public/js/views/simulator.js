/**
 * views/simulator.js – симулатор „Какво ако?“.
 *
 * Отговаря на въпроси като:
 *   „Ако харча 30% по-малко за заведения и изкарвам 100 € повече на месец,
 *    колко ще спестя за година и кога ще си купя лаптопа?“
 *
 * Изходни данни: прогнозата за следващия месец (/api/forecast) и целите.
 * Сметките са в браузъра, затова резултатът се обновява мигновено
 * при всяко движение на плъзгачите.
 *
 *   Спестяване на месец = прогнозни приходи + допълнителен доход
 *                         − Σ (прогноза за категорията × (1 − намаление%))
 *   Месеци до целта     = ⌈ оставаща сума / спестяване на месец ⌉
 */

import { api } from '../api.js';
import { icon } from '../icons.js';
import { eur, esc, emptyState, MONTHS } from '../ui.js';
import { savingsProjection } from '../charts.js';

export async function render(el) {
  const [f, goals] = await Promise.all([api.get('/api/forecast'), api.get('/api/goals')]);
  const cats = f.categories.filter(c => c.type === 'expense' && c.variable > 1).sort((a, b) => b.variable - a.variable);

  if (!cats.length) {
    el.innerHTML = `<div class="page-head"><h1>Симулатор „Какво ако?“</h1></div><div class="card">${emptyState('sliders', 'Още няма достатъчно данни за симулация.')}</div>`;
    return;
  }

  const state = { cuts: Object.fromEntries(cats.map(c => [c.category, 0])), extra: 0 };
  const activeGoals = goals.filter(g => !g.done);

  el.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('sliders', 14)} Планиране</div><h1>Симулатор „Какво ако?“</h1>
        <div class="sub">Промени навиците си на шега и виж реалния ефект върху спестяванията и целите.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small" data-preset="wants">${icon('zap', 15)} −25% на желанията</button>
        <button class="btn small" data-preset="side">${icon('plus', 15)} +150 € доход</button>
        <button class="btn small ghost" data-preset="reset">Нулирай</button>
      </div>
    </div>

    <div class="grid side">
      <div>
        <div class="card">
          <div class="card-head"><h2>Намали разходите</h2><span class="muted">прогноза за ${esc(f.monthLabel)}</span></div>
          ${cats.map(c => `
            <div class="sim-row">
              <div class="name"><span class="tile" style="width:32px;height:32px;background:${c.color}1f">${c.icon}</span>${esc(c.label)}</div>
              <input type="range" min="0" max="60" step="5" value="0" data-cat="${c.category}" aria-label="Намаление за ${esc(c.label)}">
              <div class="val"><b class="num" id="v-${c.category}">${eur(c.variable)}</b><span class="muted small" id="p-${c.category}">без промяна</span></div>
            </div>`).join('')}
        </div>
        <div class="card" style="margin-top:18px">
          <div class="card-head"><h2>Допълнителен доход</h2><span class="muted">напр. почасова работа</span></div>
          <div class="sim-row">
            <div class="name"><span class="tile green" style="width:32px;height:32px">${icon('plus', 16)}</span>На месец</div>
            <input type="range" min="0" max="600" step="10" value="0" id="extra" aria-label="Допълнителен доход">
            <div class="val"><b class="num income" id="extra-v">+0 €</b></div>
          </div>
        </div>
      </div>

      <div class="card sim-result">
        <div class="muted small" style="font-weight:600">Спестяване на месец</div>
        <div class="big-number num" id="r-month"></div>
        <div id="r-diff" class="small" style="margin:4px 0 14px"></div>
        <div class="grid two" style="gap:10px">
          <div style="background:var(--surface-2);border-radius:12px;padding:12px"><div class="muted small">За 1 година</div><b class="num" id="r-year" style="font-size:1.15rem"></b></div>
          <div style="background:var(--surface-2);border-radius:12px;padding:12px"><div class="muted small">Норма на спестяване</div><b class="num" id="r-rate" style="font-size:1.15rem"></b></div>
        </div>
        <div class="chart-box short" style="margin-top:14px"><canvas id="ch-sim"></canvas></div>
        ${activeGoals.length ? `<h3 style="margin:16px 0 2px">Кога ще постигнеш целите</h3><div class="muted small">ако цялото спестяване отива за съответната цел</div><div id="r-goals"></div>` : ''}
      </div>
    </div>`;

  const base = f.income - f.expenses;

  function etaText(months) {
    if (!isFinite(months) || months <= 0) return 'никога при тези разходи';
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return `${MONTHS[d.getMonth()]} ${d.getFullYear()} (${months} мес.)`;
  }

  function recalc() {
    let saved = 0;
    for (const c of cats) {
      const pct = state.cuts[c.category];
      const after = c.variable * (1 - pct / 100);
      saved += c.variable - after;
      el.querySelector(`#v-${c.category}`).textContent = eur(after);
      el.querySelector(`#p-${c.category}`).innerHTML = pct ? `<span class="income">−${pct}% · +${eur(c.variable - after)}</span>` : 'без промяна';
    }
    const scenario = base + saved + state.extra;
    const income = f.income + state.extra;
    el.querySelector('#r-month').textContent = eur(scenario);
    el.querySelector('#r-month').className = `big-number num ${scenario >= 0 ? 'income' : 'expense'}`;
    const diff = scenario - base;
    el.querySelector('#r-diff').innerHTML = diff > 0.5
      ? `<span class="chip-delta good">${icon('up', 13)} +${eur(diff)}</span> <span class="muted">спрямо сегашните навици (${eur(base)})</span>`
      : `<span class="muted">Сегашни навици: ${eur(base)} на месец</span>`;
    el.querySelector('#r-year').textContent = eur(scenario * 12);
    el.querySelector('#r-rate').textContent = income > 0 ? `${Math.round(scenario / income * 100)}%` : '—';
    el.querySelector('#extra-v').textContent = `+${eur(state.extra)}`;

    const goalsEl = el.querySelector('#r-goals');
    if (goalsEl) {
      goalsEl.innerHTML = activeGoals.map(g => {
        const mBase = base > 0 ? Math.ceil(g.remaining / base) : Infinity;
        const mNew = scenario > 0 ? Math.ceil(g.remaining / scenario) : Infinity;
        const faster = isFinite(mBase) && isFinite(mNew) ? mBase - mNew : 0;
        return `<div class="goal-eta"><div><b>${esc(g.name)}</b><div class="muted small">остават ${eur(g.remaining)}</div></div>
          <div class="right"><div class="num">${etaText(mNew)}</div>${faster > 0 ? `<div class="faster">${faster} мес. по-рано</div>` : ''}</div></div>`;
      }).join('');
    }
    savingsProjection('ch-sim', base, scenario);
  }

  el.querySelectorAll('input[data-cat]').forEach(r => r.addEventListener('input', () => {
    state.cuts[r.dataset.cat] = Number(r.value);
    recalc();
  }));
  el.querySelector('#extra').addEventListener('input', e => { state.extra = Number(e.target.value); recalc(); });

  el.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const preset = b.dataset.preset;
    for (const c of cats) {
      if (preset === 'reset') state.cuts[c.category] = 0;
      if (preset === 'wants' && c.group === 'wants') state.cuts[c.category] = 25;
    }
    if (preset === 'reset') state.extra = 0;
    if (preset === 'side') state.extra = 150;
    el.querySelectorAll('input[data-cat]').forEach(r => { r.value = state.cuts[r.dataset.cat]; });
    el.querySelector('#extra').value = state.extra;
    recalc();
  }));

  recalc();
}
