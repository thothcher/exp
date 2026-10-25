import { chapters, chapterMeta, loadCards, loadQuestions } from '../data.js';
import { state } from '../store.js';
import { buildQueue, dueMistakes, rateCard, rateMistake } from '../srs.js';
import { $, $$, html, icon, md, paint, shuffle, t, toast } from '../ui.js';
import { correctText } from './qrender.js';
import { empty, pageHead } from './parts.js';

function mistakeCard(q) {
  return { id: `m:${q.id}`, mistake: q.id, ch: q.ch, front: q.stem, back: `${correctText(q)}${q.explain ? `\n${q.explain}` : ''}`, isMistake: true };
}

export default async function cardsView({ query, onKey, navigate }) {
  const [cards, questions] = await Promise.all([loadCards(), loadQuestions()]);
  return query.get('go') === '1' ? session({ cards, questions, query, onKey, navigate }) : setup(cards, query);
}

function setup(cards, query) {
  const s = state();
  const ch = query.get('ch') || '';
  const dueAll = buildQueue(cards).length;
  const mistakes = dueMistakes().length;
  const known = cards.filter((c) => (s.cards[c.id]?.box || 0) >= 4).length;
  return {
    title: t('nav_cards'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_cards'), lead: t('cards_lead') })}
      <section class="card setup">
        <div class="setup-stats"><div><strong>${dueAll}</strong><span>${t('cards_due')}</span></div><div><strong>${mistakes}</strong><span>${t('mistake_cards')}</span></div><div><strong>${known}/${cards.length}</strong><span>${t('cards_mastered')}</span></div></div>
        <form id="cards-form" class="form-stack">
          <label class="field"><span class="field-label">${t('scope')}</span>
            <select class="input" name="ch"><option value="">${t('all_chapters')}</option>${chapters().filter((c) => cards.some((x) => x.ch === c.id)).map((c) => html`<option value="${c.id}"${c.id === ch ? ' selected' : ''}>${c.number}. ${c.title}</option>`)}</select></label>
          <label class="check"><input type="checkbox" name="shuffle" checked><span>${t('shuffle')}</span></label>
          <label class="check"><input type="checkbox" name="hide"><span>${t('hide_mastered')}</span></label>
          <label class="check"><input type="checkbox" name="cram"><span><strong>${t('cram')}</strong><small>${t('cram_hint')}</small></span></label>
          <button class="btn btn-primary btn-lg" type="submit">${icon('arrow-right')}${t('start_session')}</button>
        </form>
      </section>
    </div>`,
    after(root) {
      $('#cards-form', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const q = new URLSearchParams({ go: '1' });
        if (f.get('ch')) q.set('ch', f.get('ch'));
        if (f.get('hide')) q.set('hide', '1');
        if (f.get('cram')) q.set('cram', '1');
        q.set('shuffle', f.get('shuffle') ? '1' : '0');
        location.hash = `#/cards?${q}`;
      });
    },
  };
}

