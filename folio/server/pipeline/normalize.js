import sanitizeHtml from 'sanitize-html';
import { CHAPTER_ICONS } from '../lib/iconNames.js';
import { stripTags, words } from '../lib/util.js';

export const CALLOUT_KINDS = ['remember', 'example', 'pitfall', 'myth', 'study', 'mnemonic', 'exam', 'think'];
export const CARD_TYPES = ['term', 'why', 'compare', 'cloze', 'apply'];
export const BLOOM = ['remember', 'understand', 'apply', 'analyse'];
export const IMPORTANCE = ['core', 'standard', 'supplementary'];

const QUOTES = {
  ka: ['„', '“'], de: ['„', '“'], cs: ['„', '“'], pl: ['„', '”'],
  ru: ['«', '»'], uk: ['«', '»'], fr: ['« ', ' »'], es: ['«', '»'], it: ['«', '»'], tr: ['“', '”'], en: ['“', '”'],
};

/** Replaces straight double quotes by the typographic pair of the content language (master §5). */
export function smartQuotes(text, lang = 'en') {
  const [open, close] = QUOTES[lang] || QUOTES.en;
  let isOpen = true;
  return text.replace(/"/g, () => {
    const q = isOpen ? open : close;
    isOpen = !isOpen;
    return q;
  });
}

const MOJIBAKE = /áƒ|á‚|Ã©|Ã¡|Ã³|Ã¶|Ã¼|Ð°|Ð¿|Ñ‚|�/;
export const hasMojibake = (text) => MOJIBAKE.test(text);

export function cleanText(value, { max = 4000, lang = 'en' } = {}) {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  s = stripTags(s).replace(/&nbsp;/g, ' ').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  s = smartQuotes(s, lang);
  return s.length > max ? s.slice(0, max).trim() : s;
}

const list = (v) => (Array.isArray(v) ? v : []);
const strList = (v, opts) => list(v).map((x) => cleanText(x, opts)).filter(Boolean);

// ----------------------------------------------------------------- SVG

