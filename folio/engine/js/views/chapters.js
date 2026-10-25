import { chapters, loadCards } from '../data.js';
import { state } from '../store.js';
import { mastery } from '../srs.js';
import { html, paint, pct, raw, t } from '../ui.js';
import { chapterCard, pageHead } from './parts.js';

export default async function chaptersView({ query }) {
  const cards = await loadCards();
  const s = state();
  const only = query.get('f') === 'core';
  const list = chapters().filter((c) => !only || c.importance === 'core');
  return {
    title: t('nav_chapters'),
    html: html`<div class="page">
      ${pageHead({ title: t('nav_chapters'), lead: t('chapters_lead') })}
      <div class="filter-row" role="group" aria-label="${t('filter')}">
        <a class="filter-chip" href="#/chapters"${only ? '' : raw(' aria-current="true"')}>${t('all')}</a>
        <a class="filter-chip" href="#/chapters?f=core"${only ? raw(' aria-current="true"') : ''}>${t('imp_core')}</a>
      </div>
      <div class="ch-grid">${list.map((c) => chapterCard(c, pct(mastery(c.id, cards)), { studied: Boolean(s.studied[c.id]) }))}</div>
    </div>`,
    after: paint,
  };
}