function session({ cards, questions, query, onKey }) {
  const opts = { chapter: query.get('ch') || '', cram: query.get('cram') === '1', hideMastered: query.get('hide') === '1' };
  const byId = new Map(questions.map((q) => [q.id, q]));
  let queue = buildQueue(cards, opts);
  if (!opts.chapter && !opts.cram) {
    queue = [...queue, ...dueMistakes().map((id) => byId.get(id)).filter(Boolean).map(mistakeCard)];
  }
  if (query.get('shuffle') !== '0') queue = shuffle(queue);

  const total = queue.length;
  let i = 0;
  let flipped = false;
  const result = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let hard = [];
  let stage;

  const ratingBtn = (r, key, label, iconName) => html`<button type="button" class="rate rate-${r}" data-r="${r}"><span class="rate-key">${key}</span>${icon(iconName, 'i-sm')}<span>${label}</span></button>`;

  const card = () => {
    const c = queue[i];
    const meta = chapterMeta(c.ch);
    stage.innerHTML = html`<div class="fl-top"><span class="fl-count">${t('card_n_of', { n: i + 1, total: queue.length })}</span>${meta ? html`<span class="chip chip-tone tone-${meta.tone}">${meta.number}. ${meta.title}</span>` : ''}${c.isMistake ? html`<span class="chip chip-warn">${t('mistake_card')}</span>` : ''}</div>
      <span class="bar" role="presentation"><span data-w="${Math.round((i / queue.length) * 100)}"></span></span>
      <button type="button" class="flash-card${flipped ? ' is-flipped' : ''}" aria-label="${t('flip')}" aria-pressed="${flipped}">
        <span class="fc-side fc-front"><span class="fc-label">${t('front')}</span><span class="fc-text">${md(c.front)}</span></span>
        <span class="fc-side fc-back"><span class="fc-label">${t('back_side')}</span><span class="fc-text">${c.back.split('\n').map((line) => html`<span>${md(line)}</span>`)}</span>${c.src ? html`<span class="fc-src">${t('in_book')}: ${c.src}</span>` : ''}</span>
      </button>
      ${flipped
    ? html`<div class="rates" role="group" aria-label="${t('rate')}">${ratingBtn(1, 1, t('again'), 'rotate-ccw')}${ratingBtn(2, 2, t('hard'), 'frown')}${ratingBtn(3, 3, t('good'), 'smile')}${ratingBtn(4, 4, t('easy'), 'zap')}</div>`
    : html`<button type="button" class="btn btn-primary btn-lg fl-reveal">${icon('eye')}${t('show_answer')}</button><p class="fl-hint">${t('flip_hint')}</p>`}`.toString();
    paint(stage);
  };

  const flip = () => {
    flipped = true;
    card();
    $('.rate-3', stage)?.focus({ preventScroll: true });
  };

  const rate = (r) => {
    const c = queue[i];
    if (c.isMistake) rateMistake(c.mistake, r);
    else rateCard(c.id, r);
    result[r] += 1;
    if (r <= 2) hard.push(c);
    flipped = false;
    i += 1;
    i < queue.length ? card() : finish();
  };

  const finish = () => {
    const done = result[1] + result[2] + result[3] + result[4];
    stage.innerHTML = html`<div class="fl-done card"><span class="done-ico">${icon('circle-check')}</span><h2>${t('round_done')}</h2><p>${t('round_summary', { n: done })}</p>
      <div class="result-row"><span class="chip chip-bad">${t('again')} ${result[1]}</span><span class="chip chip-warn">${t('hard')} ${result[2]}</span><span class="chip chip-ok">${t('good')} ${result[3]}</span><span class="chip chip-ok">${t('easy')} ${result[4]}</span></div>
      <div class="fl-done-actions">${hard.length ? html`<button type="button" class="btn btn-primary" data-act="repeat">${icon('rotate-ccw')}${t('repeat_hard', { n: hard.length })}</button>` : ''}<a class="btn btn-ghost" href="#/cards">${t('back_to_setup')}</a><a class="btn btn-ghost" href="#/practice">${t('nav_practice')}</a></div></div>`.toString();
    $('[data-act=repeat]', stage)?.addEventListener('click', () => {
      queue = shuffle(hard);
      hard = [];
      i = 0;
      result[1] = result[2] = result[3] = result[4] = 0;
      card();
    });
  };

  if (!total) {
    return {
      title: t('nav_cards'),
      html: html`<div class="page page-narrow">${pageHead({ title: t('nav_cards') })}${empty(t('nothing_due'), html`<div class="empty-actions"><a class="btn btn-primary" href="#/cards?go=1&cram=1${opts.chapter ? `&ch=${opts.chapter}` : ''}">${icon('zap')}${t('cram')}</a><a class="btn btn-ghost" href="#/cards">${t('choose_scope')}</a></div>`)}</div>`,
    };
  }

  onKey((e) => {
    if (!stage || !queue[i]) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (!flipped) {
        e.preventDefault();
        flip();
      }
    } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
  });

  return {
    title: t('nav_cards'),
    html: html`<div class="page page-narrow"><div class="fl-head"><a class="back" href="#/cards">${icon('arrow-left', 'i-sm')}${t('back')}</a></div><div class="flash" id="fl-stage"></div></div>`,
    after(root) {
      stage = $('#fl-stage', root);
      stage.addEventListener('click', (e) => {
        if (e.target.closest('.flash-card, .fl-reveal') && !flipped) flip();
        else if (e.target.closest('.flash-card') && flipped) {
          /* flipping back is not offered: the answer must be rated */
        }
        const r = e.target.closest('[data-r]');
        if (r) rate(Number(r.dataset.r));
      });
      card();
      $$('.fl-reveal', root)[0]?.focus({ preventScroll: true });
      if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) toast(t('keys_hint'));
    },
  };
}
