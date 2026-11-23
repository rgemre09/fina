/**
 * views/dashboard.js – Табло: баланс, финансово здраве, съвети, графики,
 * топлинна карта на разходите и открити абонаменти.
 */

import { api, categoryById } from '../api.js';
import { icon } from '../icons.js';
import {
  eur, esc, monthLabel, addMonths, currentMonthStr, insightHtml, deltaChip, progressBar,
  animateCounters, catTile, relDate, fmtDate, toast, showError, emptyState, monthShortOnly,
} from '../ui.js';
import { categoryDoughnut, trendBars, cumulativeLine } from '../charts.js';

let month = currentMonthStr();

function greeting() {
  const h = new Date().getHours();
  return h < 11 ? 'Добро утро' : h < 18 ? 'Добър ден' : 'Добър вечер';
}

export async function render(el) {
  const [d, budgets, health, patterns, recent] = await Promise.all([
    api.get(`/api/dashboard?month=${month}`),
    api.get('/api/budgets'),
    api.get('/api/health'),
    api.get('/api/patterns/recurring'),
    api.get(`/api/transactions?month=${month}`),
  ]);
  const user = document.querySelector('.sidebar-footer .who')?.firstChild?.textContent || '';
  const spentBy = Object.fromEntries(d.byCategory.map(c => [c.category, c.total]));
  const top = d.byCategory.find(c => c.category !== 'housing') || d.byCategory[0];
  const p = d.projection;

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="eyebrow">${icon('sparkles', 14)} ${greeting()}${user ? ', ' + esc(user) : ''}</div>
        <h1>Финансов преглед</h1>
      </div>
      <div class="month-nav">
        <button class="icon-btn" id="prev-month" aria-label="Предишен месец">${icon('left', 18)}</button>
        <b>${esc(monthLabel(month))}</b>
        <button class="icon-btn" id="next-month" aria-label="Следващ месец" ${d.isCurrent ? 'disabled style="opacity:.3"' : ''}>${icon('right', 18)}</button>
      </div>
    </div>

    <div class="grid hero-row">
      <div class="card hero">
        <div>
          <div class="label">${icon('wallet', 16)} Баланс за ${esc(d.monthLabel)}</div>
          <div class="amount num" data-count="${d.balance}" data-format="eur">${eur(d.balance)}</div>
          ${p ? `<div class="proj" style="margin-top:8px">${icon('trend', 15)}Очакван остатък в края на месеца: <b class="num">${eur(p.endBalance)}</b></div>` : ''}
        </div>
        ${d.income > 0 ? `<div class="spent">
          <div style="display:flex;justify-content:space-between"><span>Похарчени от приходите</span><b class="num">${Math.round(d.expenses / d.income * 100)}%</b></div>
          <div class="bar"><i style="width:${Math.min(100, d.expenses / d.income * 100)}%"></i></div>
        </div>` : ''}
        <div class="row">
          <div class="pill"><small>${icon('down', 14)} Приходи</small><b class="num">${eur(d.income)}</b>${miniDelta(d.incomeChangePct, true)}</div>
          <div class="pill"><small>${icon('up', 14)} Разходи</small><b class="num">${eur(d.expenses)}</b>${miniDelta(d.expensesChangePct, false)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div class="card-title"><span class="tile green">${icon('shield', 18)}</span><div><h2>Финансово здраве</h2><div class="muted small">последните 3 месеца</div></div></div>
          <span class="badge violet" title="Как се смята – виж README">0–100</span>
        </div>
        ${health.score === null ? emptyState('shield', health.message) : `
        <div class="health">
          ${gauge(health.score, health.grade)}
          <div>${health.components.map(c => `
            <div class="comp" title="${esc(c.tip)} (${c.points} от ${c.max} точки)">
              <div class="top"><b>${esc(c.label)}</b><span class="muted num">${esc(c.value)}</span></div>
              <div class="mini-bar"><i style="width:${c.points / c.max * 100}%"></i></div>
            </div>`).join('')}
          </div>
        </div>`}
      </div>
    </div>

    <div class="grid kpis">
      ${kpi('green', 'pie', 'Норма на спестяване', d.savingsRate !== null ? `<span data-count="${d.savingsRate}" data-format="pct">${d.savingsRate}%</span>` : '—', 'цел: поне 20%')}
      ${kpi('blue', 'calendar', 'Среден разход на ден', p ? eur(p.dailyVariable) : eur(d.expenses / 30), 'без фиксираните плащания')}
      ${kpi('amber', 'zap', 'Най-голям разход', top ? `${top.icon} ${esc(top.label)}` : '—', top ? eur(top.total) : '')}
      ${kpi('violet', 'trend', 'Очаквани разходи', p ? eur(p.endExpenses) : eur(d.expenses), p ? `до края на месеца · ${p.daysLeft} дни` : 'за месеца')}
    </div>

    ${patterns.length ? `<div class="card">
      <div class="card-head"><div class="card-title"><span class="tile violet">${icon('sparkles', 18)}</span>
        <div><h2>Открити скрити абонаменти</h2><div class="muted small">Анализ на историята: еднакви суми през ~30 дни</div></div></div></div>
      <div class="grid" style="gap:10px">${patterns.map((s, i) => `
        <div class="discover">
          ${catTile(s.category, 40)}
          <div class="txt"><b>${esc(s.description)}</b> · ${eur(s.amount)} около ${s.day_of_month}-о число
            <div class="muted small">Открито ${s.occurrences} пъти, средно през ${s.avgInterval} дни · ${eur(s.yearly)} на година</div></div>
          <button class="btn small primary" data-accept="${i}">${icon('plus', 15)} Добави като абонамент</button>
        </div>`).join('')}</div>
    </div>` : ''}

    <div class="grid side">
      <div class="card">
        <div class="card-head"><div class="card-title"><span class="tile amber">${icon('zap', 18)}</span><h2>Съвети и предупреждения</h2></div>
          <span class="muted">${d.insights.length} активни</span></div>
        <div class="insights">
          ${d.isCurrent
            ? (d.insights.length ? d.insights.map(insightHtml).join('') : emptyState('check', 'Всичко е наред – няма предупреждения.'))
            : emptyState('info', 'Съветите са за текущия месец.')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><span class="tile blue">${icon('target', 18)}</span><h2>Лимити за месеца</h2></div>
          <a href="#/forecast" class="small">Промени</a></div>
        ${budgets.length ? budgets.map(b => {
          const c = categoryById(b.category);
          const spent = spentBy[b.category] || 0;
          const pct = Math.round(spent / b.monthly_limit * 100);
          return `<div class="budget-row">
            <div class="top"><span>${c.icon} ${esc(c.label)}</span><span class="num"><b>${eur(spent)}</b> <span class="muted">/ ${eur(b.monthly_limit)}</span></span></div>
            ${progressBar(pct)}
          </div>`;
        }).join('') : emptyState('target', 'Няма зададени лимити. Задай ги от „Прогноза“.')}
      </div>
    </div>

    <div class="grid two">
      <div class="card">
        <div class="card-head"><h2>Разходи по категории</h2><span class="muted">${esc(monthLabel(month))}</span></div>
        ${d.byCategory.length ? '<div class="chart-box"><canvas id="ch-cat"></canvas></div>' : emptyState('pie', 'Няма разходи за този месец.')}
      </div>
      <div class="card">
        <div class="card-head"><h2>Натрупани разходи по дни</h2><span class="muted">${p ? 'с прогноза до края' : ''}</span></div>
        <div class="chart-box"><canvas id="ch-cum"></canvas></div>
      </div>
    </div>

    <div class="grid side">
      <div class="card">
        <div class="card-head"><h2>Приходи, разходи и спестено</h2><span class="muted">последните 12 месеца</span></div>
        <div class="chart-box tall"><canvas id="ch-trend"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Последни записи</h2><a href="#/transactions" class="small">Всички</a></div>
        ${recent.length ? recent.slice(0, 7).map(t => `
          <div class="tx-desc" style="padding:8px 0">
            ${catTile(t.category, 38)}
            <div style="flex:1;min-width:0"><b style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description) || esc(categoryById(t.category).label)}</b>
              <span class="muted small">${relDate(t.date)}</span></div>
            <b class="num ${t.type}">${t.type === 'income' ? '+' : '−'}${eur(t.amount)}</b>
          </div>`).join('') : emptyState('list', 'Няма записи.')}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title"><span class="tile green">${icon('calendar', 18)}</span>
        <div><h2>Карта на разходите</h2><div class="muted small">Всеки квадрат е един ден от последната година</div></div></div></div>
      ${heatmapHtml(d.heatmap)}
    </div>
  `;

  el.querySelector('#prev-month').onclick = () => { month = addMonths(month, -1); render(el); };
  el.querySelector('#next-month').onclick = () => { if (!d.isCurrent) { month = addMonths(month, 1); render(el); } };

  el.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
    const s = patterns[Number(b.dataset.accept)];
    try {
      await api.post('/api/patterns/recurring/accept', s);
      toast(`„${s.description}“ е добавен към абонаментите`);
      render(el);
    } catch (err) { showError(err); }
  }));

  animateCounters(el);
  // Анимираме индикатора за здраве: от 0 до стойността
  requestAnimationFrame(() => el.querySelectorAll('.gauge circle.val').forEach(c => { c.style.strokeDashoffset = c.dataset.target; }));

  if (d.byCategory.length) categoryDoughnut('ch-cat', d.byCategory);
  cumulativeLine('ch-cum', d.cumulative);
  trendBars('ch-trend', d.trend);
}

/* ---------------- Помощни компоненти ---------------- */

function kpi(color, ic, label, value, sub) {
  return `<div class="card kpi">
    <div class="top"><span class="label">${label}</span><span class="tile ${color}">${icon(ic, 17)}</span></div>
    <div class="value num">${value}</div>
    <div class="delta muted">${sub}</div>
  </div>`;
}

function miniDelta(pct, goodWhenUp) {
  if (pct === null || pct === undefined) return '';
  return `<small style="margin-top:4px">${pct > 0 ? '▲' : pct < 0 ? '▼' : '•'} ${Math.abs(pct)}% спрямо миналия месец</small>`;
}

/** Кръгов индикатор (gauge) за индекса на финансово здраве. */
function gauge(score, grade) {
  const size = 170, stroke = 14, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const color = score >= 80 ? '#10b981' : score >= 60 ? '#0ea5e9' : score >= 40 ? '#f59e0b' : '#e11d48';
  return `<div class="gauge">
    <svg width="${size}" height="${size}">
      <defs><linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle class="val" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#gaugeGrad)" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" style="stroke-dashoffset:${c}" data-target="${c * (1 - score / 100)}"/>
    </svg>
    <div class="center"><div><div class="score" data-count="${score}">${score}</div><div class="grade">${esc(grade)}</div></div></div>
  </div>`;
}

/**
 * Топлинна карта (като в GitHub): колони = седмици, редове = дни (пон–нед).
 * Нивата на цвета са по квартили на дневните разходи – така картата
 * работи добре и при малки, и при големи суми.
 */
function heatmapHtml(data) {
  const map = Object.fromEntries(data.map(x => [x.date, x.total]));
  const values = data.map(x => x.total).sort((a, b) => a - b);
  const q = k => values.length ? values[Math.floor((values.length - 1) * k)] : 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = v => (!v ? 0 : v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - 7 * 52);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // връщаме до понеделник

  const cells = [];
  const monthsRow = [];
  let lastMonth = -1;
  for (let d = new Date(start), i = 0; d <= today || i % 7 !== 0; d.setDate(d.getDate() + 1), i++) {
    const key = iso(d);
    if (i % 7 === 0) {
      const m = d.getMonth();
      monthsRow.push(m !== lastMonth ? monthShortOnly(key.slice(0, 7)) : '');
      lastMonth = m;
    }
    if (d > today) { cells.push('<i class="out"></i>'); continue; }
    const v = map[key] || 0;
    cells.push(`<i data-l="${level(v)}" title="${fmtDate(key)}: ${v ? eur(v) : 'без разходи'}"></i>`);
  }
  const total = values.reduce((a, b) => a + b, 0);
  const activeDays = values.length;
  return `<div class="heatmap-wrap">
      <div class="heat-months">${monthsRow.map(m => `<span>${m}</span>`).join('')}</div>
      <div class="heatmap">${cells.join('')}</div>
    </div>
    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">
      <span class="muted small">${activeDays} дни с разходи · общо ${eur(total)} · средно ${eur(activeDays ? total / activeDays : 0)} на ден с разход</span>
      <div class="heat-legend">По-малко ${[0, 1, 2, 3, 4].map(l => `<i class="${l ? '' : ''}" style="background:${l === 0 ? 'var(--surface-3)' : l === 4 ? 'var(--primary-strong)' : `color-mix(in srgb, var(--primary) ${[0, 30, 55, 80][l]}%, var(--surface-3))`}"></i>`).join('')} Повече</div>
    </div>`;
}
