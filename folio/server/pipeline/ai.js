import Anthropic from '@anthropic-ai/sdk';
import { get, run, now, tx } from '../db.js';
import { apiKey, costOf, setting } from '../lib/settings.js';
import { monthStartMs, sleep } from '../lib/util.js';

export class AiError extends Error {
  constructor(message, code = 'api', { retryable = false, fatal = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    this.fatal = fatal;
  }
}

// Models that take the server-side refusal fallback (Haiku 5.5 has none).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

let client = null;
let clientKey = '';

function getClient() {
  const key = apiKey();
  if (!key) throw new AiError('No API key is configured. An administrator can add one under Settings.', 'no_key', { fatal: true });
  if (!client || clientKey !== key) {
    client = new Anthropic({ apiKey: key, maxRetries: 5, timeout: 15 * 60 * 1000 });
    clientKey = key;
  }
  return client;
}

/** Throws when the user, the book or the whole team has used up its budget. */
export function assertBudget(bookId) {
  const book = get('SELECT owner_id, cost_usd, budget_usd, dry_run FROM books WHERE id = ?', bookId);
  if (!book || book.dry_run) return;
  if (book.budget_usd > 0 && book.cost_usd >= book.budget_usd) {
    throw new AiError(`This book reached its spending limit of $${book.budget_usd.toFixed(2)}. Raise the limit and resume.`, 'budget', { fatal: true });
  }
  const user = get('SELECT monthly_budget_usd, username FROM users WHERE id = ?', book.owner_id);
  const limit = user?.monthly_budget_usd ?? setting('default_user_budget_usd');
  if (limit > 0) {
    const spent = get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE user_id = ? AND ts >= ?', book.owner_id, monthStartMs()).s;
    if (spent >= limit) throw new AiError(`The monthly budget of $${limit.toFixed(2)} for ${user?.username || 'this user'} is used up.`, 'budget', { fatal: true });
  }
  const globalLimit = setting('global_monthly_budget_usd');
  if (globalLimit > 0) {
    const spent = get('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM usage_events WHERE ts >= ?', monthStartMs()).s;
    if (spent >= globalLimit) throw new AiError(`The team's monthly budget of $${globalLimit.toFixed(2)} is used up.`, 'budget', { fatal: true });
  }
}

export function recordUsage({ bookId, unitId = null, userId, model, purpose, usage, cost, dryRun }) {
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  tx(() => {
    run(
      `INSERT INTO usage_events (ts, user_id, book_id, unit_id, model, purpose, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens, cost_usd, dry_run)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      now(), userId, bookId, unitId, model, purpose, input, cr, cw, output, cost, dryRun ? 1 : 0,
    );
    run(
      `UPDATE books SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cache_read_tokens = cache_read_tokens + ?,
         cache_write_tokens = cache_write_tokens + ?, cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?`,
      input, output, cr, cw, cost, now(), bookId,
    );
    if (unitId) {
      run('UPDATE units SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, cost_usd = cost_usd + ?, updated_at = ? WHERE id = ?', input + cr + cw, output, cost, now(), unitId);
    }
  });
}

function translateError(err, signal) {
  if (err instanceof AiError) return err;
  // A cancelled run surfaces as the SDK's abort error (a subclass of APIError), so test for it first.
  if (signal?.aborted || err instanceof Anthropic.APIUserAbortError || err?.name === 'AbortError') {
    return new AiError('Cancelled.', 'cancelled', { fatal: true });
  }
  if (err instanceof Anthropic.AuthenticationError) return new AiError('The API key was rejected. Check it under Settings.', 'auth', { fatal: true });
  if (err instanceof Anthropic.PermissionDeniedError) return new AiError('The API key does not have access to this model or feature.', 'permission', { fatal: true });
  if (err instanceof Anthropic.RateLimitError) return new AiError('Rate limit reached. Folio will retry shortly.', 'rate_limit', { retryable: true });
  if (err instanceof Anthropic.BadRequestError) return new AiError(`The API rejected the request: ${err.message}`, 'bad_request');
  if (err instanceof Anthropic.APIConnectionError) return new AiError('Could not reach the API. Check the network connection.', 'network', { retryable: true });
  if (err instanceof Anthropic.APIError) return new AiError(`API error ${err.status ?? ''}: ${err.message}`, 'api', { retryable: (err.status ?? 500) >= 500 });
  return err;
}

/**
 * One model call. `content` is the user content (blocks or string). `history` appends extra turns
 * after the first user message, used for the JSON repair loop.
 */
export async function callModel({ book, unitId = null, purpose, model, system, content, history = [], maxTokens, effort, signal, mock }) {
  assertBudget(book.id);
  const dryRun = Boolean(book.dry_run);

  if (dryRun) {
    await sleep(120);
    const text = JSON.stringify(mock ? mock() : {});
    const usage = { input_tokens: 0, output_tokens: 0 };
    recordUsage({ bookId: book.id, unitId, userId: book.owner_id, model, purpose, usage, cost: 0, dryRun: true });
    return { text, usage, model, stopReason: 'end_turn' };
  }

  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }, ...history],
    output_config: { effort },
  };
  if (setting('enable_fallbacks') && FALLBACK_MODELS.has(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let message;
  try {
    try {
      message = await getClient().beta.messages.stream(params, { signal }).finalMessage();
    } catch (err) {
      // If the fallback beta is not available for this key, run once without it.
      if (params.fallbacks && err instanceof Anthropic.BadRequestError && /fallback|beta/i.test(err.message)) {
        delete params.fallbacks;
        delete params.betas;
        message = await getClient().beta.messages.stream(params, { signal }).finalMessage();
      } else {
        throw err;
      }
    }
  } catch (err) {
    throw translateError(err, signal);
  }

  const usage = message.usage || {};
  const priced = message.model in (setting('prices') || {}) ? message.model : model; // a fallback model is billed at its own rate
  recordUsage({ bookId: book.id, unitId, userId: book.owner_id, model: message.model || model, purpose, usage, cost: costOf(priced, usage), dryRun: false });

  if (message.stop_reason === 'refusal') {
    const cat = message.stop_details?.category ? ` (${message.stop_details.category})` : '';
    throw new AiError(`The model declined to process this content${cat}. Try a smaller page range or a different model.`, 'refusal');
  }
  if (message.stop_reason === 'max_tokens') throw new AiError('The response was cut off because it was too long. Split this unit into smaller parts.', 'truncated');

  const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { text, usage, model: message.model || model, stopReason: message.stop_reason };
}

/** Pulls one JSON object out of a model reply, tolerating a markdown fence or stray prose. */
export function parseJsonReply(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('No JSON object found in the reply.');
  return JSON.parse(s.slice(first, last + 1));
}

/**
 * Calls the model and returns a parsed JSON object. When the reply is not valid JSON, or `validate`
 * returns problems, the model gets up to `repairs` more turns to fix it.
 */
export async function callJson({ validate, repairs = 2, ...opts }) {
  let history = [];
  let lastProblem = '';
  for (let attempt = 0; attempt <= repairs; attempt++) {
    const res = await callModel({ ...opts, history });
    let problems = [];
    let value = null;
    try {
      value = parseJsonReply(res.text);
      problems = validate ? validate(value) || [] : [];
    } catch (err) {
      problems = [`The reply was not valid JSON: ${err.message}`];
    }
    if (!problems.length) return { value, usage: res.usage };
    lastProblem = problems.slice(0, 8).join(' | ');
    history = [
      ...history,
      { role: 'assistant', content: res.text || '{}' },
      { role: 'user', content: `Your reply has problems: ${problems.slice(0, 12).join('; ')}\nReturn the complete corrected JSON object only, with no commentary.` },
    ];
  }
  throw new AiError(`The model did not return usable JSON: ${lastProblem}`, 'bad_json', { retryable: false });
}

export async function testApiKey() {
  const c = getClient();
  const model = Object.keys(setting('prices') || {}).find((m) => m.includes('haiku')) || setting('default_model');
  const msg = await c.messages.create({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] });
  return { model: msg.model, ok: true };
}

export { translateError };
