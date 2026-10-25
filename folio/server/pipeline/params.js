import { bad } from '../lib/util.js';

/**
 * PART A of the master prompt as a form schema. The server renders the validated values into the
 * <book_parameters> YAML block, exactly like the block a person would paste into the prompt by hand.
 */

export const FEATURE_KEYS = [
  { key: 'flashcards_with_spaced_repetition', label: 'Flashcards with spaced repetition', default: 'on' },
  { key: 'quiz_and_mock_exam', label: 'Quiz and mock exam', default: 'on' },
  { key: 'exam_prep_hub', label: 'Exam preparation hub', default: 'on' },
  { key: 'compare_tables', label: 'Compare tables with self-test', default: 'auto' },
  { key: 'glossary_and_search', label: 'Glossary and search', default: 'on' },
  { key: 'notes_and_bookmarks', label: 'Notes and bookmarks', default: 'on' },
  { key: 'study_planner', label: 'Study planner', default: 'on' },
  { key: 'progress_export_import', label: 'Progress export and import', default: 'on' },
  { key: 'offline_pwa', label: 'Offline use (PWA)', default: 'on' },
  { key: 'quick_full_toggle', label: 'Quick / Full reading switch', default: 'on' },
];

// Features of the master prompt that engine 1.0 does not ship. They are always written as "off".
export const UNSUPPORTED_FEATURES = ['matching_ordering_connections', 'timeline', 'signature_interactive'];

export const PARAM_FIELDS = [
  // ---- required
  { key: 'BOOK_TITLE', group: 'book', label: 'Book title', type: 'text', required: true, max: 200, placeholder: 'As printed on the cover', help: 'The title as printed on the cover.' },
  { key: 'AUTHORS', group: 'book', label: 'Authors', type: 'text', required: true, max: 300, placeholder: 'Author names, or "unknown / lecture notes"', help: '"unknown / lecture notes" is fine.' },
  { key: 'SUBJECT', group: 'book', label: 'Subject', type: 'text', required: true, max: 200, placeholder: 'Social psychology, BA year 2' },
  {
    key: 'CONTENT_LANGUAGE', group: 'book', label: 'Site language', type: 'combo', required: true, max: 60, default: 'Georgian (ka)',
    options: ['Georgian (ka)', 'English (en)', 'Russian (ru)', 'German (de)', 'French (fr)', 'Spanish (es)', 'Turkish (tr)', 'Ukrainian (uk)'],
    help: 'Language of the whole site, text and buttons. Content is translated if the book is in another language.',
  },
  // ---- recommended
  { key: 'COURSE_CONTEXT', group: 'course', label: 'Course context', type: 'textarea', max: 3000, rows: 3, placeholder: 'University, course, level, how you are examined (MCQ, essay, oral), exam date, what you find hard', help: 'Large effect on quality: it decides what counts as core.' },
  { key: 'EXAM_MATERIALS', group: 'course', label: 'Exam materials', type: 'textarea', max: 20000, rows: 4, placeholder: 'Paste the official exam questions, the syllabus or past-paper questions here', help: 'If given, these drive the Exam section.' },
  { key: 'SCOPE', group: 'course', label: 'Scope', type: 'text', max: 400, default: 'all', placeholder: 'all, or "chapters 1-9 only; skip appendices"' },
  { key: 'DEPTH', group: 'course', label: 'Depth', type: 'select', default: 'standard', options: [
    { value: 'compact', label: 'Compact (cram)' },
    { value: 'standard', label: 'Standard' },
    { value: 'thorough', label: 'Thorough' },
  ] },
  {
    key: 'DESIGN_DIRECTION', group: 'course', label: 'Design direction', type: 'combo', max: 200, default: 'auto',
    options: ['auto', 'calm-pastel', 'bold-editorial', 'clean-academic'],
    help: 'A preset, or free text such as "dark navy and orange, techy".',
  },
  { key: 'EXTRA_INSTRUCTIONS', group: 'course', label: 'Extra instructions', type: 'textarea', max: 4000, rows: 3, placeholder: 'Book-specific quirks: "chapter 5 is formula-heavy", "ignore the grey side boxes"' },
  // ---- advanced
  { key: 'SOURCE_TYPE', group: 'advanced', label: 'Source type', type: 'select', default: 'auto', options: ['auto', 'textbook', 'lecture-notes', 'slides', 'anthology', 'scanned'] },
  { key: 'SUBJECT_TYPE', group: 'advanced', label: 'Subject type', type: 'text', max: 120, default: 'auto', placeholder: 'concepts, history, science, quantitative, law, language, tech, business' },
  { key: 'TARGET_AUDIENCE', group: 'advanced', label: 'Target audience', type: 'text', max: 300, default: '16–24-year-old university students, phone-first, studying in short sessions' },
  { key: 'TONE', group: 'advanced', label: 'Tone', type: 'text', max: 300, default: "warm, clear, respectful; speaks to the reader as 'you'; no baby-talk; emoji almost never" },
  { key: 'GAMIFICATION', group: 'advanced', label: 'Gamification', type: 'select', default: 'light', options: ['none', 'light', 'full'] },
  { key: 'THEME', group: 'advanced', label: 'Default theme', type: 'select', default: 'system', options: ['system', 'light', 'dark'] },
  { key: 'IMAGES', group: 'advanced', label: 'Images', type: 'select', default: 'svg-diagrams', options: ['svg-diagrams', 'none'] },
  { key: 'SITE_NAME', group: 'advanced', label: 'Site name', type: 'text', max: 60, default: 'auto', help: 'auto = a short friendly name from the title.' },
  { key: 'SLUG', group: 'advanced', label: 'Slug', type: 'text', max: 48, default: 'auto', pattern: /^(auto|[a-z0-9]+(-[a-z0-9]+)*)$/, help: 'ASCII kebab-case. Used for the folder and the local storage key.' },
  { key: 'FOOTER_CREDIT', group: 'advanced', label: 'Footer credit', type: 'text', max: 200, placeholder: 'Built by your team' },
  { key: 'FEEDBACK_CONTACT', group: 'advanced', label: 'Feedback contact', type: 'text', max: 200, placeholder: 'E-mail or issues URL for "Report a mistake" links' },
  { key: 'VISIBILITY', group: 'advanced', label: 'Visibility', type: 'select', default: 'public', options: ['public', 'private'], help: 'Public applies strict anti-reproduction rules (§9).' },
  { key: 'AUTONOMY', group: 'advanced', label: 'Approval gates', type: 'select', default: 'gated', options: [
    { value: 'gated', label: 'Gated: pause for blueprint and pilot approval' },
    { value: 'autonomous', label: 'Autonomous: run to the end without pausing' },
  ] },
  { key: 'CHAT_LANGUAGE', group: 'advanced', label: 'Language for notes to you', type: 'text', max: 40, default: 'English' },
];

