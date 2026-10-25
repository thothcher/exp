import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { UPLOAD_DIR } from '../config.js';
import { all, audit, get, now, run } from '../db.js';
import { setting } from '../lib/settings.js';
import { bad, clientIp, newId, notFound } from '../lib/util.js';
import { countPages, looksLikePdf } from '../pipeline/pdf.js';

const router = Router();

const TMP = path.join(UPLOAD_DIR, 'incoming');
fs.mkdirSync(TMP, { recursive: true });

const MAX_PENDING = 30;

function uploader() {
  return multer({
    storage: multer.diskStorage({
      destination: TMP,
      filename: (_req, _file, cb) => cb(null, `${newId(10)}.part`),
    }),
    limits: { fileSize: setting('max_upload_mb') * 1024 * 1024, files: 20, fields: 5, parts: 40 },
    fileFilter: (_req, file, cb) => {
      const ok = /\.pdf$/i.test(file.originalname) || file.mimetype === 'application/pdf';
      cb(ok ? null : bad('Only PDF files can be uploaded.'), ok);
    },
  }).array('files', 20);
}

const shape = (u) => ({ id: u.id, name: u.original_name, size: u.size, pages: u.pages, createdAt: u.created_at });

router.get('/', (req, res) => {
  res.json({ uploads: all('SELECT * FROM uploads WHERE owner_id = ? AND book_id IS NULL ORDER BY created_at DESC', req.user.id).map(shape) });
});

router.post('/', (req, res, next) => {
  uploader()(req, res, async (err) => {
    const files = req.files || [];
    const cleanup = () => Promise.all(files.map((f) => fsp.rm(f.path, { force: true })));
    try {
      if (err) {
        await cleanup();
        if (err.code === 'LIMIT_FILE_SIZE') throw bad(`A file is larger than the limit of ${setting('max_upload_mb')} MB.`);
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') throw bad('Upload at most 20 files at a time.');
        throw err.status ? err : bad(err.message || 'Upload failed.');
      }
      if (!files.length) throw bad('Choose at least one PDF file.');
      const pending = get('SELECT COUNT(*) AS n FROM uploads WHERE owner_id = ? AND book_id IS NULL', req.user.id).n;
      if (pending + files.length > MAX_PENDING) {
        await cleanup();
        throw bad('Too many files are waiting. Remove some, or start the conversion first.');
      }
      const out = [];
      const errors = [];
      for (const f of files) {
        const original = path.basename(f.originalname).slice(0, 180);
        try {
          const buffer = await fsp.readFile(f.path);
          if (!looksLikePdf(buffer)) throw bad('This file is not a PDF.');
          const pages = await countPages(buffer);
          const id = newId(8);
          const stored = `${id}.pdf`;
          await fsp.rename(f.path, path.join(UPLOAD_DIR, stored));
          run('INSERT INTO uploads (id, owner_id, original_name, stored_name, size, pages, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, req.user.id, original, stored, buffer.length, pages, createHash('sha256').update(buffer).digest('hex'), now());
          out.push(shape(get('SELECT * FROM uploads WHERE id = ?', id)));
        } catch (e) {
          await fsp.rm(f.path, { force: true });
          errors.push({ name: original, error: e.message });
        }
      }
      audit(req.user, 'upload', `${out.length} file(s)`, { names: out.map((o) => o.name) }, clientIp(req));
      res.status(out.length ? 201 : 400).json({ uploads: out, errors });
    } catch (e) {
      next(e);
    }
  });
});

router.delete('/:id', async (req, res) => {
  const row = get('SELECT * FROM uploads WHERE id = ? AND owner_id = ? AND book_id IS NULL', req.params.id, req.user.id);
  if (!row) throw notFound('Upload not found.');
  await fsp.rm(path.join(UPLOAD_DIR, row.stored_name), { force: true });
  run('DELETE FROM uploads WHERE id = ?', row.id);
  res.json({ ok: true });
});

/** Removes uploads that were never attached to a book and are older than a day. */
export async function cleanupUploads() {
  const old = all('SELECT * FROM uploads WHERE book_id IS NULL AND created_at < ?', now() - 24 * 3600 * 1000);
  for (const row of old) {
    await fsp.rm(path.join(UPLOAD_DIR, row.stored_name), { force: true });
    run('DELETE FROM uploads WHERE id = ?', row.id);
  }
  for (const f of await fsp.readdir(TMP)) {
    const p = path.join(TMP, f);
    const st = await fsp.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 3600 * 1000) await fsp.rm(p, { force: true });
  }
}

export default router;
