import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { UPLOAD_DIR } from '../config.js';
import { all, audit, get, getArtifact, now, run, setArtifact, tx } from '../db.js';
import { CHAPTER_ICONS } from '../lib/iconNames.js';
import { activePrompt } from '../lib/masterPrompt.js';
import { apiKeySource, setting } from '../lib/settings.js';
import { bad, clampNum, clientIp, forbidden, newId, notFound, monthStartMs, safeJson, slugify } from '../lib/util.js';
import { FORCE_MOCK_AI } from '../config.js';
import { assembleBook, ensureBuilt, zipSite } from '../pipeline/assemble.js';
import { estimateBook, estimateForUnits } from '../pipeline/estimate.js';
import { mergePdfs } from '../pipeline/pdf.js';
import { validateParams } from '../pipeline/params.js';
import { IMPORTANCE } from '../pipeline/normalize.js';
import { approveGate, isActive, queueBook, requestCancel } from '../pipeline/runner.js';
import { bookContext, bookDir, logBook, numberedUnits } from '../pipeline/stages.js';

const router = Router();

const ACTIVE = ['queued', 'running', 'awaiting'];

export function allowedModelsFor(user) {
  const global = setting('allowed_models');
  const own = user.allowed_models ? safeJson(user.allowed_models, null) : null;
  return own ? global.filter((m) => own.includes(m)) : global;
}

function shapeBook(b, owners) {
  const o = owners?.get(b.owner_id);
  return {
    id: b.id,
    title: b.title,
    slug: b.slug,
    status: b.status,
    stage: b.stage,
    gate: b.gate,
    error: b.error,
    model: b.model,
    scanModel: b.scan_model,
    dryRun: Boolean(b.dry_run),
    pagesTotal: b.pages_total,
    unitsTotal: b.units_total,
    unitsDone: b.units_done,
    inputTokens: b.input_tokens + b.cache_read_tokens + b.cache_write_tokens,
    outputTokens: b.output_tokens,
    costUsd: b.cost_usd,
    budgetUsd: b.budget_usd,
    owner: o ? { id: o.id, username: o.username, displayName: o.display_name } : { id: b.owner_id },
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    startedAt: b.started_at,
    finishedAt: b.finished_at,
    running: isActive(b.id),
  };
}

const ownersMap = () => new Map(all('SELECT id, username, display_name FROM users').map((u) => [u.id, u]));

function loadBook(req, id = req.params.id) {
  const book = get('SELECT * FROM books WHERE id = ?', id);
  if (!book || (book.owner_id !== req.user.id && req.user.role !== 'admin')) throw notFound('Book not found.');
  return book;
}

function shapeUnit(u) {
  const chapter = u.chapter ? safeJson(u.chapter) : null;
  const practice = u.practice ? safeJson(u.practice) : null;
  return {
    id: u.id,
    idx: u.idx,
    number: u.number,
    title: u.title,
    pageStart: u.page_start,
    pageEnd: u.page_end,
    importance: u.importance,
    icon: u.icon,
    skip: Boolean(u.skip),
    isPilot: Boolean(u.is_pilot),
    status: u.status,
    step: u.step,
    error: u.error,
    notes: u.notes || '',
    attempts: u.attempts,
    warnings: u.warnings ? safeJson(u.warnings, []) : [],
    costUsd: u.cost_usd,
    tokens: u.input_tokens + u.output_tokens,
    chapterTitle: chapter?.title || null,
    counts: chapter ? { sections: chapter.sections.length, keyPoints: chapter.keyPoints.length, cards: practice?.cards.length ?? 0, questions: practice?.questions.length ?? 0, exam: practice?.exam.length ?? 0, review: chapter.needsReview.length } : null,
  };
}

// ------------------------------------------------------------------ list, estimate, create

router.get('/', (req, res) => {
  const rows = req.user.role === 'admin' && req.query.scope === 'all'
    ? all('SELECT * FROM books ORDER BY created_at DESC LIMIT 500')
    : all('SELECT * FROM books WHERE owner_id = ? ORDER BY created_at DESC LIMIT 500', req.user.id);
  const owners = ownersMap();
  res.json({ books: rows.map((b) => shapeBook(b, owners)) });
});