export const PARAM_GROUPS = [
  { id: 'book', title: 'The book', hint: 'Required.' },
  { id: 'course', title: 'Course and exam', hint: 'Recommended. Has a large effect on quality.' },
  { id: 'advanced', title: 'Advanced', hint: 'Defaults are fine for most books.' },
];

const FIELD_BY_KEY = new Map(PARAM_FIELDS.map((f) => [f.key, f]));

export function defaultParams() {
  const out = {};
  for (const f of PARAM_FIELDS) out[f.key] = f.default ?? '';
  out.FEATURES = Object.fromEntries(FEATURE_KEYS.map((f) => [f.key, f.default]));
  return out;
}

function optionValues(field) {
  return (field.options || []).map((o) => (typeof o === 'string' ? o : o.value));
}

/** Validates user input against the schema and fills defaults. Throws a 400 with field errors. */
export function validateParams(input = {}) {
  const out = defaultParams();
  const errors = {};
  for (const f of PARAM_FIELDS) {
    let v = input[f.key];
    if (v === undefined || v === null) v = f.default ?? '';
    v = String(v).replace(/\r\n/g, '\n').trim();
    if (f.required && !v) {
      errors[f.key] = `${f.label} is required.`;
      continue;
    }
    if (f.max && v.length > f.max) {
      errors[f.key] = `${f.label} is too long (max ${f.max} characters).`;
      continue;
    }
    if (f.type === 'select' && v && !optionValues(f).includes(v)) {
      errors[f.key] = `${f.label}: unknown option.`;
      continue;
    }
    if (f.pattern && v && !f.pattern.test(v)) {
      errors[f.key] = `${f.label}: use lowercase letters, digits and dashes.`;
      continue;
    }
    if (!v && f.default !== undefined) v = f.default;
    out[f.key] = v;
  }
  const features = input.FEATURES && typeof input.FEATURES === 'object' ? input.FEATURES : {};
  for (const f of FEATURE_KEYS) {
    const v = String(features[f.key] ?? f.default);
    out.FEATURES[f.key] = ['on', 'off', 'auto'].includes(v) ? v : f.default;
  }
  if (Object.keys(errors).length) throw bad('Please fix the highlighted fields.', { fields: errors });
  return out;
}

