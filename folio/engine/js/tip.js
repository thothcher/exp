// Tap-a-term tooltips: one popover element, closes on Escape or an outside click.
import { term } from './data.js';
import { html, icon, md, t } from './ui.js';

let tip = null;
let owner = null;

function hide() {
  tip?.remove();
  tip = null;
  owner?.setAttribute('aria-expanded', 'false');
  owner = null;
}

function show(button) {
  if (owner === button) return hide();
  hide();
  const entry = term(button.dataset.term);
  if (!entry) return;
  owner = button;
  button.setAttribute('aria-expanded', 'true');
  tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'dialog');
  tip.setAttribute('aria-label', entry.term);
  tip.innerHTML = html`<p class="tip-term">${entry.term}${entry.termOriginal ? html` <span class="tip-orig">(${entry.termOriginal})</span>` : ''}</p><p class="tip-def">${md(entry.definition)}</p><a class="tip-link" href="#/glossary/${entry.id}">${t('open_in_glossary')}${icon('arrow-right', 'i-sm')}</a>`.toString();
  document.body.append(tip);
  const r = button.getBoundingClientRect();
  const w = Math.min(340, window.innerWidth - 24);
  tip.style.width = `${w}px`;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12);
  const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight || r.top < tip.offsetHeight + 16;
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${(below ? r.bottom + 8 : r.top - tip.offsetHeight - 8) + window.scrollY}px`;
}

export function initTips() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.term');
    if (b) {
      e.preventDefault();
      show(b);
    } else if (!e.target.closest?.('.tip')) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tip) {
      const o = owner;
      hide();
      o?.focus();
    }
  });
  window.addEventListener('hashchange', hide);
}
