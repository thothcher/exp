import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'folio.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  monthly_budget_usd REAL,
  max_active_books INTEGER,
  max_pages_per_book INTEGER,
  allowed_models TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  encrypted INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  note TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL,
  pages INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  book_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  slug TEXT,
  params TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  gate TEXT,
  error TEXT,
  model TEXT NOT NULL,
  scan_model TEXT NOT NULL,
  dry_run INTEGER NOT NULL DEFAULT 0,
  pages_total INTEGER NOT NULL DEFAULT 0,
  units_total INTEGER NOT NULL DEFAULT 0,
  units_done INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  budget_usd REAL NOT NULL DEFAULT 0,
  content_version INTEGER NOT NULL DEFAULT 0,
  built_version INTEGER NOT NULL DEFAULT -1,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);

CREATE TABLE IF NOT EXISTS book_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  pages INTEGER NOT NULL,
  first_page INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  importance TEXT NOT NULL DEFAULT 'standard',
  icon TEXT,
  skip INTEGER NOT NULL DEFAULT 0,
  is_pilot INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  step TEXT,
  chapter TEXT,
  practice TEXT,
  warnings TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  notes TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_units_book ON units(book_id, idx);

CREATE TABLE IF NOT EXISTS artifacts (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, key)
);

CREATE TABLE IF NOT EXISTS book_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  ts INTEGER NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_book ON book_logs(book_id, id);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  book_id TEXT,
  unit_id INTEGER,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  dry_run INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage_events(ts);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id, ts);
`;

db.exec(SCHEMA);
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < SCHEMA_VERSION) db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);

// ---------------------------------------------------------------- helpers

const statements = new Map();

function prepare(sql) {
  let st = statements.get(sql);
  if (!st) {
    st = db.prepare(sql);
    statements.set(sql, st);
  }
  return st;
}

function norm(values) {
  return values.map((v) => {
    if (v === undefined) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

export const get = (sql, ...params) => prepare(sql).get(...norm(params));
export const all = (sql, ...params) => prepare(sql).all(...norm(params));
export const run = (sql, ...params) => {
  const r = prepare(sql).run(...norm(params));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};

let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

export const now = () => Date.now();

export function getArtifact(bookId, key) {
  const row = get('SELECT value FROM artifacts WHERE book_id = ? AND key = ?', bookId, key);
  return row ? JSON.parse(row.value) : null;
}

export function setArtifact(bookId, key, value) {
  run(
    `INSERT INTO artifacts (book_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(book_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    bookId,
    key,
    JSON.stringify(value),
    now(),
  );
}

export function audit(actor, action, target = null, detail = null, ip = null) {
  run(
    'INSERT INTO audit_log (ts, user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
    now(),
    actor?.id ?? null,
    actor?.username ?? null,
    action,
    target,
    detail == null ? null : JSON.stringify(detail),
    ip,
  );
}
