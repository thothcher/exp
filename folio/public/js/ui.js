// UI toolkit for the dashboard: safe HTML templates, icons, formatting, dialogs, toasts, charts.
import { ICONS } from './icons.js';

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

/** Tagged template: values are escaped unless they come from html`` or raw(). */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s + (i < vals.length ? val(vals[i]) : '');
  });
  return new Safe(out);
}

export function icon(name, cls = '') {
  const body = ICONS[name] ?? ICONS['question-circle'] ?? '';
  return raw(`<svg class="i ${cls}" viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true" focusable="false">${body}</svg>`);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Applies widths and heights that cannot live in inline styles (the page runs under a strict CSP). */
export function paint(root = document) {
  for (const el of root.querySelectorAll('[data-w]')) el.style.width = `${el.dataset.w}%`;
  for (const el of root.querySelectorAll('[data-h]')) el.style.height = `${el.dataset.h}%`;
  for (const el of root.querySelectorAll('[data-x]')) el.style.left = `${el.dataset.x}%`;
}

export const debounce = (fn, ms = 300) => {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
};

// ------------------------------------------------------------- formatting

export const money = (n) => {
  const v = Number(n) || 0;
  if (v > 0 && v < 0.1) return `$${v.toFixed(3)}`;
  return `$${v >= 100 ? v.toFixed(0) : v.toFixed(2)}`;
};

export const compact = (n) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n) || 0);
export const int = (n) => new Intl.NumberFormat('en').format(Number(n) || 0);

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function ago(ts) {
  if (!ts) return 'never';
  const sec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(sec / 86400), 'day');
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(ts);
}

export const dateTime = (ts) => (ts ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts) : '');
export const clock = (ts) => new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(ts);

export function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

// ------------------------------------------------------------- fragments

const STATUS = {
  queued: { label: 'Queued', tone: 'neutral', icon: 'clock-circle' },
  running: { label: 'Running', tone: 'info', icon: 'refresh' },
  awaiting: { label: 'Needs your approval', tone: 'warn', icon: 'hand-stars' },
  attention: { label: 'Needs attention', tone: 'bad', icon: 'danger-triangle' },
  failed: { label: 'Failed', tone: 'bad', icon: 'close-circle' },
  done: { label: 'Done', tone: 'ok', icon: 'check-circle' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'stop-circle' },
  pending: { label: 'Pending', tone: 'neutral', icon: 'clock-circle' },
};

export function status(name, label) {
  const s = STATUS[name] || STATUS.queued;
  return html`<span class="status status-${s.tone}${name === 'running' ? ' is-live' : ''}">${icon(s.icon, 'i-sm')}<span>${label || s.label}</span></span>`;
}

export const progressBar = (done, total, tone = '') => {
  const p = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return html`<span class="meter ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><span data-w="${p}"></span></span>`;
};

export const empty = (title, text = '', action = '') => html`<div class="empty"><span class="empty-ico">${icon('inbox')}</span><p class="empty-title">${title}</p>${text ? html`<p class="empty-text">${text}</p>` : ''}${action}</div>`;

export function pageHeader({ title, sub = '', actions = '', back = null }) {
  return html`<header class="page-head">${back ? html`<a class="back" href="${back.href}">${icon('alt-arrow-left', 'i-sm')}${back.label}</a>` : ''}<div class="page-head-row"><div><h1>${title}</h1>${sub ? html`<p class="page-sub">${sub}</p>` : ''}</div>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div></header>`;
}

export function field({ name, label, type = 'text', value = '', hint = '', required = false, attrs = '', options = null, rows = 3, list = '' }) {
  const id = `f-${name}`;
  const input = options
    ? html`<select class="input" id="${id}" name="${name}">${options.map((o) => { const v = typeof o === 'string' ? o : o.value; const l = typeof o === 'string' ? o : o.label; return html`<option value="${v}"${String(v) === String(value) ? raw(' selected') : ''}>${l}</option>`; })}</select>`
    : type === 'textarea'
      ? html`<textarea class="input" id="${id}" name="${name}" rows="${rows}"${required ? raw(' required') : ''}${raw(attrs)}>${value}</textarea>`
      : html`<input class="input" id="${id}" name="${name}" type="${type}" value="${value}"${required ? raw(' required') : ''}${list ? raw(` list="${esc(list)}"`) : ''}${raw(attrs)}>`;
  return html`<div class="field" data-field="${name}"><label class="field-label" for="${id}">${label}${required ? html`<span class="req" title="Required">*</span>` : ''}</label>${input}${hint ? html`<p class="field-hint">${hint}</p>` : ''}<p class="field-error" role="alert" hidden></p></div>`;
}

export function showFieldErrors(root, fields = {}) {
  let first = null;
  for (const el of root.querySelectorAll('[data-field]')) {
    const msg = fields[el.dataset.field];
    const err = el.querySelector('.field-error');
    el.classList.toggle('has-error', Boolean(msg));
    if (err) {
      err.textContent = msg || '';
      err.hidden = !msg;
    }
    if (msg && !first) first = el;
  }
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  first?.querySelector('input, select, textarea')?.focus({ preventScroll: true });
}

// ------------------------------------------------------------- toasts and dialogs

export function toast(message, kind = 'info') {
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = html`${icon(kind === 'error' ? 'danger-triangle' : kind === 'ok' ? 'check-circle' : 'info-circle')}<span>${message}</span>`.toString();
  box.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3800);
}

