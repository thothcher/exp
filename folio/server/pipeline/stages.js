import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BOOKS_DIR, ENGINE_DIR } from '../config.js';
import { all, get, getArtifact, now, run, setArtifact } from '../db.js';
import { setting } from '../lib/settings.js';
import { activePrompt } from '../lib/masterPrompt.js';
import { CHAPTER_ICONS } from '../lib/iconNames.js';
import { AiError, callJson } from './ai.js';
import { documentBlock, sliceForApi } from './pdf.js';
import { languageInfo, renderParamsYaml } from './params.js';
import {
  SCAN_SYSTEM, assetsTask, auditTask, bookMapText, buildSystem, chapterTask, planTask, practiceTask, scanTask, uiTask,
} from './prompts.js';
import {
  IMPORTANCE, applyAudit, chapterProblems, normalizeChapter, normalizePractice, normalizeUiStrings, practiceProblems,
} from './normalize.js';
import { mockAssets, mockAudit, mockChapter, mockPlan, mockPractice, mockScan, mockUi } from './mock.js';

export const bookDir = (id) => path.join(BOOKS_DIR, id);
export const sourcePathOf = (id) => path.join(bookDir(id), 'source.pdf');

export function logBook(bookId, level, message) {
  run('INSERT INTO book_logs (book_id, ts, level, message) VALUES (?, ?, ?, ?)', bookId, now(), level, String(message).slice(0, 1000));
}

export function setProgress(bookId, label, done, total) {
  setArtifact(bookId, 'progress', { label, done, total, at: now() });
}

export function uiBase() {
  return JSON.parse(fs.readFileSync(path.join(ENGINE_DIR, 'ui.en.json'), 'utf8'));
}

/** Everything a stage needs about a book, built fresh so blueprint edits are always picked up. */
export function bookContext(bookId, signal) {
  const book = get('SELECT * FROM books WHERE id = ?', bookId);
  if (!book) throw new AiError('Book not found.', 'missing', { fatal: true });
  const params = JSON.parse(book.params);
  const meta = getArtifact(bookId, 'meta') || {};
  const pinned = meta.promptVersionId ? get('SELECT * FROM prompt_versions WHERE id = ?', meta.promptVersionId) : null;
  const master = pinned || activePrompt();
  if (!master) throw new AiError('The master prompt is missing. An administrator can add it under Master prompt.', 'no_prompt', { fatal: true });
  const files = all('SELECT * FROM book_files WHERE book_id = ? ORDER BY position', bookId);
  const plan = getArtifact(bookId, 'plan');
  const overrides = getArtifact(bookId, 'overrides') || {};
  const extra = {
    SITE_NAME: params.SITE_NAME !== 'auto' ? params.SITE_NAME : overrides.siteName || plan?.site_name || 'auto',
    SLUG: params.SLUG !== 'auto' ? params.SLUG : book.slug || 'auto',
  };
  const paramsYaml = renderParamsYaml(params, { sourceNames: files.map((f) => f.original_name), extra });
  return {
    book,
    params,
    plan,
    files,
    lang: languageInfo(params.CONTENT_LANGUAGE),
    depth: params.DEPTH || 'standard',
    verify: params.VERIFY !== false,
    system: buildSystem({ masterBody: master.body, paramsYaml }),
    sourcePath: sourcePathOf(bookId),
    signal,
  };
}

export function numberedUnits(bookId) {
  const rows = all('SELECT * FROM units WHERE book_id = ? ORDER BY idx', bookId);
  let n = 0;
  return rows.map((u) => ({ ...u, number: u.skip ? null : ++n }));
}

// ---------------------------------------------------------------- helpers

function sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AiError('Cancelled.', 'cancelled', { fatal: true }));
    }, { once: true });
  });
}