router.get('/estimate', (req, res) => {
  const pages = Math.max(1, Math.min(5000, Number.parseInt(req.query.pages, 10) || 1));
  const model = String(req.query.model || setting('default_model'));
  const unitSize = Math.max(8, Math.min(40, setting('max_unit_pages') * 0.7));
  const count = Math.max(1, Math.ceil(pages / unitSize));
  const est = estimateBook({
    totalPages: pages,
    unitPages: Array.from({ length: count }, () => pages / count),
    depth: String(req.query.depth || 'standard'),
    model,
    scanModel: setting('scan_model'),
    verify: req.query.verify !== '0',
  });
  res.json({ estimate: est, units: count });
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const user = req.userRow;
  const ids = [...new Set(Array.isArray(body.uploadIds) ? body.uploadIds.map(String) : [])];
  if (!ids.length || ids.length > 20) throw bad('Add between 1 and 20 PDF files.');
  const uploads = ids.map((id) => get('SELECT * FROM uploads WHERE id = ? AND owner_id = ? AND book_id IS NULL', id, user.id));
  if (uploads.some((u) => !u)) throw bad('One of the uploaded files is no longer available. Upload it again.');

  const params = validateParams(body.params);
  params.VERIFY = body.verify !== false;

  const dryRun = Boolean(setting('dry_run') || FORCE_MOCK_AI);
  if (!dryRun && apiKeySource() === 'none') throw bad('No API key is configured yet. Ask an administrator to add one under Settings.');

  const allowed = allowedModelsFor(user);
  const model = String(body.model || setting('default_model'));
  if (!allowed.includes(model)) throw bad('That model is not available to you.');
  const scan = setting('scan_model');
  const scanModel = allowed.includes(scan) ? scan : model;

  const totalPages = uploads.reduce((n, u) => n + u.pages, 0);
  const maxPages = user.max_pages_per_book ?? setting('max_pages_per_book');
  if (totalPages > maxPages) throw bad(`These files have ${totalPages} pages in total. Your limit is ${maxPages} pages per book.`);
  const maxActive = user.max_active_books ?? 3;
  const activeNow = get(`SELECT COUNT(*) AS n FROM books WHERE owner_id = ? AND status IN ('queued','running','awaiting')`, user.id).n;
  if (activeNow >= maxActive) throw bad(`You already have ${activeNow} book(s) in progress (limit ${maxActive}). Finish or cancel one first.`);

  if (!dryRun) {
    const limit = user.monthly_budget_usd ?? setting('default_user_budget_usd');
    if (limit > 0) {
      const spent = get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE user_id = ? AND ts >= ?', user.id, monthStartMs()).s;
      if (spent >= limit) throw bad(`Your monthly budget of $${limit.toFixed(2)} is used up.`);
    }
  }
  const budget = dryRun ? 0 : clampNum(body.budgetUsd, 0, 100000, setting('default_book_budget_usd'));

  const id = newId(6);
  const dir = bookDir(id);
  await fsp.mkdir(dir, { recursive: true });
  let counts;
  try {
    counts = await mergePdfs(uploads.map((u) => path.join(UPLOAD_DIR, u.stored_name)), path.join(dir, 'source.pdf'));
  } catch (err) {
    await fsp.rm(dir, { recursive: true, force: true });
    throw err.status ? err : bad('The files could not be combined into one PDF.');
  }

  const t = now();
  const master = activePrompt();
  tx(() => {
    run(
      `INSERT INTO books (id, owner_id, title, slug, params, status, stage, model, scan_model, dry_run, pages_total, budget_usd, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 'audit', ?, ?, ?, ?, ?, ?, ?)`,
      id, user.id, params.BOOK_TITLE, params.SLUG !== 'auto' ? params.SLUG : null, JSON.stringify(params), model, scanModel, dryRun ? 1 : 0, counts.reduce((a, b) => a + b, 0), budget, t, t,
    );
    let first = 1;
    uploads.forEach((u, i) => {
      run('INSERT INTO book_files (book_id, position, original_name, pages, first_page) VALUES (?, ?, ?, ?, ?)', id, i, u.original_name, counts[i], first);
      first += counts[i];
      run('UPDATE uploads SET book_id = ? WHERE id = ?', id, u.id);
    });
    setArtifact(id, 'meta', { promptVersionId: master?.id ?? null, createdBy: user.username });
    setArtifact(id, 'gates', {});
  });
  for (const u of uploads) await fsp.rm(path.join(UPLOAD_DIR, u.stored_name), { force: true });

  logBook(id, 'info', `Book created by ${user.username}: ${uploads.length} file(s), ${totalPages} pages, model ${model}${dryRun ? ' (dry run: no AI calls)' : ''}.`);
  audit(req.user, 'book.create', id, { title: params.BOOK_TITLE, pages: totalPages, model, dryRun }, clientIp(req));
  res.status(201).json({ book: shapeBook(get('SELECT * FROM books WHERE id = ?', id), ownersMap()) });
});

