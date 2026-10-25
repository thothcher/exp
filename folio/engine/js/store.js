// One versioned state object in localStorage (key "{slug}:v1"). Every access is guarded: private mode,
// quota errors and disabled storage fall back to memory so the site keeps working.
import { todayStr } from './ui.js';

const VERSION = 1;
let KEY = 'site:v1';
let S = null;
let persistent = true;
const listeners = new Set();

const fresh = () => ({
  v: VERSION,
  studied: {},
  cards: {},
  mistakeCards: {},
  quiz: { log: [], stats: {}, best: 0 },
  exam: {},
  notes: {},
  bookmarks: [],
  settings: { theme: '', size: 0, quick: false, newPerDay: 10, reviewPerDay: 40, motion: false, goal: 10 },
  days: [],
  daily: { date: '', n: 0 },
  last: '',
  plan: { examDate: '', minutes: 30 },
});

function merge(base, saved) {
  const out = { ...base, ...saved };
  out.settings = { ...base.settings, ...(saved?.settings || {}) };
  out.quiz = { ...base.quiz, ...(saved?.quiz || {}) };
  out.plan = { ...base.plan, ...(saved?.plan || {}) };
  return out;
}

function migrate(saved) {
  // no migrations yet: version 1 is the first schema. Add one step per future version bump.
  return saved;
}

export function initStore(slug) {
  KEY = `${slug}:v${VERSION}`;
  let saved = null;
  try {
    const text = localStorage.getItem(KEY);
    if (text) saved = migrate(JSON.parse(text));
  } catch {
    persistent = false;
  }
  S = merge(fresh(), saved || {});
  return S;
}

export const state = () => S;
export const isPersistent = () => persistent;

let timer = null;
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(S));
      persistent = true;
    } catch {
      persistent = false;
    }
  }, 120);
}

export function mutate(fn) {
  fn(S);
  persist();
  for (const l of listeners) l(S);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Records a study action: adds the day to the streak and counts towards the daily goal. */
export function touchToday() {
  const d = todayStr();
  mutate((s) => {
    if (!s.days.includes(d)) s.days.push(d);
    if (s.daily.date !== d) s.daily = { date: d, n: 0 };
    s.daily.n += 1;
  });
}

export function streak() {
  // One free rest day per week: a single missed day inside a streak does not break it.
  const days = new Set(S.days);
  const cur = new Date();
  if (!days.has(todayStr(cur))) cur.setDate(cur.getDate() - 1);
  let count = 0;
  let rests = 0;
  for (let i = 0; i < 400; i++) {
    if (days.has(todayStr(cur))) {
      count++;
    } else {
      const before = new Date(cur);
      before.setDate(before.getDate() - 1);
      if (count > 0 && days.has(todayStr(before)) && rests < Math.ceil((count + 1) / 7)) rests++;
      else break;
    }
    cur.setDate(cur.getDate() - 1);
  }
  return count;
}

export function exportData() {
  return JSON.stringify({ app: KEY, exportedAt: new Date().toISOString(), data: S }, null, 1);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  if (!parsed || parsed.app !== KEY || typeof parsed.data !== 'object') throw new Error('wrong-file');
  S = merge(fresh(), migrate(parsed.data));
  persist();
  for (const l of listeners) l(S);
}

export function resetAll() {
  S = fresh();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  for (const l of listeners) l(S);
}
