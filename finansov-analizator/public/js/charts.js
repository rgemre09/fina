/**
 * charts.js – графики с библиотеката Chart.js.
 *
 * Пазим създадените графики в обект, за да ги унищожим, преди да
 * нарисуваме нови на същото място (иначе Chart.js дава грешка).
 * Цветовете се взимат от CSS променливите, затова графиките сменят
 * вида си заедно с темата (светла/тъмна).
 */

import { eur, monthShort } from './ui.js';

const charts = {};

const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function make(canvasId, config, quiet = false) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!window.Chart) {
    // Без интернет Chart.js не се зарежда – показваме съобщение (за малките графики – нищо).
    canvas.parentElement.innerHTML = quiet ? '' : '<p class="empty">Графиките не се заредиха (няма интернет за Chart.js).</p>';
    return;
  }
  charts[canvasId]?.destroy();
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--border');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  charts[canvasId] = new Chart(canvas, config);
}

/** Общ стил на подсказките (tooltip). */
const tooltip = (labelFn) => ({
  backgroundColor: cssVar('--text'),
  titleColor: cssVar('--surface'),
  bodyColor: cssVar('--surface'),
  padding: 10,
  cornerRadius: 10,
  boxPadding: 4,
  usePointStyle: true,
  callbacks: { label: labelFn },
});

const legend = { labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 } };

/** Вертикален градиент за запълване под линия/стълб. */
function vGradient(ctx, color, alphaTop = 0.35) {
  const { chart } = ctx;
  const { ctx: c, chartArea } = chart;
  if (!chartArea) return color;
  const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, hexA(color, alphaTop));
  g.addColorStop(1, hexA(color, 0));
  return g;
}
function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Кръгова диаграма: разходи по категории (с общата сума в центъра). */
export function categoryDoughnut(id, items) {
  const total = items.reduce((s, i) => s + i.total, 0);
  const centerText = {
    id: 'centerText',
    afterDraw(chart) {
      const { ctx, chartArea: a } = chart;
      if (!a) return;
      const x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = cssVar('--muted');
      ctx.font = `500 12px ${Chart.defaults.font.family}`;
      ctx.fillText('Общо', x, y - 12);
      ctx.fillStyle = cssVar('--text');
      ctx.font = `750 18px ${Chart.defaults.font.family}`;
      ctx.fillText(eur(total), x, y + 10);
      ctx.restore();
    },
  };
  make(id, {
    type: 'doughnut',
    data: {
      labels: items.map(i => `${i.icon} ${i.label}`),
      datasets: [{ data: items.map(i => i.total), backgroundColor: items.map(i => i.color), borderWidth: 3, borderColor: cssVar('--surface'), hoverOffset: 8, borderRadius: 4 }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '70%',
      layout: { padding: 6 },
      plugins: { legend: { ...legend, position: 'right' }, tooltip: tooltip(ctx => ` ${ctx.label}: ${eur(ctx.parsed)}`) },
    },
    plugins: [centerText],
  });
}

/** Стълбова диаграма: приходи и разходи за последните 12 месеца + линия на спестеното. */
export function trendBars(id, trend) {
  make(id, {
    type: 'bar',
    data: {
      labels: trend.map(t => monthShort(t.month)),
      datasets: [
        { label: 'Приходи', data: trend.map(t => t.income), backgroundColor: cssVar('--income'), borderRadius: 6, barPercentage: .7, categoryPercentage: .7, order: 2 },
        { label: 'Разходи', data: trend.map(t => t.expenses), backgroundColor: cssVar('--expense'), borderRadius: 6, barPercentage: .7, categoryPercentage: .7, order: 2 },
        { label: 'Спестено', type: 'line', data: trend.map(t => Math.round((t.income - t.expenses) * 100) / 100), borderColor: cssVar('--accent'),
          backgroundColor: cssVar('--accent'), tension: .35, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend, tooltip: tooltip(ctx => ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}`) },
      scales: {
        y: { ticks: { callback: v => `${v} €` }, grid: { color: cssVar('--border') }, border: { display: false } },
        x: { grid: { display: false }, border: { display: false } },
      },
    },
  });
}

/** Линия: натрупани разходи по дни – този месец, миналия и прогноза до края. */
export function cumulativeLine(id, cumulative) {
  const days = Math.max(cumulative.current.length, cumulative.previous.length);
  const primary = cssVar('--primary');
  const datasets = [
    { label: 'Този месец', data: cumulative.current, borderColor: primary, backgroundColor: ctx => vGradient(ctx, primary), fill: true, tension: .3, pointRadius: 0, borderWidth: 3 },
    { label: 'Миналия месец', data: cumulative.previous, borderColor: cssVar('--muted'), borderDash: [4, 4], tension: .3, pointRadius: 0, borderWidth: 1.5 },
  ];
  if (cumulative.projected) {
    datasets.push({ label: 'Прогноза', data: cumulative.projected, borderColor: cssVar('--accent'), borderDash: [7, 5], tension: .3, pointRadius: 0, borderWidth: 2.5 });
  }
  make(id, {
    type: 'line',
    data: { labels: Array.from({ length: days }, (_, i) => i + 1), datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend, tooltip: tooltip(ctx => ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}`) },
      scales: {
        y: { ticks: { callback: v => `${v} €` }, grid: { color: cssVar('--border') }, border: { display: false } },
        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 10 } },
      },
    },
  });
}

