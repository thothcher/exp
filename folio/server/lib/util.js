import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);

export function newId(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function monthStartMs(date = new Date()) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

const KA = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o',
  პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'f', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'z', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};
const RU = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** ASCII kebab-case slug. Georgian and Cyrillic are transliterated, other scripts fall back to the fallback text. */
export function slugify(text, fallback = 'item', max = 48) {
  let out = '';
  for (const ch of String(text || '').normalize('NFKD').toLowerCase()) {
    out += KA[ch] ?? RU[ch] ?? ch;
  }
  out = out
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return out || fallback;
}

export function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function words(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export function stripTags(text) {
  return String(text ?? '').replace(/<[^>]*>/g, '');
}

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function fmtErr(err) {
  if (!err) return 'Unknown error';
  return String(err.message || err).slice(0, 600);
}