const SVG_TAGS = ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc'];
const SVG_ATTRS = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'points', 'fill', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'font-size', 'font-weight',
  'font-style', 'text-anchor', 'dominant-baseline', 'id', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
  'markerUnits', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'preserveAspectRatio', 'role', 'aria-label', 'aria-hidden', 'dx', 'dy',
  'fill-rule', 'clip-rule', 'letter-spacing', 'xmlns',
]);
const COLOR_VALUE = /^(none|currentColor|transparent|#[0-9a-fA-F]{3,8}|var\(--(accent|ink|muted|line|surface-2|surface|ok|bad)\))$/;
const URL_REF = /^url\(#[A-Za-z0-9_-]+\)$/;
const SAFE_NUMBER_LIST = /^[0-9eE+\-.,\s%]*$/;
const SAFE_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;
const SAFE_TRANSFORM = /^[a-zA-Z0-9eE+\-.,()\s]*$/;

function cleanSvgAttr(name, value) {
  if (!SVG_ATTRS.has(name)) return null;
  const v = String(value).trim();
  if (v.length > 4000) return null;
  if (name === 'fill' || name === 'stroke' || name === 'stop-color') return COLOR_VALUE.test(v) || (name !== 'stop-color' && URL_REF.test(v)) ? v : null;
  if (name === 'marker-end' || name === 'marker-start') return URL_REF.test(v) ? v : null;
  if (name === 'd') return SAFE_PATH.test(v) ? v : null;
  if (name === 'transform') return SAFE_TRANSFORM.test(v) ? v : null;
  if (name === 'id') return /^[A-Za-z][A-Za-z0-9_-]{0,40}$/.test(v) ? v : null;
  if (['role', 'aria-label', 'font-style', 'font-weight', 'text-anchor', 'dominant-baseline', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule', 'orient', 'markerUnits', 'gradientUnits', 'preserveAspectRatio', 'aria-hidden', 'xmlns'].includes(name)) {
    return /^[A-Za-z0-9 :/.\-,'’“”„]*$/.test(v) ? v : null;
  }
  return SAFE_NUMBER_LIST.test(v) ? v : null;
}

/** Strict allowlist sanitizer: SVG is the only markup the model may produce, and it is rendered inline by the engine. */
export function sanitizeSvg(svg) {
  if (typeof svg !== 'string') return '';
  const raw = svg.trim();
  if (!raw.startsWith('<svg') || raw.length > 14000) return '';
  const clean = sanitizeHtml(raw, {
    allowedTags: SVG_TAGS,
    allowedAttributes: false,
    disallowedTagsMode: 'discard',
    parser: { xmlMode: true, lowerCaseTags: false, lowerCaseAttributeNames: false, decodeEntities: true },
    transformTags: {
      '*': (tagName, attribs) => {
        const out = {};
        for (const [k, v] of Object.entries(attribs)) {
          const cleaned = cleanSvgAttr(k, v);
          if (cleaned !== null) out[k] = cleaned;
        }
        if (tagName === 'svg') {
          out.xmlns = 'http://www.w3.org/2000/svg';
          out.role = out.role || 'img';
        }
        return { tagName, attribs: out };
      },
    },
  }).trim();
  if (!clean.startsWith('<svg') || !/viewBox="[0-9.\s,-]+"/.test(clean)) return '';
  return clean;
}

// ----------------------------------------------------------------- blocks

function common(raw, out, opts) {
  const src = cleanText(raw.src, { max: 60, lang: opts.lang });
  if (src) out.src = src;
  if (raw.origin === 'ours') out.origin = 'ours';
  const nr = cleanText(raw.needsReview, { max: 300, lang: opts.lang });
  if (nr) out.needsReview = nr;
  const sn = cleanText(raw.sourceNote, { max: 300, lang: opts.lang });
  if (sn) out.sourceNote = sn;
  return out;
}

export function normalizeBlock(raw, opts) {
  if (!raw || typeof raw !== 'object') return null;
  const t = String(raw.t || '').toLowerCase();
  const o = (v, max = 2000) => cleanText(v, { max, lang: opts.lang });
  const depth = raw.depth === 'core' ? 'core' : 'full';
  switch (t) {
    case 'p': {
      const x = o(raw.x, 4000);
      return x ? common(raw, { t, depth, x }, opts) : null;
    }
    case 'list': {
      const items = strList(raw.items, { max: 600, lang: opts.lang });
      return items.length ? common(raw, { t, depth, style: raw.style === 'numbers' ? 'numbers' : 'bullets', items }, opts) : null;
    }
    case 'steps': {
      const items = list(raw.items).map((s) => ({ title: o(s?.title, 160), x: o(s?.x, 800) })).filter((s) => s.title || s.x);
      return items.length ? common(raw, { t, depth, items }, opts) : null;
    }
    case 'table': {
      const head = strList(raw.head, { max: 160, lang: opts.lang });
      const rows = list(raw.rows).map((r) => list(r).map((c) => o(c, 500))).filter((r) => r.length);
      if (!rows.length) return null;
      const cols = Math.max(head.length, ...rows.map((r) => r.length));
      const fix = (r) => Array.from({ length: cols }, (_, i) => r[i] ?? '');
      return common(raw, { t, depth, caption: o(raw.caption, 200), head: head.length ? fix(head) : [], rows: rows.map(fix), compare: Boolean(raw.compare) }, opts);
    }
    case 'figure': {
      const alt = o(raw.alt, 600);
      const svg = sanitizeSvg(raw.svg);
      if (!alt && !svg) return null;
      return common(raw, { t, depth, alt, caption: o(raw.caption, 300), svg }, opts);
    }
    case 'callout': {
      const x = o(raw.x, 800);
      if (!x) return null;
      return common(raw, { t, kind: CALLOUT_KINDS.includes(raw.kind) ? raw.kind : 'remember', title: o(raw.title, 120), x, depth }, opts);
    }
    case 'define': {
      const term = o(raw.term, 160);
      const x = o(raw.x, 600);
      return term && x ? common(raw, { t, depth, term, termOriginal: o(raw.termOriginal, 160), x }, opts) : null;
    }
    case 'recall': {
      const q = o(raw.q, 500);
      const a = o(raw.a, 900);
      return q && a ? common(raw, { t, depth, q, a }, opts) : null;
    }
    case 'quote': {
      const x = o(raw.x, 600);
      return x ? common(raw, { t, depth, x, by: o(raw.by, 160), page: o(raw.page, 40) }, opts) : null;
    }
    case 'case': {
      const scenario = o(raw.scenario, 1200);
      const question = o(raw.question, 400);
      const answer = o(raw.answer, 1200);
      return scenario && question && answer ? common(raw, { t, depth, scenario, question, answer }, opts) : null;
    }
    case 'formula': {
      const tex = cleanText(raw.tex, { max: 600, lang: 'en' });
      return tex ? common(raw, { t, depth, tex, where: strList(raw.where, { max: 200, lang: opts.lang }) }, opts) : null;
    }
    default:
      return null;
  }
}

// ----------------------------------------------------------------- chapter

/** Structural check used by the repair loop: returns problems the model should fix. */
export function chapterProblems(raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') return ['The reply must be a JSON object.'];
  if (!Array.isArray(raw.sections) || !raw.sections.length) p.push('"sections" must be a non-empty array.');
  else if (!raw.sections.some((s) => Array.isArray(s?.blocks) && s.blocks.length)) p.push('Sections need a "blocks" array with content.');
  if (!Array.isArray(raw.keyPoints) || !raw.keyPoints.length) p.push('"keyPoints" must be a non-empty array of strings.');
  if (!Array.isArray(raw.tldr) || !raw.tldr.length) p.push('"tldr" must be a non-empty array of strings.');
  if (typeof raw.title !== 'string' || !raw.title.trim()) p.push('"title" is required.');
  return p;
}

export function normalizeChapter(raw, { unit, totalUnits, lang }) {
  const opts = { lang };
  const warnings = [];
  const blocksCount = { total: 0, dropped: 0 };

  const sections = list(raw.sections)
    .map((s) => {
      const blocks = list(s?.blocks).map((b) => {
        blocksCount.total++;
        const n = normalizeBlock(b, opts);
        if (!n) blocksCount.dropped++;
        return n;
      }).filter(Boolean);
      return { heading: cleanText(s?.heading, { max: 200, lang }), src: cleanText(s?.src, { max: 60, lang }), blocks };
    })
    .filter((s) => s.blocks.length);

  if (blocksCount.dropped) warnings.push(`${blocksCount.dropped} of ${blocksCount.total} content blocks were invalid and dropped.`);
  for (const s of sections) if (!s.heading) s.heading = unit.title;

  const keyPoints = strList(raw.keyPoints, { max: 400, lang });
  const tldr = strList(raw.tldr, { max: 200, lang }).slice(0, 6);
  tldr.forEach((b, i) => words(b) > 30 && warnings.push(`TL;DR bullet ${i + 1} is long (${words(b)} words).`));
  const summary = cleanText(raw.summary, { max: 800, lang });
  if (words(summary) > 120) warnings.push(`The summary is long (${words(summary)} words).`);

  const related = [...new Set(list(raw.related).map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= totalUnits && n !== unit.number))];

  const glossary = list(raw.glossary)
    .map((g) => ({
      term: cleanText(g?.term, { max: 160, lang }),
      termOriginal: cleanText(g?.termOriginal, { max: 160, lang }),
      definition: cleanText(g?.definition, { max: 400, lang }),
      aliases: strList(g?.aliases, { max: 120, lang }).slice(0, 6),
    }))
    .filter((g) => g.term && g.definition);

  const needsReview = list(raw.needsReview)
    .map((n) => ({ where: cleanText(n?.where, { max: 120, lang }), what: cleanText(n?.what, { max: 300, lang }) }))
    .filter((n) => n.what);

  const chapter = {
    title: cleanText(raw.title, { max: 200, lang }) || unit.title,
    lead: cleanText(raw.lead, { max: 400, lang }),
    icon: CHAPTER_ICONS.includes(raw.icon) ? raw.icon : unit.icon && CHAPTER_ICONS.includes(unit.icon) ? unit.icon : 'book-open',
    objectives: strList(raw.objectives, { max: 240, lang }).slice(0, 8),
    tldr,
    sections,
    keyPoints,
    summary,
    mistakes: strList(raw.mistakes, { max: 300, lang }).slice(0, 8),
    related,
    glossary,
    needsReview,
  };
  const blob = JSON.stringify(chapter);
  if (hasMojibake(blob)) warnings.push('Possible encoding damage (mojibake) found in the text. Check the source PDF text layer.');
  return { chapter, warnings };
}

// ----------------------------------------------------------------- practice

export function practiceProblems(raw) {
  const p = [];
  if (!raw || typeof raw !== 'object') return ['The reply must be a JSON object.'];
  if (!Array.isArray(raw.cards) || !raw.cards.length) p.push('"cards" must be a non-empty array.');
  if (!Array.isArray(raw.questions) || !raw.questions.length) p.push('"questions" must be a non-empty array.');
  if (!Array.isArray(raw.exam)) p.push('"exam" must be an array.');
  return p;
}

function kpList(v, keyPointCount) {
  return [...new Set(list(v).map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 1 && n <= keyPointCount))];
}

export function normalizeCard(raw, keyPointCount, lang) {
  const front = cleanText(raw?.front, { max: 400, lang });
  const back = cleanText(raw?.back, { max: 700, lang });
  if (!front || !back) return null;
  const card = { type: CARD_TYPES.includes(raw.type) ? raw.type : 'term', front, back, kp: kpList(raw.kp, keyPointCount) };
  const src = cleanText(raw.src, { max: 60, lang });
  if (src) card.src = src;
  if (raw.origin === 'ours') card.origin = 'ours';
  return card;
}

export function normalizeQuestion(raw, keyPointCount, lang) {
  const type = ['mcq', 'tf', 'multi', 'cloze'].includes(raw?.type) ? raw.type : 'mcq';
  const stem = cleanText(raw?.stem, { max: 700, lang });
  const explain = cleanText(raw?.explain, { max: 600, lang });
  if (!stem) return null;
  const q = { type, stem, explain };
  if (type === 'tf') {
    if (typeof raw.answer !== 'boolean') return null;
    q.answer = raw.answer;
  } else {
    const options = [];
    const seen = new Set();
    for (const o of list(raw.options)) {
      const t = cleanText(o, { max: 300, lang });
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase());
        options.push(t);
      }
    }
    if (options.length < 3) return null;
    q.options = options.slice(0, 6);
    if (type === 'multi') {
      q.answers = [...new Set(list(raw.answers).map((n) => Number.parseInt(n, 10)).filter((n) => Number.isInteger(n) && n >= 0 && n < q.options.length))];
      if (q.answers.length < 1) return null;
      q.fixedOrder = true;
    } else if (raw.fixedOrder && Number.isInteger(raw.answer) && raw.answer >= 0 && raw.answer < q.options.length) {
      q.fixedOrder = true;
      q.answer = raw.answer;
    }
    if (raw.whyWrong && typeof raw.whyWrong === 'object') {
      const ww = {};
      for (const [k, v] of Object.entries(raw.whyWrong)) {
        const idx = Number.parseInt(k, 10);
        const t = cleanText(v, { max: 300, lang });
        if (Number.isInteger(idx) && idx >= 0 && idx < q.options.length && t) ww[idx] = t;
      }
      if (Object.keys(ww).length) q.whyWrong = ww;
    }
  }
  q.difficulty = Math.min(3, Math.max(1, Number.parseInt(raw.difficulty, 10) || 2));
  q.bloom = BLOOM.includes(raw.bloom) ? raw.bloom : 'understand';
  q.kp = kpList(raw.kp, keyPointCount);
  const src = cleanText(raw.src, { max: 60, lang });
  if (src) q.src = src;
  if (raw.origin === 'ours') q.origin = 'ours';
  return q;
}

