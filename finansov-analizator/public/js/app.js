/**
 * app.js – стартира приложението: вход, меню, тема, навигация.
 *
 * Навигацията е с "#" в адреса (hash routing): #/dashboard, #/transactions...
 * Всеки екран е отделен модул в папка views/ с функция render(container).
 */

import { api, getCategories } from './api.js';
import { icon } from './icons.js';
import { showError, skeleton, esc } from './ui.js';
import { openPalette } from './palette.js';
import * as dashboard from './views/dashboard.js';
import * as transactions from './views/transactions.js';
import * as scan from './views/scan.js';
import * as forecast from './views/forecast.js';
import * as simulator from './views/simulator.js';
import * as goals from './views/goals.js';
import * as recurring from './views/recurring.js';

const VIEWS = { dashboard, transactions, scan, forecast, simulator, goals, recurring };

/* Меню: [ключ, иконка, текст, скрито на телефон?] */
const NAV = [
  ['label', 'Общ преглед'],
  ['dashboard', 'dashboard', 'Табло'],
  ['transactions', 'list', 'Записи'],
  ['scan', 'scan', 'Сканирай'],
  ['label', 'Планиране'],
  ['forecast', 'trend', 'Прогноза'],
  ['simulator', 'sliders', 'Симулатор'],
  ['goals', 'target', 'Цели'],
  ['recurring', 'repeat', 'Абонаменти', true],
];

const authScreen = document.getElementById('auth-screen');
const appEl = document.getElementById('app');
const viewEl = document.getElementById('view');

/* ---------------- Статични части с иконки ---------------- */
const logoSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l5-6 4 3 7-9"/></svg>';
document.getElementById('auth-logo').innerHTML = logoSvg;
document.getElementById('auth-features').innerHTML = [
  ['sparkles', 'Автоматични категории, които се учат от теб'],
  ['trend', 'Прогноза с регресия и сезонност'],
  ['camera', 'Сканиране на касови бележки (QR + OCR)'],
  ['shield', 'Индекс на финансово здраве и съвети'],
].map(([i, t]) => `<li><span class="ico-wrap">${icon(i, 17)}</span>${t}</li>`).join('');
document.getElementById('search-ico').outerHTML = icon('sparkles', 18);
document.getElementById('fab').innerHTML = icon('plus', 24);

function buildSidebar(user) {
  document.getElementById('sidebar').innerHTML = `
    <div class="brand"><div class="logo">${logoSvg}</div><div>Fina<small>Финансов анализатор</small></div></div>
    ${NAV.map(n => n[0] === 'label'
      ? `<div class="nav-label">${n[1]}</div>`
      : `<a href="#/${n[0]}" data-view="${n[0]}" class="${n[3] ? 'hide-mobile' : ''}">${icon(n[1], 19)}<span>${n[2]}</span></a>`).join('')}
    <div class="sidebar-footer">
      <div class="avatar">${esc(user.username[0])}</div>
      <div class="who">${esc(user.username)}<small>Личен профил</small></div>
      <button class="icon-btn sidebar-btn" id="logout-btn" title="Изход" aria-label="Изход">${icon('logout', 18)}</button>
    </div>`;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api.post('/api/logout').catch(() => {});
    showAuth();
  });
}

/* ---------------- Тема (светла/тъмна) ---------------- */
const themeBtn = document.getElementById('theme-toggle');
function paintThemeBtn() {
  themeBtn.innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 19);
}
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* няма значение */ }
  paintThemeBtn();
  route(); // прерисуваме графиките с новите цветове
});
paintThemeBtn();

/* ---------------- Бързо добавяне (Ctrl+K) ---------------- */
const openQuick = () => openPalette(() => route());
document.getElementById('open-palette').addEventListener('click', openQuick);
document.getElementById('fab').addEventListener('click', openQuick);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !appEl.hidden) {
    e.preventDefault();
    openQuick();
  }
});

/* ---------------- Вход и регистрация ---------------- */
let authMode = 'login';

document.querySelectorAll('[data-auth-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    authMode = btn.dataset.authTab;
    document.querySelectorAll('[data-auth-tab]').forEach(b => b.classList.toggle('active', b === btn));
    const login = authMode === 'login';
    document.getElementById('auth-submit').textContent = login ? 'Вход' : 'Създай профил';
    document.getElementById('auth-title').textContent = login ? 'Добре дошъл отново' : 'Създай профил';
    document.querySelector('#auth-form [name=password]').autocomplete = login ? 'current-password' : 'new-password';
  });
});

document.getElementById('demo-fill').addEventListener('click', () => {
  document.querySelector('[data-auth-tab=login]').click();
  document.querySelector('#auth-form [name=username]').value = 'demo';
  document.querySelector('#auth-form [name=password]').value = 'demo1234';
});

document.getElementById('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errorEl = document.getElementById('auth-error');
  errorEl.hidden = true;
  try {
    const user = await api.post(authMode === 'login' ? '/api/login' : '/api/register', {
      username: form.get('username'),
      password: form.get('password'),
    });
    startApp(user);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
  }
});

window.addEventListener('unauthorized', showAuth);

function showAuth() {
  appEl.hidden = true;
  authScreen.hidden = false;
}

async function startApp(user) {
  buildSidebar(user);
  authScreen.hidden = true;
  appEl.hidden = false;
  await getCategories();
  if (!location.hash) location.hash = '#/dashboard';
  else route();
}

/* ---------------- Навигация ---------------- */
async function route() {
  if (appEl.hidden) return;
  const name = location.hash.replace('#/', '').split('?')[0] || 'dashboard';
  const view = VIEWS[name] || dashboard;
  document.querySelectorAll('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.view === name));
  viewEl.innerHTML = skeleton();
  try {
    await view.render(viewEl);
  } catch (err) {
    if (err.status !== 401) {
      viewEl.innerHTML = `<div class="card empty">${icon('alert', 22)}<br>${esc(err.message)}</div>`;
      showError(err);
    }
  }
  viewEl.focus({ preventScroll: true });
}

window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

/* ---------------- Старт ---------------- */
api.get('/api/me').then(startApp).catch(showAuth);
