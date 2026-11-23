/**
 * db.js – връзка с базата данни SQLite и създаване на таблиците.
 *
 * Използваме вградения в Node.js модул `node:sqlite` (Node 22.13+),
 * затова проектът няма нужда от външни пакети и `npm install`.
 * Базата е един файл: data/finance.db
 * (или пътят от променливата DB_FILE – използва се при качване в интернет).
 */

const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'finance.db');

// Папката на базата се създава автоматично (на сървъра в интернет тя е на постоянен диск, напр. /data).
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new DatabaseSync(DB_FILE);

// Външните ключове в SQLite са изключени по подразбиране – включваме ги.
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

/* ------------------------------------------------------------------
 * Схема на базата данни
 * ------------------------------------------------------------------ */
db.exec(`
  -- Потребители: паролата се пази като хеш (scrypt) + сол, никога като текст.
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Сесии: случаен токен в бисквитка (cookie) → потребител.
  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  -- Повтарящи се плащания/приходи (наем, абонаменти, заплата).
  CREATE TABLE IF NOT EXISTS recurring (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type           TEXT NOT NULL CHECK (type IN ('income','expense')),
    amount         REAL NOT NULL CHECK (amount > 0),
    category       TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    day_of_month   INTEGER NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
    start_month    TEXT NOT NULL,          -- 'YYYY-MM'
    last_generated TEXT,                   -- последният месец, за който е създаден запис
    active         INTEGER NOT NULL DEFAULT 1
  );

  -- Всички приходи и разходи.
  CREATE TABLE IF NOT EXISTS transactions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT NOT NULL CHECK (type IN ('income','expense')),
    amount       REAL NOT NULL CHECK (amount > 0),
    category     TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    date         TEXT NOT NULL,            -- 'YYYY-MM-DD'
    source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','recurring','receipt')),
    recurring_id INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);

  -- Месечни лимити по категории.
  CREATE TABLE IF NOT EXISTS budgets (
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category      TEXT NOT NULL,
    monthly_limit REAL NOT NULL CHECK (monthly_limit > 0),
    PRIMARY KEY (user_id, category)
  );

  -- Спестовни цели.
  CREATE TABLE IF NOT EXISTS goals (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    target_amount REAL NOT NULL CHECK (target_amount > 0),
    saved_amount  REAL NOT NULL DEFAULT 0,
    deadline      TEXT NOT NULL,           -- 'YYYY-MM-DD'
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- "Паметта" на категоризатора: колко пъти дадена дума е била в дадена категория.
  CREATE TABLE IF NOT EXISTS category_learning (
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token    TEXT NOT NULL,
    category TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, token, category)
  );
`);

/**
 * Изпълнява функция в транзакция: или всички промени минават, или нито една.
 */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** node:sqlite връща обекти без прототип – превръщаме ги в обикновени. */
const plain = row => (row ? { ...row } : row);
const all = (sql, ...params) => db.prepare(sql).all(...params).map(plain);
const get = (sql, ...params) => plain(db.prepare(sql).get(...params));
const run = (sql, ...params) => db.prepare(sql).run(...params);

module.exports = { db, all, get, run, transaction, DB_FILE };