// ------------------------------------------------------------------ detail

router.get('/:id', (req, res) => {
  const book = loadBook(req);
  const units = numberedUnits(book.id);
  const plan = getArtifact(book.id, 'plan');
  res.json({
    book: shapeBook(book, ownersMap()),
    params: JSON.parse(book.params),
    files: all('SELECT original_name AS name, pages, first_page AS firstPage FROM book_files WHERE book_id = ? ORDER BY position', book.id),
    units: units.map(shapeUnit),
    plan: plan ? { ...plan } : null,
    overrides: getArtifact(book.id, 'overrides') || {},
    gates: getArtifact(book.id, 'gates') || {},
    progress: getArtifact(book.id, 'progress'),
    estimate: plan ? estimateForUnits(book, units, plan.tokensPerPage) : null,
    previewable: units.some((u) => u.status === 'done'),
    site: book.built_version === book.content_version && fs.existsSync(path.join(bookDir(book.id), 'site', 'index.html')),
  });
});

router.get('/:id/logs', (req, res) => {
  const book = loadBook(req);
  const after = Number.parseInt(req.query.after, 10) || 0;
  const rows = all('SELECT id, ts, level, message FROM book_logs WHERE book_id = ? AND id > ? ORDER BY id LIMIT 400', book.id, after);
  res.json({ logs: rows });
});

router.get('/:id/prompt', (req, res) => {
  const book = loadBook(req);
  const ctx = bookContext(book.id);
  const meta = getArtifact(book.id, 'meta') || {};
  const master = ctx.system[1].text;
  res.json({
    adapter: ctx.system[0].text,
    paramsBlock: ctx.system[2].text,
    master: { versionId: meta.promptVersionId, characters: master.length },
  });
});

// ------------------------------------------------------------------ gates and edits

