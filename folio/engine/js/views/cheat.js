// Printable cheat sheets: TL;DR, key terms and key points of one chapter, or of the whole book.
import { book, chapterMeta, chapters, loadChapter, term } from '../data.js';
import { $, html, icon, md, t } from '../ui.js';
import { notFound } from './parts.js';

function sheet(c, ch) {
  const defs = [];
  for (const sec of ch.sections) for (const b of sec.blocks) if (b.t === 'define') defs.push({ term: b.term, original: b.termOriginal, x: b.x });
  const known = new Set(defs.map((d) => d.term));
  for (const id of ch.terms) {
    const e = term(id);
    if (e && !known.has(e.term)) defs.push({ term: e.term, original: e.termOriginal, x: e.definition });
  }
  const formulas = ch.sections.flatMap((s) => s.blocks.filter((b) => b.t === 'formula'));
  return html`<section class="cheat tone-${c.tone}"><h2><span class="chip chip-tone">${c.number}</span>${c.title}</h2>
    <h3>${t('tldr')}</h3><ul>${ch.tldr.map((x) => html`<li>${md(x)}</li>`)}</ul>
    ${defs.length ? html`<h3>${t('key_terms')}</h3><dl>${defs.map((d) => html`<dt>${d.term}${d.original ? html` <span class="define-orig">(${d.original})</span>` : ''}</dt><dd>${md(d.x)}</dd>`)}</dl>` : ''}
    ${formulas.length ? html`<h3>${t('formulas')}</h3>${formulas.map((f) => html`<p><code>${f.tex}</code></p>`)}` : ''}
    <h3>${t('core_remember')}</h3><ol>${ch.keyPoints.map((k) => html`<li>${md(k.x)}</li>`)}</ol></section>`;
}

export default async function cheat({ params }) {
  const which = params[0] || 'all';
  const metas = which === 'all' ? chapters() : [chapterMeta(which)].filter(Boolean);
  if (!metas.length) return notFound();
  const loaded = await Promise.all(metas.map((c) => loadChapter(c.id)));
  const title = which === 'all' ? t('cheat_all') : t('cheat_sheet_of', { title: metas[0].title });
  return {
    title,
    html: html`<div class="page page-cheat"><div class="cheat-bar"><a class="back" href="${which === 'all' ? '#/progress' : `#/chapter/${which}`}">${icon('arrow-left', 'i-sm')}${t('back')}</a><button type="button" class="btn btn-primary" id="print">${icon('printer')}${t('print')}</button></div>
      <h1>${which === 'all' ? book().title : metas[0].title}</h1><p class="muted">${title}</p>${metas.map((c, i) => sheet(c, loaded[i]))}</div>`,
    after(root) {
      $('#print', root).addEventListener('click', () => window.print());
    },
  };
}
