import { chapterMeta, chapters, loadExam, loadQuestions, feature } from '../data.js';
import { mutate, state, touchToday } from '../store.js';
import { $, $$, debounce, html, icon, md, mdText, paint, t, toast } from '../ui.js';
import { empty, pageHead, crumbs } from './parts.js';
import { pickWeighted, startSession } from './quiz.js';

export default async function examView({ params, query }) {
  const items = await loadExam();
  if (params[0] === 'mock') return mock();
  if (params[0]) return item(items, params[0]);
  return hub(items, query);
}

function hub(items, query) {
  const s = state();
  const ch = query.get('ch') || '';
  const groups = chapters().map((c) => ({ c, list: items.filter((e) => e.ch.includes(c.id)) })).filter((g) => g.list.length && (!ch || g.c.id === ch));
  const done = items.filter((e) => s.exam[e.id]?.done).length;
  return {
    title: t('nav_exam'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_exam'), lead: t('exam_lead') })}
      ${feature('quiz_and_mock_exam') ? html`<a class="mode-card" href="#/exam/mock"><span class="mode-ico">${icon('timer')}</span><span class="mode-body"><strong>${t('mock_exam')}</strong><small>${t('mock_hint')}</small></span>${icon('arrow-right')}</a>` : ''}
      <p class="exam-progress">${t('exam_progress', { done, total: items.length })}${items.some((e) => e.source === 'predicted') ? html` <span class="chip chip-outline">${t('predicted_note')}</span>` : ''}</p>
      ${groups.length ? groups.map((g) => html`<section class="exam-group"><h2 class="tone-${g.c.tone}"><span class="chip chip-tone">${g.c.number}</span>${g.c.title}</h2>
        <ul class="exam-list">${g.list.map((e) => { const st = s.exam[e.id]; return html`<li><a class="exam-row" href="#/exam/${e.id}">${icon(st?.done ? 'circle-check' : st?.answer ? 'pencil' : 'circle', 'i-sm')}<span>${md(e.prompt)}</span><span class="chip chip-outline">${t('marks', { n: e.marks })}</span></a></li>`; })}</ul></section>`) : empty(t('no_exam'))}
    </div>`,
  };
}

function item(items, id) {
  const e = items.find((x) => x.id === id);
  if (!e) return { title: t('not_found'), html: html`<div class="page page-narrow">${empty(t('not_found_text'), html`<a class="btn btn-primary" href="#/exam">${t('nav_exam')}</a>`)}</div>` };
  const meta = chapterMeta(e.ch[0]);
  const st = state().exam[id] || { answer: '', ticks: [], revealed: false, done: false };
  const idx = items.findIndex((x) => x.id === id);
  const next = items[idx + 1];
  return {
    title: t('nav_exam'),
    html: html`<div class="page page-narrow">
      ${crumbs([{ href: '#/exam', label: t('nav_exam') }, { label: meta ? `${meta.number}. ${meta.title}` : id }])}
      <section class="exam-item">
        <p class="exam-prompt">${md(e.prompt)}</p>
        <p class="exam-meta"><span class="chip chip-outline">${t('marks', { n: e.marks })}</span>${e.source === 'predicted' ? html`<span class="chip chip-outline">${t('predicted')}</span>` : html`<span class="chip chip-ok">${t('official')}</span>`}</p>
        <label class="field"><span class="field-label">${t('your_answer')}</span><textarea id="ex-answer" class="input" rows="7" placeholder="${t('write_first')}">${st.answer || ''}</textarea></label>
        <button type="button" class="btn btn-primary" id="ex-reveal"${st.revealed ? ' hidden' : ''}>${icon('eye')}${t('show_model')}</button>
        <div id="ex-model"${st.revealed ? '' : ' hidden'}>
          <section class="model card"><h2>${t('model_answer')}</h2><p>${md(e.modelAnswer)}</p></section>
          <section class="ticks"><h2>${t('tick_points')}</h2>${e.keyPoints.map((k, i) => html`<label class="check"><input type="checkbox" data-i="${i}"${st.ticks?.[i] ? ' checked' : ''}><span>${md(k)}</span></label>`)}<p class="tick-result" id="ex-result" aria-live="polite"></p></section>
        </div>
      </section>
      <div class="pager"><a class="pager-link" href="#/exam">${icon('arrow-left')}<span>${t('nav_exam')}</span></a>${next ? html`<a class="pager-link pager-next" href="#/exam/${next.id}"><span><small>${t('next')}</small>${mdText(next.prompt).slice(0, 60)}</span>${icon('arrow-right')}</a>` : ''}</div>
    </div>`,
    after(root) {
      const save = (patch) => mutate((s) => {
        s.exam[id] = { answer: '', ticks: [], revealed: false, done: false, ...(s.exam[id] || {}), ...patch };
      });
      const refresh = () => {
        const ticks = $$('input[data-i]', root).map((c) => c.checked);
        const all = ticks.length > 0 && ticks.every(Boolean);
        save({ ticks, done: all });
        $('#ex-result', root).textContent = all ? t('all_ticked') : t('ticked_n', { n: ticks.filter(Boolean).length, total: ticks.length });
        if (all) touchToday();
      };
      $('#ex-answer', root).addEventListener('input', debounce((ev) => save({ answer: ev.target.value }), 400));
      $('#ex-reveal', root).addEventListener('click', (ev) => {
        save({ revealed: true });
        ev.currentTarget.hidden = true;
        $('#ex-model', root).hidden = false;
        refresh();
        toast(t('compare_hint'));
      });
      $$('input[data-i]', root).forEach((c) => c.addEventListener('change', refresh));
      if (st.revealed) refresh();
      paint(root);
    },
  };
}

function mock() {
  return {
    title: t('mock_exam'),
    html: html`<div class="page page-narrow">${pageHead({ title: t('mock_exam'), lead: t('mock_lead') })}
      <form id="mock-form" class="card setup form-stack">
        <label class="field"><span class="field-label">${t('how_many')}</span><input class="input" type="number" name="n" min="5" max="100" value="20"></label>
        <label class="check"><input type="checkbox" name="timer" checked><span><strong>${t('timed')}</strong><small>${t('mock_timer_hint')}</small></span></label>
        <button class="btn btn-primary btn-lg" type="submit">${icon('arrow-right')}${t('start_mock')}</button>
      </form></div>`,
    async after(root) {
      const questions = await loadQuestions();
      $('#mock-form', root).addEventListener('submit', (ev) => {
        ev.preventDefault();
        const f = new FormData(ev.target);
        const n = Math.max(5, Math.min(Number(f.get('n')) || 20, questions.length));
        const chosen = pickWeighted(questions, n);
        if (!chosen.length) return toast(t('no_questions'));
        startSession(chosen, f.get('timer') ? { mode: 'mock', limitSec: Math.round(n * 75) } : { mode: 'mock' });
      });
    },
  };
}
