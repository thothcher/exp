// Fragments shared by several views.
import { html, icon, t, ring } from '../ui.js';

export const impLabel = (imp) => t(`imp_${imp}`);

export function impChip(imp) {
  return html`<span class="chip chip-imp imp-${imp}">${impLabel(imp)}</span>`;
}

export function pageHead({ title, lead = '', actions = '', eyebrow = '' }) {
  return html`<header class="page-head">${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}<div class="page-head-row"><h1>${title}</h1>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</div>${lead ? html`<p class="lead">${lead}</p>` : ''}</header>`;
}

export function tile({ value, label, iconName, hint = '' }) {
  return html`<div class="tile"><span class="tile-ico">${icon(iconName)}</span><div><p class="tile-value">${value}</p><p class="tile-label">${label}</p>${hint ? html`<p class="tile-hint">${hint}</p>` : ''}</div></div>`;
}

export function chapterCard(c, masteryPct, { studied = false } = {}) {
  return html`<a class="ch-card tone-${c.tone}" href="#/chapter/${c.id}">
    <span class="ch-top"><span class="ch-ico">${icon(c.icon)}</span><span class="ch-num">${c.number}</span></span>
    <h3>${c.title}</h3>
    <p class="ch-lead">${c.lead}</p>
    <span class="ch-meta">${impChip(c.importance)}<span class="ch-min">${icon('clock', 'i-sm')}${t('minutes', { n: c.minutes })}</span>${studied ? html`<span class="ch-done" title="${t('studied')}">${icon('circle-check', 'i-sm')}</span>` : ''}<span class="ch-ring">${ring(masteryPct, t('mastery'))}</span></span>
  </a>`;
}

export function empty(text, action = '') {
  return html`<div class="empty"><p>${text}</p>${action}</div>`;
}

export function crumbs(items) {
  return html`<nav class="crumbs" aria-label="${t('breadcrumbs')}">${items.map((it, i) => html`${i ? icon('chevron-right', 'i-sm') : ''}${it.href ? html`<a href="${it.href}">${it.label}</a>` : html`<span aria-current="page">${it.label}</span>`}`)}</nav>`;
}

export function notFound() {
  return { title: t('not_found'), html: html`<div class="page page-narrow">${empty(t('not_found_text'), html`<a class="btn btn-primary" href="#/">${t('nav_home')}</a>`)}</div>` };
}
