import { api } from '../api.js';
import { $, ago, dateTime, empty, html, icon, pageHeader } from '../ui.js';

const LABELS = {
  'login.ok': 'signed in',
  'login.failed': 'failed to sign in',
  'login.lockout': 'was locked out after repeated failures',
  'login.locked': 'tried to sign in while locked out',
  logout: 'signed out',
  'password.change': 'changed their password',
  'user.create': 'created an account',
  'user.update': 'changed an account',
  'user.delete': 'deleted an account',
  'user.reset_password': 'reset a password',
  'user.revoke_sessions': 'signed an account out everywhere',
  upload: 'uploaded files',
  'book.create': 'started a book',
  'book.blueprint': 'edited a blueprint',
  'book.approve': 'approved a gate',
  'book.pilot_redo': 'asked for the pilot chapter to be rewritten',
  'book.cancel': 'cancelled a book',
  'book.resume': 'resumed a book',
  'book.budget': 'changed a spending limit',
  'book.rebuild': 'rebuilt a site folder',
  'book.download': 'downloaded a site folder',
  'book.delete': 'deleted a book',
  'settings.update': 'changed settings',
  'settings.api_key_set': 'set the API key',
  'settings.api_key_removed': 'removed the API key',
  'prompt.save': 'saved a master prompt version',
  'prompt.activate': 'activated a master prompt version',
};

export const describe = (action) => LABELS[action] || action;

const ICONS = { login: 'login-2', logout: 'logout-2', user: 'user', book: 'book-2', settings: 'settings', prompt: 'document-text', password: 'lock-password', upload: 'upload-minimalistic' };
const iconFor = (action) => ICONS[action.split('.')[0]] || 'info-circle';
const bad = (a) => /failed|lockout|locked|delete|removed/.test(a);

export default async function activity({ query }) {
  const filter = query.get('f') || '';
  const first = await api.get(`/api/admin/audit?limit=100${filter ? `&action=${filter}` : ''}`);
  let entries = first.entries;
  let next = first.next;

  const rows = (list) => html`${list.map((e) => html`<tr>
    <td class="nowrap" title="${new Date(e.ts).toISOString()}">${dateTime(e.ts)}<small class="muted block">${ago(e.ts)}</small></td>
    <td><span class="act${bad(e.action) ? ' is-bad' : ''}">${icon(iconFor(e.action), 'i-sm')}<span><strong>${e.username || 'Someone'}</strong> ${describe(e.action)}${e.target ? html` <code>${e.target}</code>` : ''}</span></span></td>
    <td class="muted nowrap">${e.ip || ''}</td>
  </tr>`)}`;

  const chips = [['', 'Everything'], ['login', 'Sign-ins'], ['book', 'Books'], ['user', 'People'], ['settings', 'Settings'], ['prompt', 'Prompt']];
  return {
    title: 'Activity log',
    html: html`<div class="view">
      ${pageHeader({ title: 'Activity log', sub: 'Every sign-in, change and download, newest first.' })}
      <div class="chips" role="group" aria-label="Filter">${chips.map(([v, l]) => html`<a class="chip${filter === v ? ' is-on' : ''}" href="#/activity${v ? `?f=${v}` : ''}"${filter === v ? html` aria-current="true"` : ''}>${l}</a>`)}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>What happened</th><th>From</th></tr></thead><tbody id="act-body">${entries.length ? rows(entries) : html`<tr><td colspan="3">${empty('Nothing here yet')}</td></tr>`}</tbody></table></div>
      <p class="center"><button class="btn btn-ghost" id="more"${next ? '' : html` hidden`}>${icon('alt-arrow-down', 'i-sm')}Load older entries</button></p>
    </div>`,
    after(root) {
      $('#more', root).addEventListener('click', async () => {
        const more = await api.get(`/api/admin/audit?limit=100&before=${next}${filter ? `&action=${filter}` : ''}`);
        $('#act-body', root).insertAdjacentHTML('beforeend', rows(more.entries).toString());
        next = more.next;
        if (!next) $('#more', root).hidden = true;
      });
    },
  };
}
