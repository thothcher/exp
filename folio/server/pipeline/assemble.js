import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { ENGINE_DIR, ENGINE_VERSION } from '../config.js';
import { get, getArtifact, run, now } from '../db.js';
import { pad, slugify, words } from '../lib/util.js';
import { languageInfo } from './params.js';
import { buildTokens } from './design.js';
import { bookDir, numberedUnits, uiBase } from './stages.js';

export const siteDir = (bookId) => path.join(bookDir(bookId), 'site');

// ------------------------------------------------------------------ terms

const norm = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[“”„"«»'’]/g, '').replace(/\s+/g, ' ').trim();

function buildGlossary(chapters) {
  const byKey = new Map();
  const byId = new Map();
  const terms = [];
  const uniqueId = (base) => {
    let id = base;
    for (let i = 2; byId.has(id); i++) id = `${base}-${i}`;
    return id;
  };
  const add = (chId, { term, termOriginal = '', definition, aliases = [] }) => {
    const keys = [term, ...aliases].map(norm);
    let entry = keys.map((k) => byKey.get(k)).find(Boolean);
    if (!entry) {
      entry = { id: uniqueId(slugify(term, 'term')), term, termOriginal, definition, aliases: [...aliases], chapter: chId, chapters: [chId], related: [] };
      terms.push(entry);
      byId.set(entry.id, entry);
    } else {
      if (!entry.chapters.includes(chId)) entry.chapters.push(chId);
      for (const a of aliases) if (!entry.aliases.some((x) => norm(x) === norm(a)) && norm(a) !== norm(entry.term)) entry.aliases.push(a);
      if (!entry.termOriginal && termOriginal) entry.termOriginal = termOriginal;
    }
    for (const k of [entry.term, ...entry.aliases].map(norm)) if (!byKey.has(k)) byKey.set(k, entry);
    return entry;
  };
  for (const ch of chapters) {
    ch.termIds = [];
    for (const g of ch.lean.glossary) ch.termIds.push(add(ch.id, g).id);
    for (const s of ch.lean.sections) {
      for (const b of s.blocks) {
        if (b.t === 'define') ch.termIds.push(add(ch.id, { term: b.term, termOriginal: b.termOriginal, definition: b.x }).id);
      }
    }
    ch.termIds = [...new Set(ch.termIds)];
  }
  // related terms: those that appear together in the same chapter
  for (const t of terms) {
    const set = new Set();
    for (const c of t.chapters) for (const other of chapters.find((x) => x.id === c).termIds) if (other !== t.id) set.add(other);
    t.related = [...set].slice(0, 6);
  }
  return { terms, byKey, byId };
}

function linkTerms(text, gl) {
  if (typeof text !== 'string' || !text.includes('[[')) return text;
  // [[id|surface form]]: the engine shows the surface form as written in the text (important for inflected languages)
  return text.replace(/\[\[([^\]|]+)\]\]/g, (_m, t) => {
    const e = gl.byId.get(t) || gl.byKey.get(norm(t));
    return e ? `[[${e.id}|${gl.byId.has(t) ? e.term : t}]]` : t;
  });
}

function linkBlock(b, gl) {
  const L = (t) => linkTerms(t, gl);
  switch (b.t) {
    case 'p': return { ...b, x: L(b.x) };
    case 'list': return { ...b, items: b.items.map(L) };
    case 'steps': return { ...b, items: b.items.map((s) => ({ ...s, x: L(s.x) })) };
    case 'callout': return { ...b, x: L(b.x) };
    case 'recall': return { ...b, q: L(b.q), a: L(b.a) };
    case 'case': return { ...b, scenario: L(b.scenario), question: L(b.question), answer: L(b.answer) };
    case 'define': return { ...b, x: L(b.x) };
    default: return b;
  }
}

function blockText(b) {
  switch (b.t) {
    case 'p': case 'callout': case 'define': case 'quote': return b.x;
    case 'list': return b.items.join(' ');
    case 'steps': return b.items.map((s) => `${s.title} ${s.x}`).join(' ');
    case 'table': return [...b.head, ...b.rows.flat()].join(' ');
    case 'recall': return `${b.q} ${b.a}`;
    case 'case': return `${b.scenario} ${b.question} ${b.answer}`;
    default: return '';
  }
}

function pageRange(sections, unit) {
  const nums = [];
  for (const s of sections) {
    for (const m of String(s.src || '').matchAll(/\d+/g)) nums.push(Number(m[0]));
    for (const b of s.blocks) for (const m of String(b.src || '').matchAll(/\d+/g)) nums.push(Number(m[0]));
  }
  const sane = nums.filter((n) => n > 0 && n < 10000);
  if (sane.length) {
    const lo = Math.min(...sane);
    const hi = Math.max(...sane);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  }
  return unit.page_start === unit.page_end ? String(unit.page_start) : `${unit.page_start}–${unit.page_end}`;
}

