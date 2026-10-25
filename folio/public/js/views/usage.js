import { api } from '../api.js';
import { barChart, bindChart, compact, empty, fillDays, html, icon, int, money, pageHeader, paint } from '../ui.js';

const RANGES = [[7, '7 days'], [30, '30 days'], [90, '90 days']];

const share = (rows, key = 'cost') => {
  const max = Math.max(...rows.map((r) => r[key]), 0.0001);
  return (v) => Math.round((v / max) * 100);
};

function bars(rows, label, sub) {
  if (!rows.length) return html`<p class="muted">Nothing recorded in this period.</p>`;
  const pct = share(rows);
  return html`<ul class="hbars">${rows.map((r) => html`<li><span class="hbar-name">${label(r)}${sub ? html`<small class="muted block">${sub(r)}</small>` : ''}</span><span class="hbar-track" role="presentation"><span data-w="${pct(r.cost)}"></span></span><span class="hbar-val">${money(r.cost)}</span></li>`)}</ul>`;
}

export default async function usage({ query }) {
  const days = RANGES.some(([d]) => String(d) === query.get('d')) ? Number(query.get('d')) : 30;
  const u = await api.get(`/api/admin/usage?days=${days}`);
  const rows = fillDays(u.daily, Math.min(days, 90));
  const calls = u.daily.reduce((n, d) => n + d.calls, 0);
  const tokensIn = u.daily.reduce((n, d) => n + d.input, 0);
  const tokensOut = u.daily.reduce((n, d) => n + d.output, 0);
  return {
    title: 'Usage and spend',
    html: html`<div class="view">
      ${pageHeader({ title: 'Usage and spend', sub: 'Who is spending what. Dry runs are not counted.', actions: html`<div class="chips" role="group" aria-label="Period">${RANGES.map(([d, l]) => html`<a class="chip${d === days ? ' is-on' : ''}" href="#/usage?d=${d}">${l}</a>`)}</div>` })}
      <section class="stats">
        <div class="stat"><p class="stat-label">Spend, last ${days} days</p><p class="stat-value">${money(u.total)}</p></div>
        <div class="stat"><p class="stat-label">Requests</p><p class="stat-value">${int(calls)}</p></div>
        <div class="stat"><p class="stat-label">Tokens read</p><p class="stat-value">${compact(tokensIn)}</p></div>
        <div class="stat"><p class="stat-label">Tokens written</p><p class="stat-value">${compact(tokensOut)}</p></div>
      </section>
      <section class="panel">${u.total > 0 ? barChart(rows, { title: `Spend per day, last ${days} days`, id: 'us-chart' }) : empty('No spend in this period', 'Costs appear here once books are converted with a real API key.')}</section>
      <div class="grid-2 grid-top">
        <section class="panel"><h2>${icon('users-group-rounded')}<span>By person</span></h2>${bars(u.byUser, (r) => r.displayName || r.username, (r) => `${r.books} book${r.books === 1 ? '' : 's'} · ${compact(r.input)} in · ${compact(r.output)} out`)}</section>
        <section class="panel"><h2>${icon('book-2')}<span>Most expensive books</span></h2>${u.topBooks.length ? html`<ul class="hbars">${u.topBooks.map((b) => html`<li><span class="hbar-name"><a href="#/book/${b.id}">${b.title}</a><small class="muted block">${b.username}</small></span><span class="hbar-track" role="presentation"><span data-w="${share(u.topBooks)(b.cost)}"></span></span><span class="hbar-val">${money(b.cost)}</span></li>`)}</ul>` : html`<p class="muted">Nothing recorded in this period.</p>`}</section>
        <section class="panel"><h2>${icon('cpu')}<span>By model</span></h2>${bars(u.byModel, (r) => r.model, (r) => `${int(r.calls)} requests`)}</section>
        <section class="panel"><h2>${icon('layers-minimalistic')}<span>By kind of work</span></h2>${bars(u.byPurpose, (r) => ({ scan: 'Reading the structure', plan: 'Planning units', chapter: 'Writing chapters', practice: 'Cards, questions, exam', audit: 'Checking answer keys', assets: 'Big picture and interface' }[r.purpose] || r.purpose), (r) => `${int(r.calls)} requests`)}</section>
      </div>
    </div>`,
    after(root) {
      paint(root);
      bindChart(root, rows);
    },
  };
}
