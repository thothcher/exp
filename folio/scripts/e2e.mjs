// End-to-end test in dry-run mode (no API key, no cost): node scripts/e2e.mjs
// Starts a throwaway server, drives it over HTTP through login, upload, both gates, preview and download,
// then checks the generated site folder. Exits non-zero on the first failed expectation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-e2e-'));
const PORT = 3190 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, FOLIO_DATA_DIR: DATA, FOLIO_MOCK_AI: '1', PORT: String(PORT), HOST: '127.0.0.1' };

const ok = (cond, msg) => {
  if (!cond) {
    console.error(`  FAIL ${msg}`);
    cleanup(1);
  }
  console.log(`  ok   ${msg}`);
};

let server;
function cleanup(code = 0) {
  server?.kill();
  setTimeout(() => {
    fs.rmSync(DATA, { recursive: true, force: true });
    process.exit(code);
  }, 300);
}

const sample = path.join(DATA, 'sample.pdf');
spawnSync(process.execPath, [path.join(ROOT, 'scripts/make-sample-pdf.mjs'), sample, '4'], { env });
const admin = spawnSync(process.execPath, [path.join(ROOT, 'scripts/create-admin.mjs'), '--username=tester', '--password=correct-horse-battery'], { env, encoding: 'utf8' });
ok(admin.status === 0, `create-admin: ${admin.stdout.trim() || admin.stderr.trim()}`);

server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

let cookie = '';
let csrf = '';
async function api(method, url, body, extra = {}) {
  const headers = { cookie, 'x-csrf-token': csrf, origin: BASE, ...extra };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual' });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data, headers: res.headers };
}

console.log('Auth');
let r = await api('POST', '/api/auth/login', { username: 'tester', password: 'wrong-password-here' });
ok(r.status === 401, 'wrong password is rejected');
r = await api('GET', '/api/books');
ok(r.status === 401, 'API requires a session');
r = await api('POST', '/api/auth/login', { username: 'tester', password: 'correct-horse-battery' });
ok(r.status === 200 && r.data.csrf, 'login works');
csrf = r.data.csrf;
const savedCookie = cookie;
r = await api('POST', '/api/books', {}, { 'x-csrf-token': 'bad' });
ok(r.status === 403, 'a request without the right CSRF token is refused');
cookie = savedCookie;

console.log('Config');
r = await api('GET', '/api/config');
ok(r.status === 200 && r.data.dryRun === true, 'dry-run mode is on');
ok(r.data.schema.fields.some((f) => f.key === 'BOOK_TITLE'), 'parameter schema is served');

console.log('Upload and create');
const form = new FormData();
form.append('files', new Blob([fs.readFileSync(sample)], { type: 'application/pdf' }), 'sample.pdf');
r = await api('POST', '/api/uploads', form);
ok(r.status === 201 && r.data.uploads[0].pages === 41, `PDF uploaded (${r.data.uploads?.[0]?.pages} pages)`);
const uploadId = r.data.uploads[0].id;

const bad = new FormData();
bad.append('files', new Blob(['not a pdf'], { type: 'application/pdf' }), 'fake.pdf');
r = await api('POST', '/api/uploads', bad);
ok(r.status === 400, 'a fake PDF is rejected');

r = await api('POST', '/api/books', { uploadIds: [uploadId], params: { BOOK_TITLE: '' } });
ok(r.status === 400 && r.data.fields?.BOOK_TITLE, 'missing required parameters are reported per field');

r = await api('POST', '/api/books', { uploadIds: [uploadId], params: { BOOK_TITLE: 'Sample Book of Learning', AUTHORS: 'Test Author', SUBJECT: 'Psychology', CONTENT_LANGUAGE: process.env.E2E_LANG || 'English (en)', SLUG: 'sample-book', EXTRA_INSTRUCTIONS: 'Line one\nLine two' } });
ok(r.status === 201, 'book created');
const bookId = r.data.book.id;

async function waitFor(pred, label, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const d = (await api('GET', `/api/books/${bookId}`)).data;
    if (pred(d)) return d;
    if (['failed', 'attention'].includes(d.book.status)) {
      console.error(d.book.error, d.units.map((u) => u.error).filter(Boolean));
      ok(false, `${label}: book stopped with ${d.book.status}`);
    }
    await new Promise((res) => setTimeout(res, 400));
  }
  ok(false, `${label}: timed out`);
}

console.log('Gate 1: blueprint');
let d = await waitFor((x) => x.book.status === 'awaiting' && x.book.gate === 'blueprint', 'blueprint gate');
ok(d.units.length === 4, `blueprint has ${d.units.length} units`);
ok(d.plan.skipped.length === 1, 'the title page is listed as skipped');
ok(d.estimate && d.estimate.mid >= 0, 'estimate is present');
r = await api('PUT', `/api/books/${bookId}/blueprint`, { units: d.units.map((u) => ({ ...u, title: u.idx === 0 ? 'Renamed first chapter' : u.title })), siteName: 'Sample Site' });
ok(r.status === 200, 'blueprint saved with an edit');
r = await api('GET', `/preview/${bookId}/`);
ok(r.status === 404, 'no preview before any unit is finished');
r = await api('POST', `/api/books/${bookId}/approve`, { gate: 'blueprint' });
ok(r.status === 200, 'blueprint approved');

