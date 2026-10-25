import fs from 'node:fs';
import { PROMPT_SEED } from '../config.js';
import { all, get, run, now, tx } from '../db.js';

/** Extracts PART B (the fixed instructions) from a master prompt file. */
export function extractInstructions(text) {
  const open = text.search(/^<instructions>\s*$/m);
  const closeMatch = [...text.matchAll(/^<\/instructions>\s*$/gm)].pop();
  if (open < 0 || !closeMatch) return null;
  return text.slice(open, closeMatch.index + closeMatch[0].length).trim();
}

export function seedMasterPrompt() {
  if (get('SELECT id FROM prompt_versions LIMIT 1')) return;
  let body = null;
  try {
    body = extractInstructions(fs.readFileSync(PROMPT_SEED, 'utf8'));
  } catch (err) {
    console.error('[folio] Could not read the master prompt seed:', err.message);
  }
  if (!body) {
    console.error('[folio] Master prompt seed missing: add PART B in the dashboard under Master prompt.');
    return;
  }
  run('INSERT INTO prompt_versions (version, body, note, created_by, created_at, active) VALUES (1, ?, ?, NULL, ?, 1)', body, 'Imported from BOOK-TO-STUDY-SITE_MASTER-PROMPT.md (v1.0)', now());
}

export function activePrompt() {
  return get('SELECT * FROM prompt_versions WHERE active = 1 ORDER BY id DESC LIMIT 1') || null;
}

export function promptVersions() {
  return all(
    `SELECT p.id, p.version, p.note, p.created_at, p.active, length(p.body) AS size, u.username AS author
     FROM prompt_versions p LEFT JOIN users u ON u.id = p.created_by ORDER BY p.id DESC LIMIT 100`,
  );
}

export function savePromptVersion(body, note, userId) {
  return tx(() => {
    const version = (get('SELECT MAX(version) AS v FROM prompt_versions').v || 0) + 1;
    run('UPDATE prompt_versions SET active = 0');
    const { id } = run('INSERT INTO prompt_versions (version, body, note, created_by, created_at, active) VALUES (?, ?, ?, ?, ?, 1)', version, body, note || null, userId, now());
    return { id, version };
  });
}

export function activatePromptVersion(id) {
  return tx(() => {
    const row = get('SELECT id FROM prompt_versions WHERE id = ?', id);
    if (!row) return false;
    run('UPDATE prompt_versions SET active = 0');
    run('UPDATE prompt_versions SET active = 1 WHERE id = ?', id);
    return true;
  });
}
