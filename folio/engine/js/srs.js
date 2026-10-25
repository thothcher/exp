// Spaced repetition (Leitner, 5 boxes) and mastery. Master prompt §4.7.
import { state, mutate, touchToday } from './store.js';
import { addDays, todayStr, clamp } from './ui.js';

export const INTERVALS = [1, 2, 4, 8, 16];
export const RATINGS = { again: 1, hard: 2, good: 3, easy: 4 };

export function rateCard(id, rating) {
  const today = todayStr();
  mutate((s) => {
    const c = s.cards[id] || { box: 1, due: today, seen: 0, lapses: 0, first: today };
    if (rating === 1) {
      c.box = 1;
      c.lapses += 1;
    } else if (rating === 3) c.box = clamp(c.box + 1, 1, 5);
    else if (rating === 4) c.box = clamp(c.box + 2, 1, 5);
    c.seen += 1;
    c.due = addDays(today, rating === 1 ? 0 : INTERVALS[c.box - 1]);
    if (rating === 1) c.due = today;
    s.cards[id] = c;
  });
  touchToday();
}

export function rateMistake(id, rating) {
  const today = todayStr();
  mutate((s) => {
    const c = s.mistakeCards[id];
    if (!c) return;
    if (rating === 1) c.box = 1;
    else if (rating === 3) c.box = clamp(c.box + 1, 1, 5);
    else if (rating === 4) c.box = clamp(c.box + 2, 1, 5);
    c.due = addDays(today, rating === 1 ? 0 : INTERVALS[c.box - 1]);
    // a mistake card is retired once it has been answered well from box 4 up
    if (c.box >= 4 && rating >= 3) delete s.mistakeCards[id];
  });
  touchToday();
}

export function addMistake(qid) {
  mutate((s) => {
    if (!s.mistakeCards[qid]) s.mistakeCards[qid] = { box: 1, due: addDays(todayStr(), 1) };
  });
}

export function newToday() {
  const today = todayStr();
  return Object.values(state().cards).filter((c) => c.first === today).length;
}

export function reviewedToday() {
  const today = todayStr();
  return Object.values(state().cards).filter((c) => c.first !== today && c.due !== today && c.seen > 0 && c.due > today).length;
}

/** Cards that should be shown today. `cram` ignores the schedule. */
export function buildQueue(cards, { chapter = '', hideMastered = false, cram = false } = {}) {
  const s = state();
  const today = todayStr();
  let list = cards.filter((c) => !chapter || c.ch === chapter);
  if (hideMastered) list = list.filter((c) => (s.cards[c.id]?.box || 0) < 4);
  if (cram) return list;
  const due = [];
  const fresh = [];
  for (const c of list) {
    const st = s.cards[c.id];
    if (!st) fresh.push(c);
    else if (st.due <= today) due.push(c);
  }
  const newLeft = Math.max(0, s.settings.newPerDay - newToday());
  return [...due.slice(0, s.settings.reviewPerDay), ...fresh.slice(0, newLeft)];
}

export function dueCount(cards) {
  return buildQueue(cards).length;
}

export function dueMistakes() {
  const today = todayStr();
  return Object.entries(state().mistakeCards).filter(([, c]) => c.due <= today).map(([id]) => id);
}

// ------------------------------------------------------------- mastery

export function recordAnswer(chId, ok) {
  mutate((s) => {
    const st = s.quiz.stats[chId] || { ok: 0, total: 0, recent: [] };
    st.total += 1;
    if (ok) st.ok += 1;
    st.recent = [...st.recent, ok ? 1 : 0].slice(-10);
    s.quiz.stats[chId] = st;
  });
  touchToday();
}

/** 40 % recent quiz accuracy + 40 % cards in box >= 3 + 20 % read. Missing parts are left out. */
export function mastery(chId, cards) {
  const s = state();
  const parts = [];
  const q = s.quiz.stats[chId];
  if (q?.recent.length) parts.push([0.4, q.recent.reduce((a, b) => a + b, 0) / q.recent.length]);
  const own = cards.filter((c) => c.ch === chId);
  const seen = own.filter((c) => s.cards[c.id]);
  if (own.length && seen.length) parts.push([0.4, own.filter((c) => (s.cards[c.id]?.box || 0) >= 3).length / own.length]);
  parts.push([0.2, s.studied[chId] ? 1 : 0]);
  const w = parts.reduce((a, [x]) => a + x, 0);
  return parts.reduce((a, [x, v]) => a + x * v, 0) / w;
}

export function hasProgress(chId, cards) {
  const s = state();
  return Boolean(s.studied[chId] || s.quiz.stats[chId] || cards.some((c) => c.ch === chId && s.cards[c.id]));
}
