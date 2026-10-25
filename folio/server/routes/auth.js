import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { get, run, now, audit } from '../db.js';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from '../security.js';
import { clearSessionCookie, createSession, publicUser, requireAuth, revokeSessions, setSessionCookie } from '../auth.js';
import { HttpError, bad, clientIp } from '../lib/util.js';

const router = Router();

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many sign-in attempts. Wait a few minutes and try again.' }),
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body?.username ?? '').trim().slice(0, 64);
  const password = String(req.body?.password ?? '').slice(0, 200);
  if (!username || !password) throw bad('Enter your username and password.');

  const user = get('SELECT * FROM users WHERE username = ?', username);
  const t = now();

  if (user && user.locked_until && user.locked_until > t) {
    await verifyPassword(password, DUMMY_HASH);
    audit(null, 'login.locked', username, null, clientIp(req));
    throw new HttpError(429, 'Too many failed attempts. Try again in a few minutes.');
  }

  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok || !user.active) {
    if (user) {
      const fails = user.failed_logins + 1;
      if (fails >= MAX_FAILS) {
        run('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?', t + LOCK_MS, user.id);
        audit(null, 'login.lockout', username, null, clientIp(req));
      } else {
        run('UPDATE users SET failed_logins = ? WHERE id = ?', fails, user.id);
      }
    }
    audit(null, 'login.failed', username, null, clientIp(req));
    throw new HttpError(401, 'Invalid username or password.');
  }

  run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', t, user.id);
  const session = createSession(req, user.id);
  setSessionCookie(req, res, session.token, session.maxAgeSec);
  audit(user, 'login.ok', null, null, clientIp(req));
  res.json({ user: publicUser(user), csrf: session.csrf });
});

router.post('/logout', requireAuth, (req, res) => {
  run('DELETE FROM sessions WHERE id = ?', req.session.id);
  clearSessionCookie(req, res);
  audit(req.user, 'logout', null, null, clientIp(req));
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user, csrf: req.session.csrf });
});

// Used by the app at start-up: answers 200 whether or not someone is signed in, so no error is logged.
router.get('/session', (req, res, next) => {
  requireAuth(req, res, (err) => {
    if (err) return err.status === 401 ? res.json({ user: null }) : next(err);
    res.json({ user: req.user, csrf: req.session.csrf });
  });
});

router.post('/password', requireAuth, async (req, res) => {
  const current = String(req.body?.current ?? '');
  const next = String(req.body?.next ?? '');
  if (!(await verifyPassword(current, req.userRow.password_hash))) throw new HttpError(400, 'Your current password is not correct.');
  const problem = passwordProblem(next, req.user.username);
  if (problem) throw bad(problem);
  if (next === current) throw bad('Choose a password you have not used just now.');
  run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashPassword(next), req.user.id);
  revokeSessions(req.user.id, req.session.id);
  audit(req.user, 'password.change', null, null, clientIp(req));
  res.json({ ok: true });
});

export default router;
