import { boot, book, chapters, feature } from './data.js';
import { initStore, onChange, state, mutate } from './store.js';
import { $, $$, html, icon, paint, setStrings, t, toast } from './ui.js';
import { define, render, setAfterRender } from './router.js';
import { openSearch } from './search.js';
import { initTips } from './tip.js';

define('home', () => import('./views/home.js'));
define('chapters', () => import('./views/chapters.js'));
define('chapter', () => import('./views/chapter.js'));
define('practice', () => import('./views/practice.js'));
define('cards', () => import('./views/cards.js'));
define('quiz', () => import('./views/quiz.js'));
define('exam', () => import('./views/exam.js'));
define('glossary', () => import('./views/glossary.js'));
define('big-picture', () => import('./views/bigpicture.js'));
define('progress', () => import('./views/progress.js'));
define('about', () => import('./views/about.js'));
define('cheat', () => import('./views/cheat.js'));
define('404', () => import('./views/notfound.js'));

// which navigation entry is current for each route
const NAV_FOR = { home: 'home', chapters: 'chapters', chapter: 'chapters', cheat: 'chapters', practice: 'practice', cards: 'practice', quiz: 'practice', glossary: 'practice', 'big-picture': 'practice', exam: 'exam', progress: 'progress', about: 'progress' };

function applySettings() {
  const s = state().settings;
  const root = document.documentElement;
  const theme = s.theme || book().theme || 'system';
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  root.dataset.size = String(s.size);
  root.dataset.motion = s.motion ? 'reduce' : '';
}

