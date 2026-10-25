import { api } from '../api.js';
import { S } from '../state.js';
import { $, ago, confirmBox, empty, field, html, icon, modal, money, pageHeader, paint, progressBar, raw, toast } from '../ui.js';

const stateOf = (u) => (!u.active ? html`<span class="status status-neutral">${icon('stop-circle', 'i-sm')}<span>Disabled</span></span>` : u.lockedUntil ? html`<span class="status status-warn">${icon('lock-password', 'i-sm')}<span>Locked out</span></span>` : u.mustChangePassword ? html`<span class="status status-info">${icon('key-minimalistic', 'i-sm')}<span>Has not signed in yet</span></span>` : html`<span class="status status-ok">${icon('check-circle', 'i-sm')}<span>Active</span></span>`);

function limitFields(u, defaults) {
  const models = S.config.models;
  const allowed = u?.allowedModels;
  return html`<div class="grid-2">
    ${field({ name: 'monthlyBudgetUsd', label: 'Monthly budget (USD)', type: 'number', value: u?.monthlyBudgetUsd ?? '', hint: `Empty uses the team default (${money(defaults.monthlyBudgetUsd)}). 0 means no limit.`, attrs: ' min="0" step="1"' })}
    ${field({ name: 'maxActiveBooks', label: 'Books at the same time', type: 'number', value: u?.maxActiveBooks ?? '', hint: 'Empty uses the default (3).', attrs: ' min="0" max="50"' })}
    ${field({ name: 'maxPagesPerBook', label: 'Pages per book', type: 'number', value: u?.maxPagesPerBook ?? '', hint: 'Empty uses the team default.', attrs: ' min="1"' })}
  </div>
  <fieldset class="field"><legend class="field-label">Models this person may use</legend><p class="field-hint">Leave all ticked to allow every model.</p>
    <div class="checks">${models.map((m) => html`<label class="check"><input type="checkbox" name="model" value="${m.id}"${!allowed || allowed.includes(m.id) ? raw(' checked') : ''}><span>${m.label}</span></label>`)}</div></fieldset>`;
}

function readLimits(r) {
  const form = r.form;
  const num = (k) => (r.data[k] === '' || r.data[k] === undefined ? null : Number(r.data[k]));
  const picked = [...form.querySelectorAll('[name=model]:checked')].map((c) => c.value);
  return {
    monthlyBudgetUsd: num('monthlyBudgetUsd'),
    maxActiveBooks: num('maxActiveBooks'),
    maxPagesPerBook: num('maxPagesPerBook'),
    allowedModels: picked.length === S.config.models.length ? null : picked,
  };
}