// ------------------------------------------------------------------ templates

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escJson = (s) => JSON.stringify(String(s)).slice(1, -1);

function fill(text, map, mode) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_m, key) => {
    const v = map[key];
    if (v === undefined) return '';
    if (key.endsWith('_RAW')) return String(v);
    return mode === 'html' ? escHtml(v) : mode === 'json' ? escJson(v) : String(v);
  });
}

const TEMPLATED = { 'index.html': 'html', '404.html': 'html', 'manifest.webmanifest': 'json', 'sw.js': 'raw', 'package.json': 'json', 'README.md': 'raw', 'CREDITS.md': 'raw' };

function copyEngine(target, map, { georgian }) {
  const walk = (rel = '') => {
    for (const entry of fs.readdirSync(path.join(ENGINE_DIR, rel), { withFileTypes: true })) {
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(path.join(target, r), { recursive: true });
        walk(r);
        continue;
      }
      if (entry.name === 'ui.en.json') continue;
      if (!georgian && /georgian\.woff2$/.test(entry.name)) continue;
      const mode = TEMPLATED[r.replace(/\\/g, '/')];
      if (mode) fs.writeFileSync(path.join(target, r), fill(fs.readFileSync(path.join(ENGINE_DIR, r), 'utf8'), map, mode));
      else fs.copyFileSync(path.join(ENGINE_DIR, r), path.join(target, r));
    }
  };
  walk();
}

function listFiles(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(dir, r));
    else out.push(r);
  }
  return out;
}

// ------------------------------------------------------------------ assembly

const builds = new Map();

/** Builds (or rebuilds) the site folder for a book. Returns null when no unit is finished yet. */
export function assembleBook(bookId) {
  const prev = builds.get(bookId) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => doAssemble(bookId));
  builds.set(bookId, next);
  return next;
}

