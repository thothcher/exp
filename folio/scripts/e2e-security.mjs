// Security checks against a throwaway server: node scripts/e2e-security.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sec-'));
const PORT = 3150 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, FOLIO_DATA_DIR: DATA, FOLIO_MOCK_AI: '1', PORT: String(PORT), HOST: '127.0.0.1' };
delete env.ANTHROPIC_API_KEY;

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const sample = path.join(DATA, 'sample.pdf');
spawnSync(process.execPath, [path.join(ROOT, 'scripts/make-sample-pdf.mjs'), sample, '2'], { env });
spawnSync(process.execPath, [path.join(ROOT, 'scripts/create-admin.mjs'), '--username=boss', '--password=correct-horse-battery'], { env });
const server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

class Client {
  constructor() {
    this.cookie = '';
    this.csrf = '';
  }

  async call(method, url, body, headers = {}) {
    const h = { cookie: this.cookie, 'x-csrf-token': this.csrf, origin: BASE, ...headers };
    let payload = body;
    if (body && !(body instanceof FormData)) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, set, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }

  async login(username, password) {
    const r = await this.call('POST', '/api/auth/login', { username, password });
    if (r.status === 200) this.csrf = r.data.csrf;
    return r;
  }
}

try {
  console.log('Headers and cookies');
  const anon = new Client();
  const home = await anon.call('GET', '/');
  const csp = home.headers.get('content-security-policy') || '';
  ok(csp.includes("default-src 'self'") && csp.includes("script-src 'self'") && !csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'), 'the dashboard has a strict CSP without unsafe-inline or unsafe-eval');
  ok(home.headers.get('x-content-type-options') === 'nosniff' && /frame/i.test(csp), 'nosniff and frame-ancestors are set');
  ok(home.headers.get('x-powered-by') === null, 'the server does not announce Express');

  const admin = new Client();
  let r = await admin.login('boss', 'correct-horse-battery');
  ok(r.status === 200, 'admin signs in');
  const cookieFlags = r.set[0] || '';
  ok(/HttpOnly/i.test(cookieFlags) && /SameSite=Strict/i.test(cookieFlags) && /Path=\//.test(cookieFlags), `session cookie is HttpOnly and SameSite=Strict`);

  console.log('Login protection');
  r = await anon.call('POST', '/api/auth/login', { username: 'nobody', password: 'x'.repeat(12) });
  const unknownMsg = r.data.error;
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'wrong-password-1' });
  ok(r.status === 401 && r.data.error === unknownMsg, 'unknown users and wrong passwords get the same message');
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'wrong-password-2' });
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'wrong-password-3' });
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'wrong-password-4' });
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'wrong-password-5' });
  r = await anon.call('POST', '/api/auth/login', { username: 'boss', password: 'correct-horse-battery' });
  ok(r.status === 429, 'five failures lock the account: even the right password is refused');

  console.log('Accounts');
  // unlock the account through the CLI; that also signs the account out everywhere, so sign in again
  spawnSync(process.execPath, [path.join(ROOT, 'scripts/create-admin.mjs'), '--username=boss', '--password=correct-horse-battery', '--reset'], { env });
  r = await admin.call('GET', '/api/books');
  ok(r.status === 401, 'a password reset from the command line signs the account out everywhere');
  r = await admin.login('boss', 'correct-horse-battery');
  ok(r.status === 200, 'the administrator signs in again with the reset password');
  r = await admin.call('POST', '/api/users', { username: 'anna', displayName: 'Anna', role: 'member', monthlyBudgetUsd: 5 });
  ok(r.status === 201 && r.data.temporaryPassword.length >= 16, 'admin creates a member and gets a temporary password');
  const temp = r.data.temporaryPassword;
  const annaId = r.data.user.id;
  r = await admin.call('POST', '/api/users', { username: 'anna', role: 'member' });
  ok(r.status === 400, 'duplicate usernames are refused');
  r = await admin.call('POST', '/api/users', { username: 'x', role: 'member' });
  ok(r.status === 400, 'bad usernames are refused');

  const anna = new Client();
  r = await anna.login('anna', temp);
  ok(r.status === 200 && r.data.user.mustChangePassword === true, 'the member signs in with the temporary password');
  r = await anna.call('GET', '/api/books');
  ok(r.status === 403 && r.data.code === 'must_change_password', 'nothing works until the password is changed');
  r = await anna.call('POST', '/api/auth/password', { current: temp, next: 'short' });
  ok(r.status === 400, 'a short password is refused');
  r = await anna.call('POST', '/api/auth/password', { current: temp, next: 'purple-river-stone-1' });
  r = await anna.call('POST', '/api/auth/password', { current: temp, next: 'a-better-password-2' });
  ok(r.status === 400, 'the old temporary password no longer works as the current password');
  r = await anna.call('POST', '/api/auth/password', { current: 'purple-river-stone-1', next: 'a-better-password-2' });
  r = await anna.call('GET', '/api/books');
  ok(r.status === 200, 'after the change the member can work');

  console.log('Roles');
  for (const [m, u] of [['GET', '/api/users'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/prompt'], ['GET', '/api/admin/usage'], ['GET', '/api/admin/audit'], ['PUT', '/api/admin/settings/key']]) {
    r = await anna.call(m, u, m === 'PUT' ? { key: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx' } : undefined);
    ok(r.status === 403, `member is refused: ${m} ${u}`);
  }
  r = await anna.call('PATCH', `/api/users/${annaId}`, { role: 'admin' });
  ok(r.status === 403, 'a member cannot promote themselves');

  console.log('Isolation between people');
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(sample)], { type: 'application/pdf' }), 'a.pdf');
  r = await admin.call('POST', '/api/uploads', form);
  const up = r.data.uploads[0].id;
  r = await admin.call('POST', '/api/books', { uploadIds: [up], params: { BOOK_TITLE: 'Private book', AUTHORS: 'X', SUBJECT: 'Y', CONTENT_LANGUAGE: 'English (en)' } });
  const bookId = r.data.book.id;
  await new Promise((res) => setTimeout(res, 2500));
  r = await anna.call('GET', `/api/books/${bookId}`);
  ok(r.status === 404, "a member cannot open someone else's book");
  r = await anna.call('GET', '/api/books');
  ok(r.data.books.length === 0, "a member's library does not list other people's books");
  r = await anna.call('GET', '/api/books?scope=all');
  ok(r.data.books.length === 0, 'scope=all does not widen a member\'s view');
  for (const u of [`/preview/${bookId}/`, `/api/books/${bookId}/download`, `/api/books/${bookId}/logs`]) {
    r = await anna.call('GET', u);
    ok(r.status === 404, `404 for the other member: ${u}`);
  }
  r = await anna.call('POST', `/api/books/${bookId}/cancel`);
  ok(r.status === 404, "a member cannot cancel someone else's book");
  r = await anna.call('DELETE', `/api/books/${bookId}`);
  ok(r.status === 404, "a member cannot delete someone else's book");
  r = await anna.call('POST', '/api/books', { uploadIds: [up], params: { BOOK_TITLE: 'Stolen', AUTHORS: 'X', SUBJECT: 'Y', CONTENT_LANGUAGE: 'English (en)' } });
  ok(r.status === 400, "a member cannot build a book from someone else's upload");
  r = await anna.call('POST', `/api/books/${bookId}/budget`, { budgetUsd: 1000 });
  ok([403, 404].includes(r.status), 'a member cannot change a spending limit');

  console.log('Request forgery');
  r = await admin.call('POST', '/api/users', { username: 'evil', role: 'admin' }, { origin: 'http://evil.example' });
  ok(r.status === 403, 'a request from another origin is refused');
  r = await admin.call('POST', '/api/users', { username: 'evil', role: 'admin' }, { 'x-csrf-token': 'wrong' });
  ok(r.status === 403, 'a request with the wrong CSRF token is refused');
  r = await admin.call('POST', '/api/users', { username: 'evil2', role: 'admin' }, { 'sec-fetch-site': 'cross-site' });
  ok(r.status === 403, 'a cross-site fetch is refused');

  console.log('Secrets');
  r = await admin.call('PUT', '/api/admin/settings/key', { key: 'sk-ant-api03-SECRETSECRETSECRETSECRET-abcd' });
  ok(r.status === 200 && !JSON.stringify(r.data).includes('SECRETSECRET'), 'saving the key returns only a masked form');
  r = await admin.call('GET', '/api/admin/settings');
  ok(!JSON.stringify(r.data).includes('SECRETSECRET') && r.data.key.source === 'dashboard', 'the key is never returned by the settings endpoint');
  const db = fs.readFileSync(path.join(DATA, 'folio.db'));
  const wal = fs.existsSync(path.join(DATA, 'folio.db-wal')) ? fs.readFileSync(path.join(DATA, 'folio.db-wal')) : Buffer.alloc(0);
  ok(!db.includes('SECRETSECRET') && !wal.includes('SECRETSECRET'), 'the key is not stored in plain text in the database');
  r = await admin.call('GET', '/api/config');
  ok(!JSON.stringify(r.data).includes('SECRETSECRET'), 'the key is not in the public config either');
  r = await admin.call('GET', '/api/admin/audit?limit=50');
  ok(!JSON.stringify(r.data).includes('SECRETSECRET'), 'the audit log does not contain the key');

  console.log('Disabling an account');
  r = await admin.call('PATCH', `/api/users/${annaId}`, { active: false });
  r = await anna.call('GET', '/api/books');
  ok(r.status === 401, 'a disabled account loses its session immediately');
  r = await new Client().login('anna', 'a-better-password-2');
  ok(r.status === 401, 'and cannot sign in again');
  r = await admin.call('PATCH', '/api/users/1', { active: false });
  ok(r.status === 400, 'the last administrator cannot be disabled');

  console.log('Uploads');
  const evil = new FormData();
  evil.append('files', new Blob(['<html><script>alert(1)</script></html>'], { type: 'application/pdf' }), '../../evil.pdf');
  r = await admin.call('POST', '/api/uploads', evil);
  ok(r.status === 400, 'a file that is not a PDF is refused even with a PDF name');
  r = await admin.call('GET', '/uploads/anything.pdf');
  ok(r.status === 404 || r.data.toString().includes('<!doctype') === false, 'uploads are not served statically');
  r = await anon.call('GET', '/data/folio.db');
  ok(r.status === 404, 'the data folder is not reachable over HTTP');
  r = await anon.call('GET', '/../server/config.js');
  ok(r.status === 404 || !String(r.data).includes('APP_SECRET'), 'source files are not reachable over HTTP');
} catch (err) {
  console.error(err);
  failures++;
}

server.kill();
setTimeout(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failures ? `\n${failures} security check(s) FAILED` : '\nAll security checks passed.');
  process.exit(failures ? 1 : 0);
}, 400);
