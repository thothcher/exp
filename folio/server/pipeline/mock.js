// Deterministic stand-ins for the model, used in dry-run mode. They exercise every block type of the
// site engine so a whole book can be built and previewed without an API key or any cost.

export function mockScan({ a, b, total }) {
  const headings = [];
  const kinds = [];
  for (let p = a; p <= b; p++) {
    if (p === 1) {
      kinds.push({ from: 1, to: 1, kind: 'front-matter' });
    } else if ((p - 2) % 10 === 0) {
      const n = (p - 2) / 10 + 1;
      headings.push({ level: 1, title: `Dry-run chapter ${n}`, pdf_page: p, printed_page: String(p - 1) });
      headings.push({ level: 2, title: `Dry-run chapter ${n}: first section`, pdf_page: p + 1, printed_page: String(p) });
    }
  }
  if (!kinds.length) kinds.push({ from: a, to: b, kind: 'chapter' });
  return {
    extraction: 'good',
    printed_page_of_first_pdf_page: String(Math.max(1, a - 1)),
    kinds,
    headings,
    contents: null,
    book: a === 1 ? { title: 'Dry-run book', authors: 'Folio', edition: '', year: '', publisher: '', language: 'English' } : null,
    notes: 'Dry run: structure was generated without reading the pages.',
    _total: total,
  };
}

export function mockPlan({ total, scan }) {
  const heads = [];
  for (const c of scan) for (const h of c.headings || []) if (h.level === 1) heads.push(h);
  heads.sort((x, y) => x.pdf_page - y.pdf_page);
  const units = [];
  if (!heads.length) {
    units.push({ title: 'Dry-run unit', pdf_start: 1, pdf_end: total, importance: 'core', icon: 'book-open' });
  } else {
    const icons = ['brain', 'lightbulb', 'users', 'scale', 'leaf', 'compass', 'puzzle', 'target'];
    heads.forEach((h, i) => {
      const end = i + 1 < heads.length ? heads[i + 1].pdf_page - 1 : total;
      units.push({ title: h.title, pdf_start: h.pdf_page, pdf_end: end, importance: i % 4 === 3 ? 'supplementary' : i % 3 === 2 ? 'standard' : 'core', icon: icons[i % icons.length] });
    });
  }
  return {
    book: { title: 'Dry-run book', authors: 'Folio', edition: '', year: '', publisher: '', language: 'English' },
    source_type: 'textbook',
    subject_type: 'concepts',
    site_name: 'Dry run',
    tagline: 'A pipeline test with no AI involved',
    slug: '',
    design: { preset: 'calm-pastel', accent: null },
    units,
    skipped: total > 1 ? [{ pdf_start: 1, pdf_end: 1, reason: 'Title page' }] : [],
    pilot_unit: 1,
    warnings: ['Dry run: this structure was generated without reading the pages.'],
  };
}

const svg = `<svg viewBox="0 0 400 180" role="img"><title>Mock diagram</title><rect x="20" y="60" width="100" height="60" fill="var(--surface-2)" stroke="var(--line)"/><rect x="150" y="60" width="100" height="60" fill="var(--surface-2)" stroke="var(--line)"/><rect x="280" y="60" width="100" height="60" fill="var(--accent)" stroke="none"/><line x1="120" y1="90" x2="150" y2="90" stroke="currentColor" stroke-width="2"/><line x1="250" y1="90" x2="280" y2="90" stroke="currentColor" stroke-width="2"/><text x="70" y="95" text-anchor="middle" font-size="14" fill="currentColor">Cue</text><text x="200" y="95" text-anchor="middle" font-size="14" fill="currentColor">Process</text><text x="330" y="95" text-anchor="middle" font-size="14" fill="currentColor">Result</text></svg>`;

