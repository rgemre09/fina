/**
 * api.js – връзка със сървъра.
 * Всички заявки минават оттук: изпращаме JSON и получаваме JSON.
 * При грешка хвърляме Error с текста, върнат от сървъра.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(0, 'Няма връзка със сървъра. Стартиран ли е?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // 401 = сесията е изтекла → връщаме на екрана за вход.
    if (res.status === 401 && !url.includes('/login') && !url.includes('/me')) {
      window.dispatchEvent(new Event('unauthorized'));
    }
    throw new ApiError(res.status, data.error || 'Грешка');
  }
  return data;
}

export const api = {
  get: url => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: url => request('DELETE', url),
};

/** Кеш за категориите – зареждаме ги само веднъж. */
let categoriesCache = null;
export async function getCategories() {
  if (!categoriesCache) categoriesCache = await api.get('/api/categories');
  return categoriesCache;
}
export function categoryById(id) {
  return categoriesCache?.find(c => c.id === id) || { id, label: id, icon: '❔', color: '#999' };
}
