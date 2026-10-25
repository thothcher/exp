// Content loading. Shared files are loaded once; chapters load lazily and are cached by the service worker.
let BOOK = null;
let UI = null;
let GLOSSARY = [];
let GLOSSARY_MAP = new Map();
const cache = new Map();

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

function once(key, loader) {
  if (!cache.has(key)) cache.set(key, loader().catch((err) => {
    cache.delete(key);
    throw err;
  }));
  return cache.get(key);
}

export async function boot() {
  [BOOK, UI, GLOSSARY] = await Promise.all([getJson('content/book.json'), getJson('content/ui.json'), getJson('content/glossary.json')]);
  GLOSSARY_MAP = new Map(GLOSSARY.map((g) => [g.id, g]));
  return { book: BOOK, ui: UI };
}

export const book = () => BOOK;
export const chapters = () => BOOK.chapters;
export const chapterMeta = (id) => BOOK.chapters.find((c) => c.id === id) || null;
export const glossaryList = () => GLOSSARY;
export const term = (id) => GLOSSARY_MAP.get(id) || null;
export const feature = (key) => (BOOK.features?.[key] ?? 'on') !== 'off';

export const loadChapter = (id) => once(`ch:${id}`, () => {
  const meta = chapterMeta(id);
  if (!meta) return Promise.reject(new Error('unknown chapter'));
  return getJson(`content/${meta.file}`);
});
export const loadCards = () => once('cards', () => getJson('content/cards.json'));
export const loadQuestions = () => once('questions', () => getJson('content/questions.json'));
export const loadExam = () => once('exam', () => getJson('content/exam.json'));
export const loadIndex = () => once('index', () => getJson('search-index.json'));

export function neighbors(id) {
  const i = BOOK.chapters.findIndex((c) => c.id === id);
  return { prev: BOOK.chapters[i - 1] || null, next: BOOK.chapters[i + 1] || null, index: i };
}
