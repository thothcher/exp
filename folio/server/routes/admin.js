import { Router } from 'express';
import { FORCE_MOCK_AI } from '../config.js';
import { all, audit, get, now } from '../db.js';
import { requireAdmin } from '../auth.js';
import { activatePromptVersion, activePrompt, promptVersions, savePromptVersion } from '../lib/masterPrompt.js';
import { DEFAULT_PRICES, SETTING_KEYS, apiKey, apiKeySource, clearSetting, isSecretKey, publicSettings, saveSetting, setting } from '../lib/settings.js';
import { bad, clampInt, clampNum, clientIp, notFound } from '../lib/util.js';

import { testApiKey } from '../pipeline/ai.js';
import { ADAPTER } from '../pipeline/prompts.js';
import { maskSecret } from '../security.js';

const router = Router();
router.use(requireAdmin);

// ------------------------------------------------------------------ settings

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const INT_RULES = {
  max_upload_mb: [1, 500, 'Upload limit (MB)'],
  max_pages_per_book: [1, 5000, 'Pages per book'],
  max_concurrent_books: [1, 10, 'Books at the same time'],
  unit_concurrency: [1, 8, 'Units in parallel'],
  scan_chunk_pages: [5, 60, 'Scan chunk (pages)'],
  max_unit_pages: [5, 100, 'Unit size (pages)'],
  session_idle_hours: [1, 168, 'Idle timeout (hours)'],
  session_max_days: [1, 90, 'Session length (days)'],
};