function doAssemble(bookId) {
  const book = get('SELECT * FROM books WHERE id = ?', bookId);
  if (!book) return null;
  const params = JSON.parse(book.params);
  const plan = getArtifact(bookId, 'plan') || {};
  const overrides = getArtifact(bookId, 'overrides') || {};
  const assets = getArtifact(bookId, 'assets');
  const uiArtifact = getArtifact(bookId, 'ui');
  const lang = languageInfo(params.CONTENT_LANGUAGE);
  const units = numberedUnits(bookId).filter((u) => !u.skip && u.status === 'done' && u.chapter && u.practice);
  if (!units.length) return null;

  const design = buildTokens({ preset: overrides.preset || plan.design?.preset, accent: overrides.accent ?? plan.design?.accent });
  const slug = book.slug || slugify(params.BOOK_TITLE, 'book');
  const siteName = overrides.siteName || (params.SITE_NAME !== 'auto' ? params.SITE_NAME : assets?.site_name || plan.site_name || params.BOOK_TITLE).slice(0, 60);
  const tagline = overrides.tagline || assets?.tagline || plan.tagline || '';
  const info = { ...(plan.book || {}), ...(overrides.book || {}) };

  // 1. chapters
  const chapters = units.map((u) => {
    const lean = JSON.parse(u.chapter);
    const practice = JSON.parse(u.practice);
    const id = `ch${pad(u.number)}`;
    return { unit: u, number: u.number, id, lean, practice, slug: slugify(lean.title, `chapter-${u.number}`, 40) };
  });
  const byNumber = new Map(chapters.map((c) => [c.number, c.id]));
  const gl = buildGlossary(chapters);

  const chapterFiles = [];
  const cards = [];
  const questions = [];
  const exam = [];
  let wordsTotal = 0;
  const reviewItems = [];

  chapters.forEach((c, i) => {
    const sections = c.lean.sections.map((s, si) => ({
      id: `${c.id}-s${si + 1}`,
      heading: s.heading,
      src: s.src,
      blocks: s.blocks.map((b) => linkBlock(b, gl)),
    }));
    const fullWords = sections.reduce((n, s) => n + s.blocks.reduce((m, b) => m + words(blockText(b)), 0), 0);
    wordsTotal += fullWords;
    const kpIds = c.lean.keyPoints.map((_, k) => `${c.id}-k${k + 1}`);
    const kpMap = (list) => (list || []).map((n) => kpIds[n - 1]).filter(Boolean);
    const toneName = design.toneNames[i % design.toneNames.length];

    for (const n of c.lean.needsReview) reviewItems.push({ chapter: c.id, title: c.lean.title, ...n });
    for (const s of sections) for (const b of s.blocks) if (b.needsReview) reviewItems.push({ chapter: c.id, title: c.lean.title, where: s.heading, what: b.needsReview });

    const file = `chapters/${pad(c.number)}-${c.slug}.json`;
    c.meta = {
      id: c.id,
      number: c.number,
      slug: c.slug,
      file,
      title: c.lean.title,
      lead: c.lean.lead,
      minutes: Math.max(1, Math.ceil(fullWords / 150)),
      importance: c.unit.importance,
      tone: toneName,
      icon: c.lean.icon,
      pages: pageRange(c.lean.sections, c.unit),
      counts: { cards: c.practice.cards.length, questions: c.practice.questions.length, exam: c.practice.exam.length },
    };
    chapterFiles.push({
      file,
      data: {
        ...c.meta,
        src: { pages: c.meta.pages },
        objectives: c.lean.objectives,
        tldr: c.lean.tldr,
        sections,
        keyPoints: c.lean.keyPoints.map((x, k) => ({ id: kpIds[k], x })),
        summary: c.lean.summary,
        mistakes: c.lean.mistakes,
        related: c.lean.related.map((n) => byNumber.get(n)).filter(Boolean),
        terms: c.termIds,
        needsReview: c.lean.needsReview,
      },
    });
    c.practice.cards.forEach((card, k) => cards.push({ id: `c-${c.id}-${pad(k + 1, 3)}`, ch: c.id, ...card, kp: kpMap(card.kp) }));
    c.practice.questions.forEach((q, k) => questions.push({ id: `q-${c.id}-${pad(k + 1, 3)}`, ch: c.id, ...q, kp: kpMap(q.kp) }));
    c.practice.exam.forEach((e, k) => exam.push({ id: `e-${c.id}-${pad(k + 1)}`, ch: [c.id], ...e }));
  });

  // 2. big picture
  const recap = (assets?.recap || [])
    .map((r) => ({ ch: byNumber.get(Number(r.unit)), text: String(r.text || '') }))
    .filter((r) => r.ch && r.text);
  const bigPicture = assets
    ? { thesis: assets.thesis || '', coreIdeas: assets.coreIdeas || [], howChaptersConnect: assets.howChaptersConnect || '', recap }
    : { thesis: '', coreIdeas: [], howChaptersConnect: '', recap: chapters.map((c) => ({ ch: c.id, text: c.lean.summary })) };

  const features = { ...params.FEATURES };
  const stats = {
    chapters: chapters.length,
    cards: cards.length,
    questions: questions.length,
    exam: exam.length,
    terms: gl.terms.length,
    needsReview: reviewItems.length,
    words: wordsTotal,
    minutes: chapters.reduce((n, c) => n + c.meta.minutes, 0),
  };

  const bookJson = {
    schema: 1,
    engine: ENGINE_VERSION,
    slug,
    siteName,
    tagline,
    title: params.BOOK_TITLE,
    authors: params.AUTHORS,
    subject: params.SUBJECT,
    edition: info.edition || '',
    year: info.year || '',
    publisher: info.publisher || '',
    language: lang.code,
    dir: lang.dir,
    visibility: params.VISIBILITY,
    gamification: params.GAMIFICATION,
    theme: params.THEME,
    footerCredit: params.FOOTER_CREDIT,
    feedbackContact: params.FEEDBACK_CONTACT,
    features,
    design: { preset: design.preset, accent: design.accent },
    generatedAt: new Date().toISOString(),
    model: book.model,
    partial: units.length < get('SELECT COUNT(*) AS n FROM units WHERE book_id = ? AND skip = 0', bookId).n,
    stats,
    bigPicture,
    chapters: chapters.map((c) => c.meta),
  };

  const searchIndex = {
    v: 1,
    lang: lang.code,
    chapters: chapterFiles.map((f) => ({
      id: f.data.id,
      t: f.data.title,
      l: f.data.lead,
      h: f.data.sections.map((s) => ({ id: s.id, t: s.heading })),
      k: f.data.keyPoints.map((k) => k.x),
      d: f.data.tldr,
    })),
    terms: gl.terms.map((t) => ({ id: t.id, t: t.term, o: t.termOriginal, d: t.definition, a: t.aliases })),
    cards: cards.map((c) => ({ id: c.id, ch: c.ch, t: c.front })),
  };

  const ui = { lang: uiArtifact?.lang || 'en', dir: lang.dir, strings: uiArtifact?.strings || uiBase() };

  // 3. write to a temp dir, then swap
  const root = bookDir(bookId);
  const tmp = path.join(root, `site-build-${Date.now()}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'content', 'chapters'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
  const write = (rel, data) => fs.writeFileSync(path.join(tmp, rel), typeof data === 'string' ? data : JSON.stringify(data), 'utf8');

  write('content/book.json', JSON.stringify(bookJson, null, 1));
  for (const f of chapterFiles) write(`content/${f.file}`, f.data);
  write('content/cards.json', cards);
  write('content/questions.json', questions);
  write('content/exam.json', exam);
  write('content/glossary.json', gl.terms);
  write('content/ui.json', ui);
  write('search-index.json', searchIndex);
  write('docs/REPORT.md', reportMarkdown({ book, params, plan, chapters, stats, reviewItems }));

  const georgian = lang.code === 'ka';
  const description = tagline || `Study site for ${params.BOOK_TITLE}`;
  const preloads = (georgian ? ['sans-georgian', 'serif-georgian'] : ['sans-latin', 'serif-latin'])
    .map((f) => `<link rel="preload" href="assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n  ');

  const map = {
    LANG: lang.code,
    DIR: lang.dir,
    SITE_NAME: siteName,
    SLUG: slug,
    DESCRIPTION: description,
    THEME_COLOR: design.themeColor,
    BOOK_TITLE: params.BOOK_TITLE,
    AUTHORS: params.AUTHORS,
    SUBJECT: params.SUBJECT,
    ENGINE_VERSION,
    GENERATED_DATE: new Date().toISOString().slice(0, 10),
    FONT_PRELOADS_RAW: preloads,
    VERSION: '',
    PRECACHE_RAW: '[]',
  };
  copyEngine(tmp, map, { georgian });
  write('css/tokens.css', design.css);

  // service worker: precache the whole shell and all content, version = content hash
  const files = listFiles(tmp).filter((f) => !/^(docs\/|README\.md|CREDITS\.md|server\.js|start\.bat|package\.json|sw\.js|\.)/.test(f));
  const version = createHash('sha256').update(JSON.stringify([ENGINE_VERSION, book.content_version, files.length, bookJson.generatedAt])).digest('hex').slice(0, 10);
  const precache = ['./', ...files.map((f) => `./${f}`)];
  const swPath = path.join(tmp, 'sw.js');
  fs.writeFileSync(swPath, fill(fs.readFileSync(path.join(ENGINE_DIR, 'sw.js'), 'utf8'), { ...map, VERSION: `${slug}-${version}`, PRECACHE_RAW: JSON.stringify(precache) }, 'raw'));

  const finalDir = siteDir(bookId);
  fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(tmp, finalDir);
  run('UPDATE books SET built_version = ?, updated_at = ? WHERE id = ?', book.content_version, now(), bookId);
  return { dir: finalDir, stats, slug };
}

function reportMarkdown({ book, params, plan, chapters, stats, reviewItems }) {
  const lines = [];
  lines.push(`# Coverage report: ${params.BOOK_TITLE}`, '', `Generated ${new Date().toISOString().slice(0, 10)} by Folio with ${book.model}.`, '');
  lines.push(`${stats.chapters} chapters, ${stats.cards} flashcards, ${stats.questions} questions, ${stats.exam} exam items, ${stats.terms} glossary terms.`, '');
  lines.push('## Chapters', '', '| # | Title | PDF pages | Importance | Cards | Questions | Exam |', '|---|---|---|---|---|---|---|');
  for (const c of chapters) lines.push(`| ${c.number} | ${c.lean.title.replace(/\|/g, '/')} | ${c.unit.page_start}–${c.unit.page_end} | ${c.unit.importance} | ${c.practice.cards.length} | ${c.practice.questions.length} | ${c.practice.exam.length} |`);
  if (plan.skipped?.length) {
    lines.push('', '## Skipped on purpose', '');
    for (const s of plan.skipped) lines.push(`- PDF pages ${s.pdf_start}–${s.pdf_end}: ${s.reason}`);
  }
  lines.push('', '## Needs review', '');
  if (!reviewItems.length) lines.push('Nothing was flagged.');
  for (const r of reviewItems) lines.push(`- Chapter ${r.title}${r.where ? ` (${r.where})` : ''}: ${r.what}`);
  lines.push('');
  return lines.join('\n');
}

// ------------------------------------------------------------------ build state and zip

export async function ensureBuilt(bookId) {
  const book = get('SELECT content_version, built_version FROM books WHERE id = ?', bookId);
  if (!book) return null;
  if (book.built_version !== book.content_version || !fs.existsSync(path.join(siteDir(bookId), 'index.html'))) return assembleBook(bookId);
  return { dir: siteDir(bookId) };
}

export function zipSite(bookId, folderName) {
  const dir = siteDir(bookId);
  const entries = {};
  for (const rel of listFiles(dir)) entries[`${folderName}/${rel}`] = [new Uint8Array(fs.readFileSync(path.join(dir, rel))), { level: /\.(woff2|png|jpe?g)$/.test(rel) ? 0 : 6 }];
  return Buffer.from(zipSync(entries));
}
