/**
 * router.js – малък рутер, написан от нас (вместо Express).
 *
 * Пример:
 *   router.get('/api/goals/:id', handler, { auth: true });
 *
 * Handler-ът получава (req, res, ctx), където:
 *   ctx.params – параметри от пътя (напр. { id: '5' })
 *   ctx.query  – параметри след '?' (напр. { month: '2026-11' })
 *   ctx.body   – JSON тялото на заявката (за POST/PUT)
 *   ctx.user   – влезлият потребител (ако маршрутът е с auth: true)
 * и връща обект, който се изпраща като JSON.
 */

const { getUserFromRequest } = require('./auth');

/** Грешка с HTTP статус, напр. throw new HttpError(400, 'Невалидна сума'). */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY = 5 * 1024 * 1024; // 5 MB – стига дори за текст от OCR

/** Прочита тялото на заявката и го парсва като JSON. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Заявката е твърде голяма'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Невалиден JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Изпраща JSON отговор. */
function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

/** Превръща '/api/goals/:id' в регулярен израз и списък с имена на параметри. */
function compile(pattern) {
  const names = [];
  const regex = pattern.replace(/\/:(\w+)/g, (_, name) => {
    names.push(name);
    return '/([^/]+)';
  });
  return { regex: new RegExp(`^${regex}$`), names };
}

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    this.routes.push({ method, ...compile(pattern), handler, options });
  }
  get(p, h, o) { this.add('GET', p, h, o); }
  post(p, h, o) { this.add('POST', p, h, o); }
  put(p, h, o) { this.add('PUT', p, h, o); }
  delete(p, h, o) { this.add('DELETE', p, h, o); }

  /**
   * Опитва да обработи заявката. Връща false, ако няма подходящ маршрут
   * (тогава сървърът търси статичен файл).
   */
  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathMatches = this.routes.filter(r => r.regex.test(url.pathname));
    if (!pathMatches.length) return false;

    const route = pathMatches.find(r => r.method === req.method);
    if (!route) {
      sendJson(res, 405, { error: 'Методът не е разрешен' });
      return true;
    }

    try {
      const m = url.pathname.match(route.regex);
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      const query = Object.fromEntries(url.searchParams);
      const body = ['POST', 'PUT'].includes(req.method) ? await readJsonBody(req) : {};

      let user = null;
      if (route.options.auth) {
        user = getUserFromRequest(req);
        if (!user) throw new HttpError(401, 'Моля, влезте в профила си');
      }

      const result = await route.handler(req, res, { params, query, body, user });
      // Ако handler-ът сам е изпратил отговор (напр. CSV файл), не правим нищо.
      if (!res.writableEnded) sendJson(res, 200, result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        console.error(err);
        sendJson(res, 500, { error: 'Вътрешна грешка на сървъра' });
      }
    }
    return true;
  }
}

module.exports = { Router, HttpError, sendJson };