function readSetting(key, value) {
  const models = Object.keys(setting('prices'));
  switch (key) {
    case 'default_model':
    case 'scan_model':
      if (!models.includes(value)) throw bad(`Unknown model for ${key}.`);
      return value;
    case 'allowed_models': {
      const list = [...new Set((Array.isArray(value) ? value : []).map(String))].filter((m) => models.includes(m));
      if (!list.length) throw bad('Allow at least one model.');
      return list;
    }
    case 'prices': {
      if (!value || typeof value !== 'object') throw bad('Prices must be an object.');
      const out = {};
      for (const [id, p] of Object.entries(value)) {
        if (!/^[a-z0-9.-]{3,60}$/.test(id)) throw bad(`Bad model id: ${id}`);
        const num = (n) => clampNum(n, 0, 10000, null);
        const price = { label: String(p.label || DEFAULT_PRICES[id]?.label || id).slice(0, 60), in: num(p.in), out: num(p.out), cacheWrite: num(p.cacheWrite), cacheRead: num(p.cacheRead) };
        if ([price.in, price.out, price.cacheWrite, price.cacheRead].some((n) => n === null)) throw bad(`Check the prices of ${id}.`);
        out[id] = price;
      }
      if (!Object.keys(out).length) throw bad('Keep at least one model.');
      return out;
    }
    case 'effort': {
      const out = {};
      for (const k of Object.keys(setting('effort'))) {
        const v = String(value?.[k] ?? setting('effort')[k]);
        if (!EFFORTS.includes(v)) throw bad(`Effort for ${k} must be one of ${EFFORTS.join(', ')}.`);
        out[k] = v;
      }
      return out;
    }
    case 'max_upload_mb':
    case 'max_pages_per_book':
    case 'max_concurrent_books':
    case 'unit_concurrency':
    case 'scan_chunk_pages':
    case 'max_unit_pages':
    case 'session_idle_hours':
    case 'session_max_days': {
      const [lo, hi, label] = INT_RULES[key];
      const n = Number.parseInt(value, 10);
      if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${label}: enter a whole number from ${lo} to ${hi}.`);
      return n;
    }
    case 'default_user_budget_usd':
    case 'default_book_budget_usd':
    case 'global_monthly_budget_usd': {
      const n = clampNum(value, 0, 1e6, null);
      if (n === null) throw bad('Enter an amount in dollars (0 means no limit).');
      return n;
    }
    case 'dry_run':
    case 'enable_fallbacks':
      return Boolean(value);
    default:
      throw bad(`Unknown setting: ${key}`);
  }
}

function keyInfo() {
  const key = apiKey();
  return { source: apiKeySource(), masked: maskSecret(key) };
}

router.get('/settings', (_req, res) => {
  res.json({ settings: publicSettings(), key: keyInfo(), envDryRun: FORCE_MOCK_AI });
});

router.put('/settings', (req, res) => {
  const body = req.body || {};
  const changed = [];
  for (const [key, value] of Object.entries(body)) {
    if (!SETTING_KEYS.includes(key) || isSecretKey(key)) continue;
    saveSetting(key, readSetting(key, value), req.user.id);
    changed.push(key);
  }
  const s = publicSettings();
  if (!s.allowed_models.includes(s.default_model)) saveSetting('default_model', s.allowed_models[0], req.user.id);
  audit(req.user, 'settings.update', null, { keys: changed }, clientIp(req));
  res.json({ settings: publicSettings(), key: keyInfo() });
});

router.put('/settings/key', (req, res) => {
  const key = String(req.body?.key || '').trim();
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) throw bad('That does not look like an API key.');
  saveSetting('anthropic_api_key', key, req.user.id);
  audit(req.user, 'settings.api_key_set', null, { masked: maskSecret(key) }, clientIp(req));
  res.json({ key: keyInfo() });
});

router.delete('/settings/key', (req, res) => {
  clearSetting('anthropic_api_key');
  audit(req.user, 'settings.api_key_removed', null, null, clientIp(req));
  res.json({ key: keyInfo() });
});

router.post('/settings/test-key', async (_req, res) => {
  try {
    const out = await testApiKey();
    res.json({ ok: true, model: out.model });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
});

// ------------------------------------------------------------------ master prompt

router.get('/prompt', (_req, res) => {
  const active = activePrompt();
  res.json({ active: active ? { id: active.id, version: active.version, body: active.body, note: active.note } : null, versions: promptVersions(), adapter: ADAPTER });
});

router.get('/prompt/:id', (req, res) => {
  const row = get('SELECT id, version, body, note, active FROM prompt_versions WHERE id = ?', Number(req.params.id));
  if (!row) throw notFound('Version not found.');
  res.json({ version: row });
});

router.put('/prompt', (req, res) => {
  const body = String(req.body?.body || '').replace(/\r\n/g, '\n').trim();
  const note = String(req.body?.note || '').trim().slice(0, 200);
  if (body.length < 500) throw bad('The master instructions look too short.');
  if (body.length > 200000) throw bad('The master instructions are too long (200,000 characters at most).');
  const { id, version } = savePromptVersion(body, note, req.user.id);
  audit(req.user, 'prompt.save', `v${version}`, { chars: body.length }, clientIp(req));
  res.status(201).json({ id, version });
});

router.post('/prompt/:id/activate', (req, res) => {
  if (!activatePromptVersion(Number(req.params.id))) throw notFound('Version not found.');
  audit(req.user, 'prompt.activate', String(req.params.id), null, clientIp(req));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ usage and audit

router.get('/usage', (req, res) => {
  const days = clampInt(req.query.days, 1, 365, 30);
  const since = now() - days * 86400000;
  const daily = all(
    `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, ROUND(SUM(cost_usd), 4) AS cost, SUM(input_tokens + cache_read_tokens + cache_write_tokens) AS input, SUM(output_tokens) AS output, COUNT(*) AS calls
     FROM usage_events WHERE ts >= ? AND dry_run = 0 GROUP BY day ORDER BY day`, since,
  );
  const byUser = all(
    `SELECT u.id, u.username, u.display_name AS displayName, ROUND(SUM(e.cost_usd), 4) AS cost, COUNT(DISTINCT e.book_id) AS books, SUM(e.input_tokens + e.cache_read_tokens + e.cache_write_tokens) AS input, SUM(e.output_tokens) AS output
     FROM usage_events e JOIN users u ON u.id = e.user_id WHERE e.ts >= ? AND e.dry_run = 0 GROUP BY u.id ORDER BY cost DESC`, since,
  );
  const byModel = all(`SELECT model, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls FROM usage_events WHERE ts >= ? AND dry_run = 0 GROUP BY model ORDER BY cost DESC`, since);
  const byPurpose = all(`SELECT purpose, ROUND(SUM(cost_usd), 4) AS cost, COUNT(*) AS calls FROM usage_events WHERE ts >= ? AND dry_run = 0 GROUP BY purpose ORDER BY cost DESC`, since);
  const topBooks = all(
    `SELECT b.id, b.title, u.username, ROUND(SUM(e.cost_usd), 4) AS cost FROM usage_events e JOIN books b ON b.id = e.book_id JOIN users u ON u.id = b.owner_id
     WHERE e.ts >= ? AND e.dry_run = 0 GROUP BY b.id ORDER BY cost DESC LIMIT 8`, since,
  );
  const total = daily.reduce((n, d) => n + d.cost, 0);
  res.json({ days, total: Math.round(total * 100) / 100, daily, byUser, byModel, byPurpose, topBooks });
});

router.get('/audit', (req, res) => {
  const limit = clampInt(req.query.limit, 1, 300, 100);
  const before = clampInt(req.query.before, 1, 1e12, 1e12);
  const prefix = String(req.query.action || '').replace(/[^a-z._]/gi, '');
  const rows = prefix
    ? all('SELECT * FROM audit_log WHERE id < ? AND action LIKE ? ORDER BY id DESC LIMIT ?', before, `${prefix}%`, limit)
    : all('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit);
  res.json({
    entries: rows.map((r) => ({ id: r.id, ts: r.ts, username: r.username, action: r.action, target: r.target, detail: r.detail ? JSON.parse(r.detail) : null, ip: r.ip })),
    next: rows.length === limit ? rows[rows.length - 1].id : null,
  });
});

export default router;
