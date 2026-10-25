// Static checks for the sources: npm run check
//  - every UI string key used by the engine exists in engine/ui.en.json
//  - every JavaScript file parses (as an ES module)
//  - no inline style attributes in templates (both apps run under a strict Content-Security-Policy)
//  - every icon requested exists in the generated icon files
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;
const fail = (msg) => {
  problems++;
  console.error(`  x ${msg}`);
};

function walk(dir, ext = '.js') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('data') ? [] : walk(p, ext);
    return p.endsWith(ext) ? [p] : [];
  });
}

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
const sources = [...walk(path.join(ROOT, 'engine')), ...walk(path.join(ROOT, 'public')), ...walk(path.join(ROOT, 'server')), ...walk(path.join(ROOT, 'scripts'), '.mjs')];

console.log('Syntax');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-check-'));
for (const file of sources) {
  if (fs.readFileSync(file, 'utf8').includes('{{')) continue; // template, parsed after substitution
  const copy = path.join(tmp, `${path.basename(file)}.mjs`);
  fs.copyFileSync(file, copy);
  const r = spawnSync(process.execPath, ['--check', copy], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${rel(file)}: ${r.stderr.split('\n').find((l) => /Error/.test(l)) || 'syntax error'}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

console.log('Engine UI strings');
const ui = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine/ui.en.json'), 'utf8'));
const used = new Set();
for (const file of walk(path.join(ROOT, 'engine/js'))) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\('([a-z0-9_]+)'/g)) used.add(m[1]);
}
const dynamic = { imp_: ['core', 'standard', 'supplementary'], callout_: ['remember', 'example', 'pitfall', 'myth', 'study', 'mnemonic', 'exam', 'think'], theme_: ['system', 'light', 'dark'] };
for (const [prefix, list] of Object.entries(dynamic)) for (const k of list) used.add(prefix + k);
for (const key of used) if (!(key in ui)) fail(`engine/ui.en.json is missing "${key}"`);
const unused = Object.keys(ui).filter((k) => !used.has(k));
if (unused.length) console.log(`  (unused keys: ${unused.join(', ')})`);

console.log('Inline styles');
for (const file of [...walk(path.join(ROOT, 'engine/js')), ...walk(path.join(ROOT, 'public/js'))]) {
  const src = fs.readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (/\sstyle=["'`$]/.test(line) && !/\/\/ csp-ok/.test(line)) fail(`${rel(file)}:${i + 1} has an inline style attribute`);
  });
}

console.log('Icons');
for (const [dir, suffix] of [['engine/js', ''], ['public/js', '']]) {
  const iconFile = path.join(ROOT, dir, 'icons.js');
  if (!fs.existsSync(iconFile)) continue;
  const text = fs.readFileSync(iconFile, 'utf8');
  for (const file of walk(path.join(ROOT, dir))) {
    if (file === iconFile) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*'([a-z0-9-]+)'/g)) if (!text.includes(`"${m[1]}${suffix}":`)) fail(`${rel(file)}: icon "${m[1]}" is not in ${dir}/icons.js (run npm run icons)`);
  }
}

console.log(problems ? `\n${problems} problem(s).` : '\nAll checks passed.');
process.exit(problems ? 1 : 0);
