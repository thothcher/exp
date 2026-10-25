import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { get } from '../db.js';
import { ensureBuilt, siteDir } from '../pipeline/assemble.js';
import { HttpError } from '../lib/util.js';

const router = Router();

// Generated sites are untrusted content: serve them with a strict policy of their own.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

router.get('/:id{/*rest}', async (req, res, next) => {
  try {
    const pathname = req.originalUrl.split('?')[0];
    if (!req.params.rest && !pathname.endsWith('/')) return res.redirect(301, `${pathname}/`);

    const book = get('SELECT id, owner_id FROM books WHERE id = ?', req.params.id);
    if (!book || (book.owner_id !== req.user.id && req.user.role !== 'admin')) throw new HttpError(404, 'Not found.');

    const built = await ensureBuilt(book.id);
    if (!built) throw new HttpError(404, 'Nothing to preview yet: no unit is finished.');

    const rest = (req.params.rest || []).join('/') || 'index.html';
    const root = siteDir(book.id);
    const file = path.resolve(root, rest);
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, 'Not found.');
    let target = file;
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
    if (!fs.existsSync(target)) throw new HttpError(404, 'Not found.');

    res.set({
      'Content-Security-Policy': PREVIEW_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.sendFile(target, { dotfiles: 'deny' }, (err) => err && next(err));
  } catch (err) {
    next(err);
  }
});

export default router;
