import { Router } from 'express';
import { ENGINE_VERSION, FORCE_MOCK_AI } from '../config.js';
import { all, get } from '../db.js';
import { DEFAULT_PRICES, apiKeySource, setting } from '../lib/settings.js';
import { monthStartMs, safeJson } from '../lib/util.js';
import { publicSchema } from '../pipeline/params.js';
import { CHAPTER_ICONS } from '../lib/iconNames.js';

const router = Router();

function modelsFor(userRow) {
  const prices = setting('prices') || DEFAULT_PRICES;
  const global = setting('allowed_models');
  const own = userRow.allowed_models ? safeJson(userRow.allowed_models, null) : null;
  const allowed = own ? global.filter((m) => own.includes(m)) : global;
  return allowed.map((id) => ({ id, label: prices[id]?.label || id, price: prices[id] || null }));
}

router.get('/config', (req, res) => {
  const u = req.userRow;
  const models = modelsFor(u);
  const defaultModel = models.some((m) => m.id === setting('default_model')) ? setting('default_model') : models[0]?.id;
  res.json({
    schema: publicSchema(),
    models,
    defaultModel,
    icons: CHAPTER_ICONS,
    limits: {
      maxUploadMb: setting('max_upload_mb'),
      maxPagesPerBook: u.max_pages_per_book ?? setting('max_pages_per_book'),
      maxActiveBooks: u.max_active_books ?? 3,
      maxUnitPages: setting('max_unit_pages'),
      defaultBookBudgetUsd: setting('default_book_budget_usd'),
    },
    dryRun: Boolean(setting('dry_run') || FORCE_MOCK_AI),
    hasKey: apiKeySource() !== 'none',
    engineVersion: ENGINE_VERSION,
  });
});

router.get('/overview', (req, res) => {
  const u = req.userRow;
  const since = monthStartMs();
  const spent = get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE user_id = ? AND ts >= ?', u.id, since).s;
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM books WHERE owner_id = ? GROUP BY status', u.id).map((r) => [r.status, r.n]));
  const activeBooks = (counts.queued || 0) + (counts.running || 0) + (counts.awaiting || 0);
  const out = {
    me: {
      monthSpendUsd: spent,
      budgetUsd: u.monthly_budget_usd ?? setting('default_user_budget_usd'),
      activeBooks,
      maxActiveBooks: u.max_active_books ?? 3,
      done: counts.done || 0,
      attention: (counts.attention || 0) + (counts.failed || 0),
      awaiting: counts.awaiting || 0,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    },
  };
  if (req.user.role === 'admin') {
    const team = get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE ts >= ? AND dry_run = 0', since).s;
    out.team = {
      monthSpendUsd: team,
      budgetUsd: setting('global_monthly_budget_usd'),
      users: get('SELECT COUNT(*) AS n FROM users WHERE active = 1').n,
      books: get('SELECT COUNT(*) AS n FROM books').n,
      inProgress: all(
        `SELECT b.id, b.title, b.status, b.gate, b.stage, b.units_done AS unitsDone, b.units_total AS unitsTotal, b.cost_usd AS costUsd, u.username
         FROM books b JOIN users u ON u.id = b.owner_id WHERE b.status IN ('queued','running','awaiting','attention','failed') ORDER BY b.updated_at DESC LIMIT 12`,
      ),
      daily: all(
        `SELECT strftime('%Y-%m-%d', ts / 1000, 'unixepoch') AS day, ROUND(SUM(cost_usd), 4) AS cost FROM usage_events WHERE ts >= ? AND dry_run = 0 GROUP BY day ORDER BY day`,
        Date.now() - 29 * 86400000,
      ),
      recent: all('SELECT id, ts, username, action, target FROM audit_log ORDER BY id DESC LIMIT 8'),
    };
  }
  res.json(out);
});

export default router;
