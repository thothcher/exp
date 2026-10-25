import { api } from '../api.js';
import { S } from '../state.js';
import { ago, barChart, bindChart, compact, empty, fillDays, html, icon, int, money, paint, pageHeader, progressBar, status } from '../ui.js';
import { describe } from './activity.js';

export function hint(b) {
  if (b.status === 'awaiting') return b.gate === 'blueprint' ? 'Review the blueprint and approve it' : 'Review the pilot chapter and approve it';
  if (['attention', 'failed'].includes(b.status)) return b.error || 'Something needs your attention';
  return '';
}

export function bookRow(b, { owner = false } = {}) {
  const note = hint(b);
  return html`<a class="row" href="#/book/${b.id}">
    <span class="row-main"><strong>${b.title}</strong><small>${owner ? `${b.owner.displayName || b.owner.username} · ` : ''}${b.pagesTotal} pages · updated ${ago(b.updatedAt)}</small>${note ? html`<small class="row-note">${note}</small>` : ''}</span>
    <span class="row-side">${b.unitsTotal ? html`<span class="row-prog">${progressBar(b.unitsDone, b.unitsTotal)}<small>${b.unitsDone}/${b.unitsTotal} units</small></span>` : ''}${status(b.status)}</span>
  </a>`;
}

export default async function overview({ onLeave }) {
  const admin = S.user.role === 'admin';
  const load = async () => {
    const [ov, list] = await Promise.all([api.get('/api/overview'), api.get('/api/books')]);
    return { ov, books: list.books };
  };
  let { ov, books } = await load();

  const render = () => {
    const me = ov.me;
    const needs = books.filter((b) => ['awaiting', 'attention', 'failed'].includes(b.status));
    const recent = books.slice(0, 6);
    const budget = me.budgetUsd;
    const month = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date());
    const team = ov.team;
    const chartRows = team ? fillDays(team.daily, 30) : [];
    return html`
      <section class="stats" aria-label="Your numbers">
        <div class="stat"><p class="stat-label">In progress</p><p class="stat-value">${me.activeBooks}<small> of ${me.maxActiveBooks}</small></p><p class="stat-sub">books being converted</p></div>
        <div class="stat${me.awaiting ? ' is-warn' : ''}"><p class="stat-label">Waiting for you</p><p class="stat-value">${me.awaiting}</p><p class="stat-sub">gates to approve</p></div>
        <div class="stat${me.attention ? ' is-bad' : ''}"><p class="stat-label">Needs attention</p><p class="stat-value">${me.attention}</p><p class="stat-sub">stopped with a problem</p></div>
        <div class="stat"><p class="stat-label">Your spend in ${month}</p><p class="stat-value">${money(me.monthSpendUsd)}</p>${budget > 0 ? html`<p class="stat-sub">${progressBar(me.monthSpendUsd, budget, me.monthSpendUsd / budget > 0.85 ? 'is-warn' : '')}of ${money(budget)} budget</p>` : html`<p class="stat-sub">no personal limit</p>`}</div>
      </section>

      ${needs.length ? html`<section class="panel"><h2>${icon('bell-bing')}<span>Needs you</span></h2><div class="rows">${needs.map((b) => bookRow(b))}</div></section>` : ''}

      <section class="panel"><div class="panel-head"><h2>${icon('book-2')}<span>Recent books</span></h2><a class="link" href="#/books">All books${icon('alt-arrow-right', 'i-sm')}</a></div>
        ${recent.length ? html`<div class="rows">${recent.map((b) => bookRow(b))}</div>` : empty('No books yet', 'Upload a PDF to start your first conversion.', html`<a class="btn btn-primary" href="#/new">${icon('add-circle')}New book</a>`)}</section>

      ${admin && team ? html`<section class="panel"><div class="panel-head"><h2>${icon('users-group-rounded')}<span>The team this month</span></h2><a class="link" href="#/usage">Usage and spend${icon('alt-arrow-right', 'i-sm')}</a></div>
        <div class="stats stats-inner">
          <div class="stat"><p class="stat-label">Team spend</p><p class="stat-value">${money(team.monthSpendUsd)}</p><p class="stat-sub">${team.budgetUsd > 0 ? html`${progressBar(team.monthSpendUsd, team.budgetUsd)}of ${money(team.budgetUsd)} team budget` : 'no team limit set'}</p></div>
          <div class="stat"><p class="stat-label">People</p><p class="stat-value">${team.users}</p><p class="stat-sub">active accounts</p></div>
          <div class="stat"><p class="stat-label">Books</p><p class="stat-value">${team.books}</p><p class="stat-sub">in the library</p></div>
        </div>
        ${team.daily.length ? barChart(chartRows, { title: 'Spend per day, last 30 days', id: 'ov-chart' }) : html`<p class="muted">No spend recorded in the last 30 days.</p>`}
        ${team.inProgress.length ? html`<h3>Running and stuck right now</h3><div class="table-wrap"><table class="table"><thead><tr><th>Book</th><th>Owner</th><th>Status</th><th class="num">Units</th><th class="num">Cost</th></tr></thead><tbody>${team.inProgress.map((b) => html`<tr class="clickable" data-href="#/book/${b.id}"><td><a href="#/book/${b.id}">${b.title}</a></td><td>${b.username}</td><td>${status(b.status)}</td><td class="num">${b.unitsDone}/${b.unitsTotal}</td><td class="num">${money(b.costUsd)}</td></tr>`)}</tbody></table></div>` : ''}
        <h3>Latest activity</h3><ul class="feed">${team.recent.map((r) => html`<li><strong>${r.username || 'Someone'}</strong> ${describe(r.action)}${r.target ? html` <code>${r.target}</code>` : ''}<small>${ago(r.ts)}</small></li>`)}</ul></section>` : ''}
      <p class="muted center">${int(me.total)} books in total · ${compact(books.reduce((n, b) => n + b.inputTokens + b.outputTokens, 0))} tokens used by your books</p>`;
  };

  const page = html`<div class="view">${pageHeader({ title: 'Overview', sub: `Welcome back, ${S.user.displayName}.`, actions: html`<a class="btn btn-primary" href="#/new">${icon('add-circle')}<span>New book</span></a>` })}<div id="ov">${render()}</div></div>`;
  return {
    title: 'Overview',
    html: page,
    after(root) {
      const mount = () => {
        const el = root.querySelector('#ov');
        paint(el);
        if (ov.team) bindChart(el, fillDays(ov.team.daily, 30));
        el.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', (e) => !e.target.closest('a') && (location.hash = tr.dataset.href)));
      };
      mount();
      const timer = setInterval(async () => {
        if (document.hidden) return;
        try {
          ({ ov, books } = await load());
          root.querySelector('#ov').innerHTML = render().toString();
          mount();
        } catch {
          // keep the last view
        }
      }, 8000);
      onLeave(() => clearInterval(timer));
    },
  };
}
