/**
 * ui.js – общи помощни функции за интерфейса.
 */

import { categoryById } from './api.js';
import { icon } from './icons.js';

const eurFormat = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR' });

/** 1234.5 → "1234,50 €" */
export const eur = x => eurFormat.format(x || 0);

/** '2026-11-08' → '08.11.2026' */
export const fmtDate = d => d.split('-').reverse().join('.');

/** Днешна дата 'YYYY-MM-DD' */
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const currentMonthStr = () => todayStr().slice(0, 7);

export function addMonths(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const MONTHS_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
export const monthLabel = m => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = m => `${MONTHS_SHORT[Number(m.slice(5)) - 1]} ’${m.slice(2, 4)}`;
export const monthShortOnly = m => MONTHS_SHORT[Number(m.slice(5)) - 1];

/** Относителна дата: днес, вчера, или 08.11.2026 */
export function relDate(d) {
  const t = todayStr();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const ys = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  return d === t ? 'Днес' : d === ys ? 'Вчера' : fmtDate(d);
}

/**
 * Защита от XSS: всеки текст, въведен от потребителя, минава оттук,
 * преди да се сложи в HTML.
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Цветна плочка с иконката на категорията. */
export function catTile(id, size = 38) {
  const c = categoryById(id);
  return `<span class="tile" style="width:${size}px;height:${size}px;background:${c.color}1f">${c.icon}</span>`;
}

/** Етикет с цвят и иконка за категория. */
export function catChip(id) {
  const c = categoryById(id);
  return `<span class="cat-chip"><span class="dot" style="background:${c.color}"></span>${esc(c.label)}</span>`;
}

/** Кратко известие в ъгъла на екрана. */
export function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.innerHTML = `${icon(type === 'error' ? 'alert' : 'check', 18)}<span></span>`;
  el.querySelector('span').textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

/** Показва грешка от сървъра. */
export const showError = err => toast(err.message || 'Грешка', 'error');

/** Лента за прогрес: зелена/жълта/червена според процента. */
export function progressBar(pct, big = false) {
  const cls = pct > 100 ? 'over' : pct >= 80 ? 'warn' : '';
  return `<div class="progress ${cls} ${big ? 'big' : ''}"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div>`;
}

/** Кръгов индикатор (за цели). */
export function ring(pct, size = 74, stroke = 8, color = 'url(#ringGrad)') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return `<div class="ring" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#6366f1"/></linearGradient></defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${stroke}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - Math.min(100, pct) / 100)}"/>
    </svg><span>${Math.round(pct)}%</span></div>`;
}

/** Връща <option> елементи за категориите от даден тип. */
export function categoryOptions(categories, type, selected) {
  return categories.filter(c => c.type === type)
    .map(c => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('');
}

/** Съвет (insight) като HTML. */
const INSIGHT_ICONS = { danger: 'alert', warning: 'zap', info: 'info', success: 'check' };
export function insightHtml(i) {
  return `<div class="insight ${i.level}"><span class="tile">${icon(INSIGHT_ICONS[i.level] || 'info', 17)}</span>
    <div><b>${esc(i.title)}</b><p>${esc(i.text)}</p></div></div>`;
}

/** Процентна промяна като цветен "чип". За разходите ръстът е "лош". */
export function deltaChip(pct, goodWhenUp = false) {
  if (pct === null || pct === undefined) return '<span class="chip-delta neutral">няма данни</span>';
  if (pct === 0) return '<span class="chip-delta neutral">0%</span>';
  const up = pct > 0;
  const good = goodWhenUp ? up : !up;
  return `<span class="chip-delta ${good ? 'good' : 'bad'}">${icon(up ? 'up' : 'down', 13)}${Math.abs(pct)}%</span>`;
}

/**
 * Анимирано броене на числата: <span data-count="1234.5" data-format="eur">.
 * Използва requestAnimationFrame и "ease-out" крива.
 */
export function animateCounters(root) {
  root.querySelectorAll('[data-count]').forEach(el => {
    const target = Number(el.dataset.count);
    const fmt = el.dataset.format === 'eur' ? eur : el.dataset.format === 'pct' ? v => `${Math.round(v)}%` : v => Math.round(v);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(target); return; }
    const start = performance.now();
    const dur = 900;
    const step = now => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** Скелет за зареждане – сиви "трептящи" блокове, докато чакаме сървъра. */
export function skeleton() {
  return `<div class="page-head"><div class="skeleton" style="width:260px;height:44px"></div></div>
    <div class="grid kpis">${'<div class="skeleton" style="height:120px"></div>'.repeat(4)}</div>
    <div class="grid side" style="margin-top:18px"><div class="skeleton" style="height:320px"></div><div class="skeleton" style="height:320px"></div></div>`;
}

/** Празно състояние с иконка. */
export function emptyState(ic, text) {
  return `<div class="empty"><div class="tile violet">${icon(ic, 22)}</div>${text}</div>`;
}
