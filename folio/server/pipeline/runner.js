import { all, get, getArtifact, now, run, setArtifact } from '../db.js';
import { setting } from '../lib/settings.js';
import { AiError } from './ai.js';
import { assembleBook } from './assemble.js';
import { bookContext, logBook, numberedUnits, pool, runAssets, runPlan, runScan, runUnit, saveStyleReference, setProgress } from './stages.js';

/**
 * The book driver. A book moves through: scan, plan, GATE 1 (blueprint), pilot unit, GATE 2 (pilot),
 * remaining units, whole-book assets, assembly. Every step stores its result, so a restart, a failure
 * or a resume continues where it stopped.
 */

const active = new Map(); // bookId -> AbortController
let timer = null;

export function startRunner() {
  run("UPDATE books SET status = 'queued', updated_at = ? WHERE status = 'running'", now());
  run("UPDATE units SET status = 'pending' WHERE status = 'running'");
  timer = setInterval(tick, 1500);
  timer.unref?.();
}

export function stopRunner() {
  if (timer) clearInterval(timer);
  for (const ac of active.values()) ac.abort();
}

export const isActive = (bookId) => active.has(bookId);

function tick() {
  try {
    const limit = setting('max_concurrent_books');
    if (active.size >= limit) return;
    const queued = all("SELECT id FROM books WHERE status = 'queued' ORDER BY created_at LIMIT 10");
    for (const { id } of queued) {
      if (active.size >= limit) break;
      if (!active.has(id)) startDriver(id);
    }
  } catch (err) {
    console.error('[folio] runner tick failed:', err);
  }
}

function startDriver(bookId) {
  const ac = new AbortController();
  active.set(bookId, ac);
  run("UPDATE books SET status = 'running', gate = NULL, error = NULL, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?", now(), now(), bookId);
  drive(bookId, ac.signal)
    .catch((err) => handleStop(bookId, err))
    .finally(() => active.delete(bookId));
}

/** Stops a running book (it ends as "cancelled") or cancels a waiting one. */
export function requestCancel(bookId) {
  const ac = active.get(bookId);
  if (ac) {
    ac.abort();
    return;
  }
  run("UPDATE books SET status = 'cancelled', gate = NULL, updated_at = ? WHERE id = ? AND status IN ('queued','awaiting','attention','failed')", now(), bookId);
}

export function queueBook(bookId) {
  run("UPDATE books SET status = 'queued', gate = NULL, error = NULL, updated_at = ? WHERE id = ?", now(), bookId);
}

function setStage(bookId, stage) {
  run('UPDATE books SET stage = ?, updated_at = ? WHERE id = ?', stage, now(), bookId);
}

function setAwaiting(bookId, gate) {
  run("UPDATE books SET status = 'awaiting', gate = ?, stage = ?, updated_at = ? WHERE id = ?", gate, gate, now(), bookId);
  setProgress(bookId, gate === 'blueprint' ? 'Waiting for your approval of the blueprint' : 'Waiting for your approval of the pilot chapter', 0, 0);
  logBook(bookId, 'info', gate === 'blueprint' ? 'Gate 1: the blueprint is ready for review.' : 'Gate 2: the pilot chapter is ready for review.');
}

function handleStop(bookId, err) {
  if (err?.code === 'cancelled') {
    run("UPDATE books SET status = 'cancelled', updated_at = ? WHERE id = ?", now(), bookId);
    logBook(bookId, 'warn', 'Stopped.');
    return;
  }
  const known = err instanceof AiError;
  const message = String(err?.message || err).slice(0, 500);
  if (!known) console.error(`[folio] book ${bookId} crashed:`, err);
  run("UPDATE books SET status = ?, error = ?, updated_at = ? WHERE id = ?", known ? 'attention' : 'failed', message, now(), bookId);
  logBook(bookId, 'error', known ? message : `Unexpected error: ${message}`);
}

const gates = (bookId) => getArtifact(bookId, 'gates') || {};
const setGate = (bookId, patch) => setArtifact(bookId, 'gates', { ...gates(bookId), ...patch });

