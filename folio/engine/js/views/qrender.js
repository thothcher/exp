// One question on screen: rendering, answering, feedback. Used by the chapter quick check, the quiz and the mock exam.
import { html, icon, md, t, shuffle, mdText } from '../ui.js';

/** Shuffles options at runtime (the authored order puts the correct answer first, master prompt §4.5). */
export function prepare(q) {
  if (q.type === 'tf') return { q, order: [0, 1] };
  const n = q.options.length;
  const idx = [...Array(n).keys()];
  if (q.type === 'multi' || q.fixedOrder) return { q, order: idx };
  return { q, order: shuffle(idx) };
}

function correctSet(q) {
  if (q.type === 'multi') return new Set(q.answers);
  if (q.type === 'tf') return new Set([q.answer ? 0 : 1]); // option 0 = true, 1 = false
  return new Set([q.fixedOrder && Number.isInteger(q.answer) ? q.answer : 0]);
}

export function correctText(q) {
  if (q.type === 'tf') return q.answer ? t('true') : t('false');
  return [...correctSet(q)].map((i) => mdText(q.options[i])).join(' / ');
}

export function questionHtml(pq, { number = 0, total = 0 } = {}) {
  const { q, order } = pq;
  const multi = q.type === 'multi';
  const labels = q.type === 'tf' ? [t('true'), t('false')] : order.map((i) => q.options[i]);
  return html`<div class="q" data-qid="${q.id}">
    ${number ? html`<p class="q-count">${t('question_of', { n: number, total })}</p>` : ''}
    <h3 class="q-stem">${md(q.stem)}</h3>
    ${multi ? html`<p class="q-hint">${t('select_all')}</p>` : ''}
    <div class="q-opts" role="${multi ? 'group' : 'radiogroup'}" aria-label="${t('answers')}">
      ${labels.map((label, k) => html`<button type="button" class="opt" data-k="${k}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="false"><span class="opt-key">${k + 1}</span><span class="opt-text">${md(label)}</span><span class="opt-mark" aria-hidden="true"></span></button>`)}
    </div>
    ${multi ? html`<button type="button" class="btn btn-primary q-check" disabled>${t('check')}</button>` : ''}
    <div class="q-feedback" aria-live="polite"></div>
  </div>`;
}

/** Wires one rendered question. `onDone({ ok, picked })` runs once, after the answer is checked. */
export function bind(root, pq, onDone) {
  const { q, order } = pq;
  const opts = [...root.querySelectorAll('.opt')];
  const multi = q.type === 'multi';
  const right = correctSet(q);
  const originalOf = (k) => (q.type === 'tf' ? k : order[k]);
  const picked = new Set();
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    const chosen = [...picked].map(originalOf);
    const ok = chosen.length === right.size && chosen.every((i) => right.has(i));
    opts.forEach((o, k) => {
      const orig = originalOf(k);
      o.disabled = true;
      const mark = o.querySelector('.opt-mark');
      if (right.has(orig)) {
        o.classList.add('is-correct');
        mark.innerHTML = icon('check').toString();
      } else if (picked.has(k)) {
        o.classList.add('is-wrong');
        mark.innerHTML = icon('x').toString();
      }
    });
    const fb = root.querySelector('.q-feedback');
    const why = q.whyWrong ? [...picked].map((k) => q.whyWrong[originalOf(k)]).filter(Boolean) : [];
    fb.className = `q-feedback ${ok ? 'is-ok' : 'is-bad'}`;
    fb.innerHTML = html`<p class="fb-title">${icon(ok ? 'circle-check' : 'circle-x')}<span>${ok ? t('correct') : t('incorrect')}</span></p>
      ${!ok && q.type !== 'tf' ? html`<p class="fb-answer">${t('right_answer')}: <strong>${md(correctText(q))}</strong></p>` : ''}
      ${q.explain ? html`<p class="fb-explain">${md(q.explain)}</p>` : ''}
      ${why.map((w) => html`<p class="fb-why">${md(w)}</p>`)}
      ${q.src ? html`<p class="fb-src">${icon('book-open', 'i-sm')}${t('in_book')}: ${q.src}</p>` : ''}
      ${q.origin === 'ours' ? html`<p class="fb-src"><span class="chip chip-outline">${t('added_by_us')}</span></p>` : ''}`.toString();
    onDone({ ok, picked: [...picked].map(originalOf) });
  };

  const check = root.querySelector('.q-check');
  opts.forEach((o, k) => {
    o.addEventListener('click', () => {
      if (done) return;
      if (multi) {
        if (picked.has(k)) picked.delete(k);
        else picked.add(k);
        o.classList.toggle('is-picked', picked.has(k));
        o.setAttribute('aria-checked', String(picked.has(k)));
        check.disabled = picked.size === 0;
      } else {
        picked.add(k);
        o.setAttribute('aria-checked', 'true');
        finish();
      }
    });
  });
  check?.addEventListener('click', finish);

  return {
    pick: (k) => opts[k]?.click(),
    isDone: () => done,
    submit: () => check?.click(),
  };
}
