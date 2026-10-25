import { book, chapterMeta } from '../data.js';
import { $, $$, html, icon, md, t } from '../ui.js';
import { empty, pageHead } from './parts.js';

export default async function bigPicture() {
  const bp = book().bigPicture;
  if (!bp?.thesis) return { title: t('big_picture'), html: html`<div class="page page-narrow">${empty(t('no_big_picture'))}</div>` };
  const recap = bp.recap.map((r) => ({ ...r, c: chapterMeta(r.ch) })).filter((r) => r.c);
  return {
    title: t('big_picture'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('big_picture'), lead: t('big_picture_lead') })}
      <section class="bp-thesis card"><p class="eyebrow">${t('the_thesis')}</p><p class="bp-thesis-text">${md(bp.thesis)}</p></section>
      ${bp.coreIdeas.length ? html`<section class="bp-ideas"><h2>${t('core_ideas')}</h2><ol>${bp.coreIdeas.map((x) => html`<li>${md(x)}</li>`)}</ol></section>` : ''}
      ${bp.howChaptersConnect ? html`<section class="bp-connect"><h2>${t('how_connect')}</h2><p>${md(bp.howChaptersConnect)}</p></section>` : ''}
      ${recap.length ? html`<section class="bp-deck" aria-roledescription="carousel" aria-label="${t('recap_deck')}">
        <div class="sec-title-row"><h2>${t('recap_deck')}</h2><div class="deck-nav"><button type="button" class="btn btn-ghost btn-icon" data-deck="-1" aria-label="${t('previous')}">${icon('chevron-left')}</button><button type="button" class="btn btn-ghost btn-icon" data-deck="1" aria-label="${t('next')}">${icon('chevron-right')}</button></div></div>
        <div class="deck" tabindex="0">${recap.map((r, i) => html`<a class="deck-card tone-${r.c.tone}" href="#/chapter/${r.c.id}" aria-label="${t('card_n_of', { n: i + 1, total: recap.length })}"><span class="deck-n">${icon(r.c.icon)} ${r.c.number}</span><strong>${r.c.title}</strong><span>${md(r.text)}</span></a>`)}</div>
      </section>` : ''}
    </div>`,
    after(root) {
      const deck = $('.deck', root);
      if (!deck) return;
      $$('[data-deck]', root).forEach((b) => b.addEventListener('click', () => {
        const step = deck.firstElementChild.getBoundingClientRect().width + 14;
        deck.scrollBy({ left: Number(b.dataset.deck) * step, behavior: 'smooth' });
      }));
    },
  };
}
