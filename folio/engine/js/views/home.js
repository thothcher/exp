import { book, chapterMeta, chapters, feature, loadCards } from '../data.js';
import { state, streak } from '../store.js';
import { buildQueue, dueMistakes, hasProgress, mastery } from '../srs.js';
import { html, icon, paint, pct, t } from '../ui.js';
import { chapterCard, tile } from './parts.js';

export default async function home() {
  const b = book();
  const s = state();
  const cards = await loadCards();
  const list = chapters();
  const due = buildQueue(cards).length + dueMistakes().length;
  const studied = list.filter((c) => s.studied[c.id]).length;
  const known = cards.filter((c) => (s.cards[c.id]?.box || 0) >= 3).length;
  const examDone = Object.values(s.exam).filter((e) => e.done).length;
  const lastRoute = s.last && s.last.startsWith('chapter/') && chapterMeta(s.last.split('/')[1]) ? s.last : '';
  const next = list.find((c) => !s.studied[c.id]) || list[0];
  const started = studied > 0 || Object.keys(s.cards).length > 0 || s.days.length > 0;
  const weak = list
    .filter((c) => hasProgress(c.id, cards))
    .map((c) => ({ c, m: mastery(c.id, cards) }))
    .sort((a, z) => a.m - z.m)
    .slice(0, 3)
    .filter((x) => x.m < 0.8);
  const days = streak();
  const showToday = due > 0 || started;

  return {
    title: t('nav_home'),
    html: html`<div class="page">
      <section class="hero">
        <p class="eyebrow">${b.siteName}</p>
        <h1>${b.title}</h1>
        <p class="lead">${b.tagline || b.subject}</p>
        <div class="hero-actions">
          <a class="btn btn-primary btn-lg" href="#/${lastRoute || `chapter/${next.id}`}">${icon('arrow-right')}${started ? t('continue') : t('start')}</a>
          ${b.bigPicture?.thesis ? html`<a class="btn btn-ghost btn-lg" href="#/big-picture">${icon('map')}${t('whole_book')}</a>` : ''}
        </div>
        <p class="hero-meta">${t('book_stats', { chapters: b.stats.chapters, minutes: b.stats.minutes, cards: b.stats.cards, questions: b.stats.questions })}</p>
      </section>

      ${showToday ? html`<section class="today card" aria-labelledby="today-h">
        <h2 id="today-h">${icon('calendar-days')}<span>${t('today')}</span></h2>
        <div class="today-grid">
          ${feature('flashcards_with_spaced_repetition') ? html`<a class="today-item" href="#/cards?go=1"><span class="today-n">${due}</span><span>${t('cards_due')}</span></a>` : ''}
          <a class="today-item" href="#/chapter/${next.id}"><span class="today-n">${icon('book-open')}</span><span>${t('next_up')}: ${next.title}</span></a>
          ${feature('quiz_and_mock_exam') ? html`<a class="today-item" href="#/quiz?quick=1"><span class="today-n">${icon('timer')}</span><span>${t('quick_quiz')}</span></a>` : ''}
          ${b.gamification !== 'none' && days > 0 ? html`<div class="today-item is-static"><span class="today-n">${icon('flame')} ${days}</span><span>${t('day_streak')}</span></div>` : ''}
        </div>
      </section>` : ''}

      <section class="tiles" aria-label="${t('your_progress')}">
        ${tile({ value: `${studied}/${list.length}`, label: t('tile_chapters'), iconName: 'book-open' })}
        ${feature('flashcards_with_spaced_repetition') ? tile({ value: `${known}/${cards.length}`, label: t('tile_cards'), iconName: 'layers' }) : ''}
        ${feature('quiz_and_mock_exam') ? tile({ value: s.quiz.best ? `${s.quiz.best}%` : '–', label: t('tile_quiz'), iconName: 'list-checks' }) : ''}
        ${feature('exam_prep_hub') ? tile({ value: `${examDone}/${b.stats.exam}`, label: t('tile_exam'), iconName: 'graduation-cap' }) : ''}
      </section>

      ${weak.length ? html`<section class="weak"><h2>${t('weakest')}</h2><div class="weak-list">${weak.map(({ c, m }) => html`<a class="weak-item tone-${c.tone}" href="#/chapter/${c.id}">${icon(c.icon, 'i-sm')}<span>${c.number}. ${c.title}</span><strong>${pct(m)}%</strong></a>`)}</div></section>` : ''}

      <section class="chapters-sec"><div class="sec-title-row"><h2>${t('nav_chapters')}</h2><a class="link-more" href="#/chapters">${t('see_all')}${icon('arrow-right', 'i-sm')}</a></div>
        <div class="ch-grid">${list.map((c) => chapterCard(c, pct(mastery(c.id, cards)) , { studied: Boolean(s.studied[c.id]) }))}</div></section>

      <section class="shortcuts">
        ${feature('flashcards_with_spaced_repetition') ? html`<a class="shortcut" href="#/cards">${icon('layers')}<span><strong>${t('nav_cards')}</strong><small>${t('cards_hint')}</small></span></a>` : ''}
        ${feature('quiz_and_mock_exam') ? html`<a class="shortcut" href="#/quiz">${icon('list-checks')}<span><strong>${t('nav_quiz')}</strong><small>${t('quiz_hint')}</small></span></a>` : ''}
        ${feature('glossary_and_search') ? html`<a class="shortcut" href="#/glossary">${icon('book-a')}<span><strong>${t('nav_glossary')}</strong><small>${t('glossary_hint')}</small></span></a>` : ''}
      </section>

      ${feature('exam_prep_hub') && b.stats.exam ? html`<a class="exam-banner" href="#/exam">${icon('graduation-cap')}<span><strong>${t('exam_banner_title')}</strong><small>${t('exam_banner_text')}</small></span>${icon('arrow-right')}</a>` : ''}
    </div>`,
    after: paint,
  };
}