export function normalizeExam(raw, keyPointCount, lang) {
  const prompt = cleanText(raw?.prompt, { max: 800, lang });
  const modelAnswer = cleanText(raw?.modelAnswer, { max: 1800, lang });
  if (!prompt || !modelAnswer) return null;
  return {
    prompt,
    modelAnswer,
    keyPoints: strList(raw.keyPoints, { max: 300, lang }).slice(0, 10),
    marks: Math.min(100, Math.max(1, Number.parseInt(raw.marks, 10) || 5)),
    source: raw.source === 'provided' ? 'provided' : 'predicted',
  };
}

export function normalizePractice(raw, { keyPointCount, lang }) {
  const warnings = [];
  const cards = list(raw.cards).map((c) => normalizeCard(c, keyPointCount, lang)).filter(Boolean);
  const questions = list(raw.questions).map((q) => normalizeQuestion(q, keyPointCount, lang)).filter(Boolean);
  const exam = list(raw.exam).map((e) => normalizeExam(e, keyPointCount, lang)).filter(Boolean);

  const droppedCards = list(raw.cards).length - cards.length;
  const droppedQ = list(raw.questions).length - questions.length;
  if (droppedCards) warnings.push(`${droppedCards} flashcard(s) were invalid and dropped.`);
  if (droppedQ) warnings.push(`${droppedQ} question(s) were invalid and dropped.`);
  cards.forEach((c, i) => words(c.back) > 50 && warnings.push(`Card ${i + 1} has a long back (${words(c.back)} words).`));

  for (let k = 1; k <= keyPointCount; k++) {
    if (!cards.some((c) => c.kp.includes(k))) warnings.push(`Key point ${k} has no flashcard.`);
    if (!questions.some((q) => q.kp.includes(k))) warnings.push(`Key point ${k} has no question.`);
  }
  return { practice: { cards, questions, exam }, warnings };
}