export function approveGate(bookId, gate) {
  setGate(bookId, { [gate]: true });
  if (gate === 'pilot') saveStyleReference(bookId);
  run('UPDATE books SET content_version = content_version + 1 WHERE id = ?', bookId);
  queueBook(bookId);
  logBook(bookId, 'info', gate === 'blueprint' ? 'Blueprint approved.' : 'Pilot chapter approved.');
}

async function drive(bookId, signal) {
  let ctx = bookContext(bookId, signal);
  const gated = ctx.params.AUTONOMY !== 'autonomous';

  // ---- phase 0 and 1: scan, plan
  if (!getArtifact(bookId, 'plan')) {
    setStage(bookId, 'audit');
    await runScan(ctx);
    await runPlan(bookContext(bookId, signal));
    ctx = bookContext(bookId, signal);
  }

  // ---- gate 1
  if (!gates(bookId).blueprint) {
    if (gated) return setAwaiting(bookId, 'blueprint');
    setGate(bookId, { blueprint: true });
  }
  ctx = bookContext(bookId, signal);
  const unitsNow = numberedUnits(bookId).filter((u) => !u.skip);
  if (!unitsNow.length) throw new AiError('Every unit is skipped. Include at least one unit in the blueprint.', 'no_units');
  run('UPDATE books SET units_total = ? WHERE id = ?', unitsNow.length, bookId);

  // ---- phase 2: pilot
  if (!gates(bookId).pilot) {
    const pilot = unitsNow.find((u) => u.is_pilot) || unitsNow[0];
    if (pilot.status !== 'done') {
      setStage(bookId, 'pilot');
      setProgress(bookId, `Writing the pilot chapter: ${pilot.title}`, 0, 1);
      await runUnit(ctx, pilot.id);
      const after = get('SELECT status, error FROM units WHERE id = ?', pilot.id);
      if (after.status !== 'done') throw new AiError(`The pilot chapter failed: ${after.error || 'unknown error'}. Fix the cause and resume.`, 'pilot_failed');
    }
    if (gated) {
      await assembleBook(bookId);
      return setAwaiting(bookId, 'pilot');
    }
    setGate(bookId, { pilot: true });
    saveStyleReference(bookId);
    ctx = bookContext(bookId, signal);
  }

  // ---- phase 3: remaining units
  setStage(bookId, 'chapters');
  const todo = numberedUnits(bookId).filter((u) => !u.skip && u.status !== 'done');
  const total = unitsNow.length;
  let finished = total - todo.length;
  setProgress(bookId, 'Writing chapters', finished, total);
  if (todo.length) logBook(bookId, 'info', `Writing ${todo.length} unit(s) with up to ${setting('unit_concurrency')} in parallel.`);
  await pool(todo, setting('unit_concurrency'), async (u) => {
    await runUnit(ctx, u.id);
    finished += 1;
    setProgress(bookId, 'Writing chapters', finished, total);
  }, signal);

  // ---- phase 4 and assembly
  const doneCount = get("SELECT COUNT(*) AS n FROM units WHERE book_id = ? AND skip = 0 AND status = 'done'", bookId).n;
  if (doneCount > 0) {
    setStage(bookId, 'assets');
    await runAssets(ctx);
    setStage(bookId, 'assemble');
    setProgress(bookId, 'Building the site folder', 0, 1);
    run('UPDATE books SET content_version = content_version + 1 WHERE id = ?', bookId);
    await assembleBook(bookId);
  }

  const failed = get("SELECT COUNT(*) AS n FROM units WHERE book_id = ? AND skip = 0 AND status = 'failed'", bookId).n;
  setProgress(bookId, failed ? `${failed} unit(s) need attention` : 'Finished', total, total);
  if (failed) {
    run("UPDATE books SET status = 'attention', stage = 'chapters', error = ?, finished_at = ?, updated_at = ? WHERE id = ?", `${failed} unit(s) failed. Open the Units tab to retry them.`, now(), now(), bookId);
    logBook(bookId, 'warn', `${failed} unit(s) failed; the site was built from the rest.`);
  } else {
    run("UPDATE books SET status = 'done', stage = 'done', error = NULL, finished_at = ?, updated_at = ? WHERE id = ?", now(), now(), bookId);
    logBook(bookId, 'info', 'Finished. The site folder is ready to preview and download.');
  }
}
