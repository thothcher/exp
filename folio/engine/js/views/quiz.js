import { chapterMeta, chapters, loadCards, loadQuestions } from '../data.js';
import { mutate, state } from '../store.js';
import { addMistake, hasProgress, mastery, recordAnswer } from '../srs.js';
import { $, announce, html, icon, md, paint, pct, shuffle, t, toast } from '../ui.js';
import { bind, correctText, prepare, questionHtml } from './qrender.js';
import { empty, pageHead } from './parts.js';

// The running session lives in memory: a reload returns to the setup screen.
let session = null;

const WEIGHT = { core: 3, standard: 2, supplementary: 1 };

/** Picks `n` questions spread over the chapters in proportion to their importance (mock exam, master prompt §4.6). */
export function pickWeighted(questions, n) {
  const byCh = new Map();
  for (const q of questions) byCh.set(q.ch, [...(byCh.get(q.ch) || []), q]);
  const metas = [...byCh.keys()].map((id) => chapterMeta(id)).filter(Boolean);
  const sum = metas.reduce((a, m) => a + (WEIGHT[m.importance] || 2), 0);
  const picked = [];
  for (const m of metas) {
    const quota = Math.max(1, Math.round((n * (WEIGHT[m.importance] || 2)) / sum));
    picked.push(...shuffle(byCh.get(m.id)).slice(0, quota));
  }
  const rest = shuffle(questions.filter((q) => !picked.includes(q)));
  while (picked.length < n && rest.length) picked.push(rest.pop());
  return shuffle(picked).slice(0, n);
}

// Moves to the run screen, re-rendering even when the hash is already "#/quiz/run".
function goRun() {
  if (location.hash === '#/quiz/run') window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = '#/quiz/run';
}

export function startSession(questions, { mode = 'practice', limitSec = 0 } = {}) {
  session = { items: questions.map(prepare), i: 0, results: [], mode, limitSec, startedAt: Date.now(), extra: 0, finished: false };
  goRun();
}

