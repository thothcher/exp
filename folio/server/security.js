import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { APP_SECRET } from './config.js';

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Used when a username does not exist, so response time does not reveal valid usernames.
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(12).toString('hex'));

const COMMON = new Set(['password', 'password1', 'password12', 'password123', '1234567890', '12345678910', 'qwertyuiop', 'qwerty12345', 'letmein1234', 'iloveyou123', 'admin12345', 'welcome1234']);

export function passwordProblem(password, username = '') {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common.';
  if (username && lower.includes(String(username).toLowerCase())) return 'The password must not contain the username.';
  if (/^(.)\1+$/.test(password)) return 'Use a less repetitive password.';
  return null;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function generatePassword() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += '-';
  }
  return out;
}

// ---- encryption of secrets stored in the database (AES-256-GCM, key derived from APP_SECRET)

const ENC_KEY = Buffer.from(crypto.hkdfSync('sha256', APP_SECRET, 'folio-salt', 'folio-settings-v1', 32));

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  const [v, iv, tag, enc] = String(payload).split(':');
  if (v !== 'v1') throw new Error('Unsupported secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}

export function maskSecret(secret) {
  if (!secret) return '';
  const s = String(secret);
  return s.length <= 8 ? '••••' : `${s.slice(0, 7)}…${s.slice(-4)}`;
}
