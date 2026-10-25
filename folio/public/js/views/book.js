import { api } from '../api.js';
import { S } from '../state.js';
import { $, $$, ago, clock, compact, confirmBox, duration, empty, field, html, icon, int, modal, money, paint, pageHeader, progressBar, raw, showFieldErrors, status, toast } from '../ui.js';

const STEPS = ['Read the book', 'Approve the plan', 'Pilot chapter', 'Write chapters', 'Build the site'];
const TABS = [['overview', 'Overview', 'chart-square'], ['units', 'Units', 'list-check'], ['preview', 'Preview', 'monitor-smartphone'], ['log', 'Log', 'code-square'], ['setup', 'Setup', 'tuning-2']];
const PRESETS = [['calm-pastel', 'Calm pastel'], ['bold-editorial', 'Bold editorial'], ['clean-academic', 'Clean academic']];
const IMPORTANCE = [['core', 'Core'], ['standard', 'Standard'], ['supplementary', 'Extra']];
const ACTIVE = ['queued', 'running'];

function phase(d) {
  const b = d.book;
  const g = d.gates || {};
  let cur;
  if (b.status === 'done') cur = 5;
  else if (b.status === 'awaiting') cur = b.gate === 'blueprint' ? 1 : 2;
  else if (b.stage === 'audit') cur = 0;
  else if (b.stage === 'pilot') cur = 2;
  else if (b.stage === 'chapters') cur = 3;
  else if (b.stage === 'assets' || b.stage === 'assemble') cur = 4;
  else cur = g.pilot ? 3 : g.blueprint ? 2 : d.plan ? 1 : 0;
  return cur;
}

