// Small UI toolkit: escaping, safe HTML templates, inline markup, icons, toasts, dialogs.
import { ICONS } from './icons.js';
import { term as lookupTerm } from './data.js';

let STRINGS = {};
let LANG = 'en';

export function setStrings(strings, lang) {
  STRINGS = strings;
  LANG = lang || 'en';
}

export function t(key, vars) {
  let s = STRINGS[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
  return s;
}

// ------------------------------------------------------------- safe html

class Safe {
  constructor(s) {
    this.s = s;
  }

  toString() {
    return this.s;
  }
}

export const raw = (s) => new Safe(String(s));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** Tagged template: interpolated values are escaped unless they come from html``, raw() or md(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s + (i < vals.length ? val(vals[i]) : '');
  });
  return new Safe(out);
}

/** Inline markup of the content model: **bold**, *italic*, `code`, [[term-id|surface]]. Everything else is escaped. */
export function md(text) {
  const s = esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g, (_m, id, surface) => {
      const entry = lookupTerm(id);
      const label = surface || entry?.term || id;
      return entry ? `<button type="button" class="term" data-term="${id}">${label}</button>` : label;
    });
  return new Safe(s);
}

export function mdText(text) {
  return String(text ?? '').replace(/\[\[[a-z0-9-]+\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*`]/g, '');
}

// ------------------------------------------------------------- icons

export function icon(name, cls = '') {
  const body = ICONS[name] || ICONS['circle-help'] || '';
  return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`);
}

// ------------------------------------------------------------- svg (defensive second pass; the platform sanitizes too)

const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc']);
const SVG_ATTRS = new Set(['viewBox', 'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'id', 'marker-end', 'marker-start', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'preserveAspectRatio', 'role', 'aria-label', 'aria-hidden', 'dx', 'dy', 'xmlns']);

export function safeSvgNode(markup) {
  if (!markup) return null;
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) return null;
  const scrub = (el) => {
    for (const a of [...el.attributes]) {
      if (!SVG_ATTRS.has(a.name) || /javascript:|data:|<|url\((?!#)/i.test(a.value)) el.removeAttribute(a.name);
    }
    for (const child of [...el.children]) {
      if (!SVG_TAGS.has(child.localName)) child.remove();
      else scrub(child);
    }
  };
  scrub(root);
  return document.importNode(root, true);
}

// ------------------------------------------------------------- dom helpers

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Applies values that cannot live in inline style attributes (the page runs under a strict CSP). */
export function paint(root = document) {
  for (const el of root.querySelectorAll('[data-w]')) el.style.width = `${el.dataset.w}%`;
  for (const el of root.querySelectorAll('[data-p]')) el.style.setProperty('--p', el.dataset.p);
}

export const debounce = (fn, ms = 300) => {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
};

export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// local calendar date, never UTC (master prompt §4.7)
export function todayStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return todayStr(new Date(y, m - 1, d + n));
}

export function daysBetween(a, b) {
  const pa = a.split('-').map(Number);
  const pb = b.split('-').map(Number);
  return Math.round((new Date(pb[0], pb[1] - 1, pb[2]) - new Date(pa[0], pa[1] - 1, pa[2])) / 86400000);
}

export function fmtDate(dateStr, opts = { day: 'numeric', month: 'long' }) {
  const [y, m, d] = dateStr.split('-').map(Number);
  try {
    return new Intl.DateTimeFormat(LANG, opts).format(new Date(y, m - 1, d));
  } catch {
    return dateStr;
  }
}

export const collator = () => {
  try {
    return new Intl.Collator(LANG, { sensitivity: 'base', numeric: true });
  } catch {
    return new Intl.Collator('en');
  }
};

export function pct(n) {
  return Math.round(clamp(n, 0, 1) * 100);
}

// ------------------------------------------------------------- shared fragments

export function ring(percent, label = '') {
  const p = clamp(Math.round(percent), 0, 100);
  return html`<span class="ring" data-p="${p}" role="img" aria-label="${label ? `${label}: ${p}%` : `${p}%`}"><span>${p}</span></span>`;
}

export function bar(percent, tone = '') {
  return html`<span class="bar ${tone}" role="presentation"><span data-w="${clamp(Math.round(percent), 0, 100)}"></span></span>`;
}

// ------------------------------------------------------------- toasts, live region, dialogs

export function announce(message) {
  const el = $('#live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => {
    el.textContent = message;
  }, 30);
}

export function toast(message, { action, onAction } = {}) {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  const span = document.createElement('span');
  span.textContent = message;
  el.append(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action;
    b.addEventListener('click', () => {
      onAction?.();
      el.remove();
    });
    el.append(b);
  }
  box.append(el);
  setTimeout(() => el.remove(), action ? 9000 : 3200);
}

export function confirmDialog(message, okLabel = t('ok'), { danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dialog';
    dlg.innerHTML = html`<form method="dialog"><p class="dialog-text">${message}</p><div class="dialog-actions"><button class="btn btn-ghost" value="no">${t('cancel')}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" value="yes">${okLabel}</button></div></form>`.toString();
    document.body.append(dlg);
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'yes');
      dlg.remove();
    });
    dlg.showModal();
  });
}

export function copyText(text) {
  return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
}
