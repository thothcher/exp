import { api } from '../api.js';
import { S } from '../state.js';
import { $, $$, ago, debounce, empty, html, icon, int, money, paint, pageHeader, progressBar, status } from '../ui.js';
import { hint } from './overview.js';

const GROUPS = {
  all: { label: 'All', test: () => true },
  active: { label: 'In progress', test: (b) => ['queued', 'running'].includes(b.status) },
  needs: { label: 'Needs you', test: (b) => ['awaiting', 'attention', 'failed'].includes(b.status) },
  done: { label: 'Done', test: (b) => b.status === 'done' },
};

export default async function library({ query, onLeave }) {
  const admin = S.user.role === 'admin';
  const scope = admin && query.get('scope') === 'all' ? 'all' : 'mine';
  let group = query.get('f') in GROUPS ? query.get('f') : 'all';
  let text = '';
  let books = (await api.get(`/api/books${scope === 'all' ? '?scope=all' : ''}`)).books;

  const body = () => {
    const q = text.trim().toLowerCase();
    const list = books.filter((b) => GROUPS[group].test(b) && (!q || `${b.title} ${b.owner.username || ''}`.toLowerCase().includes(q)));
    if (!list.length) return html`<tr><td colspan="${scope === 'all' ? 7 : 6}">${books.length ? empty('Nothing matches', 'Try another filter or search.') : empty('No books yet', 'Upload a PDF to start.', html`<a class="btn btn-primary" href="#/new">${icon('add-circle')}New book</a>`)}</td></tr>`;
    return html`${list.map((b) => html`<tr class="clickable" data-href="#/book/${b.id}">
      <td><a class="cell-title" href="#/book/${b.id}">${b.title}</a>${hint(b) ? html`<small class="muted block clamp">${hint(b)}</small>` : ''}</td>
      ${scope === 'all' ? html`<td>${b.owner.displayName || b.owner.username}</td>` : ''}
      <td>${status(b.status)}${b.dryRun ? html` <span class="tag">dry run</span>` : ''}</td>
      <td class="prog-cell">${b.unitsTotal ? html`${progressBar(b.unitsDone, b.unitsTotal)}<small class="muted">${b.unitsDone} of ${b.unitsTotal} units</small>` : html`<small class="muted">planning</small>`}</td>
      <td class="num hide-sm">${int(b.pagesTotal)}</td>
      <td class="num hide-sm">${b.dryRun ? '–' : money(b.costUsd)}</td>
      <td class="muted nowrap hide-sm">${ago(b.updatedAt)}</td>
    </tr>`)}`;
  };

  const chips = (counts) => html`${Object.entries(GROUPS).map(([k, g]) => html`<button type="button" class="chip${group === k ? ' is-on' : ''}" data-group="${k}" aria-pressed="${group === k}">${g.label}<span class="chip-n">${counts[k]}</span></button>`)}`;
  const counts = () => Object.fromEntries(Object.entries(GROUPS).map(([k, g]) => [k, books.filter(g.test).length]));

  return {
    title: 'Library',
    html: html`<div class="view">
      ${pageHeader({ title: 'Library', sub: scope === 'all' ? 'Every book the team has started.' : 'The books you started.', actions: html`${admin ? html`<a class="btn btn-ghost" href="#/books${scope === 'all' ? '' : '?scope=all'}">${icon(scope === 'all' ? 'user' : 'users-group-rounded')}<span>${scope === 'all' ? 'Only mine' : 'Whole team'}</span></a>` : ''}<a class="btn btn-primary" href="#/new">${icon('add-circle')}<span>New book</span></a>` })}
      <div class="toolbar"><div class="chips" id="chips" role="group" aria-label="Filter by state">${chips(counts())}</div><label class="search">${icon('magnifer')}<span class="visually-hidden">Search books</span><input class="input" type="search" id="q" placeholder="Search by title${scope === 'all' ? ' or person' : ''}" autocomplete="off"></label></div>
      <div class="table-wrap"><table class="table table-rows"><thead><tr><th>Book</th>${scope === 'all' ? html`<th>Owner</th>` : ''}<th>State</th><th>Progress</th><th class="num hide-sm">Pages</th><th class="num hide-sm">Cost</th><th class="hide-sm">Updated</th></tr></thead><tbody id="rows">${body()}</tbody></table></div>
    </div>`,
    after(root) {
      const draw = () => {
        $('#rows', root).innerHTML = body().toString();
        $('#chips', root).innerHTML = chips(counts()).toString();
        paint(root);
      };
      draw();
      root.addEventListener('click', (e) => {
        const tr = e.target.closest('tr.clickable');
        if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
        const chip = e.target.closest('[data-group]');
        if (chip) {
          group = chip.dataset.group;
          draw();
        }
      });
      $('#q', root).addEventListener('input', debounce((e) => {
        text = e.target.value;
        draw();
      }, 120));
      const timer = setInterval(async () => {
        if (document.hidden || !books.some((b) => ['queued', 'running', 'awaiting'].includes(b.status))) return;
        try {
          books = (await api.get(`/api/books${scope === 'all' ? '?scope=all' : ''}`)).books;
          draw();
        } catch {
          // keep the last view
        }
      }, 5000);
      onLeave(() => clearInterval(timer));
    },
  };
}
