// Integration test of the REAL API code path against a fake Anthropic server (no key, no cost):
//   node scripts/e2e-api.mjs
// The fake server streams server-sent events like the real API, answers each task with the dry-run
// generators, and injects faults (a 429 and an invalid-JSON reply) to test retry and the repair loop.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { mockAssets, mockAudit, mockChapter, mockPlan, mockPractice, mockScan, mockUi } from '../server/pipeline/mock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-api-'));
const FAKE_PORT = 3170 + Math.floor(Math.random() * 9);
const APP_PORT = 3180 + Math.floor(Math.random() * 9);
const BASE = `http://127.0.0.1:${APP_PORT}`;
const KEY = 'sk-ant-fake-key-for-integration-test-0000';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

// ------------------------------------------------------------------ fake API

const seen = [];
const faults = { scan429: true, chapterJunk: true, delayMs: 0 };
const PRICE = { in: 4, out: 20, cw: 5, cr: 0.2 };

function jsonFrom(text, start, end) {
  const i = text.indexOf(start);
  const j = text.indexOf(end, i + start.length);
  return JSON.parse(text.slice(i + start.length, j));
}

async function answer(body) {
  const sysBlocks = Array.isArray(body.system) ? body.system : [{ type: 'text', text: String(body.system) }];
  const sys = sysBlocks.map((b) => b.text).join('\n');
  const first = body.messages[0].content;
  const blocks = Array.isArray(first) ? first : [{ type: 'text', text: first }];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const doc = blocks.find((b) => b.type === 'document');
  let pages = 0;
  if (doc) pages = (await PDFDocument.load(Buffer.from(doc.source.data, 'base64'))).getPageCount();

  let purpose;
  let reply;
  let usage = { input_tokens: 1200, output_tokens: 600, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  if (text.includes('Describe the structure visible on THESE pages')) {
    purpose = 'scan';
    const m = text.match(/PDF pages (\d+) to (\d+) of a document with (\d+) pages/);
    reply = mockScan({ a: Number(m[1]), b: Number(m[2]), total: Number(m[3]) });
    reply._pagesInRequest = pages;
    usage = { input_tokens: pages * 2000, output_tokens: 700, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  } else if (text.includes('TASK: BLUEPRINT')) {
    purpose = 'plan';
    const total = Number(text.match(/The book has (\d+) PDF pages/)[1]);
    reply = mockPlan({ total, scan: JSON.parse(text.slice(text.indexOf('are:\n\n') + 6, text.indexOf('\n\nRules:'))) });
    usage = { input_tokens: 3000, output_tokens: 1500, cache_creation_input_tokens: 17000, cache_read_input_tokens: 0 };
  } else if (text.includes('TASK: WRITE ONE CHAPTER')) {
    purpose = 'chapter';
    const m = text.match(/It is unit (\d+) of (\d+): "([^"]+)"/);
    const r = text.match(/PDF pages (\d+)–(\d+) of a book/);
    reply = mockChapter({ unit: { number: Number(m[1]), title: m[3], page_start: Number(r[1]), icon: 'brain' }, total: Number(m[2]) });
    usage = { input_tokens: 500, output_tokens: 9000, cache_creation_input_tokens: pages * 2000, cache_read_input_tokens: 17000 };
  } else if (text.includes('TASK: PRACTICE MATERIAL')) {
    purpose = 'practice';
    reply = mockPractice({ chapter: JSON.parse(text.slice(text.indexOf('CHAPTER:\n') + 9, text.indexOf('\n\nWrite flashcards'))) });
    usage = { input_tokens: 9000, output_tokens: 6000, cache_creation_input_tokens: 0, cache_read_input_tokens: 17000 + pages * 2000 };
  } else if (text.includes('TASK: ANSWER-KEY AUDIT')) {
    purpose = 'audit';
    reply = mockAudit();
    usage = { input_tokens: 15000, output_tokens: 2500, cache_creation_input_tokens: 0, cache_read_input_tokens: 17000 + pages * 2000 };
  } else if (text.includes('TASK: WHOLE-BOOK ASSETS')) {
    purpose = 'assets';
    reply = mockAssets({ units: JSON.parse(text.slice(text.indexOf('chapter of the finished site says.\n\n') + 36, text.indexOf('\n\nWrite the Big Picture'))) });
  } else if (text.includes('TASK: TRANSLATE THE INTERFACE')) {
    purpose = 'ui';
    reply = mockUi({ strings: JSON.parse(text.slice(text.indexOf('{"about_lead"'), text.lastIndexOf('}') + 1 - 0).replace(/\n\nReturn one JSON[\s\S]*$/, '')) });
  } else {
    purpose = 'unknown';
    reply = {};
  }
  return { purpose, reply, usage, pages, text, sys, turns: body.messages.length };
}

function sse(res, model, text, usage) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  ev('message_start', { type: 'message_start', message: { id: 'msg_fake', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } } });
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  for (let i = 0; i < text.length; i += 4000) ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + 4000) } });
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"type":"error","error":{"type":"not_found_error","message":"no"}}');
    return;
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const a = await answer(body);
  if (faults.delayMs) await new Promise((r) => setTimeout(r, faults.delayMs));
  const entry = { purpose: a.purpose, model: body.model, effort: body.output_config?.effort, beta: req.headers['anthropic-beta'], fallbacks: body.fallbacks, key: req.headers['x-api-key'] || String(req.headers.authorization || '').replace(/^Bearer /, ''), pages: a.pages, cached: Array.isArray(body.system) && body.system.some((b) => b.cache_control), hasMaster: a.sys.includes('<instructions>'), hasParams: a.sys.includes('<book_parameters>'), hasYamlValue: a.sys.includes('BOOK_TITLE: "Integration Book"'), turns: a.turns, repairText: body.messages.length > 1 ? String(body.messages.at(-1).content) : '' , thinking: body.thinking, stream: body.stream };
  seen.push(entry);

  if (a.purpose === 'scan' && faults.scan429) {
    faults.scan429 = false;
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }).end('{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}');
    return;
  }
  if (a.purpose === 'chapter' && faults.chapterJunk && body.messages.length === 1) {
    faults.chapterJunk = false;
    return sse(res, body.model, 'Sure, here is the chapter: {"title": "broken', a.usage);
  }
  sse(res, body.model, JSON.stringify(a.reply), a.usage);
});
await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));