export function mockChapter({ unit, total }) {
  const t = unit.title;
  const related = [unit.number > 1 ? unit.number - 1 : unit.number + 1].filter((n) => n >= 1 && n <= total && n !== unit.number);
  return {
    title: t,
    lead: `Dry-run content for "${t}": it shows how a finished chapter looks in the study site.`,
    icon: unit.icon || 'book-open',
    objectives: ['Explain the main idea of this chapter in your own words', 'Tell the key terms apart with an example', 'Apply the idea to a short case'],
    tldr: ['This chapter is placeholder text from a dry run.', 'Each section has Core and Full blocks.', 'Real runs write these from the PDF pages.'],
    sections: [
      {
        heading: 'What is the main idea?',
        src: `p. ${unit.page_start}`,
        blocks: [
          { t: 'p', depth: 'core', x: 'A **mock concept** is a placeholder that stands in for a real [[mock term]] from the book. This paragraph belongs to the *Core* layer, so it shows in Quick mode.' },
          { t: 'define', depth: 'core', term: 'Mock term', termOriginal: 'mock', x: 'A stand-in term used to test glossary links and tooltips.' },
          { t: 'p', depth: 'full', x: 'This paragraph belongs to the Full layer only. It adds nuance and secondary examples that Quick mode hides, so a student can skim first and dig deeper later.' },
          { t: 'callout', kind: 'example', title: 'An example from your day', origin: 'ours', x: 'Your phone buzzes and you reach for it before you decide to: the sound has become a signal.' },
          { t: 'recall', q: 'Which layer does this paragraph belong to?', a: 'The Core layer, so it appears in Quick mode.' },
        ],
      },
      {
        heading: 'How do the parts fit together?',
        src: `p. ${unit.page_start + 1}`,
        blocks: [
          { t: 'steps', depth: 'core', items: [{ title: 'Notice', x: 'Spot the cue in the situation.' }, { title: 'Decide', x: 'Choose a response from what you know.' }, { title: 'Check', x: 'Compare the result with what you expected.' }] },
          { t: 'figure', depth: 'core', alt: 'Three boxes joined by arrows: cue, process, result.', caption: 'Cue to result (mock diagram)', svg },
          { t: 'table', depth: 'core', caption: 'Two ideas compared', head: ['', 'Idea A', 'Idea B'], rows: [['Trigger', 'An external signal', 'An internal need'], ['Speed', 'Fast', 'Slow'], ['Example', 'A bell rings', 'You feel hungry']], compare: true },
          { t: 'list', depth: 'full', style: 'bullets', items: ['First secondary point', 'Second secondary point', 'Third secondary point'] },
          { t: 'quote', depth: 'full', x: 'A short quotation would appear here with its author.', by: 'Mock Author', page: `p. ${unit.page_start + 1}` },
          { t: 'callout', kind: 'pitfall', title: 'Common slip', x: 'Do not confuse Idea A with Idea B: one needs a signal, the other does not.' },
        ],
      },
      {
        heading: 'Where does it apply?',
        src: `p. ${unit.page_start + 2}`,
        blocks: [
          { t: 'case', scenario: 'A student keeps checking a phone during study sessions.', question: 'Which idea explains the habit?', answer: 'Idea A: the notification is a signal that triggers the response.' },
          { t: 'formula', depth: 'full', tex: 'R = S \\times H', where: ['R = response strength', 'S = signal strength', 'H = habit strength'] },
          { t: 'callout', kind: 'mnemonic', origin: 'ours', title: 'Remember it as', x: 'Cue, Process, Result: C-P-R, like a quick restart.' },
        ],
      },
    ],
    keyPoints: [
      `${t}: a mock concept stands in for a real idea from the book.`,
      'Core blocks are what a student must know.',
      'Full blocks add nuance and secondary examples.',
      'Cue, process and result form the basic sequence.',
      'Idea A and Idea B differ in what triggers them.',
    ],
    summary: 'This dry-run chapter shows the layout of a real one: layers, blocks, key points and practice material.',
    mistakes: ['Treating Core and Full as separate topics instead of two depths of the same topic.'],
    related,
    glossary: [{ term: 'Mock term', termOriginal: 'mock', definition: 'A stand-in term used to test glossary links.', aliases: ['mock concept'] }],
    needsReview: [],
  };
}

export function mockPractice({ chapter }) {
  const kps = chapter.keyPoints.length;
  const cards = chapter.keyPoints.flatMap((kp, i) => [
    { type: 'term', front: `Key idea ${i + 1}: what does the chapter say?`, back: kp, kp: [i + 1], src: 'p. 1' },
    { type: 'why', front: `Why does key idea ${i + 1} matter?`, back: `It supports the main argument of the chapter (point ${i + 1}).`, kp: [i + 1], src: 'p. 1' },
  ]);
  const questions = chapter.keyPoints.flatMap((kp, i) => [
    {
      type: 'mcq', stem: `Which statement matches key idea ${i + 1}?`,
      options: [kp, 'A statement that sounds right but is not in the chapter', 'The opposite of the chapter claim', 'An unrelated claim'],
      explain: 'The chapter states exactly this.', whyWrong: { 1: 'It is not in the chapter.', 2: 'It reverses the claim.' }, difficulty: (i % 3) + 1, bloom: 'understand', kp: [i + 1], src: 'p. 1',
    },
    { type: 'tf', stem: `True or false: ${kp}`, answer: true, explain: 'The chapter states this.', difficulty: 1, bloom: 'remember', kp: [i + 1], src: 'p. 1' },
  ]);
  questions.push({ type: 'multi', stem: 'Select all that apply to Core blocks.', options: ['They show in Quick mode', 'They are what a student must know', 'They are hidden in Full mode', 'They are optional trivia'], answers: [0, 1], explain: 'Core blocks show in both modes.', difficulty: 3, bloom: 'analyse', kp: [Math.min(2, kps)], src: 'p. 2' });
  questions.push({ type: 'cloze', stem: 'The ____ layer shows only what a student must know.', options: ['Core', 'Full', 'Extra', 'Hidden'], explain: 'Core is the short layer.', difficulty: 1, bloom: 'remember', kp: [Math.min(2, kps)], src: 'p. 2' });
  const exam = [
    { prompt: `Explain the main idea of "${chapter.title}" and give one example.`, modelAnswer: 'A short model answer would state the idea, define the key terms and give a worked example.', keyPoints: ['States the main idea', 'Defines the key terms', 'Gives a clear example'], marks: 6, source: 'predicted' },
    { prompt: 'Compare Idea A and Idea B.', modelAnswer: 'Idea A is triggered by an external signal and is fast; Idea B comes from an internal need and is slow.', keyPoints: ['Trigger differs', 'Speed differs', 'Example for each'], marks: 4, source: 'predicted' },
  ];
  return { cards, questions, exam };
}

export function mockAudit() {
  return { checked: { cards: 0, questions: 0, exam: 0 }, issues: [], uncovered_key_points: [] };
}

export function mockAssets({ units }) {
  return {
    site_name: 'Dry run',
    tagline: 'A pipeline test with no AI involved',
    thesis: 'This dry-run book shows how a finished study site looks.',
    coreIdeas: units.slice(0, 7).map((u) => `Core idea from "${u.title}".`),
    howChaptersConnect: 'Each chapter builds on the one before it, from the basic cue-process-result sequence to its applications.',
    recap: units.map((u) => ({ unit: u.number, text: `Recap of "${u.title}" in one breath.` })),
  };
}

export function mockUi({ strings }) {
  return { ...strings };
}
