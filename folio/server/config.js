import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional
}

const env = process.env;

export const DATA_DIR = path.resolve(env.FOLIO_DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const BOOKS_DIR = path.join(DATA_DIR, 'books');
export const ENGINE_DIR = path.join(ROOT, 'engine');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const PROMPT_SEED = path.join(ROOT, 'prompts', 'master-prompt.source.md');

export const PORT = Number(env.PORT) || 3100;
export const HOST = env.HOST || '127.0.0.1';
export const TRUST_PROXY = env.TRUST_PROXY || '';
export const COOKIE_SECURE = (env.COOKIE_SECURE || 'auto').toLowerCase(); // auto | 1 | 0
export const FORCE_MOCK_AI = env.FOLIO_MOCK_AI === '1';

for (const dir of [DATA_DIR, UPLOAD_DIR, BOOKS_DIR]) fs.mkdirSync(dir, { recursive: true });

function loadSecret() {
  const fromEnv = (env.APP_SECRET || '').trim();
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error('APP_SECRET must be at least 32 characters.');
    return fromEnv;
  }
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    // generate below
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  console.warn('[folio] No APP_SECRET set: generated data/secret.key. For production set APP_SECRET in the environment instead.');
  return secret;
}

export const APP_SECRET = loadSecret();
export const ENGINE_VERSION = '1.0.0';
