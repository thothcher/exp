import { book, chapterMeta, chapters, feature, loadCards } from '../data.js';
import { exportData, importData, isPersistent, mutate, resetAll, state, streak } from '../store.js';
import { hasProgress, mastery } from '../srs.js';
import { $, $$, confirmDialog, daysBetween, fmtDate, html, icon, md, paint, pct, ring, t, todayStr, addDays, toast, bar } from '../ui.js';
import { empty, pageHead } from './parts.js';

const RANK = { core: 0, standard: 1, supplementary: 2 };

/** Day-by-day plan (master prompt §4.7): first pass by importance, recall, mock exam two days before, cheat sheets the day before. */
function buildPlan(plan) {
  const today = todayStr();
  const days = daysBetween(today, plan.examDate);
  if (!plan.examDate || days < 1) return null;
  const s = state();
  const todo = [...chapters()].filter((c) => !s.studied[c.id]).sort((a, b) => RANK[a.importance] - RANK[b.importance] || a.number - b.number);
  const reserve = days >= 4 ? 2 : days >= 2 ? 1 : 0;
  const studyDays = Math.max(1, days - reserve);
  const fullTotal = todo.reduce((n, c) => n + c.minutes, 0);
  const coreOnly = fullTotal > studyDays * plan.minutes * 0.75;
  const cost = (c) => (coreOnly ? Math.max(3, Math.ceil(c.minutes / 3)) : c.minutes);
  const out = [];
  let queue = todo;
  for (let d = 0; d < days; d++) {
    const date = addDays(today, d);
    const tasks = [];
    if (d >= days - reserve && reserve) {
      if (d === days - 1) tasks.push({ icon: 'printer', label: t('plan_cheat'), href: '#/cheat/all' }, { icon: 'target', label: t('plan_weak'), href: '#/quiz' });
      else tasks.push({ icon: 'timer', label: t('plan_mock'), href: '#/exam/mock' });
    } else {
      let left = plan.minutes;
      while (queue.length && (left >= cost(queue[0]) || left === plan.minutes)) {
        const c = queue.shift();
        left -= cost(c);
        tasks.push({ icon: 'book-open', label: `${c.number}. ${c.title}`, href: `#/chapter/${c.id}`, meta: t('minutes', { n: cost(c) }) });
      }
      if (left > 5 || !tasks.length) tasks.push({ icon: 'layers', label: t('plan_recall'), href: '#/cards?go=1' });
    }
    out.push({ date, tasks });
  }
  return { days: out, coreOnly, leftover: queue };
}

