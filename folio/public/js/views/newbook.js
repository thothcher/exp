import { api, ApiError } from '../api.js';
import { S } from '../state.js';
import { $, $$, debounce, esc, field, html, icon, int, money, pageHeader, paint, raw, showFieldErrors, toast } from '../ui.js';

const mb = (n) => `${(n / 1048576).toFixed(n > 10485760 ? 0 : 1)} MB`;

function renderField(f, values) {
  const v = values[f.key] ?? f.default ?? '';
  const hint = f.help || '';
  if (f.type === 'select') {
    return field({ name: f.key, label: f.label, value: v, hint, options: f.options });
  }
  if (f.type === 'combo') {
    return html`${field({ name: f.key, label: f.label, value: v, hint, required: f.required, list: `dl-${f.key}`, attrs: f.max ? ` maxlength="${f.max}"` : '' })}<datalist id="dl-${f.key}">${f.options.map((o) => html`<option value="${o}"></option>`)}</datalist>`;
  }
  return field({ name: f.key, label: f.label, type: f.type === 'textarea' ? 'textarea' : 'text', value: v, hint, required: f.required, rows: f.rows || 3, attrs: `${f.max ? ` maxlength="${f.max}"` : ''}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}` });
}

export default async function newBook() {
  const cfg = S.config;
  const schema = cfg.schema;
  const existing = await api.get('/api/uploads');
  let uploads = existing.uploads;
  let busy = false;

  const byGroup = (g) => schema.fields.filter((f) => f.group === g);
  const values = Object.fromEntries(schema.fields.map((f) => [f.key, f.default]));

  const fileList = () => (uploads.length
    ? html`<ul class="files">${uploads.map((u, i) => html`<li class="file"><span class="file-ico">${icon('file-text')}</span><span class="file-main"><strong>${u.name}</strong><small>${int(u.pages)} pages · ${mb(u.size)}</small></span><span class="file-actions"><button type="button" class="btn btn-quiet btn-icon btn-sm" data-move="${i}" data-dir="-1" aria-label="Move up"${i === 0 ? raw(' disabled') : ''}>${icon('alt-arrow-up', 'i-sm')}</button><button type="button" class="btn btn-quiet btn-icon btn-sm" data-move="${i}" data-dir="1" aria-label="Move down"${i === uploads.length - 1 ? raw(' disabled') : ''}>${icon('alt-arrow-down', 'i-sm')}</button><button type="button" class="btn btn-quiet btn-icon btn-sm" data-remove="${u.id}" aria-label="Remove ${esc(u.name)}">${icon('trash-bin-trash', 'i-sm')}</button></span></li>`)}</ul>${uploads.length > 1 ? html`<p class="hint">${icon('info-circle', 'i-sm')}These files become one book, in this order.</p>` : ''}`
    : '');

  const featureRows = html`${schema.features.map((f) => html`<div class="feature"><span>${f.label}</span><div class="seg" role="radiogroup" aria-label="${f.label}">${['on', 'auto', 'off'].map((o) => html`<label class="seg-opt"><input type="radio" name="feat_${f.key}" value="${o}"${f.default === o ? raw(' checked') : ''}><span>${o === 'on' ? 'On' : o === 'auto' ? 'Auto' : 'Off'}</span></label>`)}</div></div>`)}`;

  const page = html`<div class="view">
    ${pageHeader({ title: 'New book', sub: 'Upload the PDF, describe the course, and Folio plans the study site. You approve before anything expensive happens.' })}
    <div class="split">
      <form id="book-form" class="stack" novalidate>
        <section class="panel"><h2><span class="step-n">1</span><span>Source files</span></h2>
          <label class="drop" id="drop" for="file-input" tabindex="0">${icon('upload-minimalistic')}<span class="drop-title">Drop PDF files here, or choose them</span><span class="drop-sub">Up to ${cfg.limits.maxUploadMb} MB per file. Several files are treated as parts of one book, in order.</span></label>
          <input id="file-input" class="visually-hidden" type="file" accept="application/pdf,.pdf" multiple>
          <div id="files">${fileList()}</div></section>
        <section class="panel"><h2><span class="step-n">2</span><span>The book</span></h2><p class="muted">${schema.groups[0].hint}</p><div class="grid-2">${byGroup('book').map((f) => renderField(f, values))}</div></section>
        <section class="panel"><h2><span class="step-n">3</span><span>Course and exam</span></h2><p class="muted">${schema.groups[1].hint}</p><div class="stack-s">${byGroup('course').map((f) => renderField(f, values))}</div></section>
        <details class="panel fold"><summary><h2><span class="step-n">4</span><span>Advanced</span></h2>${icon('alt-arrow-down', 'fold-ico')}</summary><p class="muted">${schema.groups[2].hint}</p><div class="grid-2">${byGroup('advanced').map((f) => renderField(f, values))}</div>
          <h3>Features of the study site</h3><div class="features">${featureRows}</div>
          <p class="hint">${icon('info-circle', 'i-sm')}Matching games, timeline and signature interactive are not in site engine ${cfg.engineVersion}; they are always off.</p></details>
      </form>

      <aside class="summary" aria-label="Summary and cost">
        <div class="panel panel-sticky">
          <h2>Summary</h2>
          <dl class="facts" id="facts"></dl>
          <div class="field"><label class="field-label" for="model">Model</label><select class="input" id="model">${cfg.models.map((m) => html`<option value="${m.id}"${m.id === cfg.defaultModel ? raw(' selected') : ''}>${m.label}</option>`)}</select></div>
          <label class="check"><input type="checkbox" id="verify" checked><span><strong>Check every answer key</strong><small>A second pass re-reads the pages and fixes wrong questions. Adds about 15% to the cost.</small></span></label>
          ${cfg.dryRun ? '' : html`<div class="field"><label class="field-label" for="budget">Spending limit for this book (USD)</label><input class="input" id="budget" type="number" min="0" step="1" value="${cfg.limits.defaultBookBudgetUsd}"><p class="field-hint">The run stops when it reaches this. 0 means no limit.</p></div>`}
          <div class="estimate" id="estimate"></div>
          ${cfg.dryRun ? html`<p class="notice notice-info">${icon('test-tube', 'i-sm')}<span>Dry-run mode is on. Folio builds a placeholder site without calling the AI. Nothing is charged.</span></p>` : cfg.hasKey ? '' : html`<p class="notice notice-bad">${icon('danger-triangle', 'i-sm')}<span>No API key is set yet. ${S.user.role === 'admin' ? html`<a href="#/settings">Add one in Settings.</a>` : 'Ask an administrator to add one.'}</span></p>`}
          <button class="btn btn-primary btn-block btn-lg" id="start" type="button" disabled>${icon('play')}<span>Start conversion</span></button>
          <p class="hint">Folio first reads the structure and shows you a plan. Nothing is written until you approve it.</p>
        </div>
      </aside>
    </div>
  </div>`;

  return {
    title: 'New book',
    html: page,
    after(root) {
      const form = $('#book-form', root);
      const facts = $('#facts', root);
      const start = $('#start', root);

      const totalPages = () => uploads.reduce((n, u) => n + u.pages, 0);
      const refreshFiles = () => {
        $('#files', root).innerHTML = fileList().toString();
        facts.innerHTML = html`<div><dt>Files</dt><dd>${uploads.length}</dd></div><div><dt>Pages</dt><dd>${int(totalPages())}</dd></div>`.toString();
        start.disabled = !uploads.length || busy;
        estimate();
      };

      const estimate = debounce(async () => {
        const box = $('#estimate', root);
        if (!uploads.length) {
          box.innerHTML = html`<p class="muted">Add a file to see an estimate.</p>`.toString();
          return;
        }
        try {
          const depth = form.elements.DEPTH.value;
          const { estimate: e, units } = await api.get(`/api/books/estimate?pages=${totalPages()}&depth=${depth}&model=${$('#model', root).value}&verify=${$('#verify', root).checked ? 1 : 0}`);
          box.innerHTML = cfg.dryRun
            ? html`<p class="est-label">Estimated cost</p><p class="est-value">$0.00</p><p class="muted">Dry run. A real run would cost about ${money(e.low)} to ${money(e.high)}.</p>`.toString()
            : html`<p class="est-label">Estimated cost</p><p class="est-value">${money(e.mid)}</p><p class="muted">Likely between ${money(e.low)} and ${money(e.high)} for about ${units} chapters. The structure scan alone is about ${money(e.scan)}.</p><p class="hint">${icon('info-circle', 'i-sm')}An estimate before reading the book. It is refined after the scan, before you approve.</p>`.toString();
        } catch {
          box.innerHTML = '';
        }
      }, 250);

      async function upload(fileList) {
        const files = [...fileList].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
        if (!files.length) return toast('Only PDF files can be uploaded.', 'error');
        busy = true;
        start.disabled = true;
        $('#drop', root).classList.add('is-busy');
        $('#drop .drop-title', root).textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`;
        const fd = new FormData();
        files.forEach((f) => fd.append('files', f));
        try {
          const res = await api.upload('/api/uploads', fd);
          uploads = [...uploads, ...res.uploads];
          for (const e of res.errors || []) toast(`${e.name}: ${e.error}`, 'error');
          if (!form.elements.BOOK_TITLE.value && res.uploads[0]) form.elements.BOOK_TITLE.value = res.uploads[0].name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim();
        } catch (err) {
          const detail = err instanceof ApiError ? err.message : 'Upload failed.';
          toast(detail, 'error');
          for (const e of err.data?.errors || []) toast(`${e.name}: ${e.error}`, 'error');
        } finally {
          busy = false;
          $('#drop', root).classList.remove('is-busy');
          $('#drop .drop-title', root).textContent = 'Drop PDF files here, or choose them';
          refreshFiles();
        }
      }

      const input = $('#file-input', root);
      input.addEventListener('change', () => {
        upload(input.files);
        input.value = '';
      });
      const drop = $('#drop', root);
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add('is-over');
      }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
      }));
      drop.addEventListener('drop', (e) => upload(e.dataTransfer.files));

      $('#files', root).addEventListener('click', async (e) => {
        const rm = e.target.closest('[data-remove]');
        const mv = e.target.closest('[data-move]');
        if (rm) {
          try {
            await api.del(`/api/uploads/${rm.dataset.remove}`);
          } catch {
            // already gone
          }
          uploads = uploads.filter((u) => u.id !== rm.dataset.remove);
          refreshFiles();
        } else if (mv) {
          const i = Number(mv.dataset.move);
          const j = i + Number(mv.dataset.dir);
          [uploads[i], uploads[j]] = [uploads[j], uploads[i]];
          refreshFiles();
        }
      });

      form.addEventListener('change', estimate);
      $('#model', root).addEventListener('change', estimate);
      $('#verify', root).addEventListener('change', estimate);

      start.addEventListener('click', async () => {
        const fd = new FormData(form);
        const params = {};
        for (const f of schema.fields) params[f.key] = fd.get(f.key) ?? '';
        params.FEATURES = Object.fromEntries(schema.features.map((f) => [f.key, fd.get(`feat_${f.key}`) || f.default]));
        showFieldErrors(root, {});
        start.disabled = true;
        try {
          const budget = $('#budget', root);
          const res = await api.post('/api/books', {
            uploadIds: uploads.map((u) => u.id),
            params,
            model: $('#model', root).value,
            verify: $('#verify', root).checked,
            budgetUsd: budget ? Number(budget.value) : 0,
          });
          toast('Conversion started.', 'ok');
          location.hash = `#/book/${res.book.id}`;
        } catch (err) {
          start.disabled = false;
          if (err.fields) {
            // the advanced section may hide the failing field
            if (Object.keys(err.fields).some((k) => schema.fields.find((f) => f.key === k)?.group === 'advanced')) $('details.fold', root).open = true;
            showFieldErrors(root, err.fields);
          }
          toast(err.message, 'error');
        }
      });

      refreshFiles();
      paint(root);
    },
  };
}
