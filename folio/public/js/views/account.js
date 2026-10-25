import { api } from '../api.js';
import { S } from '../state.js';
import { $, field, html, icon, money, pageHeader, progressBar, paint, toast } from '../ui.js';

export default async function account() {
  const ov = await api.get('/api/overview');
  const me = ov.me;
  const u = S.user;
  return {
    title: 'Account',
    html: html`<div class="view view-narrow">${pageHeader({ title: 'Your account', sub: `${u.displayName} · @${u.username} · ${u.role === 'admin' ? 'Administrator' : 'Member'}` })}
      <section class="panel"><h2>${icon('wallet')}<span>This month</span></h2>
        <p class="big">${money(me.monthSpendUsd)}</p>${me.budgetUsd > 0 ? html`${progressBar(me.monthSpendUsd, me.budgetUsd)}<p class="muted">of your ${money(me.budgetUsd)} monthly budget</p>` : html`<p class="muted">You have no monthly limit.</p>`}
        <p class="muted">You may run ${me.maxActiveBooks} books at the same time.</p></section>
      <form id="pw" class="panel stack-s" novalidate><h2>${icon('lock-password')}<span>Change your password</span></h2>
        ${field({ name: 'current', label: 'Current password', type: 'password', required: true, attrs: ' autocomplete="current-password"' })}
        ${field({ name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters. You are signed out on your other devices.', attrs: ' autocomplete="new-password"' })}
        ${field({ name: 'again', label: 'Repeat the new password', type: 'password', required: true, attrs: ' autocomplete="new-password"' })}
        <p class="notice notice-bad" id="pw-error" role="alert" hidden></p>
        <div><button class="btn btn-primary" type="submit">${icon('diskette')}<span>Change password</span></button></div></form></div>`,
    after(root) {
      paint(root);
      const form = $('#pw', root);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('#pw-error', root);
        err.hidden = true;
        const f = new FormData(form);
        if (f.get('next') !== f.get('again')) {
          err.textContent = 'The two new passwords do not match.';
          err.hidden = false;
          return;
        }
        try {
          await api.post('/api/auth/password', { current: f.get('current'), next: f.get('next') });
          form.reset();
          toast('Password changed.', 'ok');
        } catch (error) {
          err.textContent = error.message;
          err.hidden = false;
        }
      });
    },
  };
}