export default async function progress() {
  const b = book();
  const s = state();
  const cards = await loadCards();
  const list = chapters();
  const ms = list.map((c) => ({ c, m: mastery(c.id, cards), started: hasProgress(c.id, cards) }));
  const overall = ms.length ? ms.reduce((n, x) => n + (x.started ? x.m : 0), 0) / ms.length : 0;
  const weak = ms.filter((x) => x.started && x.m < 0.8).sort((a, z) => a.m - z.m).slice(0, 3);
  const days = streak();
  const goal = s.settings.goal;
  const todayN = s.daily.date === todayStr() ? s.daily.n : 0;
  const notes = Object.entries(s.notes).map(([sec, text]) => ({ sec, text, ch: chapterMeta(sec.split('-')[0]) })).filter((n) => n.ch);
  const planOut = feature('study_planner') ? buildPlan(s.plan) : null;
  const light = b.gamification !== 'none';

  return {
    title: t('nav_progress'),
    html: html`<div class="page">
      ${pageHead({ title: t('nav_progress'), lead: t('progress_lead') })}
      ${isPersistent() ? '' : html`<p class="banner banner-warn">${icon('triangle-alert', 'i-sm')}${t('storage_off')}</p>`}
      <section class="prog-summary card">
        <div class="ps-item">${ring(overall * 100, t('overall'))}<div><strong>${t('overall')}</strong><small>${t('overall_hint')}</small></div></div>
        ${light ? html`<div class="ps-item"><span class="ps-big">${icon('flame')}${days}</span><div><strong>${t('day_streak')}</strong><small>${t('streak_hint')}</small></div></div>
        <div class="ps-item">${ring(Math.min(100, (todayN / Math.max(1, goal)) * 100), t('daily_goal'))}<div><strong>${t('daily_goal')}</strong><small>${t('goal_progress', { n: todayN, goal })}</small></div></div>` : ''}
      </section>

      <section><h2>${t('mastery_by_chapter')}</h2><div class="m-list">${ms.map(({ c, m, started }) => html`<a class="m-row tone-${c.tone}" href="#/chapter/${c.id}"><span class="m-name">${c.number}. ${c.title}</span>${bar(started ? pct(m) : 0)}<span class="m-val">${started ? `${pct(m)}%` : '–'}</span></a>`)}</div></section>
      ${weak.length ? html`<section><h2>${t('weakest')}</h2><div class="weak-list">${weak.map(({ c, m }) => html`<a class="weak-item tone-${c.tone}" href="#/chapter/${c.id}">${icon(c.icon, 'i-sm')}<span>${c.number}. ${c.title}</span><strong>${pct(m)}%</strong></a>`)}</div></section>` : ''}

      <section class="cheat-links"><h2>${t('cheat_sheets')}</h2><p class="muted">${t('cheat_hint')}</p><a class="btn btn-soft" href="#/cheat/all">${icon('printer')}${t('cheat_all')}</a></section>

      ${feature('study_planner') ? html`<section class="planner"><h2>${t('planner')}</h2><p class="muted">${t('planner_hint')}</p>
        <div class="planner-form"><label class="field"><span class="field-label">${t('exam_date')}</span><input class="input" type="date" id="pl-date" min="${addDays(todayStr(), 1)}" value="${s.plan.examDate}"></label>
        <label class="field"><span class="field-label">${t('minutes_per_day')}</span><input class="input" type="number" id="pl-min" min="10" max="480" step="5" value="${s.plan.minutes}"></label></div>
        ${planOut ? html`${planOut.coreOnly ? html`<p class="banner banner-warn">${icon('info', 'i-sm')}${t('plan_core_only')}</p>` : ''}${planOut.leftover.length ? html`<p class="banner banner-warn">${icon('triangle-alert', 'i-sm')}${t('plan_leftover', { n: planOut.leftover.length })}</p>` : ''}<ol class="plan">${planOut.days.map((d) => html`<li><p class="plan-date">${fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</p><ul>${d.tasks.map((k) => html`<li><a href="${k.href}">${icon(k.icon, 'i-sm')}<span>${k.label}</span>${k.meta ? html`<small>${k.meta}</small>` : ''}</a></li>`)}</ul></li>`)}</ol>` : (s.plan.examDate ? html`<p class="muted">${t('plan_past')}</p>` : '')}
      </section>` : ''}

      ${feature('notes_and_bookmarks') ? html`<section><h2>${t('my_notes')}</h2>${notes.length ? html`<ul class="note-list">${notes.map((n) => html`<li><a href="#/chapter/${n.ch.id}/${n.sec}"><strong>${n.ch.number}. ${n.ch.title}</strong><span>${md(n.text.slice(0, 160))}</span></a></li>`)}</ul>` : empty(t('no_notes'))}
        <h2>${t('bookmarks')}</h2>${s.bookmarks.length ? html`<div class="weak-list">${s.bookmarks.map((id) => chapterMeta(id)).filter(Boolean).map((c) => html`<a class="weak-item tone-${c.tone}" href="#/chapter/${c.id}">${icon('bookmark', 'i-sm')}<span>${c.number}. ${c.title}</span></a>`)}</div>` : empty(t('no_bookmarks'))}</section>` : ''}

      <section class="settings"><h2>${t('settings')}</h2>
        <div class="card form-stack">
          <fieldset class="field"><legend class="field-label">${t('theme')}</legend><div class="seg" role="radiogroup">${['', 'light', 'dark'].map((v) => html`<label class="seg-opt"><input type="radio" name="theme" value="${v}"${(s.settings.theme || '') === v ? ' checked' : ''}><span>${t(v ? `theme_${v}` : 'theme_system')}</span></label>`)}</div></fieldset>
          <fieldset class="field"><legend class="field-label">${t('text_size')}</legend><div class="seg" role="radiogroup">${[-1, 0, 1, 2, 3].map((v) => html`<label class="seg-opt"><input type="radio" name="size" value="${v}"${s.settings.size === v ? ' checked' : ''}><span aria-label="${t('size_n', { n: v + 2 })}">A${'+'.repeat(Math.max(0, v))}${v < 0 ? '−' : ''}</span></label>`)}</div></fieldset>
          ${feature('quick_full_toggle') ? html`<label class="check"><input type="checkbox" id="st-quick"${s.settings.quick ? ' checked' : ''}><span><strong>${t('quick_default')}</strong><small>${t('quick_default_hint')}</small></span></label>` : ''}
          <label class="check"><input type="checkbox" id="st-motion"${s.settings.motion ? ' checked' : ''}><span>${t('reduce_motion')}</span></label>
          ${feature('flashcards_with_spaced_repetition') ? html`<div class="field-row"><label class="field"><span class="field-label">${t('new_per_day')}</span><input class="input" type="number" id="st-new" min="0" max="100" value="${s.settings.newPerDay}"></label><label class="field"><span class="field-label">${t('reviews_per_day')}</span><input class="input" type="number" id="st-rev" min="0" max="500" value="${s.settings.reviewPerDay}"></label></div>` : ''}
          ${light ? html`<label class="field"><span class="field-label">${t('daily_goal')}</span><input class="input" type="number" id="st-goal" min="1" max="200" value="${s.settings.goal}"></label>` : ''}
        </div></section>

      ${feature('progress_export_import') ? html`<section><h2>${t('your_data')}</h2><div class="card form-stack"><p class="muted">${t('data_hint')}</p>
        <div class="btn-row"><button class="btn btn-soft" type="button" id="d-export">${icon('download')}${t('export')}</button><label class="btn btn-soft" for="d-import">${icon('upload')}${t('import')}</label><input id="d-import" class="visually-hidden" type="file" accept="application/json,.json"><button class="btn btn-danger-soft" type="button" id="d-reset">${icon('trash-2')}${t('reset')}</button></div></div></section>` : ''}
    </div>`,
    after(root) {
      paint(root);
      const set = (fn) => {
        mutate((st) => fn(st.settings));
        document.dispatchEvent(new CustomEvent('folio:settings'));
      };
      $$('input[name=theme]', root).forEach((r) => r.addEventListener('change', () => set((x) => { x.theme = r.value; })));
      $$('input[name=size]', root).forEach((r) => r.addEventListener('change', () => set((x) => { x.size = Number(r.value); })));
      $('#st-quick', root)?.addEventListener('change', (e) => set((x) => { x.quick = e.target.checked; }));
      $('#st-motion', root)?.addEventListener('change', (e) => set((x) => { x.motion = e.target.checked; }));
      $('#st-new', root)?.addEventListener('change', (e) => set((x) => { x.newPerDay = Math.max(0, Number(e.target.value) || 0); }));
      $('#st-rev', root)?.addEventListener('change', (e) => set((x) => { x.reviewPerDay = Math.max(0, Number(e.target.value) || 0); }));
      $('#st-goal', root)?.addEventListener('change', (e) => set((x) => { x.goal = Math.max(1, Number(e.target.value) || 10); }));

      const replan = () => {
        mutate((st) => {
          st.plan.examDate = $('#pl-date', root).value;
          st.plan.minutes = Math.max(10, Number($('#pl-min', root).value) || 30);
        });
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      };
      $('#pl-date', root)?.addEventListener('change', replan);
      $('#pl-min', root)?.addEventListener('change', replan);

      $('#d-export', root)?.addEventListener('click', () => {
        const blob = new Blob([exportData()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${b.slug}-progress-${todayStr()}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      $('#d-import', root)?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          importData(await file.text());
          toast(t('import_ok'));
          document.dispatchEvent(new CustomEvent('folio:settings'));
          window.dispatchEvent(new HashChangeEvent('hashchange'));
        } catch {
          toast(t('import_bad'));
        }
      });
      $('#d-reset', root)?.addEventListener('click', async () => {
        if (!(await confirmDialog(t('reset_confirm'), t('reset'), { danger: true }))) return;
        resetAll();
        document.dispatchEvent(new CustomEvent('folio:settings'));
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        toast(t('reset_done'));
      });
    },
  };
}