/** Applies the audit pass: replaces or removes flagged items. Returns the fixes that were applied. */
export function applyAudit(practice, audit, { keyPointCount, lang }) {
  const applied = [];
  const removals = { card: new Set(), question: new Set(), exam: new Set() };
  const arrays = { card: practice.cards, question: practice.questions, exam: practice.exam };
  const normalizers = { card: normalizeCard, question: normalizeQuestion, exam: normalizeExam };

  for (const issue of list(audit?.issues)) {
    const kind = issue?.item;
    const arr = arrays[kind];
    const idx = Number.parseInt(issue?.index, 10);
    if (!arr || !Number.isInteger(idx) || idx < 0 || idx >= arr.length) continue;
    if (issue.action === 'remove') {
      removals[kind].add(idx);
      applied.push(`Removed ${kind} ${idx + 1}: ${cleanText(issue.problem, { max: 160, lang })}`);
    } else if (issue.action === 'replace' && issue.replacement) {
      const fixed = normalizers[kind](issue.replacement, keyPointCount, lang);
      if (fixed) {
        if (kind !== 'exam' && !fixed.kp?.length) fixed.kp = arr[idx].kp;
        arr[idx] = fixed;
        applied.push(`Fixed ${kind} ${idx + 1}: ${cleanText(issue.problem, { max: 160, lang })}`);
      }
    }
  }
  practice.cards = practice.cards.filter((_, i) => !removals.card.has(i));
  practice.questions = practice.questions.filter((_, i) => !removals.question.has(i));
  practice.exam = practice.exam.filter((_, i) => !removals.exam.has(i));
  return applied;
}

export function normalizeUiStrings(raw, base) {
  const out = {};
  for (const [key, english] of Object.entries(base)) {
    const v = raw && typeof raw[key] === 'string' ? cleanText(raw[key], { max: 300, lang: 'en' }).replace(/\n+/g, ' ') : '';
    // keep placeholders intact: fall back to English when one went missing
    const placeholders = english.match(/\{[a-zA-Z]+\}/g) || [];
    out[key] = v && placeholders.every((ph) => v.includes(ph)) ? v : english;
  }
  return out;
}
