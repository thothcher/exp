import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { HOST, PORT, PUBLIC_DIR, TRUST_PROXY } from './config.js';
import { get } from './db.js';
import { guardOrigin, requireAuth } from './auth.js';
import { seedMasterPrompt } from './lib/masterPrompt.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import booksRoutes from './routes/books.js';
import miscRoutes from './routes/misc.js';
import previewRoutes from './routes/preview.js';
import uploadsRoutes, { cleanupUploads } from './routes/uploads.js';
import { startRunner, stopRunner } from './pipeline/runner.js';

seedMasterPrompt();

const app = express();
app.disable('x-powered-by');
if (TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(TRUST_PROXY) ? Number(TRUST_PROXY) : TRUST_PROXY);

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'"],
        'frame-src': ["'self'"],
        'frame-ancestors': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
      },
    },
    referrerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  }),
);

app.use(express.json({ limit: '2mb' }));
app.use(guardOrigin);

app.use('/api', rateLimit({ windowMs: 60_000, limit: 900, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: 'Too many requests. Slow down for a moment.' }) }));

app.use('/api/auth', authRoutes);
app.use('/api/uploads', requireAuth, uploadsRoutes);
app.use('/api/books', requireAuth, booksRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/admin', requireAuth, adminRoutes);
app.use('/api', requireAuth, miscRoutes);
app.use('/preview', requireAuth, previewRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: 'index.html', etag: true, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[folio] ${req.method} ${req.originalUrl}:`, err);
  const wantsHtml = req.originalUrl.startsWith('/preview') && req.accepts('html');
  const message = status >= 500 ? 'Something went wrong on the server.' : err.message;
  if (wantsHtml) return res.status(status).type('html').send(`<!doctype html><meta charset="utf-8"><title>${status}</title><body style="font:16px system-ui;padding:32px"><p>${String(message).replace(/[<>&]/g, '')}</p>`);
  res.status(status).json({ error: message, ...(err.extra || {}) });
});

process.on('unhandledRejection', (err) => console.error('[folio] unhandled rejection:', err));

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Folio is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
  if (!get('SELECT id FROM users LIMIT 1')) console.log('  No users exist yet. Create the first administrator with:\n\n    npm run create-admin\n');
  startRunner();
});

const sweep = setInterval(() => cleanupUploads().catch((e) => console.error('[folio] upload cleanup failed:', e)), 60 * 60 * 1000);
sweep.unref();

function shutdown() {
  console.log('\n[folio] shutting down');
  stopRunner();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
