// Hash router: works at any sub-path (GitHub Pages) without server configuration.
import { $, announce } from './ui.js';

const routes = new Map();
let keyHandlers = [];
let current = { name: '', params: [], query: new URLSearchParams() };
let renderId = 0;
let afterRender = () => {};

export function define(name, loader) {
  routes.set(name, loader);
}

export function setAfterRender(fn) {
  afterRender = fn;
}

export const route = () => current;

export function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

export function onKey(handler) {
  keyHandlers.push(handler);
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
  for (const h of keyHandlers) h(e);
});

function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  return { name: parts[0] || 'home', params: parts.slice(1), query: new URLSearchParams(qs) };
}

export async function render() {
  const id = ++renderId;
  keyHandlers = [];
  current = parse();
  const loader = routes.get(current.name) || routes.get('404');
  const main = $('#main');
  try {
    const view = await loader();
    const out = await view.default({ ...current, onKey, navigate });
    if (id !== renderId) return;
    document.title = out.title ? `${out.title} · ${document.documentElement.dataset.site}` : document.documentElement.dataset.site;
    main.innerHTML = out.html.toString();
    out.after?.(main);
    afterRender(current, main);
    if (!out.keepScroll) window.scrollTo(0, 0);
    if (!out.noFocus) main.focus({ preventScroll: true });
    announce(out.title || '');
  } catch (err) {
    if (id !== renderId) return;
    console.error(err);
    main.innerHTML = '<div class="page"><p class="empty"></p></div>';
    main.querySelector('.empty').textContent = String(err.message || err);
  }
}

window.addEventListener('hashchange', render);