export function languageInfo(contentLanguage) {
  const text = String(contentLanguage || '').trim();
  const m = text.match(/\(([a-zA-Z]{2,3})(?:-[A-Za-z]+)?\)/);
  let code = m ? m[1].toLowerCase() : '';
  if (!code) {
    const lower = text.toLowerCase();
    const known = { georgian: 'ka', english: 'en', russian: 'ru', german: 'de', french: 'fr', spanish: 'es', turkish: 'tr', ukrainian: 'uk', arabic: 'ar', hebrew: 'he', persian: 'fa', armenian: 'hy' };
    code = Object.entries(known).find(([name]) => lower.includes(name))?.[1] || 'en';
  }
  const rtl = ['ar', 'he', 'fa', 'ur'].includes(code);
  return { code, dir: rtl ? 'rtl' : 'ltr' };
}

function yamlValue(value, indent = 0) {
  const s = String(value ?? '');
  if (s.includes('\n')) {
    const pad = ' '.repeat(indent + 2);
    return `|\n${s.split('\n').map((line) => (line ? pad + line : '')).join('\n')}`;
  }
  return JSON.stringify(s);
}

/** Renders the <book_parameters> block for the system prompt. */
export function renderParamsYaml(params, { sourceNames = [], extra = {} } = {}) {
  const p = { ...defaultParams(), ...params };
  const lines = [];
  lines.push('SOURCE_FILES:');
  for (const name of sourceNames.length ? sourceNames : ['book.pdf']) lines.push(`  - ${JSON.stringify(`./source/${name}`)}`);
  const order = ['BOOK_TITLE', 'AUTHORS', 'SUBJECT', 'CONTENT_LANGUAGE', 'COURSE_CONTEXT', 'EXAM_MATERIALS', 'SCOPE', 'DEPTH', 'DESIGN_DIRECTION', 'EXTRA_INSTRUCTIONS', 'SOURCE_TYPE', 'SUBJECT_TYPE', 'TARGET_AUDIENCE', 'TONE'];
  for (const key of order) lines.push(`${key}: ${yamlValue(p[key])}`);
  lines.push('TECH_STACK: vanilla');
  lines.push('HOSTING: github-pages');
  for (const key of ['VISIBILITY', 'GAMIFICATION', 'IMAGES', 'THEME']) lines.push(`${key}: ${p[key]}`);
  lines.push('FEATURES:');
  for (const f of FEATURE_KEYS) lines.push(`  ${f.key}: ${p.FEATURES?.[f.key] ?? f.default}`);
  for (const key of UNSUPPORTED_FEATURES) lines.push(`  ${key}: off`);
  for (const key of ['SITE_NAME', 'SLUG']) lines.push(`${key}: ${extra[key] ?? p[key]}`);
  lines.push('OUTPUT_DIR: auto');
  lines.push(`FOOTER_CREDIT: ${yamlValue(p.FOOTER_CREDIT)}`);
  lines.push(`FEEDBACK_CONTACT: ${yamlValue(p.FEEDBACK_CONTACT)}`);
  lines.push(`CHAT_LANGUAGE: ${yamlValue(p.CHAT_LANGUAGE)}`);
  lines.push(`AUTONOMY: ${p.AUTONOMY}`);
  return lines.join('\n');
}

export function fieldDef(key) {
  return FIELD_BY_KEY.get(key);
}

export function publicSchema() {
  return {
    groups: PARAM_GROUPS,
    fields: PARAM_FIELDS.map((f) => ({
      key: f.key,
      group: f.group,
      label: f.label,
      type: f.type,
      required: Boolean(f.required),
      default: f.default ?? '',
      options: f.options || null,
      help: f.help || '',
      placeholder: f.placeholder || '',
      rows: f.rows || null,
      max: f.max || null,
    })),
    features: FEATURE_KEYS,
    unsupportedFeatures: UNSUPPORTED_FEATURES,
  };
}
