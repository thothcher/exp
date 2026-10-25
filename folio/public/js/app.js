import { api, setCsrf, setUnauthHandler } from './api.js';
import { $, $$, html, icon, paint, toast } from './ui.js';
import { define, render, setAfterRender } from './router.js';
import { renderLogin, renderForcedPassword } from './views/auth.js';
import { S } from './state.js';



define('home', () => import('./views/overview.js'));
define('books', () => import('./views/library.js'));
define('book', () => import('./views/book.js'));
define('new', () => import('./views/newbook.js'));
define('users', () => import('./views/users.js'));
define('usage', () => import('./views/usage.js'));
define('activity', () => import('./views/activity.js'));
define('prompt', () => import('./views/prompt.js'));
define('settings', () => import('./views/settings.js'));
define('account', () => import('./views/account.js'));
define('404', () => import('./views/notfound.js'));

const ADMIN_ROUTES = new Set(['users', 'usage', 'activity', 'prompt', 'settings']);
const NAV_FOR = { home: 'home', books: 'books', book: 'books', new: 'new', users: 'users', usage: 'usage', activity: 'activity', prompt: 'prompt', settings: 'settings', account: 'account' };

function theme() {
  try {
    return localStorage.getItem('folio-theme') || '';
  } catch {
    return '';
  }
}

function applyTheme(value) {
  if (value === 'light' || value === 'dark') document.documentElement.dataset.theme = value;
  else delete document.documentElement.dataset.theme;
  try {
    if (value) localStorage.setItem('folio-theme', value);
    else localStorage.removeItem('folio-theme');
  } catch {
    // storage may be unavailable
  }
}

const isDark = () => (document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);

function navLink(href, id, ico, label) {
  return html`<a class="nav-link" href="${href}" data-nav="${id}">${icon(ico)}<span>${label}</span></a>`;
}

function shell() {
  const u = S.user;
  const admin = u.role === 'admin';
  $('#app').innerHTML = html`<div class="shell">
    <header class="mobile-bar"><button type="button" class="btn btn-quiet btn-icon" id="open-nav" aria-label="Open menu" aria-expanded="false" aria-controls="rail">${icon('hamburger-menu')}</button><a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Folio</span></a></header>
    <aside class="rail" id="rail" aria-label="Main navigation">
      <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">Folio</span></a>
      <nav class="nav" aria-label="Workspace">
        <p class="nav-group">Workspace</p>
        ${navLink('#/', 'home', 'home-2', 'Overview')}
        ${navLink('#/books', 'books', 'library', 'Library')}
        ${navLink('#/new', 'new', 'add-circle', 'New book')}
        ${admin ? html`<p class="nav-group">Administration</p>
        ${navLink('#/users', 'users', 'users-group-rounded', 'People')}
        ${navLink('#/usage', 'usage', 'chart-2', 'Usage and spend')}
        ${navLink('#/activity', 'activity', 'history', 'Activity log')}
        ${navLink('#/prompt', 'prompt', 'document-text', 'Master prompt')}
        ${navLink('#/settings', 'settings', 'settings', 'Settings')}` : ''}
      </nav>
      <div class="rail-foot">
        ${S.config.dryRun ? html`<p class="rail-note">${icon('test-tube', 'i-sm')}<span>Dry-run mode: no AI calls are made.</span></p>` : ''}
        <a class="account" href="#/account" data-nav="account"><span class="avatar" aria-hidden="true">${(u.displayName || u.username).slice(0, 1).toUpperCase()}</span><span class="account-text"><strong>${u.displayName}</strong><small>${admin ? 'Administrator' : 'Member'}</small></span></a>
        <div class="rail-actions"><button type="button" class="btn btn-quiet btn-sm" id="toggle-theme">${icon(isDark() ? 'sun-2' : 'moon')}<span>${isDark() ? 'Light' : 'Dark'} theme</span></button><button type="button" class="btn btn-quiet btn-sm" id="logout">${icon('logout-2')}<span>Sign out</span></button></div>
      </div>
    </aside>
    <div class="scrim" id="scrim" hidden></div>
    <main id="main" class="main" tabindex="-1"></main>
  </div>`.toString();

  const rail = $('#rail');
  const toggleNav = (open) => {
    rail.classList.toggle('is-open', open);
    $('#scrim').hidden = !open;
    $('#open-nav').setAttribute('aria-expanded', String(open));
  };
  $('#open-nav').addEventListener('click', () => toggleNav(!rail.classList.contains('is-open')));
  $('#scrim').addEventListener('click', () => toggleNav(false));
  rail.addEventListener('click', (e) => e.target.closest('a') && toggleNav(false));
  $('#toggle-theme').addEventListener('click', () => {
    applyTheme(isDark() ? 'light' : 'dark');
    const b = $('#toggle-theme');
    b.innerHTML = html`${icon(isDark() ? 'sun-2' : 'moon')}<span>${isDark() ? 'Light' : 'Dark'} theme</span>`.toString();
  });
  $('#logout').addEventListener('click', async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // already signed out
    }
    S.user = null;
    renderLogin(start);
  });
}

function markActive(route) {
  const id = NAV_FOR[route.name] || '';
  $$('[data-nav]').forEach((a) => (a.dataset.nav === id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}

export async function start() {
  const me = await api.get('/api/auth/session');
  S.user = me.user;
  if (!S.user) return renderLogin(start);
  setCsrf(me.csrf);
  if (S.user.mustChangePassword) return renderForcedPassword(S.user, start);
  S.config = await api.get('/api/config');
  shell();
  setAfterRender(markActive);
  const route = location.hash.replace(/^#\/?/, '').split('/')[0].split('?')[0];
  if (ADMIN_ROUTES.has(route) && S.user.role !== 'admin') location.hash = '#/';
  await render();
}

setUnauthHandler(() => {
  if (!S.user) return; // not signed in yet: the login screen is already showing
  S.user = null;
  toast('Your session ended. Please sign in again.', 'error');
  renderLogin(start);
});

applyTheme(theme());
window.addEventListener('hashchange', () => {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0].split('?')[0];
  if (S.user && ADMIN_ROUTES.has(route) && S.user.role !== 'admin') location.hash = '#/';
});
paint();
start().catch((err) => {
  $('#app').innerHTML = '<div class="boot-error"><h1>Folio could not start</h1><p></p></div>';
  $('#app .boot-error p').textContent = err.message;
});
