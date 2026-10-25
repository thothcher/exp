import { api, setCsrf } from '../api.js';
import { $, field, html, icon } from '../ui.js';

export function renderLogin(onDone) {
  $('#app').innerHTML = html`<div class="auth">
    <section class="auth-intro" aria-hidden="true">
      <a class="brand brand-lg" href="#/"><span class="brand-mark"></span><span class="brand-name">Folio</span></a>
      <h2>Turn a book into a study site.</h2>
      <ul class="auth-points">
        <li>${icon('upload-minimalistic')}<span>Upload the PDF and describe the course.</span></li>
        <li>${icon('checklist-minimalistic')}<span>Approve the plan and the pilot chapter.</span></li>
        <li>${icon('folder-with-files')}<span>Download a folder that is ready to publish.</span></li>
      </ul>
    </section>
    <section class="auth-panel">
      <form id="login" class="auth-card" novalidate>
        <h1>Sign in</h1>
        <p class="muted">Use the account your administrator created for you.</p>
        ${field({ name: 'username', label: 'Username', required: true, attrs: ' autocomplete="username" autocapitalize="off" spellcheck="false" autofocus' })}
        ${field({ name: 'password', label: 'Password', type: 'password', required: true, attrs: ' autocomplete="current-password"' })}
        <p class="notice notice-bad" id="login-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">${icon('login-2')}<span>Sign in</span></button>
        <p class="auth-foot">There is no sign-up page. Ask an administrator for an account.</p>
      </form>
    </section>
  </div>`.toString();
  const form = $('#login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const f = new FormData(form);
      const res = await api.post('/api/auth/login', { username: f.get('username'), password: f.get('password') });
      setCsrf(res.csrf);
      await onDone();
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
      form.querySelector('[name=password]').value = '';
      form.querySelector('[name=password]').focus();
    } finally {
      btn.disabled = false;
    }
  });
}

export function renderForcedPassword(user, onDone) {
  $('#app').innerHTML = html`<div class="auth auth-single">
    <section class="auth-panel">
      <form id="pw" class="auth-card" novalidate>
        <a class="brand" href="#/"><span class="brand-mark"></span><span class="brand-name">Folio</span></a>
        <h1>Choose a new password</h1>
        <p class="muted">Hello ${user.displayName}. Your administrator gave you a temporary password. Choose your own before you continue.</p>
        ${field({ name: 'current', label: 'Temporary password', type: 'password', required: true, attrs: ' autocomplete="current-password"' })}
        ${field({ name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters.', attrs: ' autocomplete="new-password"' })}
        ${field({ name: 'again', label: 'Repeat the new password', type: 'password', required: true, attrs: ' autocomplete="new-password"' })}
        <p class="notice notice-bad" id="pw-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit"><span>Save and continue</span></button>
      </form>
    </section>
  </div>`.toString();
  const form = $('#pw');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#pw-error');
    err.hidden = true;
    const f = new FormData(form);
    if (f.get('next') !== f.get('again')) {
      err.textContent = 'The two new passwords do not match.';
      err.hidden = false;
      return;
    }
    try {
      await api.post('/api/auth/password', { current: f.get('current'), next: f.get('next') });
      await onDone();
    } catch (error) {
      err.textContent = error.message;
      err.hidden = false;
    }
  });
}
