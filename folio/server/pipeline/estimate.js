import { priceFor, setting } from '../lib/settings.js';

// Rough output sizes per page of source, by depth (tokens, thinking included). Real runs are measured and
// shown next to the estimate, so the numbers here only have to be honest about their uncertainty.
const CHAPTER_OUT_PER_PAGE = { compact: 200, standard: 360, thorough: 560 };
const PRACTICE_OUT = { compact: 2800, standard: 5200, thorough: 8800 };
const SYSTEM_TOKENS = 17000;
export const DEFAULT_TOKENS_PER_PAGE = 2600;

const cost = (price, { input = 0, cacheWrite = 0, cacheRead = 0, output = 0 }) =>
  (input * price.in + cacheWrite * (price.cacheWrite ?? price.in * 1.25) + cacheRead * (price.cacheRead ?? price.in * 0.1) + output * price.out) / 1e6;

/** Estimates the cost of a whole book. `unitPages` is the list of page counts of the units to write. */
export function estimateBook({ totalPages, unitPages, depth = 'standard', model, scanModel, verify = true, tokensPerPage = 0 }) {
  const tpp = tokensPerPage || DEFAULT_TOKENS_PER_PAGE;
  const main = priceFor(model);
  const scanPrice = priceFor(scanModel || model);
  const d = CHAPTER_OUT_PER_PAGE[depth] ? depth : 'standard';

  let scan = cost(scanPrice, { input: totalPages * tpp, output: Math.ceil(totalPages / 25) * 900 });
  let plan = cost(main, { cacheWrite: SYSTEM_TOKENS, input: Math.ceil(totalPages / 25) * 1200, output: 3500 });
  let units = 0;
  unitPages.forEach((pages, i) => {
    const doc = pages * tpp;
    const chapterOut = pages * CHAPTER_OUT_PER_PAGE[d];
    const practiceOut = PRACTICE_OUT[d] * Math.min(1.4, Math.max(0.6, pages / 20));
    // the first call of a book writes the system prompt to the cache, later ones read it
    const system = i === 0 ? { cacheWrite: SYSTEM_TOKENS } : { cacheRead: SYSTEM_TOKENS };
    units += cost(main, { ...system, cacheWrite: (system.cacheWrite || 0) + doc, cacheRead: system.cacheRead || 0, output: chapterOut });
    units += cost(main, { cacheRead: SYSTEM_TOKENS + doc, input: chapterOut, output: practiceOut });
    if (verify) units += cost(main, { cacheRead: SYSTEM_TOKENS + doc, input: chapterOut + practiceOut, output: 3200 });
  });
  const assets = cost(main, { cacheRead: SYSTEM_TOKENS, input: unitPages.length * 600, output: 4500 });
  const mid = scan + plan + units + assets;
  return {
    scan: round(scan),
    plan: round(plan),
    units: round(units),
    assets: round(assets),
    mid: round(mid),
    low: round(mid * 0.65),
    high: round(mid * 1.6),
    tokensPerPage: tpp,
    measured: Boolean(tokensPerPage),
  };
}

const round = (n) => Math.round(n * 100) / 100;

export function estimateForUnits(book, units, tokensPerPage) {
  const params = JSON.parse(book.params);
  return estimateBook({
    totalPages: book.pages_total,
    unitPages: units.filter((u) => !u.skip).map((u) => u.page_end - u.page_start + 1),
    depth: params.DEPTH,
    model: book.model,
    scanModel: book.scan_model,
    verify: params.VERIFY !== false,
    tokensPerPage,
  });
}

export function defaultMaxUnitPages() {
  return setting('max_unit_pages');
}