/** Opens a modal. `body` is html; submit buttons need `value`. Resolves to { value, data } or null when dismissed. */
export function modal({ title, body, actions = [{ label: 'Close', value: 'close' }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal${wide ? ' modal-wide' : ''}`;
    dlg.innerHTML = html`<form method="dialog" class="modal-form"><header class="modal-head"><h2>${title}</h2><button type="button" class="btn btn-quiet btn-icon" data-close aria-label="Close">${icon('close-circle')}</button></header><div class="modal-body">${body}</div><footer class="modal-foot">${actions.map((a) => html`<button class="btn ${a.kind ? `btn-${a.kind}` : 'btn-ghost'}" value="${a.value}"${a.noValidate ? raw(' formnovalidate') : ''}>${a.label}</button>`)}</footer></form>`.toString();
    document.body.append(dlg);
    let result = null;
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('form').addEventListener('submit', (e) => {
      const value = e.submitter?.value;
      if (value === 'close' || value === 'cancel') return;
      result = { value, data: Object.fromEntries(new FormData(e.currentTarget)), form: e.currentTarget };
    });
    dlg.addEventListener('close', () => {
      resolve(result);
      dlg.remove();
    });
    dlg.showModal();
    onOpen?.(dlg);
  });
}

export async function confirmBox({ title, text, ok = 'Confirm', danger = false }) {
  const r = await modal({ title, body: html`<p>${text}</p>`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: ok, value: 'ok', kind: danger ? 'danger' : 'primary' }] });
  return r?.value === 'ok';
}

// ------------------------------------------------------------- bar chart (single series, square marks)

const TICK = (max) => {
  const pow = 10 ** Math.floor(Math.log10(max || 1));
  const n = max / pow;
  const step = n <= 1 ? 0.25 : n <= 2 ? 0.5 : n <= 5 ? 1 : 2;
  return step * pow;
};

/** Daily bars. `rows` = [{ label, value }] in order. Returns html plus a hover tooltip wired by `bindChart`. */
export function barChart(rows, { title, format = money, id = 'chart' } = {}) {
  const W = 760;
  const H = 220;
  const pad = { l: 44, r: 8, t: 14, b: 26 };
  const max = Math.max(...rows.map((r) => r.value), 0.01);
  const tick = TICK(max);
  const top = Math.ceil(max / tick) * tick;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const slot = innerW / rows.length;
  const bw = Math.max(2, Math.min(18, slot - 2));
  const y = (v) => pad.t + innerH - (v / top) * innerH;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += tick) ticks.push(v);
  const peak = rows.reduce((best, r, i) => (r.value > rows[best].value ? i : best), 0);
  const every = Math.ceil(rows.length / 6);
  return html`<figure class="chart" id="${id}" data-chart>
    <figcaption class="chart-title">${title}</figcaption>
    <div class="chart-plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
      ${ticks.map((v) => html`<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`)}
      ${rows.map((r, i) => html`<rect class="hit" data-i="${i}" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${innerH}"/><rect class="bar" x="${pad.l + i * slot + (slot - bw) / 2}" y="${y(r.value)}" width="${bw}" height="${Math.max(0, innerH - (y(r.value) - pad.t))}"/>${i % every === 0 ? html`<text class="axis" x="${pad.l + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${r.label}</text>` : ''}`)}
      ${rows[peak].value > 0 ? html`<text class="peak" x="${pad.l + peak * slot + slot / 2}" y="${y(rows[peak].value) - 6}" text-anchor="middle">${format(rows[peak].value)}</text>` : ''}
    </svg><div class="chart-tip" hidden></div></div>
    <details class="chart-table"><summary>${icon('list', 'i-sm')}<span>Show as table</span></summary><table class="table table-compact"><thead><tr><th>Day</th><th class="num">Spend</th></tr></thead><tbody>${rows.filter((r) => r.value > 0).map((r) => html`<tr><td>${r.full || r.label}</td><td class="num">${format(r.value)}</td></tr>`)}</tbody></table></details>
  </figure>`;
}

export function bindChart(root, rows, format = money) {
  const fig = root.querySelector('[data-chart]');
  if (!fig) return;
  const tip = fig.querySelector('.chart-tip');
  const plot = fig.querySelector('.chart-plot');
  const bars = [...fig.querySelectorAll('.bar')];
  const show = (i, clientX) => {
    const r = rows[i];
    if (!r) return;
    tip.hidden = false;
    tip.innerHTML = html`<strong>${r.full || r.label}</strong><span>${format(r.value)}</span>`.toString();
    const box = plot.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - box.left, 60), box.width - 60);
    tip.style.left = `${x}px`;
    bars.forEach((b, k) => b.classList.toggle('is-hot', k === i));
  };
  fig.addEventListener('pointermove', (e) => {
    const hit = e.target.closest?.('.hit');
    if (hit) show(Number(hit.dataset.i), e.clientX);
  });
  fig.addEventListener('pointerleave', () => {
    tip.hidden = true;
    bars.forEach((b) => b.classList.remove('is-hot'));
  });
}

/** Fills missing days with zero so the time axis is continuous. */
export function fillDays(daily, days) {
  const map = new Map(daily.map((d) => [d.day, d.cost]));
  const out = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ label: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d), full: new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d), value: map.get(key) || 0 });
  }
  return out;
}