export default async function users() {
  let data = await api.get('/api/users');
  const me = S.user;

  const table = () => html`<div class="table-wrap"><table class="table"><thead><tr><th>Person</th><th>Role</th><th>State</th><th>This month</th><th class="num">Books</th><th>Last sign-in</th><th><span class="visually-hidden">Actions</span></th></tr></thead><tbody>
    ${data.users.map((u) => {
    const limit = u.monthlyBudgetUsd ?? data.defaults.monthlyBudgetUsd;
    return html`<tr class="${u.active ? '' : 'is-muted'}">
      <td><strong>${u.displayName}</strong><small class="muted block">@${u.username}${u.id === me.id ? ' · you' : ''}</small></td>
      <td>${u.role === 'admin' ? 'Administrator' : 'Member'}</td>
      <td>${stateOf(u)}</td>
      <td class="prog-cell">${money(u.monthSpendUsd)}${limit > 0 ? html` <small class="muted">of ${money(limit)}</small>${progressBar(u.monthSpendUsd, limit, u.monthSpendUsd / limit > 0.85 ? 'is-warn' : '')}` : html` <small class="muted">no limit</small>`}</td>
      <td class="num">${u.books}${u.activeBooks ? html` <small class="muted">(${u.activeBooks} active)</small>` : ''}</td>
      <td class="muted nowrap">${ago(u.lastLoginAt)}</td>
      <td class="actions-cell"><button class="btn btn-ghost btn-sm" data-act="edit" data-id="${u.id}">${icon('pen', 'i-sm')}Edit</button>
        <details class="menu"><summary class="btn btn-quiet btn-icon btn-sm" aria-label="More actions for ${u.displayName}">${icon('menu-dots', 'i-sm')}</summary><div class="menu-list">
          <button data-act="reset" data-id="${u.id}">${icon('key-minimalistic', 'i-sm')}Reset password</button>
          <button data-act="signout" data-id="${u.id}">${icon('logout-2', 'i-sm')}Sign out everywhere${u.sessions ? ` (${u.sessions})` : ''}</button>
          ${u.id !== me.id ? html`<button data-act="toggle" data-id="${u.id}">${icon(u.active ? 'stop-circle' : 'play-circle', 'i-sm')}${u.active ? 'Disable account' : 'Enable account'}</button><button data-act="delete" data-id="${u.id}" class="is-danger">${icon('trash-bin-trash', 'i-sm')}Delete account</button>` : ''}
        </div></details></td></tr>`;
  })}</tbody></table></div>`;

  const showPassword = (name, pw, title) => modal({
    title,
    body: html`<p>Give this temporary password to <strong>${name}</strong>. It is shown only once. They must choose their own password at the first sign-in.</p><div class="secret"><code id="pw-text">${pw}</code><button type="button" class="btn btn-ghost btn-sm" id="pw-copy">${icon('copy', 'i-sm')}Copy</button></div>`,
    actions: [{ label: 'Done', value: 'close', kind: 'primary' }],
    onOpen: (dlg) => dlg.querySelector('#pw-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pw);
        toast('Copied.', 'ok');
      } catch {
        toast('Select the password and copy it by hand.', 'error');
      }
    }),
  });

  return {
    title: 'People',
    html: html`<div class="view">${pageHeader({ title: 'People', sub: 'Accounts are created here and nowhere else. Set what each person may spend and use.', actions: html`<button class="btn btn-primary" data-act="add">${icon('user-plus')}<span>Add a person</span></button>` })}<div id="users">${table()}</div></div>`,
    after(root) {
      const redraw = async () => {
        data = await api.get('/api/users');
        $('#users', root).innerHTML = table().toString();
        paint(root);
      };
      paint(root);
      root.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        btn.closest('details.menu')?.removeAttribute('open');
        const u = data.users.find((x) => x.id === Number(btn.dataset.id));
        try {
          if (btn.dataset.act === 'add') {
            const r = await modal({ title: 'Add a person', wide: true, body: html`<div class="grid-2">${field({ name: 'username', label: 'Username', required: true, hint: '3 to 32 letters, digits, dot, dash or underscore.', attrs: ' autocomplete="off" autocapitalize="off"' })}${field({ name: 'displayName', label: 'Name', hint: 'Shown in the dashboard.' })}${field({ name: 'role', label: 'Role', value: 'member', options: [{ value: 'member', label: 'Member: converts books' }, { value: 'admin', label: 'Administrator: also manages people and settings' }] })}</div>${limitFields(null, data.defaults)}`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: 'Create account', value: 'create', kind: 'primary' }] });
            if (!r) return;
            const res = await api.post('/api/users', { username: r.data.username, displayName: r.data.displayName, role: r.data.role, ...readLimits(r) });
            await redraw();
            await showPassword(res.user.displayName, res.temporaryPassword, 'Account created');
          } else if (btn.dataset.act === 'edit') {
            const r = await modal({ title: `Edit ${u.displayName}`, wide: true, body: html`<div class="grid-2">${field({ name: 'displayName', label: 'Name', value: u.displayName })}${field({ name: 'role', label: 'Role', value: u.role, options: [{ value: 'member', label: 'Member' }, { value: 'admin', label: 'Administrator' }] })}</div>${limitFields(u, data.defaults)}`, actions: [{ label: 'Cancel', value: 'cancel', noValidate: true }, { label: 'Save', value: 'save', kind: 'primary' }] });
            if (!r) return;
            await api.patch(`/api/users/${u.id}`, { displayName: r.data.displayName, role: r.data.role, ...readLimits(r) });
            toast('Saved.', 'ok');
            await redraw();
          } else if (btn.dataset.act === 'reset') {
            if (!(await confirmBox({ title: `Reset the password of ${u.displayName}?`, text: 'They are signed out everywhere and must choose a new password at the next sign-in.', ok: 'Reset password' }))) return;
            const res = await api.post(`/api/users/${u.id}/reset-password`);
            await redraw();
            await showPassword(u.displayName, res.temporaryPassword, 'Password reset');
          } else if (btn.dataset.act === 'signout') {
            await api.post(`/api/users/${u.id}/revoke-sessions`);
            toast('Signed out everywhere.', 'ok');
            await redraw();
          } else if (btn.dataset.act === 'toggle') {
            if (u.active && !(await confirmBox({ title: `Disable ${u.displayName}?`, text: 'They are signed out now and cannot sign in until you enable the account again. Their books are kept.', ok: 'Disable' }))) return;
            await api.patch(`/api/users/${u.id}`, { active: !u.active });
            await redraw();
          } else if (btn.dataset.act === 'delete') {
            if (!(await confirmBox({ title: `Delete ${u.displayName}?`, text: 'Only possible when the person owns no books. Otherwise disable the account instead.', ok: 'Delete account', danger: true }))) return;
            await api.del(`/api/users/${u.id}`);
            toast('Account deleted.', 'ok');
            await redraw();
          }
        } catch (err) {
          toast(err.message, 'error');
        }
      });
      if (!data.users.length) $('#users', root).innerHTML = empty('No people yet').toString();
    },
  };
}
