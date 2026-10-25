import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { bad } from '../lib/util.js';

const PDF_MAGIC = Buffer.from('%PDF-');

export function looksLikePdf(buffer) {
  return buffer.length > 8 && buffer.subarray(0, 1024).includes(PDF_MAGIC);
}

async function loadDoc(buffer) {
  try {
    return await PDFDocument.load(buffer, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    if (/encrypt/i.test(err?.message || '')) throw bad('This PDF is password-protected. Remove the protection and upload it again.');
    throw bad('This file could not be read as a PDF. It may be damaged.');
  }
}

export async function countPages(buffer) {
  const doc = await loadDoc(buffer);
  const n = doc.getPageCount();
  if (n < 1) throw bad('This PDF has no pages.');
  return n;
}

/** Merges PDFs in order into one file. Returns the page count of each part. */
export async function mergePdfs(paths, outPath) {
  if (paths.length === 1) {
    await fs.copyFile(paths[0], outPath);
    const doc = await loadDoc(await fs.readFile(outPath));
    return [doc.getPageCount()];
  }
  const out = await PDFDocument.create();
  const counts = [];
  for (const p of paths) {
    const src = await loadDoc(await fs.readFile(p));
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
    counts.push(pages.length);
  }
  await fs.writeFile(outPath, await out.save());
  return counts;
}

// A small cache: loading a large PDF is slow and a run slices the same file many times.
const docCache = new Map();

async function sourceDoc(path) {
  const stat = await fs.stat(path);
  const key = `${path}:${stat.mtimeMs}:${stat.size}`;
  const hit = docCache.get(path);
  if (hit && hit.key === key) return hit.doc;
  const doc = await loadDoc(await fs.readFile(path));
  docCache.set(path, { key, doc });
  if (docCache.size > 3) docCache.delete(docCache.keys().next().value);
  return doc;
}

export async function pageCountOf(path) {
  return (await sourceDoc(path)).getPageCount();
}

/** Slices pages [start, end] (1-based, inclusive) into a standalone PDF. */
export async function slicePdf(path, start, end) {
  const src = await sourceDoc(path);
  const total = src.getPageCount();
  const from = Math.max(1, Math.min(start, total));
  const to = Math.max(from, Math.min(end, total));
  const out = await PDFDocument.create();
  const indices = [];
  for (let i = from - 1; i <= to - 1; i++) indices.push(i);
  const pages = await out.copyPages(src, indices);
  for (const page of pages) out.addPage(page);
  const bytes = await out.save({ useObjectStreams: true });
  return { bytes, from, to };
}

/** The API accepts requests up to 32 MB: base64 adds a third, so keep each slice below ~22 MB. */
export const MAX_SLICE_BYTES = 22 * 1024 * 1024;

export async function sliceForApi(path, start, end) {
  const { bytes, from, to } = await slicePdf(path, start, end);
  if (bytes.length > MAX_SLICE_BYTES) {
    throw bad(`Pages ${from}-${to} are ${(bytes.length / 1048576).toFixed(0)} MB together, more than the API accepts. Split this unit into smaller parts in the blueprint.`);
  }
  return { from, to, base64: Buffer.from(bytes).toString('base64'), size: bytes.length };
}

export function documentBlock(base64, { cache = true } = {}) {
  const block = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  if (cache) block.cache_control = { type: 'ephemeral' };
  return block;
}