console.log('Gate 2: pilot');
d = await waitFor((x) => x.book.status === 'awaiting' && x.book.gate === 'pilot', 'pilot gate');
ok(d.units.filter((u) => u.status === 'done').length === 1, 'exactly the pilot unit is done');
ok(d.units[0].title === 'Renamed first chapter', 'the blueprint edit was kept');
r = await api('GET', `/preview/${bookId}/`);
ok(r.status === 200 && String(r.data).includes('<html'), 'preview serves index.html');
ok(r.headers.get('content-security-policy')?.includes("script-src 'self'"), 'preview has its own strict CSP');
r = await api('GET', `/preview/${bookId}/content/book.json`);
ok(r.status === 200 && r.data.chapters.length === 1, 'preview content: one chapter so far');
r = await api('GET', `/preview/${bookId}/..%2F..%2Fserver%2Fconfig.js`);
ok(r.status === 404, 'path traversal is refused');
r = await api('POST', `/api/books/${bookId}/approve`, { gate: 'pilot' });
ok(r.status === 200, 'pilot approved');

console.log('Finish');
d = await waitFor((x) => x.book.status === 'done', 'completion');
ok(d.units.every((u) => u.status === 'done'), 'all units done');
ok(d.book.costUsd === 0, 'dry run costs nothing');

console.log('Download and verify the folder');
r = await api('GET', `/api/books/${bookId}/download`);
ok(r.status === 200 && r.headers.get('content-type') === 'application/zip', 'zip downloaded');
const files = unzipSync(new Uint8Array(r.data));
const names = Object.keys(files);
const folder = names[0].split('/')[0];
const has = (rel) => names.includes(`${folder}/${rel}`);
for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'css/tokens.css', 'js/app.js', 'content/book.json', 'content/glossary.json', 'content/ui.json', 'search-index.json', 'server.js', 'start.bat', 'docs/REPORT.md']) ok(has(f), `contains ${f}`);
const json = (rel) => JSON.parse(Buffer.from(files[`${folder}/${rel}`]).toString('utf8'));
const book = json('content/book.json');
ok(book.chapters.length === 4 && book.siteName === 'Sample Site', 'book.json has 4 chapters and the edited site name');
const cards = json('content/cards.json');
const questions = json('content/questions.json');
const exam = json('content/exam.json');
const gloss = json('content/glossary.json');
const ids = [...cards, ...questions, ...exam].map((x) => x.id);
ok(new Set(ids).size === ids.length, `all ${ids.length} ids are unique`);
const kpIds = new Set();
for (const c of book.chapters) for (const k of json(`content/${c.file}`).keyPoints) kpIds.add(k.id);
ok([...cards, ...questions].every((x) => x.kp.every((k) => kpIds.has(k))), 'every card and question points at a real key point');
ok([...kpIds].every((k) => cards.some((c) => c.kp.includes(k)) && questions.some((q) => q.kp.includes(k))), 'every key point has a card and a question');
const glossIds = new Set(gloss.map((g) => g.id));
const ch1 = json(`content/${book.chapters[0].file}`);
const links = JSON.stringify(ch1.sections).match(/\[\[([a-z0-9-]+)\|/g) || [];
ok(links.length > 0 && links.every((l) => glossIds.has(l.slice(2, -1))), `glossary links resolve (${links.length})`);
ok(ch1.sections.some((s) => s.blocks.some((b) => b.t === 'figure' && b.svg.startsWith('<svg'))), 'an SVG figure survived sanitizing');
ok(gloss.length >= 1 && gloss.filter((g) => g.chapters.length === 4).length === 1, 'the same term in 4 chapters is merged into one glossary entry');
if (process.env.E2E_OUT) {
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const dest = path.join(process.env.E2E_OUT, name.slice(folder.length + 1));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}
const css = Buffer.from(files[`${folder}/css/tokens.css`]).toString('utf8');
ok(css.includes('--ink-2:') && css.includes('--surface-2:') && css.includes('.tone-sage'), 'tokens.css has the variable names the engine uses');
const sw = Buffer.from(files[`${folder}/sw.js`]).toString('utf8');
ok(!sw.includes('{{') && sw.includes('./content/book.json'), 'service worker is filled in');
ok(!Buffer.from(files[`${folder}/index.html`]).toString('utf8').includes('{{'), 'index.html is filled in');

console.log('\nAll end-to-end checks passed.');
cleanup(0);
