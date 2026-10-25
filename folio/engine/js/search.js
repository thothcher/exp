// Ctrl/Cmd+K search. A small in-house matcher: case- and diacritic-insensitive, prefix matching,
// no ASCII-only folding (so Georgian and other scripts work).
import { loadIndex, chapterMeta } from './data.js';
import { html, icon, t, mdText } from './ui.js';

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

let prepared = null;

async function prepare() {
  if (prepared) return prepared;
  const idx = await loadIndex();
  const mk = (text) => ({ text, w: words(text) });
  prepared = {
    chapters: idx.chapters.map((c) => ({ c, title: mk(c.t), body: mk([c.l, ...c.d, ...c.k].join(' ')), heads: c.h.map((h) => ({ h, m: mk(h.t) })) })),
    terms: idx.terms.map((x) => ({ x, m: mk([x.t, x.o, ...x.a].join(' ')) })),
    cards: idx.cards.map((x) => ({ x, m: mk(x.t) })),
  };
  return prepared;
}

const hit = (tokens, entry) => tokens.every((tok) => entry.w.some((w) => w.startsWith(tok)));

export async function search(query) {
  const tokens = words(query);
  if (!tokens.length) return { chapters: [], terms: [], cards: [] };
  const p = await prepare();
  const chapters = [];
  for (const e of p.chapters) {
    if (hit(tokens, e.title)) chapters.push({ score: 3, label: e.c.t, href: `#/chapter/${e.c.id}`, meta: chapterMeta(e.c.id)?.number });
    for (const h of e.heads) if (hit(tokens, h.m)) chapters.push({ score: 2, label: h.h.t, sub: e.c.t, href: `#/chapter/${e.c.id}/${h.h.id}` });
    if (hit(tokens, e.body)) chapters.push({ score: 1, label: e.c.t, sub: t('mentioned_in'), href: `#/chapter/${e.c.id}` });
  }
  const seen = new Set();
  const uniq = chapters.sort((a, b) => b.score - a.score).filter((r) => (seen.has(r.href) ? false : seen.add(r.href)));
  return {
    chapters: uniq.slice(0, 8),
    terms: p.terms.filter((e) => hit(tokens, e.m)).slice(0, 6).map((e) => ({ label: e.x.t, sub: mdText(e.x.d), href: `#/glossary/${e.x.id}` })),
    cards: p.cards.filter((e) => hit(tokens, e.m)).slice(0, 6).map((e) => ({ label: mdText(e.x.t), sub: chapterMeta(e.x.ch)?.title || '', href: `#/cards?ch=${e.x.ch}` })),
  };
}

export function openSearch() {
  if (document.querySelector('dialog.search')) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'search';
  dlg.setAttribute('aria-label', t('search'));
  dlg.innerHTML = html`<div class="search-box">${icon('search')}<input type="search" class="search-input" placeholder="${t('search_placeholder')}" aria-label="${t('search')}" autocomplete="off" spellcheck="false"><button type="button" class="btn btn-ghost btn-icon search-close" aria-label="${t('close')}">${icon('x')}</button></div><div class="search-results" role="listbox"></div>`.toString();
  document.body.append(dlg);
  const input = dlg.querySelector('input');
  const out = dlg.querySelector('.search-results');
  let items = [];
  let active = -1;

  const paintActive = () => items.forEach((el, i) => el.classList.toggle('is-active', i === active));
  const render = async () => {
    const res = await search(input.value);
    const group = (title, list) => (list.length ? html`<div class="sr-group"><p class="sr-title">${title}</p>${list.map((r) => html`<a class="sr-item" role="option" href="${r.href}"><span class="sr-label">${r.label}</span>${r.sub ? html`<span class="sr-sub">${r.sub}</span>` : ''}</a>`)}</div>` : '');
    const any = res.chapters.length + res.terms.length + res.cards.length;
    out.innerHTML = (input.value.trim() && !any
      ? html`<p class="sr-empty">${t('no_results')}</p>`
      : html`${group(t('sr_chapters'), res.chapters)}${group(t('sr_terms'), res.terms)}${group(t('sr_cards'), res.cards)}`).toString();
    items = [...out.querySelectorAll('.sr-item')];
    active = items.length ? 0 : -1;
    paintActive();
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paintActive();
      items[active].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault();
      items[active].click();
    }
  });
  out.addEventListener('click', (e) => {
    if (e.target.closest('.sr-item')) dlg.close();
  });
  dlg.querySelector('.search-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  input.focus();
}