function intIn(v, lo, hi) {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

function readUnit(u, total) {
  const title = String(u?.title || '').trim().slice(0, 200);
  if (!title) throw bad('Every unit needs a title.');
  const start = intIn(u.pageStart ?? u.page_start, 1, total);
  const end = intIn(u.pageEnd ?? u.page_end, 1, total);
  if (!start || !end || end < start) throw bad(`"${title}": pages must lie between 1 and ${total}, and the start must not come after the end.`);
  if (end - start + 1 > 100) throw bad(`"${title}" spans more than 100 pages. Split it into parts.`);
  return {
    title,
    start,
    end,
    importance: IMPORTANCE.includes(u.importance) ? u.importance : 'standard',
    icon: CHAPTER_ICONS.includes(u.icon) ? u.icon : 'book-open',
    skip: u.skip ? 1 : 0,
  };
}

router.put('/:id/blueprint', (req, res) => {
  const book = loadBook(req);
  if (book.status !== 'awaiting' || book.gate !== 'blueprint') throw bad('The blueprint can only be edited while it waits for approval.');
  const body = req.body || {};
  const incoming = Array.isArray(body.units) ? body.units : [];
  if (!incoming.length || incoming.length > 300) throw bad('The blueprint needs between 1 and 300 units.');
  const parsed = incoming.map((u) => ({ id: Number(u.id) || null, isPilot: Boolean(u.isPilot), ...readUnit(u, book.pages_total) }));
  if (!parsed.some((u) => !u.skip)) throw bad('Include at least one unit.');

  const existing = new Set(all('SELECT id FROM units WHERE book_id = ?', book.id).map((u) => u.id));
  let pilotIdx = parsed.findIndex((u) => u.isPilot && !u.skip);
  if (pilotIdx < 0) pilotIdx = parsed.findIndex((u) => !u.skip);

  tx(() => {
    const keep = [];
    parsed.forEach((u, i) => {
      const fields = [u.title, u.start, u.end, u.importance, u.icon, u.skip, i === pilotIdx ? 1 : 0];
      if (u.id && existing.has(u.id)) {
        run('UPDATE units SET idx = ?, title = ?, page_start = ?, page_end = ?, importance = ?, icon = ?, skip = ?, is_pilot = ?, updated_at = ? WHERE id = ? AND book_id = ?', i, ...fields, now(), u.id, book.id);
        keep.push(u.id);
      } else {
        const { id } = run(`INSERT INTO units (book_id, idx, title, page_start, page_end, importance, icon, skip, is_pilot, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`, book.id, i, ...fields, now());
        keep.push(id);
      }
    });
    run(`DELETE FROM units WHERE book_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`, book.id, ...keep);

    const overrides = getArtifact(book.id, 'overrides') || {};
    if (typeof body.siteName === 'string') overrides.siteName = body.siteName.trim().slice(0, 60);
    if (typeof body.tagline === 'string') overrides.tagline = body.tagline.trim().slice(0, 160);
    if (['calm-pastel', 'bold-editorial', 'clean-academic'].includes(body.preset)) overrides.preset = body.preset;
    if (body.accent === null || body.accent === '') overrides.accent = null;
    else if (/^#[0-9a-fA-F]{6}$/.test(body.accent || '')) overrides.accent = body.accent;
    if (body.book && typeof body.book === 'object') {
      overrides.book = Object.fromEntries(['edition', 'year', 'publisher'].map((k) => [k, String(body.book[k] ?? '').slice(0, 120)]));
    }
    setArtifact(book.id, 'overrides', overrides);
    if (typeof body.slug === 'string') {
      const slug = slugify(body.slug, '', 48);
      run('UPDATE books SET slug = ? WHERE id = ?', slug || null, book.id);
    }
    run('UPDATE books SET units_total = ?, updated_at = ? WHERE id = ?', parsed.filter((u) => !u.skip).length, now(), book.id);
  });
  audit(req.user, 'book.blueprint', book.id, null, clientIp(req));
  res.json({ ok: true });
});

router.post('/:id/approve', (req, res) => {
  const book = loadBook(req);
  const gate = req.body?.gate;
  if (book.status !== 'awaiting' || book.gate !== gate) throw bad('Nothing is waiting for approval right now.');
  approveGate(book.id, gate);
  audit(req.user, 'book.approve', book.id, { gate }, clientIp(req));
  res.json({ ok: true });
});

router.post('/:id/pilot/redo', (req, res) => {
  const book = loadBook(req);
  if (book.status !== 'awaiting' || book.gate !== 'pilot') throw bad('The pilot can only be redone while it waits for approval.');
  const notes = String(req.body?.notes || '').trim().slice(0, 2000);
  const pilot = get('SELECT * FROM units WHERE book_id = ? AND is_pilot = 1', book.id);
  if (!pilot) throw bad('There is no pilot unit.');
  run("UPDATE units SET chapter = NULL, practice = NULL, step = NULL, status = 'pending', error = NULL, notes = ?, warnings = NULL, updated_at = ? WHERE id = ?", notes, now(), pilot.id);
  run('UPDATE books SET content_version = content_version + 1 WHERE id = ?', book.id);
  queueBook(book.id);
  logBook(book.id, 'info', `Pilot chapter is being rewritten${notes ? ' with your notes' : ''}.`);
  audit(req.user, 'book.pilot_redo', book.id, null, clientIp(req));
  res.json({ ok: true });
});

router.post('/:id/cancel', (req, res) => {
  const book = loadBook(req);
  if (!ACTIVE.includes(book.status)) throw bad('This book is not running.');
  requestCancel(book.id);
  audit(req.user, 'book.cancel', book.id, null, clientIp(req));
  res.json({ ok: true });
});

router.post('/:id/resume', (req, res) => {
  const book = loadBook(req);
  if (!['attention', 'failed', 'cancelled'].includes(book.status)) throw bad('This book does not need to be resumed.');
  queueBook(book.id);
  logBook(book.id, 'info', `Resumed by ${req.user.username}.`);
  audit(req.user, 'book.resume', book.id, null, clientIp(req));
  res.json({ ok: true });
});

router.post('/:id/budget', (req, res) => {
  if (req.user.role !== 'admin') throw forbidden('Only administrators can change a spending limit.');
  const book = loadBook(req);
  const budget = clampNum(req.body?.budgetUsd, 0, 100000, null);
  if (budget === null) throw bad('Enter an amount in dollars.');
  run('UPDATE books SET budget_usd = ?, updated_at = ? WHERE id = ?', budget, now(), book.id);
  logBook(book.id, 'info', `Spending limit set to $${budget.toFixed(2)} by ${req.user.username}.`);
  audit(req.user, 'book.budget', book.id, { budget }, clientIp(req));
  res.json({ ok: true });
});

router.patch('/:id/units/:uid', (req, res) => {
  const book = loadBook(req);
  const unit = get('SELECT * FROM units WHERE id = ? AND book_id = ?', Number(req.params.uid), book.id);
  if (!unit) throw notFound('Unit not found.');
  if (unit.status === 'running') throw bad('This unit is being written right now.');
  const b = req.body || {};
  const merged = readUnit({ title: b.title ?? unit.title, pageStart: b.pageStart ?? unit.page_start, pageEnd: b.pageEnd ?? unit.page_end, importance: b.importance ?? unit.importance, icon: unit.icon, skip: b.skip ?? unit.skip }, book.pages_total);
  const pagesChanged = merged.start !== unit.page_start || merged.end !== unit.page_end;
  const notes = b.notes !== undefined ? String(b.notes).trim().slice(0, 2000) : unit.notes;
  run('UPDATE units SET title = ?, page_start = ?, page_end = ?, importance = ?, skip = ?, notes = ?, updated_at = ? WHERE id = ?', merged.title, merged.start, merged.end, merged.importance, merged.skip, notes, now(), unit.id);
  if (pagesChanged && unit.status !== 'pending') {
    run("UPDATE units SET chapter = NULL, practice = NULL, step = NULL, status = 'pending', error = NULL, warnings = NULL WHERE id = ?", unit.id);
  }
  run('UPDATE books SET content_version = content_version + 1, units_total = (SELECT COUNT(*) FROM units WHERE book_id = ? AND skip = 0), updated_at = ? WHERE id = ?', book.id, now(), book.id);
  res.json({ ok: true });
});

router.post('/:id/units/:uid/retry', (req, res) => {
  const book = loadBook(req);
  const unit = get('SELECT * FROM units WHERE id = ? AND book_id = ?', Number(req.params.uid), book.id);
  if (!unit) throw notFound('Unit not found.');
  if (unit.status === 'running') throw bad('This unit is being written right now.');
  if (book.status === 'awaiting') throw bad('Approve or reject the current gate first.');
  const regenerate = Boolean(req.body?.regenerate);
  const notes = req.body?.notes !== undefined ? String(req.body.notes).trim().slice(0, 2000) : unit.notes;
  if (regenerate) run("UPDATE units SET chapter = NULL, practice = NULL, step = NULL, warnings = NULL, status = 'pending', error = NULL, notes = ?, skip = 0, updated_at = ? WHERE id = ?", notes, now(), unit.id);
  else run("UPDATE units SET status = 'pending', error = NULL, notes = ?, skip = 0, updated_at = ? WHERE id = ?", notes, now(), unit.id);
  run('UPDATE books SET content_version = content_version + 1 WHERE id = ?', book.id);
  if (!ACTIVE.includes(book.status)) queueBook(book.id);
  logBook(book.id, 'info', `Unit "${unit.title}" ${regenerate ? 'will be rewritten' : 'will be retried'}.`);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ output

router.post('/:id/rebuild', async (req, res) => {
  const book = loadBook(req);
  const out = await assembleBook(book.id);
  if (!out) throw bad('No unit is finished yet.');
  audit(req.user, 'book.rebuild', book.id, null, clientIp(req));
  res.json({ ok: true, stats: out.stats });
});

router.get('/:id/download', async (req, res) => {
  const book = loadBook(req);
  if (!(await ensureBuilt(book.id))) throw bad('Nothing to download yet: no unit is finished.');
  const slug = slugify(book.slug || book.title, 'book', 48);
  const folder = `${slug}-study-site`;
  const zip = zipSite(book.id, folder);
  audit(req.user, 'book.download', book.id, { bytes: zip.length }, clientIp(req));
  res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${folder}.zip"`, 'Content-Length': zip.length, 'Cache-Control': 'no-store' });
  res.end(zip);
});

router.delete('/:id', async (req, res) => {
  const book = loadBook(req);
  if (ACTIVE.includes(book.status) && book.status !== 'awaiting') throw bad('Cancel the book before deleting it.');
  if (isActive(book.id)) throw bad('Cancel the book before deleting it.');
  tx(() => {
    run('UPDATE usage_events SET book_id = NULL WHERE book_id = ?', book.id);
    run('DELETE FROM books WHERE id = ?', book.id);
  });
  await fsp.rm(bookDir(book.id), { recursive: true, force: true });
  audit(req.user, 'book.delete', book.id, { title: book.title }, clientIp(req));
  res.json({ ok: true });
});

export default router;