// ------------------------------------------------------------------ app

const env = { ...process.env, FOLIO_DATA_DIR: DATA, PORT: String(APP_PORT), HOST: '127.0.0.1', ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_PORT}` };
delete env.FOLIO_MOCK_AI;
const sample = path.join(DATA, 'sample.pdf');
spawnSync(process.execPath, [path.join(ROOT, 'scripts/make-sample-pdf.mjs'), sample, '3'], { env });
spawnSync(process.execPath, [path.join(ROOT, 'scripts/create-admin.mjs'), '--username=tester', '--password=correct-horse-battery'], { env });
let server;
function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
}
startServer();
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/`)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

let cookie = '';
let csrf = '';
async function api(method, url, body) {
  const headers = { cookie, 'x-csrf-token': csrf, origin: BASE };
  let payload = body;
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, { method, headers, body: payload });
  const set = res.headers.getSetCookie?.() || [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const isJson = (res.headers.get('content-type') || '').includes('json');
  return { status: res.status, data: isJson ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
async function waitFor(bookId, pred, label, ms = 90000) {
  const t0 = Date.now();
  let d;
  while (Date.now() - t0 < ms) {
    d = (await api('GET', `/api/books/${bookId}`)).data;
    if (pred(d)) return d;
    await new Promise((r) => setTimeout(r, 400));
  }
  console.error(`  timeout: ${label}; last state`, d?.book?.status, d?.book?.error);
  failures++;
  return d;
}
async function newBook(budgetUsd, title) {
  const form = new FormData();
  form.append('files', new Blob([fs.readFileSync(sample)], { type: 'application/pdf' }), 'sample.pdf');
  const up = await api('POST', '/api/uploads', form);
  const r = await api('POST', '/api/books', { uploadIds: [up.data.uploads[0].id], budgetUsd, params: { BOOK_TITLE: title, AUTHORS: 'Test Author', SUBJECT: 'Psychology', CONTENT_LANGUAGE: 'Georgian (ka)', SLUG: 'integration' } });
  return r;
}

try {
  let r = await api('POST', '/api/auth/login', { username: 'tester', password: 'correct-horse-battery' });
  csrf = r.data.csrf;
  r = await api('GET', '/api/config');
  ok(r.data.dryRun === false && r.data.hasKey === true, 'real mode is on and the key from the environment is found');

  console.log('Scenario A: full run with a 429 and a broken JSON reply');
  r = await newBook(25, 'Integration Book');
  ok(r.status === 201 && r.data.book.dryRun === false, 'book created in real mode');
  const A = r.data.book.id;
  let d = await waitFor(A, (x) => x.book.status === 'awaiting' && x.book.gate === 'blueprint', 'blueprint');
  const scans = seen.filter((s) => s.purpose === 'scan');
  ok(scans.length >= 3, `the scan sent ${scans.length} requests (one 429 was retried by the SDK)`);
  ok(scans.every((s) => s.key === KEY), 'the configured API key is what the SDK sends');
  ok(scans.every((s) => s.pages > 0 && s.pages <= 25), `scan requests carry real PDF slices (${[...new Set(scans.map((s) => s.pages))].join(', ')} pages)`);
  ok(scans.every((s) => s.stream === true), 'requests are streamed');
  ok(d.plan?.tokensPerPage === 2000, `tokens per page were measured from the scan (${d.plan?.tokensPerPage})`);
  const plan = seen.find((s) => s.purpose === 'plan');
  ok(plan.hasMaster && plan.hasParams && plan.hasYamlValue, 'the plan request contains the master prompt and the filled-in parameters block');
  ok(plan.cached, 'the system prompt carries a cache_control breakpoint');
  ok(plan.model === 'claude-opus-5-5' && plan.effort === 'medium' && plan.thinking === undefined, 'model, effort and thinking settings are as designed');
  ok(plan.beta === 'server-side-fallback-2026-07-01' && plan.fallbacks === 'default', 'the refusal fallback is requested for Opus');
  ok(d.book.costUsd > 0 && d.estimate.measured === true, `cost is tracked after the scan ($${d.book.costUsd.toFixed(4)}) and the estimate uses measured tokens`);
  ok(d.units.length === 3, 'three chapters were planned');

  r = await api('POST', `/api/books/${A}/approve`, { gate: 'blueprint' });
  d = await waitFor(A, (x) => x.book.status === 'awaiting' && x.book.gate === 'pilot', 'pilot');
  const chapters = seen.filter((s) => s.purpose === 'chapter');
  ok(chapters.length === 2, 'the broken reply triggered exactly one repair turn');
  ok(chapters[1].turns === 3 && /not valid JSON/i.test(chapters[1].repairText), 'the repair request carried the failed reply and the problem description');
  ok(chapters.every((s) => s.pages === 10), 'chapter requests carry exactly the 10 pages of the unit');
  ok(seen.some((s) => s.purpose === 'practice') && seen.some((s) => s.purpose === 'audit'), 'practice and audit steps ran');
  const costPilot = d.book.costUsd;
  r = await api('POST', `/api/books/${A}/approve`, { gate: 'pilot' });
  d = await waitFor(A, (x) => x.book.status === 'done', 'done');
  ok(d.units.every((u) => u.status === 'done'), 'all units done');
  ok(seen.some((s) => s.purpose === 'assets'), 'big picture and interface translation were requested');
  const ui = seen.find((s) => s.purpose === 'ui');
  ok(Boolean(ui), 'the interface was translated for a non-English site');
  const stylePrompt = seen.filter((s) => s.purpose === 'chapter').at(-1);
  ok(stylePrompt.pages === 10, 'later chapters also got their own page slice');
  ok(d.book.costUsd > costPilot, 'cost kept growing');
  // expected cost of one chapter call: (500*4 + 20000*5 + 17000*0.2 + 9000*20) / 1e6
  const expectChapter = (500 * PRICE.in + 20000 * PRICE.cw + 17000 * PRICE.cr + 9000 * PRICE.out) / 1e6;
  const first = d.units[0];
  ok(first.costUsd > expectChapter, `unit cost includes all its calls ($${first.costUsd.toFixed(3)} vs $${expectChapter.toFixed(3)} for the chapter call alone)`);
  const usage = await api('GET', '/api/admin/usage?days=7');
  ok(usage.data.total > 0 && usage.data.byModel[0].model === 'claude-opus-5-5' && usage.data.byPurpose.length >= 5, `usage report: $${usage.data.total} over ${usage.data.byPurpose.length} kinds of work`);
  const dl = await api('GET', `/api/books/${A}/download`);
  ok(dl.status === 200 && dl.data.length > 50000, 'the site folder downloads');

  console.log('Scenario B: spending limit');
  seen.length = 0;
  faults.scan429 = false;
  r = await newBook(0.01, 'Integration Book');
  const B = r.data.book.id;
  d = await waitFor(B, (x) => x.book.status === 'attention', 'budget stop');
  ok(/spending limit/i.test(d.book.error || ''), `the run stopped at the limit: "${d.book.error}"`);
  ok(seen.filter((s) => s.purpose === 'scan').length <= 3, 'no more requests were made after the limit was reached');
  r = await api('POST', `/api/books/${B}/budget`, { budgetUsd: 25 });
  r = await api('POST', `/api/books/${B}/resume`);
  d = await waitFor(B, (x) => x.book.status === 'awaiting' && x.book.gate === 'blueprint', 'resume after raising the limit');
  ok(d.units.length === 3, 'the run resumed and reached the blueprint gate');

  console.log('Scenario C: the server is killed in the middle of a run');
  seen.length = 0;
  faults.chapterJunk = false;
  faults.delayMs = 500;
  r = await newBook(25, 'Integration Book');
  const C = r.data.book.id;
  d = await waitFor(C, (x) => x.book.status === 'awaiting' && x.book.gate === 'blueprint', 'C blueprint');
  await api('POST', `/api/books/${C}/approve`, { gate: 'blueprint' });
  d = await waitFor(C, (x) => x.book.status === 'awaiting' && x.book.gate === 'pilot', 'C pilot');
  await api('POST', `/api/books/${C}/approve`, { gate: 'pilot' });
  d = await waitFor(C, (x) => x.units.filter((u) => u.status === 'done').length >= 2 && x.book.status === 'running', 'C two units done');
  const doneBefore = d.units.filter((u) => u.status === 'done').map((u) => u.id);

  server.kill('SIGKILL');
  await new Promise((res) => setTimeout(res, 800));
  startServer();
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE + '/')).ok) break;
    } catch {
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  r = await api('POST', '/api/auth/login', { username: 'tester', password: 'correct-horse-battery' });
  csrf = r.data.csrf;
  d = await waitFor(C, (x) => x.book.status === 'done', 'C finished after the restart');
  ok(d.units.every((u) => u.status === 'done'), 'the book finished after the restart');
  const chapterRequests = seen.filter((s) => s.purpose === 'chapter').length;
  ok(chapterRequests <= 4, `finished units were not paid for twice (${chapterRequests} chapter requests for 3 units; one may have been in flight)`);
  ok(doneBefore.every((id) => d.units.find((u) => u.id === id).status === 'done'), 'units finished before the crash stayed finished');

  console.log('Cancel and resume');
  faults.delayMs = 150;
  r = await newBook(25, 'Integration Book');
  const E = r.data.book.id;
  await waitFor(E, (x) => x.book.status === 'running' || x.book.status === 'awaiting', 'E started');
  r = await api('POST', `/api/books/${E}/cancel`);
  d = await waitFor(E, (x) => x.book.status === 'cancelled', 'E cancelled');
  ok(d.book.status === 'cancelled', 'a running book can be cancelled');
  r = await api('POST', `/api/books/${E}/resume`);
  d = await waitFor(E, (x) => x.book.status === 'awaiting', 'E resumed');
  ok(d.book.gate === 'blueprint', 'and resumed after being cancelled');
} catch (err) {
  console.error(err);
  failures++;
}

fake.close();
server.kill();
setTimeout(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll real-path checks passed.');
  process.exit(failures ? 1 : 0);
}, 400);