export async function withRetry(fn, { tries = 4, signal, onRetry } = {}) {
  let delay = 5000;
  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw new AiError('Cancelled.', 'cancelled', { fatal: true });
    try {
      return await fn();
    } catch (err) {
      if (err.code === 'cancelled' || signal?.aborted) throw err;
      if (!err.retryable || attempt >= tries) throw err;
      onRetry?.(err, attempt, delay);
      await sleepAbortable(delay, signal);
      delay = Math.min(delay * 3, 90000);
    }
  }
}

/** Runs `worker` over `items` with limited concurrency. Fatal errors stop the pool; others must be handled by the worker. */
export async function pool(items, concurrency, worker, signal) {
  let next = 0;
  let fatal = null;
  const lane = async () => {
    while (!fatal && !signal?.aborted) {
      const i = next++;
      if (i >= items.length) return;
      try {
        await worker(items[i], i);
      } catch (err) {
        if (err.fatal || err.code === 'cancelled') fatal = fatal || err;
        else throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
  if (fatal) throw fatal;
  if (signal?.aborted) throw new AiError('Cancelled.', 'cancelled', { fatal: true });
}

// ---------------------------------------------------------------- phase 0: scan

export async function runScan(ctx) {
  const { book, signal } = ctx;
  const total = book.pages_total;
  const size = Math.max(5, setting('scan_chunk_pages'));
  const ranges = [];
  for (let a = 1; a <= total; a += size) ranges.push([a, Math.min(total, a + size - 1)]);

  const scan = getArtifact(book.id, 'scan') || { chunks: {}, tokens: 0, pages: 0 };
  const todo = ranges.filter(([a, b]) => !scan.chunks[`${a}-${b}`]);
  let done = ranges.length - todo.length;
  setProgress(book.id, 'Reading the structure of the book', done, ranges.length);
  if (!todo.length) return scan;
  logBook(book.id, 'info', `Scanning ${total} pages in ${ranges.length} part(s) with ${book.scan_model}.`);

  await pool(todo, 3, async ([a, b]) => {
    const key = `${a}-${b}`;
    try {
      const slice = await sliceForApi(ctx.sourcePath, a, b);
      const { value, usage } = await withRetry(
        () => callJson({
          book,
          purpose: 'scan',
          model: book.scan_model,
          system: SCAN_SYSTEM,
          content: [documentBlock(slice.base64, { cache: false }), { type: 'text', text: scanTask({ from: a, to: b, total }) }],
          maxTokens: 12000,
          effort: setting('effort').scan,
          signal,
          mock: () => mockScan({ a, b, total }),
          validate: (v) => (Array.isArray(v.headings) ? [] : ['"headings" must be an array.']),
        }),
        { signal, onRetry: (err, n, d) => logBook(book.id, 'warn', `Scan of pages ${a}-${b}: ${err.message} Retrying in ${Math.round(d / 1000)}s (attempt ${n + 1}).`) },
      );
      scan.chunks[key] = value;
      scan.tokens += usage?.input_tokens || 0;
      scan.pages += b - a + 1;
    } catch (err) {
      if (err.fatal) throw err;
      scan.chunks[key] = { error: err.message };
      logBook(book.id, 'warn', `Could not scan pages ${a}-${b}: ${err.message}`);
    }
    setArtifact(book.id, 'scan', scan);
    setProgress(book.id, 'Reading the structure of the book', ++done, ranges.length);
  }, signal);

  setArtifact(book.id, 'scan', scan);
  return scan;
}

// ---------------------------------------------------------------- phase 1: plan

function planProblems(v) {
  if (!v || !Array.isArray(v.units) || !v.units.length) return ['"units" must be a non-empty array.'];
  const bad = v.units.filter((u) => !Number.isInteger(Number(u.pdf_start)) || !Number.isInteger(Number(u.pdf_end)) || !u.title);
  return bad.length ? [`${bad.length} unit(s) lack a title or integer pdf_start / pdf_end.`] : [];
}

/** Turns the model's unit list into clean, non-overlapping, size-limited units. */
export function cleanUnits(rawUnits, total, maxPages) {
  const sorted = rawUnits
    .map((u) => ({
      title: String(u.title).trim().slice(0, 200),
      start: Math.max(1, Math.min(total, Number.parseInt(u.pdf_start, 10))),
      end: Math.max(1, Math.min(total, Number.parseInt(u.pdf_end, 10))),
      importance: IMPORTANCE.includes(u.importance) ? u.importance : 'standard',
      icon: CHAPTER_ICONS.includes(u.icon) ? u.icon : 'book-open',
      origIndex: rawUnits.indexOf(u),
    }))
    .filter((u) => u.end >= u.start && u.title)
    .sort((a, b) => a.start - b.start);

  const out = [];
  let cursor = 0;
  for (const u of sorted) {
    const start = Math.max(u.start, cursor + 1);
    if (start > u.end) continue;
    cursor = u.end;
    const len = u.end - start + 1;
    if (len <= maxPages) {
      out.push({ ...u, start });
    } else {
      const parts = Math.ceil(len / maxPages);
      const per = Math.ceil(len / parts);
      for (let i = 0; i < parts; i++) {
        const s = start + i * per;
        const e = Math.min(u.end, s + per - 1);
        if (s > e) break;
        out.push({ ...u, title: `${u.title} (${i + 1}/${parts})`, start: s, end: e });
      }
    }
  }
  return out;
}

export async function runPlan(ctx) {
  const { book, signal } = ctx;
  const total = book.pages_total;
  const scan = getArtifact(book.id, 'scan');
  const ordered = Object.entries(scan.chunks)
    .map(([key, v]) => ({ pages: key.split('-').map(Number), v }))
    .sort((a, b) => a.pages[0] - b.pages[0])
    .map(({ pages, v }) => (v.error ? { pages, error: v.error } : { pages, extraction: v.extraction, printed_first: v.printed_page_of_first_pdf_page, kinds: v.kinds, headings: v.headings, contents: v.contents, book: v.book, notes: v.notes }));

  setProgress(book.id, 'Planning the units', 0, 1);
  logBook(book.id, 'info', 'Planning the unit map.');
  const maxUnitPages = setting('max_unit_pages');
  const { value } = await withRetry(
    () => callJson({
      book,
      purpose: 'plan',
      model: book.model,
      system: ctx.system,
      content: [{ type: 'text', text: planTask({ total, scan: ordered, maxUnitPages }) }],
      maxTokens: 24000,
      effort: setting('effort').plan,
      signal,
      mock: () => mockPlan({ total, scan: ordered.map((o) => ({ headings: o.headings })) }),
      validate: planProblems,
    }),
    { signal, onRetry: (err, n) => logBook(book.id, 'warn', `Planning: ${err.message} Retrying (attempt ${n + 1}).`) },
  );

  const units = cleanUnits(value.units, total, maxUnitPages);
  if (!units.length) throw new AiError('The model did not find any usable chapters. Check the PDF, or add units by hand in the blueprint.', 'empty_plan');

  const warnings = Array.isArray(value.warnings) ? value.warnings.map((w) => String(w).slice(0, 300)) : [];
  for (const o of ordered) {
    if (o.error) warnings.push(`Pages ${o.pages[0]}-${o.pages[1]} could not be scanned (${o.error}). Check the units around them.`);
    else if (o.extraction === 'garbled') warnings.push(`Pages ${o.pages[0]}-${o.pages[1]} have a garbled text layer (legacy font). The model reads the page images, but check the results closely.`);
  }

  // pilot: the model's choice, mapped to the first part that came from that unit
  const wanted = Number.parseInt(value.pilot_unit, 10) - 1;
  let pilot = units.findIndex((u) => u.origIndex === wanted && u.importance !== 'supplementary');
  if (pilot < 0) pilot = units.findIndex((u) => u.importance !== 'supplementary');
  if (pilot < 0) pilot = 0;

  const t = now();
  run('DELETE FROM units WHERE book_id = ?', book.id);
  units.forEach((u, i) => {
    run(
      `INSERT INTO units (book_id, idx, title, page_start, page_end, importance, icon, skip, is_pilot, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)`,
      book.id, i, u.title, u.start, u.end, u.importance, u.icon, i === pilot ? 1 : 0, t,
    );
  });

  const plan = {
    book: value.book || {},
    source_type: value.source_type || '',
    subject_type: value.subject_type || '',
    site_name: String(value.site_name || '').slice(0, 60),
    tagline: String(value.tagline || '').slice(0, 160),
    slug: String(value.slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48),
    design: { preset: ['calm-pastel', 'bold-editorial', 'clean-academic'].includes(value.design?.preset) ? value.design.preset : 'calm-pastel', accent: /^#[0-9a-fA-F]{6}$/.test(value.design?.accent || '') ? value.design.accent : null },
    skipped: Array.isArray(value.skipped) ? value.skipped.slice(0, 40).map((s) => ({ pdf_start: Number(s.pdf_start) || 0, pdf_end: Number(s.pdf_end) || 0, reason: String(s.reason || '').slice(0, 200) })) : [],
    warnings,
    tokensPerPage: scan.pages > 0 && scan.tokens > 0 ? Math.round(scan.tokens / scan.pages) : 0,
    generatedAt: now(),
  };
  setArtifact(book.id, 'plan', plan);
  run('UPDATE books SET units_total = ?, slug = COALESCE(NULLIF(slug, \'\'), ?), updated_at = ? WHERE id = ?', units.length, plan.slug || null, now(), book.id);
  logBook(book.id, 'info', `Plan ready: ${units.length} unit(s), pilot is unit ${pilot + 1}.`);
  return plan;
}

// ---------------------------------------------------------------- phase 3: one unit

function styleReference(chapter, practice) {
  const ref = {
    title: chapter.title,
    lead: chapter.lead,
    objectives: chapter.objectives,
    tldr: chapter.tldr,
    sections: chapter.sections.slice(0, 2).map((s) => ({ ...s, blocks: s.blocks.slice(0, 7) })),
    keyPoints: chapter.keyPoints,
    summary: chapter.summary,
    sampleCards: practice.cards.slice(0, 3),
    sampleQuestions: practice.questions.slice(0, 3),
    sampleExamItem: practice.exam.slice(0, 1),
  };
  return JSON.stringify(ref).slice(0, 14000);
}

export function saveStyleReference(bookId) {
  const pilot = get('SELECT * FROM units WHERE book_id = ? AND is_pilot = 1 AND status = ?', bookId, 'done');
  if (!pilot?.chapter || !pilot?.practice) return;
  setArtifact(bookId, 'style', { text: styleReference(JSON.parse(pilot.chapter), JSON.parse(pilot.practice)) });
}

function saveUnit(unitId, fields) {
  const keys = Object.keys(fields);
  run(`UPDATE units SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => fields[k]), now(), unitId);
}

/** Runs the chapter, practice and audit steps for one unit. Steps already stored are skipped, so a retry resumes. */
export async function runUnit(ctx, unitId) {
  const { book, signal } = ctx;
  const all_ = numberedUnits(book.id);
  const unit = all_.find((u) => u.id === unitId);
  if (!unit || unit.skip) return;
  const total = all_.filter((u) => !u.skip).length;
  const style = getArtifact(book.id, 'style')?.text || '';
  const map = bookMapText(all_.filter((u) => !u.skip).map((u) => ({ number: u.number, title: u.title, page_start: u.page_start, page_end: u.page_end })));
  const ctxIcon = unit.icon;

  saveUnit(unit.id, { status: 'running', error: null, attempts: unit.attempts + 1 });
  logBook(book.id, 'info', `Unit ${unit.number}: "${unit.title}" (pages ${unit.page_start}-${unit.page_end}) started.`);

  try {
    const slice = await sliceForApi(ctx.sourcePath, unit.page_start, unit.page_end);
    const doc = documentBlock(slice.base64);
    const onRetry = (err, n, d) => logBook(book.id, 'warn', `Unit ${unit.number}: ${err.message} Retrying in ${Math.round(d / 1000)}s (attempt ${n + 1}).`);
    const warnings = [];

    // -- step 1: chapter
    let chapter = unit.chapter ? JSON.parse(unit.chapter) : null;
    const chapterIsNew = !chapter;
    if (!chapter) {
      setProgress(book.id, `Writing unit ${unit.number} of ${total}`, 0, 1);
      const { value } = await withRetry(
        () => callJson({
          book,
          unitId: unit.id,
          purpose: 'chapter',
          model: book.model,
          system: ctx.system,
          content: [doc, { type: 'text', text: chapterTask({ unit: { ...unit }, total, pdfFrom: slice.from, pdfTo: slice.to, pdfTotal: book.pages_total, depth: ctx.depth, map, styleRef: style, notes: unit.notes }) }],
          maxTokens: 48000,
          effort: setting('effort').chapter,
          signal,
          mock: () => mockChapter({ unit: { ...unit, icon: ctxIcon }, total }),
          validate: chapterProblems,
        }),
        { signal, onRetry },
      );
      const norm = normalizeChapter(value, { unit, totalUnits: total, lang: ctx.lang.code });
      chapter = norm.chapter;
      warnings.push(...norm.warnings);
      saveUnit(unit.id, { chapter: JSON.stringify(chapter), step: 'chapter', practice: null, warnings: JSON.stringify(warnings) });
    } else {
      warnings.push(...(unit.warnings ? JSON.parse(unit.warnings) : []));
    }

    // -- step 2: practice
    let practice = !chapterIsNew && unit.practice ? JSON.parse(unit.practice) : null;
    const practiceIsNew = !practice;
    if (!practice) {
      const examHint = Boolean((ctx.params.EXAM_MATERIALS || '').trim());
      const { value } = await withRetry(
        () => callJson({
          book,
          unitId: unit.id,
          purpose: 'practice',
          model: book.model,
          system: ctx.system,
          content: [doc, { type: 'text', text: practiceTask({ unit, depth: ctx.depth, chapter, pdfFrom: slice.from, pdfTo: slice.to, examHint }) }],
          maxTokens: 32000,
          effort: setting('effort').practice,
          signal,
          mock: () => mockPractice({ chapter }),
          validate: practiceProblems,
        }),
        { signal, onRetry },
      );
      const norm = normalizePractice(value, { keyPointCount: chapter.keyPoints.length, lang: ctx.lang.code });
      practice = norm.practice;
      warnings.push(...norm.warnings);
      saveUnit(unit.id, { practice: JSON.stringify(practice), step: 'practice', warnings: JSON.stringify(warnings) });
    }

    // -- step 3: answer-key audit (optional, never blocks the unit)
    if (ctx.verify && (practiceIsNew || unit.step !== 'audit')) {
      try {
        const { value } = await withRetry(
          () => callJson({
            book,
            unitId: unit.id,
            purpose: 'audit',
            model: book.model,
            system: ctx.system,
            content: [doc, { type: 'text', text: auditTask({ unit, chapter, practice, pdfFrom: slice.from, pdfTo: slice.to }) }],
            maxTokens: 24000,
            effort: setting('effort').audit,
            signal,
            repairs: 1,
            mock: () => mockAudit(),
            validate: (v) => (Array.isArray(v.issues) ? [] : ['"issues" must be an array.']),
          }),
          { signal, onRetry },
        );
        const applied = applyAudit(practice, value, { keyPointCount: chapter.keyPoints.length, lang: ctx.lang.code });
        if (applied.length) logBook(book.id, 'info', `Unit ${unit.number}: audit changed ${applied.length} item(s).`);
        warnings.push(...applied.map((a) => `Audit: ${a}`));
        saveUnit(unit.id, { practice: JSON.stringify(practice), step: 'audit', warnings: JSON.stringify(warnings) });
      } catch (err) {
        if (err.fatal) throw err;
        warnings.push(`The answer-key audit could not run: ${err.message}`);
        logBook(book.id, 'warn', `Unit ${unit.number}: audit skipped (${err.message})`);
      }
    }

    saveUnit(unit.id, { status: 'done', error: null, step: 'done', warnings: JSON.stringify(warnings) });
    run('UPDATE books SET content_version = content_version + 1, units_done = (SELECT COUNT(*) FROM units WHERE book_id = ? AND status = ? AND skip = 0), updated_at = ? WHERE id = ?', book.id, 'done', now(), book.id);
    logBook(book.id, 'info', `Unit ${unit.number} done: ${chapter.keyPoints.length} key points, ${practice.cards.length} cards, ${practice.questions.length} questions, ${practice.exam.length} exam items.`);
  } catch (err) {
    if (err.fatal || err.code === 'cancelled') {
      saveUnit(unit.id, { status: 'pending', error: null });
      throw err;
    }
    saveUnit(unit.id, { status: 'failed', error: String(err.message).slice(0, 500) });
    logBook(book.id, 'error', `Unit ${unit.number} failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------- phase 4: whole-book assets

export async function runAssets(ctx) {
  const { book, signal, lang } = ctx;
  const numbered = numberedUnits(book.id).filter((u) => !u.skip && u.status === 'done' && u.chapter);
  if (!numbered.length) return;
  const digest = numbered.map((u) => {
    const c = JSON.parse(u.chapter);
    return { number: u.number, title: c.title, importance: u.importance, tldr: c.tldr, keyPoints: c.keyPoints, summary: c.summary };
  });
  const hash = createHash('sha256').update(JSON.stringify(digest)).digest('hex');
  const previous = getArtifact(book.id, 'assets');
  const siteNameParam = ctx.params.SITE_NAME !== 'auto' ? ctx.params.SITE_NAME : '';

  if (!previous || previous.hash !== hash) {
    setProgress(book.id, 'Writing the Big Picture page', 0, 1);
    logBook(book.id, 'info', 'Writing the Big Picture page.');
    const { value } = await withRetry(
      () => callJson({
        book,
        purpose: 'assets',
        model: book.model,
        system: ctx.system,
        content: [{ type: 'text', text: assetsTask({ units: digest, siteName: siteNameParam }) }],
        maxTokens: 16000,
        effort: setting('effort').assets,
        signal,
        mock: () => mockAssets({ units: digest }),
        validate: (v) => (Array.isArray(v.coreIdeas) && typeof v.thesis === 'string' ? [] : ['"thesis" (string) and "coreIdeas" (array) are required.']),
      }),
      { signal },
    );
    setArtifact(book.id, 'assets', { hash, ...value });
  }

  const base = uiBase();
  const baseHash = createHash('sha256').update(JSON.stringify(Object.keys(base))).digest('hex');
  const ui = getArtifact(book.id, 'ui');
  if (lang.code === 'en') {
    setArtifact(book.id, 'ui', { lang: 'en', keys: baseHash, strings: base });
  } else if (!ui || ui.lang !== lang.code || ui.keys !== baseHash) {
    setProgress(book.id, 'Translating the interface', 0, 1);
    logBook(book.id, 'info', `Translating the interface to ${ctx.params.CONTENT_LANGUAGE}.`);
    try {
      const { value } = await withRetry(
        () => callJson({
          book,
          purpose: 'assets',
          model: book.model,
          system: ctx.system,
          content: [{ type: 'text', text: uiTask({ language: ctx.params.CONTENT_LANGUAGE, strings: base }) }],
          maxTokens: 16000,
          effort: setting('effort').assets,
          signal,
          mock: () => mockUi({ strings: base }),
          validate: (v) => (v && typeof v === 'object' ? [] : ['Return an object.']),
        }),
        { signal },
      );
      setArtifact(book.id, 'ui', { lang: lang.code, keys: baseHash, strings: normalizeUiStrings(value, base) });
    } catch (err) {
      if (err.fatal) throw err;
      logBook(book.id, 'warn', `Interface translation failed (${err.message}). The site will use English labels.`);
      setArtifact(book.id, 'ui', { lang: 'en', keys: baseHash, strings: base, failedFor: lang.code });
    }
  }
}