function isDark() {
  const th = document.documentElement.dataset.theme;
  return th ? th === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function navItems() {
  const items = [{ id: 'home', href: '#/', ico: 'house', label: t('nav_home') }, { id: 'chapters', href: '#/chapters', ico: 'library', label: t('nav_chapters') }];
  if (feature('flashcards_with_spaced_repetition') || feature('quiz_and_mock_exam') || feature('glossary_and_search')) items.push({ id: 'practice', href: '#/practice', ico: 'dumbbell', label: t('nav_practice') });
  if (feature('exam_prep_hub') && book().stats.exam) items.push({ id: 'exam', href: '#/exam', ico: 'graduation-cap', label: t('nav_exam') });
  items.push({ id: 'progress', href: '#/progress', ico: 'circle-user-round', label: t('nav_progress') });
  return items;
}

function sidebarChapters() {
  const s = state();
  return html`${chapters().map((c) => html`<a class="sb-ch tone-${c.tone}" href="#/chapter/${c.id}" data-ch="${c.id}"><span class="sb-ch-n">${c.number}</span><span class="sb-ch-t">${c.title}</span>${s.studied[c.id] ? icon('circle-check', 'i-sm sb-tick') : ''}</a>`)}`;
}

function buildShell() {
  const b = book();
  const items = navItems();
  const more = [];
  if (b.bigPicture?.thesis) more.push({ href: '#/big-picture', ico: 'map', label: t('big_picture'), id: 'big-picture' });
  if (feature('glossary_and_search')) more.push({ href: '#/glossary', ico: 'book-a', label: t('nav_glossary'), id: 'glossary' });
  more.push({ href: '#/about', ico: 'info', label: t('nav_about'), id: 'about' });
  const studied = chapters().filter((c) => state().studied[c.id]).length;

  $('#skip').textContent = t('skip');
  $('#app').innerHTML = html`<div class="app">
    <aside class="sidebar" aria-label="${t('navigation')}">
      <a class="sb-brand" href="#/"><span class="sb-logo">${icon('book-open')}</span><span><strong>${b.siteName}</strong><small>${b.subject || b.title}</small></span></a>
      <nav class="sb-nav" aria-label="${t('navigation')}">${items.map((i) => html`<a href="${i.href}" data-nav="${i.id}">${icon(i.ico)}<span>${i.label}</span></a>`)}</nav>
      <nav class="sb-more" aria-label="${t('more')}">${more.map((i) => html`<a href="${i.href}" data-more="${i.id}">${icon(i.ico, 'i-sm')}<span>${i.label}</span></a>`)}</nav>
      <p class="sb-title">${t('nav_chapters')}</p>
      <nav class="sb-chapters" id="sb-chapters" aria-label="${t('nav_chapters')}">${sidebarChapters()}</nav>
      <div class="sb-foot"><span class="bar" role="presentation"><span id="sb-bar" data-w="${Math.round((studied / chapters().length) * 100)}"></span></span><small id="sb-prog">${t('chapters_done', { n: studied, total: chapters().length })}</small></div>
    </aside>
    <div class="content">
      <header class="topbar">
        <a class="tb-brand" href="#/"><span class="sb-logo">${icon('book-open')}</span><strong>${b.siteName}</strong></a>
        <span class="tb-spacer"></span>
        <button type="button" class="tb-search" id="open-search" aria-label="${t('search')}">${icon('search')}<span>${t('search')}</span><kbd>Ctrl K</kbd></button>
        <button type="button" class="btn btn-ghost btn-icon" id="toggle-theme" aria-label="${t('toggle_theme')}">${icon(isDark() ? 'sun' : 'moon')}</button>
      </header>
      <main id="main" tabindex="-1"></main>
      <footer class="footer"><span>${b.footerCredit || ''}</span><a href="#/about">${t('nav_about')}</a></footer>
    </div>
    <nav class="tabbar" aria-label="${t('navigation')}">${items.map((i) => html`<a href="${i.href}" data-nav="${i.id}">${icon(i.ico)}<span>${i.label}</span></a>`)}</nav>
  </div>`.toString();
  paint(document);

  $('#open-search').addEventListener('click', openSearch);
  $('#toggle-theme').addEventListener('click', () => {
    mutate((s) => {
      s.settings.theme = isDark() ? 'light' : 'dark';
    });
    applySettings();
    $('#toggle-theme').innerHTML = icon(isDark() ? 'sun' : 'moon').toString();
  });
}

function refreshChrome() {
  const s = state();
  const sb = $('#sb-chapters');
  if (sb) sb.innerHTML = sidebarChapters().toString();
  const studied = chapters().filter((c) => s.studied[c.id]).length;
  $('#sb-bar')?.style.setProperty('width', `${Math.round((studied / chapters().length) * 100)}%`);
  const p = $('#sb-prog');
  if (p) p.textContent = t('chapters_done', { n: studied, total: chapters().length });
}

function markActive(route) {
  const nav = NAV_FOR[route.name] || '';
  $$('[data-nav]').forEach((a) => (a.dataset.nav === nav ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $$('[data-more]').forEach((a) => (a.dataset.more === route.name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const chId = route.name === 'chapter' ? route.params[0] : '';
  $$('.sb-ch').forEach((a) => (a.dataset.ch === chId ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('.sb-ch[aria-current]')?.scrollIntoView({ block: 'nearest' });
}

function shortcuts() {
  if ($('dialog.shortcuts')) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'dialog shortcuts';
  dlg.innerHTML = html`<form method="dialog"><h2>${t('shortcuts')}</h2><dl class="keys">
    <dt><kbd>Ctrl</kbd> + <kbd>K</kbd></dt><dd>${t('key_search')}</dd>
    <dt><kbd>Space</kbd></dt><dd>${t('key_flip')}</dd>
    <dt><kbd>1</kbd> – <kbd>4</kbd></dt><dd>${t('key_rate')}</dd>
    <dt><kbd>Enter</kbd></dt><dd>${t('key_next')}</dd>
    <dt><kbd>Esc</kbd></dt><dd>${t('key_close')}</dd></dl>
    <div class="dialog-actions"><button class="btn btn-primary">${t('ok')}</button></div></form>`.toString();
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  const framed = window.top !== window.self || window.name === 'folio-preview';
  if (framed) {
    // inside the platform preview: never cache anything, and clean up any worker left from an earlier visit
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
    return;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const announce = (worker) => toast(t('update_ready'), { action: t('reload'), onAction: () => worker.postMessage('SKIP_WAITING') });
    if (reg.waiting && navigator.serviceWorker.controller) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) announce(w);
      });
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
}

async function main() {
  const app = $('#app');
  try {
    const { book: b, ui } = await boot();
    const root = document.documentElement;
    root.lang = b.language;
    root.dir = b.dir || 'ltr';
    root.dataset.site = b.siteName;
    setStrings(ui.strings, b.language);
    initStore(b.slug);
    applySettings();
    buildShell();
    initTips();
    setAfterRender((route) => {
      markActive(route);
      refreshChrome();
    });
    onChange(refreshChrome);
    document.addEventListener('folio:settings', applySettings);
    document.addEventListener('keydown', (e) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      } else if (!typing && !e.ctrlKey && !e.metaKey && e.key === '/') {
        e.preventDefault();
        openSearch();
      } else if (!typing && e.key === '?') shortcuts();
    });
    registerWorker();
    await render();
  } catch (err) {
    console.error(err);
    app.innerHTML = '<div class="boot-error"><h1>Could not load the site</h1><p>Open it through a web server (for example: run start.bat or npm start) instead of opening the file directly.</p></div>';
  }
}

main();
