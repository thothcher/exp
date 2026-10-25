import { api } from '../api.js';
import { $, ago, confirmBox, html, icon, int, pageHeader, toast } from '../ui.js';

export default async function prompt() {
  let data = await api.get('/api/admin/prompt');
  let baseline = data.active?.body || '';
  let loaded = data.active ? `Version ${data.active.version}` : 'empty';

  const versions = () => html`<ol class="versions">${data.versions.map((v) => html`<li class="${v.active ? 'is-active' : ''}">
    <div><strong>Version ${v.version}</strong>${v.active ? html` <span class="tag tag-ok">active</span>` : ''}<small class="muted block">${ago(v.created_at)}${v.author ? ` · ${v.author}` : ''} · ${int(v.size)} characters</small>${v.note ? html`<small class="block">${v.note}</small>` : ''}</div>
    <div class="btn-row"><button class="btn btn-ghost btn-sm" data-load="${v.id}">${icon('eye', 'i-sm')}Open</button>${v.active ? '' : html`<button class="btn btn-ghost btn-sm" data-activate="${v.id}">${icon('restart', 'i-sm')}Make active</button>`}</div></li>`)}</ol>`;

  return {
    title: 'Master prompt',
    html: html`<div class="view">
      ${pageHeader({ title: 'Master prompt', sub: 'The fixed instructions (PART B of your book-to-study-site prompt). Every request to the model contains them. Edit once, and every book benefits.' })}
      <div class="notice notice-info">${icon('info-circle', 'i-sm')}<span>Books that are already running keep the version they started with, so a change here never alters a half-finished book. The book parameters (PART A) are filled in from the New book form.</span></div>
      <div class="split split-wide">
        <section class="panel"><div class="panel-head"><h2>${icon('document-text')}<span>Instructions</span></h2><p class="muted" id="meta"></p></div>
          <textarea id="body" class="input mono" rows="28" spellcheck="false" aria-label="Master instructions">${data.active?.body || ''}</textarea>
          <div class="field"><label class="field-label" for="note">What changed (optional)</label><input class="input" id="note" maxlength="200" placeholder="For example: shorter chapter paragraphs"></div>
          <div class="btn-row"><button class="btn btn-primary" id="save" disabled>${icon('diskette')}<span>Save as a new version</span></button><button class="btn btn-ghost" id="revert" disabled>${icon('restart')}<span>Discard changes</span></button></div></section>
        <aside class="stack"><section class="panel"><h2>${icon('history')}<span>Versions</span></h2><div id="versions">${versions()}</div></section>
          <details class="panel"><summary><h2>${icon('lock-keyhole')}<span>Folio's own instructions</span></h2></summary><p class="muted">These sit in front of your master prompt and explain that Folio does the engineering, so the model only writes content. They are part of Folio, not editable here.</p><pre class="pre-block">${data.adapter}</pre></details></aside>
      </div>
    </div>`,
    after(root) {
      const body = $('#body', root);
      const save = $('#save', root);
      const revert = $('#revert', root);
      const meta = $('#meta', root);
      const sync = () => {
        const dirty = body.value !== baseline;
        save.disabled = !dirty;
        revert.disabled = !dirty;
        meta.textContent = `${loaded}${dirty ? ' · unsaved changes' : ''} · ${int(body.value.length)} characters · about ${int(Math.round(body.value.length / 4))} tokens`;
      };
      body.addEventListener('input', sync);
      sync();
      const reload = async () => {
        data = await api.get('/api/admin/prompt');
        $('#versions', root).innerHTML = versions().toString();
      };
      revert.addEventListener('click', () => {
        body.value = baseline;
        sync();
      });
      save.addEventListener('click', async () => {
        try {
          const r = await api.put('/api/admin/prompt', { body: body.value, note: $('#note', root).value });
          baseline = body.value;
          loaded = `Version ${r.version}`;
          $('#note', root).value = '';
          toast(`Saved as version ${r.version} and made active.`, 'ok');
          await reload();
          sync();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      root.addEventListener('click', async (e) => {
        const open = e.target.closest('[data-load]');
        const act = e.target.closest('[data-activate]');
        try {
          if (open) {
            if (body.value !== baseline && !(await confirmBox({ title: 'Discard your changes?', text: 'The editor holds changes that are not saved yet.', ok: 'Discard and open' }))) return;
            const r = await api.get(`/api/admin/prompt/${open.dataset.load}`);
            body.value = r.version.body;
            baseline = r.version.body;
            loaded = `Version ${r.version.version}${r.version.active ? ' (active)' : ' (not active)'}`;
            sync();
          } else if (act) {
            await api.post(`/api/admin/prompt/${act.dataset.activate}/activate`);
            toast('Version activated.', 'ok');
            await reload();
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    },
  };
}
