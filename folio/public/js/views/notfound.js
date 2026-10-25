import { empty, html } from '../ui.js';

export default async function notFound() {
  return { title: 'Not found', html: html`<div class="view">${empty('Page not found', 'This page does not exist.', html`<a class="btn btn-primary" href="#/">Back to overview</a>`)}</div>` };
}
