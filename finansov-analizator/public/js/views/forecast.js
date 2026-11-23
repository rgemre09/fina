/**
 * views/forecast.js – прогноза и предложен бюджет за следващия месец.
 */

import { api } from '../api.js';
import { eur, esc, toast, showError, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { forecastBars, sparkline } from '../charts.js';

export async function render(el) {
  const [f, budgets] = await Promise.all([api.get('/api/forecast'), api.get('/api/budgets')]);
  const limits = Object.fromEntries(budgets.map(b => [b.category, b.monthly_limit]));
  const expenses = f.categories.filter(c => c.type === 'expense');
  const incomes = f.categories.filter(c => c.type === 'income');

  // Тренд: промяна на месец в % (за разходите ръстът е червен).
  if (!f.categories.length) {
    el.innerHTML = `<div class="page-head"><div><h1>Прогноза за ${esc(f.monthLabel)}</h1></div></div>
      <div class="card">${emptyState('trend', 'Още няма достатъчно данни.<br>Добави няколко прихода и разхода (или повтарящи се плащания) и прогнозата ще се появи тук.')}</div>`;
    return;
  }

  const trendHtml = p => {
    const r = Math.round(p);
    return r > 2 ? `<span class="trend-up" title="на месец">▲ ${r}%</span>`
      : r < -2 ? `<span class="trend-down" title="на месец">▼ ${Math.abs(r)}%</span>` : '<span class="muted">≈</span>';
  };

  el.innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">${icon('trend', 14)} Прогноза</div><h1>Бюджет за ${esc(f.monthLabel)}</h1>
        <div class="sub">${f.usingPace
          ? 'Още няма завършен месец – прогнозата е по темпото на харчене този месец.'
          : `Изчислена от историята за последните ${f.basedOnMonths} месеца`}</div></div>
      <button class="btn primary" id="apply">${icon('check', 16)} Приеми предложените лимити</button>
    </div>

    <div class="grid kpis">
      <div class="card kpi"><div class="top"><span class="label">Очаквани приходи</span><span class="tile green">${icon('down', 17)}</span></div><div class="value income num">${eur(f.income)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Очаквани разходи</span><span class="tile red">${icon('up', 17)}</span></div><div class="value expense num">${eur(f.expenses)}</div><div class="delta muted">интервал ${eur(f.categories.filter(c => c.type === 'expense').reduce((s, c) => s + c.low, 0))} – ${eur(f.categories.filter(c => c.type === 'expense').reduce((s, c) => s + c.high, 0))}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Очакван остатък</span><span class="tile blue">${icon('wallet', 17)}</span></div><div class="value num ${f.surplus >= 0 ? 'income' : 'expense'}">${eur(f.surplus)}</div></div>
      <div class="card kpi"><div class="top"><span class="label">Цел за спестяване</span><span class="tile violet">${icon('target', 17)}</span></div><div class="value num">${eur(f.savingsTarget)}</div>
        <div class="delta ${f.targetReachable ? 'income' : 'expense'}">${f.targetReachable ? 'постижима с предложения бюджет' : 'трудно постижима – виж съкращенията'}</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h2>История, прогноза и предложен лимит</h2><span class="muted">по категории</span></div>
      <div class="chart-box" style="height:${Math.max(260, expenses.length * 44)}px"><canvas id="ch-fc"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title"><span class="tile green">${icon('sliders', 18)}</span><h2>Предложен бюджет</h2></div></div>
      <p class="muted small">Предложените лимити гарантират спестяване от поне ${eur(f.savingsTarget)}${f.goalsNeed > 0 ? ' (нужното за целите ти)' : ' (10% от приходите)'}.
        Ако не стига, програмата съкращава първо „желанията“ (до 30%), после „нуждите“ (до 10%). Можеш да промениш всеки лимит ръчно.</p>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Категория</th><th class="hide-mobile">Последни 6 мес.</th><th class="right">Тренд</th>
            <th class="right">Прогноза</th><th class="right hide-mobile">Интервал</th>
            <th class="right">Предложение</th><th class="right">Твой лимит</th>
          </tr></thead>
          <tbody>
            ${expenses.map((c, i) => `<tr>
              <td><span class="cat-chip"><span class="dot" style="background:${c.color}"></span>${c.icon} ${esc(c.label)}</span>
                ${c.fixed ? `<div class="muted small">вкл. ${eur(c.fixed)} фиксирани</div>` : ''}</td>
              <td class="hide-mobile"><div style="height:34px;width:120px"><canvas id="sp-${i}"></canvas></div></td>
              <td class="right num">${trendHtml(c.trendPct)}</td>
              <td class="right num" title="WMA ${c.method.wma} € · регресия ${c.method.regression} €${c.method.seasonal ? ` · сезонна корекция ${c.method.seasonal} €` : ''}">
                <b>${eur(c.forecast)}</b>${c.method.seasonal ? ` <span title="Сезонна корекция ${c.method.seasonal} €" style="color:var(--accent)">${icon('calendar', 13)}</span>` : ''}</td>
              <td class="right num muted small hide-mobile">${eur(c.low)} – ${eur(c.high)}</td>
              <td class="right num">${eur(c.suggestedLimit)}${c.cut ? `<div class="expense small">−${eur(c.cut)}</div>` : ''}</td>
              <td class="right"><input class="limit-input num" data-cat="${c.category}" inputmode="decimal" style="width:96px;text-align:right"
                value="${limits[c.category] ?? ''}" placeholder="—" aria-label="Лимит за ${esc(c.label)}"></td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr>
            <td><b>Общо</b></td><td class="hide-mobile"></td><td></td>
            <td class="right num"><b>${eur(f.expenses)}</b></td><td class="hide-mobile"></td>
            <td class="right num"><b>${eur(f.suggestedTotal)}</b></td><td></td>
          </tr></tfoot>
        </table>
      </div>
      ${incomes.length ? `<p class="muted small" style="margin-top:12px">Очаквани приходи: ${incomes.map(c => `${c.icon} ${esc(c.label)} <b>${eur(c.forecast)}</b>`).join(' · ')}</p>` : ''}
    </div>

    <div class="card algo">
      <div class="card-head"><div class="card-title"><span class="tile violet">${icon('sparkles', 18)}</span><h2>Как се изчислява прогнозата?</h2></div></div>
      <ol>
        <li><b>Фиксирани разходи</b> (наем, абонаменти) се взимат точно от повтарящите се плащания.</li>
        <li><b>Претеглена плъзгаща се средна (WMA)</b> – по-новите месеци тежат повече: <code>WMA = Σ(i·xᵢ) / Σi</code>.</li>
        <li><b>Линейна регресия</b> (метод на най-малките квадрати) открива тренда – дали разходите растат или падат – и го продължава напред.</li>
        <li><b>Сезонност</b> – ако има данни отпреди година, добавяме 60% от разликата между същия месец тогава и средното (напр. повече подаръци през декември).</li>
        <li><b>Прогноза</b> = <code>0,6·WMA + 0,4·Регресия + сезонна корекция</code>, а интервалът е ± стандартното отклонение.</li>
      </ol>
    </div>`;

  forecastBars('ch-fc', expenses);
  expenses.forEach((c, i) => sparkline(`sp-${i}`, c.history, c.color));

  // Ръчна промяна на лимит – записваме при излизане от полето.
  el.querySelectorAll('.limit-input').forEach(input => {
    input.addEventListener('change', async () => {
      const value = Number(input.value.replace(',', '.')) || 0;
      try {
        await api.put('/api/budgets', { category: input.dataset.cat, monthly_limit: value });
        toast(value ? 'Лимитът е записан' : 'Лимитът е премахнат');
      } catch (err) { showError(err); }
    });
  });

  el.querySelector('#apply').onclick = async () => {
    try {
      const r = await api.post('/api/budgets/apply-forecast');
      toast(`Приети са ${r.applied} лимита ✔`);
      render(el);
    } catch (err) { showError(err); }
  };
}
