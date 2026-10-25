import { Router } from 'express';
import { get, all, run, now, audit, tx } from '../db.js';
import { generatePassword, hashPassword, passwordProblem } from '../security.js';
import { requireAdmin, revokeSessions } from '../auth.js';
import { bad, clientIp, clampInt, clampNum, notFound } from '../lib/util.js';
import { monthStartMs } from '../lib/util.js';
import { DEFAULT_PRICES, setting } from '../lib/settings.js';

const router = Router();
router.use(requireAdmin);

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

function shape(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: Boolean(row.active),
    mustChangePassword: Boolean(row.must_change_password),
    monthlyBudgetUsd: row.monthly_budget_usd,
    maxActiveBooks: row.max_active_books,
    maxPagesPerBook: row.max_pages_per_book,
    allowedModels: row.allowed_models ? JSON.parse(row.allowed_models) : null,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    lockedUntil: row.locked_until && row.locked_until > now() ? row.locked_until : null,
    books: row.books ?? undefined,
    monthSpendUsd: row.month_spend ?? undefined,
    activeBooks: row.active_books ?? undefined,
    sessions: row.sessions ?? undefined,
  };
}

function readLimits(body) {
  const out = {};
  if ('monthlyBudgetUsd' in body) out.monthly_budget_usd = body.monthlyBudgetUsd === null || body.monthlyBudgetUsd === '' ? null : clampNum(body.monthlyBudgetUsd, 0, 100000, null);
  if ('maxActiveBooks' in body) out.max_active_books = body.maxActiveBooks === null || body.maxActiveBooks === '' ? null : clampInt(body.maxActiveBooks, 0, 50, null);
  if ('maxPagesPerBook' in body) out.max_pages_per_book = body.maxPagesPerBook === null || body.maxPagesPerBook === '' ? null : clampInt(body.maxPagesPerBook, 1, 5000, null);
  if ('allowedModels' in body) {
    if (body.allowedModels === null) out.allowed_models = null;
    else {
      const known = new Set(Object.keys(setting('prices') || DEFAULT_PRICES));
      const list = [...new Set((Array.isArray(body.allowedModels) ? body.allowedModels : []).map(String))].filter((m) => known.has(m));
      out.allowed_models = JSON.stringify(list);
    }
  }
  return out;
}

router.get('/', (_req, res) => {
  const rows = all(
    `SELECT u.*,
       (SELECT COUNT(*) FROM books b WHERE b.owner_id = u.id) AS books,
       (SELECT COUNT(*) FROM books b WHERE b.owner_id = u.id AND b.status IN ('queued','running','awaiting')) AS active_books,
       (SELECT COALESCE(SUM(cost_usd), 0) FROM usage_events e WHERE e.user_id = u.id AND e.ts >= ?) AS month_spend,
       (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS sessions
     FROM users u ORDER BY u.active DESC, u.role, u.username`,
    monthStartMs(),
    now(),
  );
  res.json({ users: rows.map(shape), defaults: { monthlyBudgetUsd: setting('default_user_budget_usd') } });
});

router.post('/', async (req, res) => {
  const b = req.body || {};
  const username = String(b.username || '').trim();
  const displayName = String(b.displayName || '').trim().slice(0, 80) || username;
  const role = b.role === 'admin' ? 'admin' : 'member';
  if (!USERNAME_RE.test(username)) throw bad('Username: 3-32 characters, letters, digits, dot, dash or underscore.');
  if (get('SELECT id FROM users WHERE username = ?', username)) throw bad('That username is already taken.');
  const temp = b.password ? String(b.password) : generatePassword();
  const problem = passwordProblem(temp, username);
  if (problem) throw bad(problem);
  const limits = readLimits(b);
  const id = run(
    `INSERT INTO users (username, display_name, password_hash, role, active, must_change_password,
       monthly_budget_usd, max_active_books, max_pages_per_book, allowed_models, created_at, created_by)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?)`,
    username,
    displayName,
    await hashPassword(temp),
    role,
    limits.monthly_budget_usd ?? null,
    limits.max_active_books ?? null,
    limits.max_pages_per_book ?? null,
    limits.allowed_models ?? null,
    now(),
    req.user.id,
  ).id;
  audit(req.user, 'user.create', username, { role }, clientIp(req));
  res.status(201).json({ user: shape(get('SELECT * FROM users WHERE id = ?', id)), temporaryPassword: temp });
});

function lastAdminGuard(target, change) {
  const losingAdmin = target.role === 'admin' && target.active && (change.role === 'member' || change.active === 0);
  if (!losingAdmin) return;
  const others = get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?", target.id).n;
  if (others === 0) throw bad('There must always be at least one active administrator.');
}

router.patch('/:id', (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) throw notFound('User not found.');
  const b = req.body || {};
  const change = {};
  if ('displayName' in b) change.display_name = String(b.displayName).trim().slice(0, 80) || target.display_name;
  if ('role' in b) change.role = b.role === 'admin' ? 'admin' : 'member';
  if ('active' in b) change.active = b.active ? 1 : 0;
  Object.assign(change, readLimits(b));

  if (target.id === req.user.id && (change.role === 'member' || change.active === 0)) throw bad('You cannot remove your own admin access or deactivate yourself.');
  lastAdminGuard(target, change);

  const keys = Object.keys(change);
  if (keys.length) {
    run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => change[k]), target.id);
    if (change.active === 0) revokeSessions(target.id);
    if (change.active === 1) run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', target.id);
    audit(req.user, 'user.update', target.username, Object.keys(b), clientIp(req));
  }
  res.json({ user: shape(get('SELECT * FROM users WHERE id = ?', target.id)) });
});

router.post('/:id/reset-password', async (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) throw notFound('User not found.');
  const temp = generatePassword();
  run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL WHERE id = ?', await hashPassword(temp), target.id);
  revokeSessions(target.id);
  audit(req.user, 'user.reset_password', target.username, null, clientIp(req));
  res.json({ temporaryPassword: temp });
});

router.post('/:id/revoke-sessions', (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) throw notFound('User not found.');
  revokeSessions(target.id, target.id === req.user.id ? req.session.id : null);
  audit(req.user, 'user.revoke_sessions', target.username, null, clientIp(req));
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const target = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!target) throw notFound('User not found.');
  if (target.id === req.user.id) throw bad('You cannot delete your own account.');
  if (get('SELECT COUNT(*) AS n FROM books WHERE owner_id = ?', target.id).n > 0) throw bad('This user owns books. Deactivate the account instead.');
  tx(() => {
    run('DELETE FROM users WHERE id = ?', target.id);
  });
  audit(req.user, 'user.delete', target.username, null, clientIp(req));
  res.json({ ok: true });
});

export default router;