/** Прогноза по категории: средно, прогноза и предложен лимит. */
export function forecastBars(id, cats) {
  const avg = c => (c.history.length ? c.history.reduce((s, h) => s + h.amount, 0) / c.history.length : 0);
  make(id, {
    type: 'bar',
    data: {
      labels: cats.map(c => `${c.icon} ${c.label}`),
      datasets: [
        { label: 'Средно (6 мес.)', data: cats.map(avg), backgroundColor: cssVar('--surface-3'), borderRadius: 6 },
        { label: 'Прогноза', data: cats.map(c => c.forecast), backgroundColor: cats.map(c => c.color), borderRadius: 6 },
        { label: 'Предложен лимит', data: cats.map(c => c.suggestedLimit), backgroundColor: 'transparent', borderColor: cssVar('--text'), borderWidth: 1.5, borderRadius: 6, borderDash: [4, 3] },
      ],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { legend, tooltip: tooltip(ctx => ` ${ctx.dataset.label}: ${eur(ctx.parsed.x)}`) },
      scales: { x: { ticks: { callback: v => `${v} €` }, grid: { color: cssVar('--border') }, border: { display: false } }, y: { grid: { display: false }, border: { display: false } } },
    },
  });
}

/** Малка линия (sparkline) за историята на категория. */
export function sparkline(id, history, color) {
  make(id, {
    type: 'line',
    data: { labels: history.map(h => monthShort(h.month)), datasets: [{ data: history.map(h => h.amount), borderColor: color, backgroundColor: ctx => vGradient(ctx, color, .25), fill: true, borderWidth: 2, pointRadius: 0, tension: .35 }] },
    options: {
      maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
    },
  }, true);
}

/** Симулатор: натрупани спестявания за 12 месеца – сега срещу след промените. */
export function savingsProjection(id, base, scenario) {
  const labels = Array.from({ length: 13 }, (_, i) => (i === 0 ? 'сега' : `+${i} м.`));
  const acc = m => labels.map((_, i) => Math.round(m * i));
  const primary = cssVar('--primary');
  make(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'С промените', data: acc(scenario), borderColor: primary, backgroundColor: ctx => vGradient(ctx, primary), fill: true, tension: .2, pointRadius: 0, borderWidth: 3 },
        { label: 'Без промени', data: acc(base), borderColor: cssVar('--muted'), borderDash: [5, 4], tension: .2, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false, animation: { duration: 250 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend, tooltip: tooltip(ctx => ` ${ctx.dataset.label}: ${eur(ctx.parsed.y)}`) },
      scales: { y: { ticks: { callback: v => `${v} €` }, grid: { color: cssVar('--border') }, border: { display: false } }, x: { grid: { display: false }, border: { display: false } } },
    },
  });
}
