// Hash router with per-route cleanup (polling timers) and focus management.
import { $ } from './ui.js';

const routes = new Map();
let cleanup = [];
let renderId = 0;
let afterRender = () => {};

export const define = (name, loader) => routes.set(name, loader);
export const setAfterRender = (fn) => {
  afterRender = fn;
};
/** Registers a function to run when the user leaves the current view (clear intervals here). */
export const onLeave = (fn) => cleanup.push(fn);

export function parse() {
  const [path, qs = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'home', params: parts.slice(1), query: new URLSearchParams(qs) };
}

export const navigate = (hash) => {
  if (location.hash === hash) render();
  else location.hash = hash;
};

export async function render() {
  const id = ++renderId;
  for (const fn of cleanup) {
    try {
      fn();
    } catch {
      // ignore
    }
  }
  cleanup = [];
  const route = parse();
  const loader = routes.get(route.name) || routes.get('404');
  const main = $('#main');
  try {
    const view = await loader();
    const out = await view.default({ ...route, onLeave, navigate });
    if (id !== renderId) return;
    document.title = `${out.title ? `${out.title} · ` : ''}Folio`;
    // A fresh <main> each time drops every listener the previous view attached to it.
    const fresh = main.cloneNode(false);
    main.replaceWith(fresh);
    fresh.innerHTML = out.html.toString();
    out.after?.(fresh);
    afterRender(route);
    if (!out.keepScroll) window.scrollTo(0, 0);
    if (!out.noFocus) fresh.focus({ preventScroll: true });
  } catch (err) {
    if (id !== renderId) return;
    if (err.status === 401) return;
    const target = $('#main');
    target.innerHTML = '<div class="view"><div class="notice notice-bad"></div></div>';
    target.querySelector('.notice').textContent = err.message || 'Something went wrong.';
  }
}

window.addEventListener('hashchange', render);