export default async function quizView({ params, query, onKey }) {
  const questions = await loadQuestions();
  if (params[0] === 'run') return run({ onKey });
  const cards = await loadCards();
  const s = state();

  if (query.get('quick') === '1') {
    const weak = chapters().filter((c) => hasProgress(c.id, cards)).sort((a, b) => mastery(a.id, cards) - mastery(b.id, cards)).slice(0, 3).map((c) => c.id);
    const pool = weak.length ? questions.filter((q) => weak.includes(q.ch)) : questions;
    if (pool.length) {
      setTimeout(() => startSession(shuffle(pool).slice(0, 10)), 0);
      return { title: t('nav_quiz'), html: html`<div class="page">${empty(t('loading'))}</div>`, noFocus: true };
    }
  }

  const chSel = query.get('ch') || '';
  const mistakeIds = Object.keys(s.mistakeCards);
  return {
    title: t('nav_quiz'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_quiz'), lead: t('quiz_lead') })}
      ${questions.length ? html`<form id="quiz-form" class="card setup form-stack">
        <fieldset class="field"><legend class="field-label">${t('scope')}</legend>
          <label class="radio"><input type="radio" name="scope" value="all"${chSel ? '' : ' checked'}><span>${t('all_chapters')} <small>(${questions.length})</small></span></label>
          <label class="radio"><input type="radio" name="scope" value="chapter"${chSel ? ' checked' : ''}><span>${t('one_chapter')}</span></label>
          <select class="input" name="ch" aria-label="${t('one_chapter')}">${chapters().filter((c) => questions.some((q) => q.ch === c.id)).map((c) => html`<option value="${c.id}"${c.id === chSel ? ' selected' : ''}>${c.number}. ${c.title}</option>`)}</select>
          <label class="radio"><input type="radio" name="scope" value="weak"><span>${t('weak_topics')}</span></label>
          <label class="radio"><input type="radio" name="scope" value="mistakes"${mistakeIds.length ? '' : ' disabled'}><span>${t('my_mistakes')} <small>(${mistakeIds.length})</small></span></label>
        </fieldset>
        <fieldset class="field"><legend class="field-label">${t('how_many')}</legend>
          <div class="seg" role="radiogroup"><label class="seg-opt"><input type="radio" name="count" value="10" checked><span>10</span></label><label class="seg-opt"><input type="radio" name="count" value="20"><span>20</span></label><label class="seg-opt"><input type="radio" name="count" value="all"><span>${t('all')}</span></label></div>
        </fieldset>
        <label class="check"><input type="checkbox" name="timed"><span><strong>${t('timed')}</strong><small>${t('timed_hint')}</small></span></label>
        <button class="btn btn-primary btn-lg" type="submit">${icon('arrow-right')}${t('start_quiz')}</button>
      </form>` : empty(t('no_questions'))}
    </div>`,
    after(root) {
      const form = $('#quiz-form', root);
      if (!form) return;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(form);
        const scope = f.get('scope');
        let pool = questions;
        if (scope === 'chapter') pool = questions.filter((q) => q.ch === f.get('ch'));
        else if (scope === 'weak') {
          const weak = chapters().filter((c) => hasProgress(c.id, cards)).sort((a, b) => mastery(a.id, cards) - mastery(b.id, cards)).slice(0, 3).map((c) => c.id);
          if (weak.length) pool = questions.filter((q) => weak.includes(q.ch));
        } else if (scope === 'mistakes') pool = questions.filter((q) => mistakeIds.includes(q.id));
        if (!pool.length) return toast(t('no_questions'));
        const n = f.get('count') === 'all' ? pool.length : Number(f.get('count'));
        const chosen = shuffle(pool).slice(0, n);
        startSession(chosen, f.get('timed') ? { mode: 'timed', limitSec: Math.round(chosen.length * 60) } : {});
      });
    },
  };
}

// ---------------------------------------------------------------- run

function run({ onKey }) {
  if (!session || session.finished) {
    if (session?.finished) return results();
    return { title: t('nav_quiz'), html: html`<div class="page page-narrow">${empty(t('no_session'), html`<a class="btn btn-primary" href="#/quiz">${t('nav_quiz')}</a>`)}</div>` };
  }
  const S = session;
  let handle = null;
  let timer = null;
  let root;

  const remaining = () => (S.limitSec ? Math.max(0, S.limitSec + S.extra - Math.floor((Date.now() - S.startedAt) / 1000)) : 0);
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  const finish = () => {
    S.finished = true;
    S.endedAt = Date.now();
    clearInterval(timer);
    const total = S.results.length;
    const correct = S.results.filter((r) => r.ok).length;
    mutate((st) => {
      st.quiz.log = [...st.quiz.log, { ts: Date.now(), mode: S.mode, total, correct }].slice(-30);
      if (total >= 5) st.quiz.best = Math.max(st.quiz.best || 0, Math.round((correct / total) * 100));
    });
    goRun();
  };

  const show = () => {
    const pq = S.items[S.i];
    const stage = $('#q-stage', root);
    stage.innerHTML = questionHtml(pq, { number: S.i + 1, total: S.items.length }).toString();
    $('#q-bar span', root).style.width = `${(S.i / S.items.length) * 100}%`;
    const next = $('#q-next', root);
    next.hidden = true;
    handle = bind($('.q', stage), pq, ({ ok, picked }) => {
      S.results.push({ q: pq.q, ok, picked });
      recordAnswer(pq.q.ch, ok);
      if (!ok) addMistake(pq.q.id);
      next.hidden = false;
      next.querySelector('span').textContent = S.i + 1 >= S.items.length ? t('finish') : t('next');
      next.focus({ preventScroll: true });
    });
    announce(t('question_of', { n: S.i + 1, total: S.items.length }));
  };

  const advance = () => {
    if (!handle?.isDone()) return;
    S.i += 1;
    S.i >= S.items.length ? finish() : show();
  };

  onKey((e) => {
    if (!handle) return;
    if (/^[1-6]$/.test(e.key) && !handle.isDone()) handle.pick(Number(e.key) - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && handle.isDone()) {
      e.preventDefault();
      advance();
    } else if (e.key === 'Enter' && !handle.isDone()) handle.submit();
  });

  return {
    title: t('nav_quiz'),
    html: html`<div class="page page-narrow quiz-run">
      <div class="q-head"><a class="back" href="#/quiz" id="q-exit">${icon('x', 'i-sm')}${t('exit')}</a>
        ${S.limitSec ? html`<div class="q-timer" id="q-timer" role="timer" aria-live="off">${icon('timer', 'i-sm')}<span id="q-time">${fmt(remaining())}</span><button type="button" class="btn btn-ghost btn-sm" id="q-plus">+5 ${t('min')}</button><button type="button" class="btn btn-ghost btn-sm" id="q-notimer">${t('timer_off')}</button></div>` : ''}
      </div>
      <span class="bar" id="q-bar" role="presentation"><span></span></span>
      <div id="q-stage"></div>
      <button type="button" class="btn btn-primary btn-lg" id="q-next" hidden>${icon('arrow-right')}<span>${t('next')}</span></button>
    </div>`,
    after(r) {
      root = r;
      show();
      $('#q-next', root).addEventListener('click', advance);
      $('#q-exit', root).addEventListener('click', () => {
        clearInterval(timer);
        session = null;
      });
      if (S.limitSec) {
        let warned = false;
        timer = setInterval(() => {
          if (!S.limitSec) return;
          const left = remaining();
          $('#q-time', root).textContent = fmt(left);
          if (left <= 120 && !warned) {
            warned = true;
            $('#q-timer', root).classList.add('is-warn');
            toast(t('two_minutes'));
          }
          if (left <= 0) {
            clearInterval(timer);
            finish();
          }
        }, 1000);
        $('#q-plus', root).addEventListener('click', () => {
          S.extra += 300;
          warned = false;
          $('#q-timer', root).classList.remove('is-warn');
        });
        $('#q-notimer', root).addEventListener('click', () => {
          S.limitSec = 0;
          clearInterval(timer);
          $('#q-timer', root).remove();
        });
        window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
      }
      paint(root);
    },
  };
}

// ---------------------------------------------------------------- results

function results() {
  const S = session;
  const total = S.results.length;
  const correct = S.results.filter((r) => r.ok).length;
  const percent = total ? Math.round((correct / total) * 100) : 0;
  const wrong = S.results.filter((r) => !r.ok);
  const byCh = new Map();
  for (const r of S.results) {
    const e = byCh.get(r.q.ch) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.ok) e.ok += 1;
    byCh.set(r.q.ch, e);
  }
  const secs = Math.round(((S.endedAt || Date.now()) - S.startedAt) / 1000);
  return {
    title: t('results'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('results') })}
      <section class="card result-card"><span class="ring ring-xl" data-p="${percent}" role="img" aria-label="${percent}%"><span>${percent}</span></span>
        <div><p class="result-main">${t('score_of', { correct, total })}</p><p class="result-sub">${percent >= 80 ? t('result_great') : percent >= 50 ? t('result_ok') : t('result_keep')}</p><p class="result-time">${icon('clock', 'i-sm')}${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</p></div></section>
      <section><h2>${t('by_chapter')}</h2><div class="ch-bars">${[...byCh].map(([id, e]) => { const m = chapterMeta(id); return html`<div class="ch-bar tone-${m?.tone}"><span class="ch-bar-name">${m ? `${m.number}. ${m.title}` : id}</span>${html`<span class="bar" role="presentation"><span data-w="${pct(e.ok / e.total)}"></span></span>`}<span class="ch-bar-n">${e.ok}/${e.total}</span></div>`; })}</div></section>
      ${wrong.length ? html`<section><h2>${t('review')}</h2><div class="review-list">${wrong.map((r) => html`<article class="review-item"><h3>${md(r.q.stem)}</h3><p class="review-a">${t('right_answer')}: <strong>${md(correctText(r.q))}</strong></p>${r.q.explain ? html`<p>${md(r.q.explain)}</p>` : ''}${r.q.src ? html`<p class="fb-src">${t('in_book')}: ${r.q.src}</p>` : ''}</article>`)}</div><p class="note-line">${icon('info', 'i-sm')}${t('mistakes_saved', { n: wrong.length })}</p></section>` : ''}
      <div class="result-actions">
        ${wrong.length ? html`<button type="button" class="btn btn-primary" id="retry">${icon('rotate-ccw')}${t('retry_mistakes')}</button>` : ''}
        <a class="btn btn-ghost" href="#/quiz">${t('new_quiz')}</a><a class="btn btn-ghost" href="#/cards?go=1">${t('nav_cards')}</a>
      </div>
    </div>`,
    after(root) {
      paint(root);
      $('#retry', root)?.addEventListener('click', () => startSession(wrong.map((r) => r.q), { mode: S.mode, limitSec: 0 }));
    },
  };
}
