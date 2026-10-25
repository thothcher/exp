import { book, feature, loadCards } from '../data.js';
import { buildQueue, dueMistakes } from '../srs.js';
import { html, icon, t } from '../ui.js';
import { pageHead } from './parts.js';

export default async function practice() {
  const b = book();
  const cards = await loadCards();
  const due = buildQueue(cards).length + dueMistakes().length;
  const item = (href, ico, title, text, badge = '') => html`<a class="mode-card" href="${href}"><span class="mode-ico">${icon(ico)}</span><span class="mode-body"><strong>${title}</strong><small>${text}</small></span>${badge ? html`<span class="chip chip-tone">${badge}</span>` : icon('arrow-right')}</a>`;
  return {
    title: t('nav_practice'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_practice'), lead: t('practice_lead') })}
      <div class="mode-list">
        ${feature('flashcards_with_spaced_repetition') ? item('#/cards', 'layers', t('nav_cards'), t('cards_hint'), due ? t('due_n', { n: due }) : '') : ''}
        ${feature('quiz_and_mock_exam') ? item('#/quiz', 'list-checks', t('nav_quiz'), t('quiz_hint')) : ''}
        ${feature('quiz_and_mock_exam') ? item('#/exam/mock', 'timer', t('mock_exam'), t('mock_hint')) : ''}
        ${feature('exam_prep_hub') && b.stats.exam ? item('#/exam', 'graduation-cap', t('nav_exam'), t('exam_hint')) : ''}
        ${feature('glossary_and_search') ? item('#/glossary', 'book-a', t('nav_glossary'), t('glossary_hint')) : ''}
        ${b.bigPicture?.thesis ? item('#/big-picture', 'map', t('big_picture'), t('big_picture_hint')) : ''}
      </div>
    </div>`,
  };
}