export default async function bookView({ params, onLeave }) {
  const id = params[0];
  let tab = TABS.some((t) => t[0] === params[1]) ? params[1] : 'overview';
  let d = await api.get(`/api/books/${id}`);
  let draft = null;
  let logs = [];
  let logCursor = 0;
  let follow = true;
  let timer = null;
  let gone = false;
  const admin = S.user.role === 'admin';
  const prompt = { loaded: false, data: null };
  const params_ = d.params;

  const isEditing = () => d.book.status === 'awaiting' && d.book.gate === 'blueprint';

  // ------------------------------------------------------------ header, gate, stepper

  const header = () => {
    const b = d.book;
    const stopped = ['attention', 'failed', 'cancelled'].includes(b.status);
    const canCancel = ['queued', 'running', 'awaiting'].includes(b.status);
    const actions = html`
      ${canCancel ? html`<button class="btn btn-ghost" data-act="cancel">${icon('stop-circle')}<span>Cancel</span></button>` : ''}
      ${stopped ? html`<button class="btn btn-primary" data-act="resume">${icon('play')}<span>Resume</span></button>` : ''}
      ${d.previewable ? html`<a class="btn btn-ghost" href="#/book/${id}/preview">${icon('monitor-smartphone')}<span>Preview</span></a><a class="btn ${b.status === 'done' ? 'btn-primary' : 'btn-ghost'}" href="/api/books/${id}/download" download>${icon('download-minimalistic')}<span>Download folder</span></a>` : ''}
      <details class="menu"><summary class="btn btn-ghost btn-icon" aria-label="More actions">${icon('menu-dots')}</summary><div class="menu-list">
        ${d.previewable ? html`<button data-act="rebuild">${icon('refresh', 'i-sm')}Rebuild site folder</button>` : ''}
        ${admin ? html`<button data-act="budget">${icon('wallet', 'i-sm')}Change spending limit</button>` : ''}
        <button data-act="delete" class="is-danger">${icon('trash-bin-trash', 'i-sm')}Delete book</button></div></details>`;
    return pageHeader({
      back: { href: '#/books', label: 'Library' },
      title: b.title,
      sub: html`${status(b.status)}${b.dryRun ? html` <span class="tag">dry run</span>` : ''}<span class="sep"></span>${b.owner.displayName || b.owner.username}<span class="sep"></span>started ${ago(b.createdAt)}<span class="sep"></span>${b.model}`,
      actions,
    });
  };

  const gate = () => {
    const b = d.book;
    if (b.status === 'awaiting' && b.gate === 'blueprint') {
      const e = d.estimate;
      const units = d.units.filter((u) => !u.skip).length;
      return html`<section class="gate"><span class="gate-ico">${icon('hand-stars')}</span><div class="gate-body"><p class="gate-kicker">Gate 1 of 2</p><h2>Review the plan</h2>
        <p>Folio split the book into <strong>${units} units</strong>. Check the titles and page ranges in the Units tab. Fix anything that looks off, then approve. Only then does Folio write the first chapter (the pilot).</p>
        ${e ? html`<p class="muted">Estimated cost of the whole book: <strong>${money(e.mid)}</strong> (likely ${money(e.low)} to ${money(e.high)}). ${e.measured ? 'Based on the pages measured in the scan.' : ''}</p>` : ''}
        ${d.plan?.warnings?.length ? html`<ul class="warns">${d.plan.warnings.map((w) => html`<li>${icon('danger-triangle', 'i-sm')}<span>${w}</span></li>`)}</ul>` : ''}
        <div class="gate-actions"><a class="btn btn-ghost" href="#/book/${id}/units">${icon('list-check')}<span>Review the units</span></a><button class="btn btn-primary" data-act="approve-blueprint">${icon('check-circle')}<span>Approve the plan</span></button></div></div></section>`;
    }
    if (b.status === 'awaiting' && b.gate === 'pilot') {
      const pilot = d.units.find((u) => u.isPilot);
      const left = d.units.filter((u) => !u.skip && u.status !== 'done').length;
      return html`<section class="gate"><span class="gate-ico">${icon('hand-stars')}</span><div class="gate-body"><p class="gate-kicker">Gate 2 of 2</p><h2>Read the pilot chapter</h2>
        <p>“${pilot?.chapterTitle || pilot?.title}” is written. Open the preview and read it the way a student would: voice, depth, the questions and the flashcards. If it is right, Folio writes the other <strong>${left} units</strong> in the same style. If not, tell it what to change.</p>
        ${pilot?.warnings?.length ? html`<ul class="warns">${pilot.warnings.slice(0, 5).map((w) => html`<li>${icon('danger-triangle', 'i-sm')}<span>${w}</span></li>`)}</ul>` : ''}
        <div class="gate-actions"><a class="btn btn-ghost" href="#/book/${id}/preview">${icon('monitor-smartphone')}<span>Open the preview</span></a><button class="btn btn-ghost" data-act="redo-pilot">${icon('restart')}<span>Rewrite with notes</span></button><button class="btn btn-primary" data-act="approve-pilot">${icon('check-circle')}<span>Approve and write the rest</span></button></div></div></section>`;
    }
    if (['attention', 'failed'].includes(b.status)) {
      return html`<section class="gate gate-bad"><span class="gate-ico">${icon('danger-triangle')}</span><div class="gate-body"><h2>This book stopped</h2><p>${b.error || 'An error stopped the run.'}</p><p class="muted">Nothing is lost: finished units are kept. Fix the cause if needed, then resume.</p><div class="gate-actions"><button class="btn btn-primary" data-act="resume">${icon('play')}<span>Resume</span></button><a class="btn btn-ghost" href="#/book/${id}/log">${icon('code-square')}<span>See the log</span></a></div></div></section>`;
    }
    return '';
  };

  const stepper = () => {
    const cur = phase(d);
    const stopped = ['attention', 'failed', 'cancelled'].includes(d.book.status);
    const p = d.progress;
    return html`<ol class="stepper" aria-label="Progress">${STEPS.map((label, i) => {
      const state = i < cur ? 'done' : i === cur ? (stopped ? 'stopped' : d.book.status === 'awaiting' ? 'wait' : 'active') : 'todo';
      return html`<li class="step is-${state}"${state === 'active' || state === 'wait' ? html` aria-current="step"` : ''}><span class="step-dot">${state === 'done' ? icon('check-read', 'i-sm') : state === 'wait' ? icon('hand-stars', 'i-sm') : state === 'stopped' ? icon('danger-triangle', 'i-sm') : i + 1}</span><span class="step-label">${label}</span></li>`;
    })}</ol>
    ${p && ACTIVE.includes(d.book.status) ? html`<div class="live"><span class="live-dot" aria-hidden="true"></span><span class="live-label">${p.label}</span>${p.total > 1 ? html`${progressBar(p.done, p.total)}<span class="live-n">${p.done} of ${p.total}</span>` : ''}</div>` : ''}`;
  };

  // ------------------------------------------------------------ tabs

  const tabs = () => html`<nav class="tabs" role="tablist" aria-label="Book sections">${TABS.map(([k, label, ico]) => html`<a class="tab${tab === k ? ' is-on' : ''}" role="tab" href="#/book/${id}/${k}" aria-selected="${tab === k}">${icon(ico, 'i-sm')}<span>${label}</span>${k === 'units' && isEditing() ? html`<span class="dot-alert" title="Needs your review"></span>` : ''}</a>`)}</nav>`;

  const overviewTab = () => {
    const b = d.book;
    const u = d.units;
    const written = u.filter((x) => x.status === 'done').length;
    const spent = b.costUsd;
    const e = d.estimate;
    const dur = b.startedAt ? duration((b.finishedAt || Date.now()) - b.startedAt) : '';
    return html`<div class="grid-main">
      <section class="panel"><h2>${icon('chart-square')}<span>Progress</span></h2>
        <dl class="facts facts-wide">
          <div><dt>Pages</dt><dd>${int(b.pagesTotal)}</dd></div>
          <div><dt>Units written</dt><dd>${written} of ${u.filter((x) => !x.skip).length}</dd></div>
          <div><dt>Model</dt><dd>${b.model}${b.scanModel !== b.model ? html`<small class="muted block">scan: ${b.scanModel}</small>` : ''}</dd></div>
          <div><dt>Running time</dt><dd>${dur || '–'}</dd></div>
          <div><dt>Tokens</dt><dd>${compact(b.inputTokens)} in · ${compact(b.outputTokens)} out</dd></div>
          <div><dt>Source files</dt><dd>${d.files.map((f) => html`<span class="block">${f.name} <small class="muted">${f.pages} pp.</small></span>`)}</dd></div>
        </dl></section>
      <section class="panel"><h2>${icon('wallet')}<span>Cost</span></h2>
        ${b.dryRun ? html`<p class="muted">Dry run: no AI calls were made, so nothing was charged.</p>` : html`<p class="big">${money(spent)}</p>${b.budgetUsd > 0 ? html`${progressBar(spent, b.budgetUsd, spent / b.budgetUsd > 0.85 ? 'is-warn' : '')}<p class="muted">of the ${money(b.budgetUsd)} limit for this book</p>` : html`<p class="muted">No spending limit on this book.</p>`}
        ${e ? html`<p class="muted">Estimated total: ${money(e.mid)} (likely ${money(e.low)} to ${money(e.high)}).</p>` : ''}`}</section>
      ${d.plan?.warnings?.length || d.plan?.skipped?.length ? html`<section class="panel panel-wide"><h2>${icon('danger-triangle')}<span>Notes from the scan</span></h2>
        ${d.plan.warnings.length ? html`<ul class="warns">${d.plan.warnings.map((w) => html`<li>${icon('danger-triangle', 'i-sm')}<span>${w}</span></li>`)}</ul>` : ''}
        ${d.plan.skipped.length ? html`<h3>Left out on purpose</h3><ul class="plain">${d.plan.skipped.map((s) => html`<li>Pages ${s.pdf_start}–${s.pdf_end}: ${s.reason}</li>`)}</ul>` : ''}</section>` : ''}
    </div>`;
  };

  const unitStatus = (u) => (u.status === 'done' ? status('done') : u.status === 'running' ? status('running') : u.status === 'failed' ? status('failed') : status('pending', u.skip ? 'Skipped' : 'Waiting'));

  const unitsReadOnly = () => {
    const locked = ACTIVE.includes(d.book.status) || d.book.status === 'awaiting';
    if (!d.units.length) return empty('No units yet', 'Folio is still reading the book.');
    return html`<div class="table-wrap"><table class="table"><thead><tr><th class="num">#</th><th>Unit</th><th>PDF pages</th><th>Importance</th><th>State</th><th>Content</th><th class="num">Cost</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
      ${d.units.map((u) => html`<tr class="${u.skip ? 'is-muted' : ''}">
        <td class="num">${u.number ?? '–'}</td>
        <td><strong>${u.chapterTitle || u.title}</strong>${u.isPilot ? html` <span class="tag">pilot</span>` : ''}${u.chapterTitle && u.chapterTitle !== u.title ? html`<small class="muted block">${u.title}</small>` : ''}${u.error ? html`<small class="bad block">${u.error}</small>` : ''}
          ${u.warnings.length ? html`<details class="mini"><summary>${u.warnings.length} note${u.warnings.length > 1 ? 's' : ''}</summary><ul class="plain">${u.warnings.map((w) => html`<li>${w}</li>`)}</ul></details>` : ''}${u.notes ? html`<small class="muted block">Notes: ${u.notes}</small>` : ''}</td>
        <td class="nowrap">${u.pageStart}–${u.pageEnd}</td>
        <td>${u.importance}</td>
        <td>${u.skip ? html`<span class="tag">skipped</span>` : unitStatus(u)}</td>
        <td class="muted">${u.counts ? `${u.counts.keyPoints} key points · ${u.counts.cards} cards · ${u.counts.questions} questions · ${u.counts.exam} exam${u.counts.review ? ` · ${u.counts.review} to check` : ''}` : '–'}</td>
        <td class="num">${d.book.dryRun ? '–' : money(u.costUsd)}</td>
        <td class="actions-cell">${locked || u.status === 'running' ? '' : u.status === 'failed' ? html`<button class="btn btn-ghost btn-sm" data-unit="${u.id}" data-act="retry">${icon('restart', 'i-sm')}Retry</button>` : html`<button class="btn btn-ghost btn-sm" data-unit="${u.id}" data-act="rewrite">${icon('pen', 'i-sm')}${u.status === 'done' ? 'Rewrite' : 'Edit'}</button>`}</td>
      </tr>`)}</tbody></table></div>`;
  };

  // ---- blueprint editor

  const startDraft = () => {
    draft = {
      units: d.units.map((u) => ({ id: u.id, title: u.title, pageStart: u.pageStart, pageEnd: u.pageEnd, importance: u.importance, icon: u.icon, skip: u.skip, isPilot: u.isPilot })),
      siteName: d.overrides.siteName ?? d.plan?.site_name ?? '',
      tagline: d.overrides.tagline ?? d.plan?.tagline ?? '',
      slug: d.book.slug || d.plan?.slug || '',
      preset: d.overrides.preset || d.plan?.design?.preset || 'calm-pastel',
      accent: d.overrides.accent ?? d.plan?.design?.accent ?? '',
      book: { edition: d.overrides.book?.edition ?? d.plan?.book?.edition ?? '', year: d.overrides.book?.year ?? d.plan?.book?.year ?? '', publisher: d.overrides.book?.publisher ?? d.plan?.book?.publisher ?? '' },
    };
  };

  const coverage = () => {
    const total = d.book.pagesTotal;
    const seen = new Set();
    let overlap = 0;
    for (const u of draft.units.filter((x) => !x.skip)) {
      for (let p = Number(u.pageStart); p <= Number(u.pageEnd); p++) {
        if (seen.has(p)) overlap++;
        seen.add(p);
      }
    }
    return { covered: seen.size, total, overlap };
  };

  const blueprintEditor = () => {
    if (!draft) startDraft();
    const c = coverage();
    return html`<form id="bp" novalidate>
      <section class="panel"><h2>${icon('palette-round')}<span>The site</span></h2>
        <div class="grid-3">${field({ name: 'siteName', label: 'Site name', value: draft.siteName, hint: 'At most 3 words.' })}${field({ name: 'tagline', label: 'Tagline', value: draft.tagline })}${field({ name: 'slug', label: 'Folder name', value: draft.slug, hint: 'Lowercase letters, digits and dashes.' })}
        ${field({ name: 'preset', label: 'Design', value: draft.preset, options: PRESETS.map(([v, l]) => ({ value: v, label: l })) })}${field({ name: 'accent', label: 'Accent colour (optional)', value: draft.accent, hint: 'Hex like #2F5D50. Leave empty for the preset colour.', attrs: ' placeholder="#2F5D50" maxlength="7"' })}
        ${field({ name: 'edition', label: 'Edition', value: draft.book.edition })}${field({ name: 'year', label: 'Year', value: draft.book.year })}${field({ name: 'publisher', label: 'Publisher', value: draft.book.publisher })}</div></section>
      <section class="panel"><div class="panel-head"><h2>${icon('list-check')}<span>Units</span></h2><p class="muted" id="coverage">${coverageText(c)}</p></div>
        <div class="table-wrap"><table class="table table-edit"><thead><tr><th class="num">#</th><th>Title</th><th>From</th><th>To</th><th>Importance</th><th>Pilot</th><th>Include</th><th><span class="visually-hidden">Order and delete</span></th></tr></thead>
        <tbody id="bp-rows">${bpRows()}</tbody></table></div>
        <p class="hint">${icon('info-circle', 'i-sm')}Pages are PDF page numbers (page 1 is the first page of the file). Units of more than ${S.config.limits.maxUnitPages} pages are slower and less precise: split them.</p>
        <div class="btn-row"><button type="button" class="btn btn-ghost" data-act="add-unit">${icon('add-circle')}<span>Add a unit</span></button></div></section>
      <div class="sticky-actions"><button type="button" class="btn btn-ghost" data-act="save-bp">${icon('diskette')}<span>Save changes</span></button><button type="button" class="btn btn-primary" data-act="approve-blueprint">${icon('check-circle')}<span>Save and approve the plan</span></button></div>
    </form>`;
  };

  const coverageText = (c) => `Units cover ${int(c.covered)} of ${int(c.total)} pages${c.overlap ? `, ${c.overlap} pages are in two units` : ''}.`;

  const bpRows = () => html`${draft.units.map((u, i) => html`<tr data-i="${i}" class="${u.skip ? 'is-muted' : ''}">
    <td class="num">${i + 1}</td>
    <td><input class="input input-sm" name="title" value="${u.title}" aria-label="Title of unit ${i + 1}" maxlength="200"></td>
    <td><input class="input input-sm input-num" name="pageStart" type="number" min="1" max="${d.book.pagesTotal}" value="${u.pageStart}" aria-label="First page"></td>
    <td><input class="input input-sm input-num" name="pageEnd" type="number" min="1" max="${d.book.pagesTotal}" value="${u.pageEnd}" aria-label="Last page"></td>
    <td><select class="input input-sm" name="importance" aria-label="Importance">${IMPORTANCE.map(([v, l]) => html`<option value="${v}"${u.importance === v ? raw(' selected') : ''}>${l}</option>`)}</select></td>
    <td><input type="radio" name="pilot" value="${i}" aria-label="Use as the pilot chapter"${u.isPilot && !u.skip ? raw(' checked') : ''}${u.skip ? raw(' disabled') : ''}></td>
    <td><input type="checkbox" name="include" aria-label="Include this unit"${u.skip ? '' : raw(' checked')}></td>
    <td class="actions-cell"><button type="button" class="btn btn-quiet btn-icon btn-sm" data-act="bp-up" aria-label="Move up"${i === 0 ? raw(' disabled') : ''}>${icon('alt-arrow-up', 'i-sm')}</button><button type="button" class="btn btn-quiet btn-icon btn-sm" data-act="bp-down" aria-label="Move down"${i === draft.units.length - 1 ? raw(' disabled') : ''}>${icon('alt-arrow-down', 'i-sm')}</button><button type="button" class="btn btn-quiet btn-icon btn-sm" data-act="bp-del" aria-label="Delete this unit">${icon('trash-bin-trash', 'i-sm')}</button></td>
  </tr>`)}`;

  /** Reads the editor fields back into the draft. */
  const syncDraft = () => {
    const form = $('#bp');
    if (!form || !draft) return;
    const f = new FormData(form);
    draft.siteName = String(f.get('siteName') ?? '');
    draft.tagline = String(f.get('tagline') ?? '');
    draft.slug = String(f.get('slug') ?? '');
    draft.preset = String(f.get('preset') ?? draft.preset);
    draft.accent = String(f.get('accent') ?? '').trim();
    draft.book = { edition: String(f.get('edition') ?? ''), year: String(f.get('year') ?? ''), publisher: String(f.get('publisher') ?? '') };
    const pilot = Number(f.get('pilot'));
    $$('#bp-rows tr').forEach((tr, i) => {
      const u = draft.units[i];
      u.title = tr.querySelector('[name=title]').value;
      u.pageStart = Number(tr.querySelector('[name=pageStart]').value);
      u.pageEnd = Number(tr.querySelector('[name=pageEnd]').value);
      u.importance = tr.querySelector('[name=importance]').value;
      u.skip = !tr.querySelector('[name=include]').checked;
      u.isPilot = i === pilot && !u.skip;
    });
    if (!draft.units.some((u) => u.isPilot)) {
      const first = draft.units.find((u) => !u.skip);
      if (first) first.isPilot = true;
    }
  };

  const redrawRows = () => {
    $('#bp-rows').innerHTML = bpRows().toString();
    $('#coverage').textContent = coverageText(coverage());
  };

  const saveDraft = async () => {
    syncDraft();
    await api.put(`/api/books/${id}/blueprint`, {
      units: draft.units,
      siteName: draft.siteName,
      tagline: draft.tagline,
      slug: draft.slug,
      preset: draft.preset,
      accent: draft.accent,
      book: draft.book,
    });
  };

  const unitsTab = () => (isEditing() ? blueprintEditor() : unitsReadOnly());

  const previewTab = () => {
    if (!d.previewable) return empty('Nothing to preview yet', 'The preview appears as soon as the first unit is written.');
    return html`<div class="preview"><div class="preview-bar"><div class="seg" role="radiogroup" aria-label="Device width"><label class="seg-opt"><input type="radio" name="dev" value="phone"><span>${icon('smartphone', 'i-sm')}Phone</span></label><label class="seg-opt"><input type="radio" name="dev" value="tablet"><span>${icon('tablet', 'i-sm')}Tablet</span></label><label class="seg-opt"><input type="radio" name="dev" value="desktop" checked><span>${icon('monitor', 'i-sm')}Desktop</span></label></div>
      <div class="btn-row"><button class="btn btn-ghost btn-sm" data-act="reload-preview">${icon('refresh', 'i-sm')}<span>Reload</span></button><a class="btn btn-ghost btn-sm" href="/preview/${id}/" target="_blank" rel="noopener">${icon('square-arrow-right-up', 'i-sm')}<span>Open in a new tab</span></a></div></div>
      <div class="preview-stage dev-desktop" id="stage"><iframe id="frame" name="folio-preview" title="Preview of the study site" src="/preview/${id}/" sandbox="allow-scripts allow-same-origin allow-popups"></iframe></div>
      ${d.book.status !== 'done' ? html`<p class="hint">${icon('info-circle', 'i-sm')}This is a partial site. It grows as units are finished; press Reload to see new ones.</p>` : ''}</div>`;
  };

  const logTab = () => html`<section class="panel panel-flush"><div class="log-bar"><span class="muted">${logs.length} entries</span><label class="check check-inline"><input type="checkbox" id="follow"${follow ? raw(' checked') : ''}><span>Follow new entries</span></label></div><ol class="log" id="log" tabindex="0" aria-label="Log">${logs.map(logLine)}</ol></section>`;
  const logLine = (l) => html`<li class="log-${l.level}"><time>${clock(l.ts)}</time><span class="log-level">${l.level}</span><span>${l.message}</span></li>`;

  const setupTab = () => {
    const schema = S.config.schema;
    const rows = schema.fields.filter((f) => String(params_[f.key] ?? '').trim());
    return html`<div class="grid-main"><section class="panel panel-wide"><h2>${icon('tuning-2')}<span>Settings used for this book</span></h2>
      <dl class="settings-list">${rows.map((f) => html`<div><dt>${f.label}</dt><dd>${String(params_[f.key]).length > 200 ? html`<span class="pre-wrap">${params_[f.key]}</span>` : params_[f.key]}</dd></div>`)}<div><dt>Check answer keys</dt><dd>${params_.VERIFY === false ? 'No' : 'Yes'}</dd></div></dl></section>
      <section class="panel panel-wide"><h2>${icon('document-text')}<span>What the model receives</span></h2><p class="muted">Every request starts with Folio's instructions, then your master prompt, then the settings above as the parameters block. This is the exact text.</p>
        <button class="btn btn-ghost" data-act="show-prompt" id="show-prompt">${icon('eye')}<span>Show the prompt</span></button><div id="prompt-view"></div></section></div>`;
  };

  const tabBody = () => (tab === 'units' ? unitsTab() : tab === 'preview' ? previewTab() : tab === 'log' ? logTab() : tab === 'setup' ? setupTab() : overviewTab());

  // ------------------------------------------------------------ page and events

  const page = html`<div class="view" id="bv"><div id="hdr">${header()}</div><div id="gate">${gate()}</div><div id="stepper">${stepper()}</div><div id="tabs">${tabs()}</div><div id="tab" role="tabpanel">${tabBody()}</div></div>`;

  return {
    title: d.book.title,
    html: page,
    noFocus: false,
    after(root) {
      const mountTab = () => {
        const el = $('#tab', root);
        paint(el);
        if (tab === 'log') {
          const log = $('#log', root);
          if (log && follow) log.scrollTop = log.scrollHeight;
        }
      };
      mountTab();
      paint(root);

      const redrawChrome = () => {
        $('#hdr', root).innerHTML = header().toString();
        $('#gate', root).innerHTML = gate().toString();
        $('#stepper', root).innerHTML = stepper().toString();
        $('#tabs', root).innerHTML = tabs().toString();
        paint(root);
      };

      async function fetchLogs() {
        const res = await api.get(`/api/books/${id}/logs?after=${logCursor}`);
        if (gone) return;
        if (res.logs.length) {
          logs = logs.concat(res.logs);
          logCursor = res.logs[res.logs.length - 1].id;
          const log = $('#log', root);
          if (log && tab === 'log') {
            log.insertAdjacentHTML('beforeend', res.logs.map(logLine).join(''));
            $('.log-bar .muted', root).textContent = `${logs.length} entries`;
            if (follow) log.scrollTop = log.scrollHeight;
          }
        }
      }

      async function refresh({ force = false } = {}) {
        if (gone) return;
        const prevStatus = d.book.status;
        const next = await api.get(`/api/books/${id}`);
        if (gone) return;
        const changed = prevStatus !== next.book.status || next.book.unitsDone !== d.book.unitsDone || force;
        d = next;
        redrawChrome();
        await fetchLogs();
        if (tab === 'overview') {
          $('#tab', root).innerHTML = overviewTab().toString();
          paint($('#tab', root));
        } else if (tab === 'units' && !isEditing() && (changed || ACTIVE.includes(d.book.status))) {
          $('#tab', root).innerHTML = unitsReadOnly().toString();
          paint($('#tab', root));
        } else if (tab === 'units' && isEditing() && !draft) {
          $('#tab', root).innerHTML = unitsTab().toString();
          paint($('#tab', root));
        }
        if (!isEditing()) draft = null;
        schedule();
      }

      function schedule() {
        clearTimeout(timer);
        if (gone) return;
        const wait = ACTIVE.includes(d.book.status) ? 2000 : d.book.status === 'awaiting' ? 6000 : 0;
        if (!wait) return;
        timer = setTimeout(() => {
          if (document.hidden) schedule();
          else refresh().catch(schedule);
        }, wait);
      }
      onLeave(() => {
        gone = true;
        clearTimeout(timer);
      });
      fetchLogs().catch(() => {});
      schedule();

      const swapTab = (next) => {
        if (tab === 'units' && isEditing()) syncDraft();
        tab = next;
        $('#tabs', root).innerHTML = tabs().toString();
        $('#tab', root).innerHTML = tabBody().toString();
        mountTab();
        history.replaceState(null, '', `#/book/${id}/${tab}`);
      };
      const onHash = () => {
        const parts = location.hash.replace(/^#\/?/, '').split('/');
        if (parts[0] === 'book' && parts[1] === id && TABS.some((t) => t[0] === parts[2]) && parts[2] !== tab) swapTab(parts[2]);
      };
      window.addEventListener('hashchange', onHash);
      onLeave(() => window.removeEventListener('hashchange', onHash));

      const act = async (name, el) => {
        try {
          if (name === 'cancel') {
            if (!(await confirmBox({ title: 'Cancel this book?', text: 'Work stops now. Everything that is finished is kept and you can resume later.', ok: 'Cancel the run', danger: true }))) return;
            await api.post(`/api/books/${id}/cancel`);
            toast('Cancelling…');
          } else if (name === 'resume') {
            await api.post(`/api/books/${id}/resume`);
            toast('Resumed.', 'ok');
          } else if (name === 'rebuild') {
            await api.post(`/api/books/${id}/rebuild`);
            toast('Site folder rebuilt with the current engine.', 'ok');
          } else if (name === 'budget') {
            const r = await modal({ title: 'Spending limit', body: html`<p class="muted">The run stops when this book's cost reaches the limit. 0 means no limit.</p>${field({ name: 'budgetUsd', label: 'Limit in USD', type: 'number', value: d.book.budgetUsd, attrs: ' min="0" step="1"' })}`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: 'Save', value: 'save', kind: 'primary' }] });
            if (!r) return;
            await api.post(`/api/books/${id}/budget`, { budgetUsd: Number(r.data.budgetUsd) });
            toast('Limit updated.', 'ok');
          } else if (name === 'delete') {
            if (!(await confirmBox({ title: 'Delete this book?', text: 'The book, its chapters and the generated site folder are removed for good. Download the folder first if you still need it.', ok: 'Delete', danger: true }))) return;
            await api.del(`/api/books/${id}`);
            toast('Book deleted.', 'ok');
            location.hash = '#/books';
            return;
          } else if (name === 'approve-blueprint') {
            if (isEditing() && draft) await saveDraft();
            await api.post(`/api/books/${id}/approve`, { gate: 'blueprint' });
            draft = null;
            toast('Plan approved. Writing the pilot chapter.', 'ok');
            if (tab === 'units') swapTab('overview');
          } else if (name === 'approve-pilot') {
            await api.post(`/api/books/${id}/approve`, { gate: 'pilot' });
            toast('Approved. Writing the remaining chapters.', 'ok');
          } else if (name === 'redo-pilot') {
            const r = await modal({ title: 'Rewrite the pilot chapter', body: html`<p class="muted">Say what to change. Folio rewrites this one chapter with your notes; nothing else is written yet.</p>${field({ name: 'notes', label: 'Notes for the rewrite', type: 'textarea', rows: 5, hint: 'For example: shorter paragraphs, more everyday examples, harder questions.' })}`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: 'Rewrite', value: 'go', kind: 'primary' }] });
            if (!r) return;
            await api.post(`/api/books/${id}/pilot/redo`, { notes: r.data.notes });
            toast('Rewriting the pilot chapter.', 'ok');
          } else if (name === 'save-bp') {
            await saveDraft();
            toast('Saved.', 'ok');
          } else if (name === 'add-unit') {
            syncDraft();
            const last = draft.units[draft.units.length - 1];
            const start = last ? Math.min(d.book.pagesTotal, Number(last.pageEnd) + 1) : 1;
            draft.units.push({ id: null, title: 'New unit', pageStart: start, pageEnd: Math.min(d.book.pagesTotal, start + 9), importance: 'standard', icon: 'book-open', skip: false, isPilot: false });
            redrawRows();
          } else if (['bp-up', 'bp-down', 'bp-del'].includes(name)) {
            syncDraft();
            const i = Number(el.closest('tr').dataset.i);
            if (name === 'bp-del') {
              if (draft.units.length === 1) return toast('Keep at least one unit.', 'error');
              draft.units.splice(i, 1);
            } else {
              const j = name === 'bp-up' ? i - 1 : i + 1;
              [draft.units[i], draft.units[j]] = [draft.units[j], draft.units[i]];
            }
            if (!draft.units.some((u) => u.isPilot && !u.skip)) {
              const first = draft.units.find((u) => !u.skip);
              if (first) first.isPilot = true;
            }
            redrawRows();
            return;
          } else if (name === 'retry' || name === 'rewrite') {
            const unit = d.units.find((u) => u.id === Number(el.dataset.unit));
            if (name === 'retry') {
              await api.post(`/api/books/${id}/units/${unit.id}/retry`, {});
              toast('Retrying this unit.', 'ok');
            } else {
              const r = await modal({ title: `Rewrite “${unit.title}”`, wide: true, body: html`<p class="muted">Folio writes this unit again from its pages. Adjust the pages or add notes if the first version missed something.</p><div class="grid-2">${field({ name: 'pageStart', label: 'First page', type: 'number', value: unit.pageStart, attrs: ` min="1" max="${d.book.pagesTotal}"` })}${field({ name: 'pageEnd', label: 'Last page', type: 'number', value: unit.pageEnd, attrs: ` min="1" max="${d.book.pagesTotal}"` })}</div>${field({ name: 'notes', label: 'Notes for the rewrite', type: 'textarea', rows: 4, value: unit.notes, hint: 'For example: add the table on page 12, simplify the language.' })}`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: 'Rewrite this unit', value: 'go', kind: 'primary' }] });
              if (!r) return;
              if (Number(r.data.pageStart) !== unit.pageStart || Number(r.data.pageEnd) !== unit.pageEnd) await api.patch(`/api/books/${id}/units/${unit.id}`, { pageStart: Number(r.data.pageStart), pageEnd: Number(r.data.pageEnd) });
              await api.post(`/api/books/${id}/units/${unit.id}/retry`, { regenerate: true, notes: r.data.notes });
              toast('Rewriting this unit.', 'ok');
            }
          } else if (name === 'reload-preview') {
            const frame = $('#frame', root);
            if (frame) frame.src = `/preview/${id}/?t=${Date.now()}`;
            return;
          } else if (name === 'show-prompt') {
            const view = $('#prompt-view', root);
            if (!prompt.loaded) prompt.data = await api.get(`/api/books/${id}/prompt`);
            prompt.loaded = true;
            view.innerHTML = html`<details open class="prompt-block"><summary>Folio instructions (fixed)</summary><pre>${prompt.data.adapter}</pre></details>
              <details class="prompt-block"><summary>Master prompt (version ${prompt.data.master.versionId ?? 'current'}, ${int(prompt.data.master.characters)} characters)</summary><p class="muted pad">Included in full on every request. Edit it under Master prompt.</p></details>
              <details open class="prompt-block"><summary>Parameters block (your settings)</summary><pre>${prompt.data.paramsBlock}</pre></details>`.toString();
            el.hidden = true;
            return;
          }
          await refresh({ force: true });
        } catch (err) {
          if (err.fields) showFieldErrors(root, err.fields);
          toast(err.message, 'error');
        }
      };

      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) {
          btn.closest('details.menu')?.removeAttribute('open');
          act(btn.dataset.act, btn);
        }
      });
      root.addEventListener('change', (e) => {
        if (e.target.name === 'dev') {
          const stage = $('#stage', root);
          stage.className = `preview-stage dev-${e.target.value}`;
        } else if (e.target.id === 'follow') follow = e.target.checked;
        else if (draft && e.target.closest('#bp')) {
          if (e.target.name === 'include' || e.target.name === 'pilot') {
            syncDraft();
            redrawRows();
          } else {
            syncDraft();
            $('#coverage').textContent = coverageText(coverage());
          }
        }
      });
      root.addEventListener('input', (e) => {
        if (draft && e.target.closest('#bp-rows') && (e.target.name === 'pageStart' || e.target.name === 'pageEnd')) {
          syncDraft();
          $('#coverage').textContent = coverageText(coverage());
        }
      });
    },
  };
}
