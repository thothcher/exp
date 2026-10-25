import { all, run, now } from '../db.js';
import { decryptSecret, encryptSecret } from '../security.js';

/** Price per million tokens in USD. Editable in the dashboard; defaults from Anthropic's published rates. */
export const DEFAULT_PRICES = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  'claude-fable-5-1': { label: 'Claude Fable 5.1', in: 10, out: 50, cacheWrite: 12.5, cacheRead: 0.25 },
};

const DEFAULTS = {
  anthropic_api_key: { secret: true, value: '' },
  default_model: 'claude-opus-5-5',
  scan_model: 'claude-opus-5-5',
  allowed_models: Object.keys(DEFAULT_PRICES),
  prices: DEFAULT_PRICES,
  effort: { scan: 'low', plan: 'medium', chapter: 'medium', practice: 'medium', audit: 'high', assets: 'medium' },
  max_upload_mb: 150,
  max_pages_per_book: 800,
  default_user_budget_usd: 50,
  default_book_budget_usd: 25,
  global_monthly_budget_usd: 0,
  max_concurrent_books: 2,
  unit_concurrency: 3,
  scan_chunk_pages: 25,
  max_unit_pages: 30,
  dry_run: false,
  enable_fallbacks: true,
  session_idle_hours: 12,
  session_max_days: 7,
};

export const SETTING_KEYS = Object.keys(DEFAULTS);
export const isSecretKey = (key) => Boolean(DEFAULTS[key]?.secret);

let cache = null;

function load() {
  const values = {};
  for (const [key, def] of Object.entries(DEFAULTS)) values[key] = def.secret ? def.value : structuredClone(def);
  for (const row of all('SELECT key, value, encrypted FROM settings')) {
    if (!(row.key in DEFAULTS)) continue;
    try {
      values[row.key] = row.encrypted ? decryptSecret(row.value) : JSON.parse(row.value);
    } catch (err) {
      console.error(`[folio] Could not read setting ${row.key}:`, err.message);
    }
  }
  return values;
}

export function settings() {
  if (!cache) cache = load();
  return cache;
}

export function setting(key) {
  return settings()[key];
}

export function saveSetting(key, value, userId = null) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  const secret = isSecretKey(key);
  const stored = secret ? encryptSecret(value) : JSON.stringify(value);
  run(
    `INSERT INTO settings (key, value, encrypted, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    key,
    stored,
    secret ? 1 : 0,
    now(),
    userId,
  );
  cache = null;
}

export function clearSetting(key) {
  run('DELETE FROM settings WHERE key = ?', key);
  cache = null;
}

export function priceFor(model) {
  const prices = setting('prices') || DEFAULT_PRICES;
  return prices[model] || DEFAULT_PRICES[model] || { in: 5, out: 25, cacheWrite: 6.25, cacheRead: 0.5 };
}

export function costOf(model, usage) {
  const p = priceFor(model);
  const inTok = usage.input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const out = usage.output_tokens || 0;
  return (inTok * p.in + cw * (p.cacheWrite ?? p.in * 1.25) + cr * (p.cacheRead ?? p.in * 0.1) + out * p.out) / 1e6;
}

export function publicSettings() {
  const s = settings();
  const out = {};
  for (const key of SETTING_KEYS) if (!isSecretKey(key)) out[key] = s[key];
  return out;
}

export function apiKey() {
  return setting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
}

export function apiKeySource() {
  if (setting('anthropic_api_key')) return 'dashboard';
  if (process.env.ANTHROPIC_API_KEY) return 'environment';
  return 'none';
}
