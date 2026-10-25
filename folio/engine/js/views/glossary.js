import { chapterMeta, glossaryList } from '../data.js';
import { $, $$, collator, debounce, html, md, t } from '../ui.js';
import { empty, pageHead } from './parts.js';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default async function glossary({ params, query }) {
  const focus = params[0] || '';
  const coll = collator();
  const list = [...glossaryList()].sort((a, b) => coll.compare(a.term, b.term));
  const entryHtml = (g) => html`<article class="gl-item${g.id === focus ? ' is-focus' : ''}" id="g-${g.id}" data-text="${fold([g.term, g.termOriginal, ...g.aliases].join(' '))}">
    <h2>${g.term}${g.termOriginal ? html` <span class="gl-orig">(${g.termOriginal})</span>` : ''}</h2>
    <p>${md(g.definition)}</p>
    <p class="gl-chapters">${g.chapters.map((id) => chapterMeta(id)).filter(Boolean).map((c) => html`<a class="chip chip-tone tone-${c.tone}" href="#/chapter/${c.id}">${c.number}. ${c.title}</a>`)}</p>
  </article>`;
  return {
    title: t('nav_glossary'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_glossary'), lead: t('glossary_lead', { n: list.length }) })}
      <div class="field"><label class="visually-hidden" for="gl-q">${t('search')}</label><input id="gl-q" class="input" type="search" value="${query.get('q') || ''}" placeholder="${t('filter_terms')}" autocomplete="off"></div>
      <div class="gl-list" id="gl-list">${list.length ? list.map(entryHtml) : empty(t('no_terms'))}</div>
      <p class="sr-empty" id="gl-none" hidden>${t('no_results')}</p>
    </div>`,
    after(root) {
      const input = $('#gl-q', root);
      const apply = () => {
        const tokens = fold(input.value).split(/\s+/).filter(Boolean);
        let shown = 0;
        for (const el of $$('.gl-item', root)) {
          const ok = tokens.every((tok) => el.dataset.text.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(tok)));
          el.hidden = !ok;
          if (ok) shown++;
        }
        $('#gl-none', root).hidden = shown > 0;
      };
      input.addEventListener('input', debounce(apply, 120));
      apply();
      if (focus) setTimeout(() => document.getElementById(`g-${focus}`)?.scrollIntoView({ block: 'center' }), 60);
    },
  };
}
