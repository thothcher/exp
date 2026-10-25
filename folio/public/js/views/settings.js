import { api } from '../api.js';
import { $, $$, confirmBox, field, html, icon, pageHeader, raw, toast } from '../ui.js';

const EFFORT_LABELS = { scan: 'Reading the structure', plan: 'Planning units', chapter: 'Writing chapters', practice: 'Cards, questions, exam', audit: 'Checking answer keys', assets: 'Big picture and interface' };
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

export default async function settings() {
  let { settings: s, key, envDryRun } = await api.get('/api/admin/settings');

  const keyCard = () => html`<section class="panel"><h2>${icon('key-minimalistic')}<span>Anthropic API key</span></h2>
    <p class="muted">Folio calls the Claude API with this key. It is stored encrypted on the server and is never sent back to any browser.</p>
    <dl class="facts"><div><dt>Status</dt><dd>${key.source === 'none' ? html`<span class="status status-bad">${icon('close-circle', 'i-sm')}<span>No key set</span></span>` : html`<span class="status status-ok">${icon('check-circle', 'i-sm')}<span>Key set</span></span> <code>${key.masked}</code>`}</dd></div><div><dt>Where from</dt><dd>${key.source === 'dashboard' ? 'Saved here' : key.source === 'environment' ? 'The ANTHROPIC_API_KEY environment variable' : '–'}</dd></div></dl>
    <div class="key-row">${field({ name: 'apikey', label: key.source === 'none' ? 'Paste your key' : 'Replace the key', type: 'password', attrs: ' autocomplete="off" placeholder="sk-ant-…" spellcheck="false"' })}<button class="btn btn-primary" data-act="save-key">${icon('diskette')}<span>Save key</span></button></div>
    <div class="btn-row"><button class="btn btn-ghost" data-act="test-key">${icon('plug-circle')}<span>Test the connection</span></button>${key.source === 'dashboard' ? html`<button class="btn btn-ghost" data-act="remove-key">${icon('trash-bin-trash')}<span>Remove the saved key</span></button>` : ''}</div>
    <p id="key-result" class="notice" hidden></p></section>`;

  const priceRows = Object.entries(s.prices).map(([id, p]) => html`<tr data-model="${id}"><td><strong>${p.label}</strong><small class="muted block">${id}</small></td>
    <td class="center"><input type="checkbox" name="allow" aria-label="Allow ${p.label}"${s.allowed_models.includes(id) ? raw(' checked') : ''}></td>
    <td><input class="input input-sm input-num" type="number" step="0.01" min="0" name="in" value="${p.in}" aria-label="Input price"></td>
    <td><input class="input input-sm input-num" type="number" step="0.01" min="0" name="out" value="${p.out}" aria-label="Output price"></td>
    <td><input class="input input-sm input-num" type="number" step="0.01" min="0" name="cacheWrite" value="${p.cacheWrite}" aria-label="Cache write price"></td>
    <td><input class="input input-sm input-num" type="number" step="0.01" min="0" name="cacheRead" value="${p.cacheRead}" aria-label="Cache read price"></td></tr>`);

  const modelOptions = (selected) => Object.entries(s.prices).map(([id, p]) => ({ value: id, label: p.label, selected: id === selected }));

  return {
    title: 'Settings',
    html: html`<div class="view">${pageHeader({ title: 'Settings', sub: 'Keys, models, limits and safety for the whole team.' })}
      <div class="stack" id="keybox">${keyCard()}</div>
      <form id="settings-form" class="stack" novalidate>
        <section class="panel"><h2>${icon('cpu')}<span>Models and prices</span></h2><p class="muted">Prices are US dollars per million tokens and drive every estimate and spending limit. Update them when the provider changes its rates.</p>
          <div class="table-wrap"><table class="table table-edit"><thead><tr><th>Model</th><th class="center">Allowed</th><th>Input</th><th>Output</th><th>Cache write</th><th>Cache read</th></tr></thead><tbody id="prices">${priceRows}</tbody></table></div>
          <div class="grid-2">${field({ name: 'default_model', label: 'Default model for new books', value: s.default_model, options: modelOptions(s.default_model) })}${field({ name: 'scan_model', label: 'Model for reading the structure', value: s.scan_model, options: modelOptions(s.scan_model), hint: 'A smaller model here cuts the cost of the first pass. You review the plan before anything else is written.' })}</div></section>
        <section class="panel"><h2>${icon('wallet')}<span>Spending limits</span></h2><p class="muted">0 means no limit. Limits are checked before every request, so nobody can overspend by a lot.</p>
          <div class="grid-3">${field({ name: 'default_user_budget_usd', label: 'Monthly budget per person (USD)', type: 'number', value: s.default_user_budget_usd, attrs: ' min="0" step="1"', hint: 'Can be overridden per person.' })}${field({ name: 'default_book_budget_usd', label: 'Default limit per book (USD)', type: 'number', value: s.default_book_budget_usd, attrs: ' min="0" step="1"' })}${field({ name: 'global_monthly_budget_usd', label: 'Team budget per month (USD)', type: 'number', value: s.global_monthly_budget_usd, attrs: ' min="0" step="1"' })}</div></section>
        <section class="panel"><h2>${icon('upload-minimalistic')}<span>Uploads</span></h2>
          <div class="grid-3">${field({ name: 'max_upload_mb', label: 'Largest file (MB)', type: 'number', value: s.max_upload_mb, attrs: ' min="1" max="500"' })}${field({ name: 'max_pages_per_book', label: 'Most pages per book', type: 'number', value: s.max_pages_per_book, attrs: ' min="1" max="5000"' })}${field({ name: 'max_unit_pages', label: 'Largest unit (pages)', type: 'number', value: s.max_unit_pages, attrs: ' min="5" max="100"', hint: 'Longer chapters are split into parts.' })}</div></section>
        <section class="panel"><h2>${icon('bolt')}<span>Speed and thoroughness</span></h2>
          <div class="grid-3">${field({ name: 'max_concurrent_books', label: 'Books at the same time', type: 'number', value: s.max_concurrent_books, attrs: ' min="1" max="10"' })}${field({ name: 'unit_concurrency', label: 'Units in parallel per book', type: 'number', value: s.unit_concurrency, attrs: ' min="1" max="8"', hint: 'Higher is faster but can hit the provider rate limit.' })}${field({ name: 'scan_chunk_pages', label: 'Pages per structure scan', type: 'number', value: s.scan_chunk_pages, attrs: ' min="5" max="60"' })}</div>
          <h3>Thinking effort per kind of work</h3><div class="grid-3">${Object.entries(EFFORT_LABELS).map(([k, l]) => field({ name: `effort_${k}`, label: l, value: s.effort[k], options: EFFORTS }))}</div>
          <label class="check"><input type="checkbox" name="enable_fallbacks"${s.enable_fallbacks ? raw(' checked') : ''}><span><strong>Automatic fallback when a request is declined</strong><small>If the provider's safety filter wrongly declines a page range, the request is re-run on a fallback model instead of failing.</small></span></label></section>
        <section class="panel"><h2>${icon('shield-check')}<span>Safety</span></h2>
          <div class="grid-3">${field({ name: 'session_idle_hours', label: 'Sign people out after (hours idle)', type: 'number', value: s.session_idle_hours, attrs: ' min="1" max="168"' })}${field({ name: 'session_max_days', label: 'Longest session (days)', type: 'number', value: s.session_max_days, attrs: ' min="1" max="90"' })}</div>
          <p class="hint">${icon('info-circle', 'i-sm')}Passwords are hashed with scrypt. Five wrong passwords lock an account for 15 minutes. Sessions use an HttpOnly, same-site cookie and a per-session security token.</p></section>
        <section class="panel"><h2>${icon('test-tube')}<span>Dry-run mode</span></h2>
          <label class="check"><input type="checkbox" name="dry_run"${s.dry_run || envDryRun ? raw(' checked') : ''}${envDryRun ? raw(' disabled') : ''}><span><strong>Build placeholder sites without calling the AI</strong><small>For testing the pipeline and the site design. Nothing is charged. ${envDryRun ? 'Forced on by the FOLIO_MOCK_AI environment variable.' : 'Applies to books created while it is on.'}</small></span></label></section>
        <div class="sticky-actions"><button class="btn btn-primary" type="submit">${icon('diskette')}<span>Save settings</span></button></div>
      </form></div>`,
    after(root) {
      const resultBox = () => $('#key-result', root);
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        try {
          if (btn.dataset.act === 'save-key') {
            const value = $('[name=apikey]', root).value.trim();
            if (!value) return toast('Paste the key first.', 'error');
            ({ key } = await api.put('/api/admin/settings/key', { key: value }));
            $('#keybox', root).innerHTML = keyCard().toString();
            toast('Key saved.', 'ok');
          } else if (btn.dataset.act === 'remove-key') {
            if (!(await confirmBox({ title: 'Remove the saved key?', text: 'New conversions stop until a key is set again. Books in progress will pause.', ok: 'Remove', danger: true }))) return;
            ({ key } = await api.del('/api/admin/settings/key'));
            $('#keybox', root).innerHTML = keyCard().toString();
          } else if (btn.dataset.act === 'test-key') {
            btn.disabled = true;
            const r = await api.post('/api/admin/settings/test-key');
            const box = resultBox();
            box.hidden = false;
            box.className = `notice ${r.ok ? 'notice-ok' : 'notice-bad'}`;
            box.textContent = r.ok ? `The key works (answered by ${r.model}).` : r.error;
            btn.disabled = false;
          }
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
        }
      });

      $('#settings-form', root).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const prices = {};
        const allowed = [];
        for (const tr of $$('#prices tr', root)) {
          const id = tr.dataset.model;
          const num = (n) => Number(tr.querySelector(`[name=${n}]`).value);
          prices[id] = { label: s.prices[id].label, in: num('in'), out: num('out'), cacheWrite: num('cacheWrite'), cacheRead: num('cacheRead') };
          if (tr.querySelector('[name=allow]').checked) allowed.push(id);
        }
        const n = (k) => Number(f.get(k));
        const body = {
          prices,
          allowed_models: allowed,
          default_model: f.get('default_model'),
          scan_model: f.get('scan_model'),
          default_user_budget_usd: n('default_user_budget_usd'),
          default_book_budget_usd: n('default_book_budget_usd'),
          global_monthly_budget_usd: n('global_monthly_budget_usd'),
          max_upload_mb: n('max_upload_mb'),
          max_pages_per_book: n('max_pages_per_book'),
          max_unit_pages: n('max_unit_pages'),
          max_concurrent_books: n('max_concurrent_books'),
          unit_concurrency: n('unit_concurrency'),
          scan_chunk_pages: n('scan_chunk_pages'),
          session_idle_hours: n('session_idle_hours'),
          session_max_days: n('session_max_days'),
          enable_fallbacks: f.get('enable_fallbacks') === 'on',
          dry_run: f.get('dry_run') === 'on',
          effort: Object.fromEntries(Object.keys(EFFORT_LABELS).map((k) => [k, f.get(`effort_${k}`)])),
        };
        try {
          const res = await api.put('/api/admin/settings', body);
          s = res.settings;
          toast('Settings saved.', 'ok');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  };
}
