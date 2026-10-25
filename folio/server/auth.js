import { COOKIE_SECURE } from './config.js';
import { get, run, now } from './db.js';
import { randomToken, sha256, safeEqual } from './security.js';
import { setting } from './lib/settings.js';
import { HttpError } from './lib/util.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const NAME_SECURE = '__Host-folio';
const NAME_PLAIN = 'folio';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookie
    }
  }
  return out;
}

function isSecure(req) {
  if (COOKIE_SECURE === '1') return true;
  if (COOKIE_SECURE === '0') return false;
  return Boolean(req.secure);
}

export function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = isSecure(req);
  const name = secure ? NAME_SECURE : NAME_PLAIN;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (secure) flags.push('Secure');
  res.append('Set-Cookie', `${name}=${encodeURIComponent(token)}; ${flags.join('; ')}`);
}

export function clearSessionCookie(req, res) {
  const secure = isSecure(req);
  const name = secure ? NAME_SECURE : NAME_PLAIN;
  const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) flags.push('Secure');
  res.append('Set-Cookie', `${name}=; ${flags.join('; ')}`);
}

export function readToken(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[NAME_SECURE] || cookies[NAME_PLAIN] || '';
}

export function createSession(req, userId) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const t = now();
  const maxMs = setting('session_max_days') * 86400000;
  run(
    'INSERT INTO sessions (id, user_id, csrf, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sha256(token),
    userId,
    csrf,
    t,
    t,
    t + maxMs,
    req.ip || '',
    String(req.get('user-agent') || '').slice(0, 200),
  );
  // keep at most 10 sessions per user
  run(
    `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
       SELECT id FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC LIMIT 10)`,
    userId,
    userId,
  );
  return { token, csrf, maxAgeSec: Math.floor(maxMs / 1000) };
}

export function revokeSessions(userId, exceptId = null) {
  if (exceptId) run('DELETE FROM sessions WHERE user_id = ? AND id != ?', userId, exceptId);
  else run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    mustChangePassword: Boolean(row.must_change_password),
  };
}

function checkOrigin(req) {
  const site = req.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new HttpError(403, 'Cross-site request blocked.');
  const origin = req.get('origin');
  if (origin) {
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'Bad origin.');
    }
    if (host !== req.get('host')) throw new HttpError(403, 'Cross-origin request blocked.');
  }
}

export function guardOrigin(req, _res, next) {
  try {
    if (!SAFE_METHODS.has(req.method)) checkOrigin(req);
    next();
  } catch (err) {
    next(err);
  }
}

const ALLOWED_WHILE_MUST_CHANGE = new Set(['/api/auth/me', '/api/auth/session', '/api/auth/password', '/api/auth/logout']);

/** Loads the session for the request. Throws 401 when missing or expired. */
export function requireAuth(req, _res, next) {
  try {
    const token = readToken(req);
    if (!token) throw new HttpError(401, 'Sign in required.', { code: 'unauthenticated' });
    const id = sha256(token);
    const session = get('SELECT * FROM sessions WHERE id = ?', id);
    if (!session) throw new HttpError(401, 'Sign in required.', { code: 'unauthenticated' });
    const t = now();
    const idleMs = setting('session_idle_hours') * 3600000;
    if (session.expires_at < t || t - session.last_seen_at > idleMs) {
      run('DELETE FROM sessions WHERE id = ?', id);
      throw new HttpError(401, 'Your session expired. Sign in again.', { code: 'unauthenticated' });
    }
    const user = get('SELECT * FROM users WHERE id = ?', session.user_id);
    if (!user || !user.active) {
      run('DELETE FROM sessions WHERE id = ?', id);
      throw new HttpError(401, 'Sign in required.', { code: 'unauthenticated' });
    }
    if (!SAFE_METHODS.has(req.method)) {
      checkOrigin(req);
      const sent = req.get('x-csrf-token') || '';
      if (!sent || !safeEqual(sent, session.csrf)) throw new HttpError(403, 'Security token missing. Reload the page.', { code: 'csrf' });
    }
    if (t - session.last_seen_at > 60000) run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', t, id);
    if (user.must_change_password && !ALLOWED_WHILE_MUST_CHANGE.has(req.baseUrl + req.path)) {
      throw new HttpError(403, 'Set a new password to continue.', { code: 'must_change_password' });
    }
    req.userRow = user;
    req.user = publicUser(user);
    req.session = session;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Administrators only.'));
  next();
}
