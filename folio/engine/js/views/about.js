import { book } from '../data.js';
import { html, icon, t } from '../ui.js';
import { pageHead } from './parts.js';

const SENSITIVE = /psych|medic|health|therap|clinic|psychi|law|legal|financ|econom|ფსიქ|სამართ|მედიც|ფინანს|право|психол|медиц|финанс/i;

export default async function about() {
  const b = book();
  const sensitive = SENSITIVE.test(`${b.subject} ${b.title}`);
  const contact = (b.feedbackContact || '').trim();
  const contactHref = contact ? (contact.includes('@') && !contact.startsWith('http') ? `mailto:${contact}` : contact) : '';
  return {
    title: t('nav_about'),
    html: html`<div class="page page-narrow">
      ${pageHead({ title: t('nav_about'), lead: t('about_lead') })}
      <section class="card about-card">
        <h2>${t('source_book')}</h2>
        <dl class="about-dl">
          <dt>${t('book_title')}</dt><dd><em>${b.title}</em></dd>
          ${b.authors ? html`<dt>${t('authors')}</dt><dd>${b.authors}</dd>` : ''}
          ${b.edition ? html`<dt>${t('edition')}</dt><dd>${b.edition}</dd>` : ''}
          ${b.publisher || b.year ? html`<dt>${t('publisher')}</dt><dd>${[b.publisher, b.year].filter(Boolean).join(', ')}</dd>` : ''}
          ${b.subject ? html`<dt>${t('subject')}</dt><dd>${b.subject}</dd>` : ''}
        </dl>
      </section>
      <section class="card about-card"><h2>${icon('info')}<span>${t('disclaimer_title')}</span></h2><p>${t('disclaimer')}</p>${sensitive ? html`<p>${t('disclaimer_sensitive')}</p>` : ''}${b.visibility === 'public' ? '' : html`<p>${t('private_note')}</p>`}</section>
      ${b.partial ? html`<section class="card about-card"><h2>${icon('triangle-alert')}<span>${t('partial_title')}</span></h2><p>${t('partial_text')}</p></section>` : ''}
      <section class="card about-card"><h2>${t('credits')}</h2><ul class="about-list">
        <li>${t('credit_fonts')}</li><li>${t('credit_icons')}</li><li>${t('credit_built', { date: b.generatedAt.slice(0, 10), engine: b.engine })}</li>
        ${b.footerCredit ? html`<li>${b.footerCredit}</li>` : ''}
      </ul>${contactHref ? html`<p><a class="btn btn-soft" href="${contactHref}" target="_blank" rel="noopener noreferrer">${icon('flag')}${t('report_mistake')}</a></p>` : ''}</section>
    </div>`,
  };
}
