import { book, chapterMeta, feature, loadCards, loadChapter, loadQuestions, neighbors, term } from '../data.js';
import { mutate, state, touchToday } from '../store.js';
import { addMistake, recordAnswer } from '../srs.js';
import { $, $$, copyText, debounce, html, icon, md, paint, raw, safeSvgNode, shuffle, t, toast } from '../ui.js';
import { bind, prepare, questionHtml } from './qrender.js';
import { crumbs, impChip, notFound } from './parts.js';

const CALLOUT_ICON = { remember: 'bookmark', example: 'lightbulb', pitfall: 'triangle-alert', myth: 'circle-x', study: 'flask-conical', mnemonic: 'brain', exam: 'graduation-cap', think: 'message-circle' };

function ours(b) {
  return b.origin === 'ours' ? html`<span class="chip chip-outline chip-ours" title="${t('added_by_us_hint')}">${t('added_by_us')}</span>` : '';
}

function review(b) {
  return b.needsReview ? html`<span class="chip chip-warn" title="${b.needsReview}">${icon('triangle-alert', 'i-sm')}${t('check_book', { page: b.src || '' })}</span>` : '';
}

function srcTag(b) {
  return b.src ? html`<span class="src">${b.src}</span>` : '';
}

function blockHtml(b) {
  const depth = b.depth === 'core' ? 'depth-core' : 'depth-full';
  switch (b.t) {
    case 'p':
      return html`<p class="blk ${depth}">${md(b.x)}${ours(b)}${review(b)}</p>`;
    case 'list': {
      const Tag = b.style === 'numbers' ? 'ol' : 'ul';
      return raw(`<${Tag} class="blk list ${depth}">${b.items.map((i) => `<li>${md(i)}</li>`).join('')}</${Tag}>`);
    }
    case 'steps':
      return html`<ol class="blk steps ${depth}">${b.items.map((s) => html`<li><span class="step-title">${md(s.title)}</span>${s.x ? html`<span class="step-text">${md(s.x)}</span>` : ''}</li>`)}</ol>`;
    case 'table':
      return html`<div class="blk table-wrap ${depth}${b.compare ? ' is-compare' : ''}">
        ${b.compare ? html`<div class="table-tools"><button type="button" class="btn btn-soft btn-sm" data-act="selftest" aria-pressed="false">${icon('eye-off', 'i-sm')}<span>${t('self_test')}</span></button></div>` : ''}
        <table>${b.caption ? html`<caption>${md(b.caption)}</caption>` : ''}
          ${b.head.length ? html`<thead><tr>${b.head.map((h) => html`<th scope="col">${md(h)}</th>`)}</tr></thead>` : ''}
          <tbody>${b.rows.map((r) => html`<tr>${r.map((c, i) => (i === 0 ? html`<th scope="row" data-label="${b.head[i] || ''}">${md(c)}</th>` : html`<td data-label="${b.head[i] || ''}"><span class="cell">${md(c)}</span></td>`))}</tr>`)}</tbody></table></div>`;
    case 'figure':
      return html`<figure class="blk figure ${depth}"><div class="fig-art" data-svg="1" ${b.svg ? '' : raw('hidden')}></div>${!b.svg ? html`<p class="fig-alt">${icon('image', 'i-sm')}${md(b.alt)}</p>` : html`<span class="visually-hidden">${b.alt}</span>`}${b.caption ? html`<figcaption>${md(b.caption)}</figcaption>` : ''}<template class="fig-src">${b.svg || ''}</template></figure>`;
    case 'callout':
      return html`<aside class="blk callout kind-${b.kind}"><p class="callout-title">${icon(CALLOUT_ICON[b.kind] || 'bookmark')}<span>${b.title || t(`callout_${b.kind}`)}</span>${ours(b)}</p><p>${md(b.x)}</p></aside>`;
    case 'define':
      return html`<dl class="blk define ${depth}"><dt>${md(b.term)}${b.termOriginal ? html` <span class="define-orig">(${b.termOriginal})</span>` : ''}</dt><dd>${md(b.x)}</dd></dl>`;
    case 'recall':
      return html`<details class="blk recall"><summary>${icon('rotate-ccw', 'i-sm')}<span><em>${t('pause_recall')}</em> ${md(b.q)}</span></summary><p class="recall-a">${md(b.a)}</p></details>`;
    case 'quote':
      return html`<blockquote class="blk quote ${depth}"><p>${md(b.x)}</p>${b.by || b.page ? html`<footer>${b.by}${b.page ? html`, ${b.page}` : ''}</footer>` : ''}</blockquote>`;
    case 'case':
      return html`<div class="blk case"><p class="case-label">${t('case')}</p><p>${md(b.scenario)}</p><p class="case-q">${md(b.question)}</p><details><summary>${t('show_answer')}</summary><p>${md(b.answer)}</p></details></div>`;
    case 'formula':
      return html`<div class="blk formula ${depth}"><code>${b.tex}</code>${b.where?.length ? html`<ul>${b.where.map((w) => html`<li>${w}</li>`)}</ul>` : ''}</div>`;
    default:
      return '';
  }
}

function reportLink(b, ch, secId) {
  const c = (b.feedbackContact || '').trim();
  if (!c) return '';
  const subject = `${b.title} / ${ch.title} / ${secId}`;
  const href = c.includes('@') && !c.startsWith('http') ? `mailto:${c}?subject=${encodeURIComponent(subject)}` : `${c}${c.includes('?') ? '&' : '?'}title=${encodeURIComponent(subject)}`;
  return html`<a class="sec-btn" href="${href}" target="_blank" rel="noopener noreferrer" title="${t('report_mistake')}">${icon('flag', 'i-sm')}<span class="visually-hidden">${t('report_mistake')}</span></a>`;
}

export default async function chapterView({ params }) {
  const id = params[0];
  const meta = chapterMeta(id);
  if (!meta) return notFound();
  const [ch, cards, questions] = await Promise.all([loadChapter(id), loadCards(), loadQuestions()]);
  const b = book();
  const s = state();
  const quick = s.settings.quick && feature('quick_full_toggle');
  const nb = neighbors(id);
  const studied = Boolean(s.studied[id]);
  const bookmarked = s.bookmarks.includes(id);
  const own = questions.filter((q) => q.ch === id && ['mcq', 'tf', 'cloze'].includes(q.type));
  const check = shuffle(own).slice(0, 4);
  const hasCards = feature('flashcards_with_spaced_repetition') && cards.some((c) => c.ch === id);
  const hasQuiz = feature('quiz_and_mock_exam') && questions.some((q) => q.ch === id);
  const hasExam = feature('exam_prep_hub') && meta.counts.exam > 0;
  const notesOn = feature('notes_and_bookmarks');
  const termIds = ch.terms.filter((tid) => term(tid));

  mutate((st) => {
    st.last = `chapter/${id}`;
  });

  const out = html`<article class="chapter tone-${meta.tone}${quick ? ' is-quick' : ''}" data-ch="${id}">
    <div class="rd-progress" aria-hidden="true"><span></span></div>
    <div class="page page-chapter">
      ${crumbs([{ href: '#/chapters', label: t('nav_chapters') }, { label: `${meta.number}. ${meta.title}` }])}
      <header class="ch-head">
        <div class="ch-badges"><span class="ch-badge-ico">${icon(meta.icon)}</span><span class="chip chip-tone">${t('chapter_n', { n: meta.number })}</span>${impChip(meta.importance)}<span class="ch-min">${icon('clock', 'i-sm')}${t('minutes', { n: meta.minutes })}</span></div>
        <h1>${meta.title}</h1>
        ${meta.lead ? html`<p class="lead">${md(meta.lead)}</p>` : ''}
        <div class="ch-tools">
          ${feature('quick_full_toggle') ? html`<div class="seg" role="group" aria-label="${t('depth')}"><button type="button" class="seg-btn" data-act="quick" data-v="1" aria-pressed="${quick}">${t('quick')}</button><button type="button" class="seg-btn" data-act="quick" data-v="0" aria-pressed="${!quick}">${t('full')}</button></div>` : ''}
          <div class="seg" role="group" aria-label="${t('text_size')}"><button type="button" class="seg-btn" data-act="size" data-d="-1" aria-label="${t('smaller')}">A−</button><button type="button" class="seg-btn" data-act="size" data-d="1" aria-label="${t('larger')}">A+</button></div>
          ${notesOn ? html`<button type="button" class="btn btn-ghost btn-sm" data-act="bookmark" aria-pressed="${bookmarked}">${icon('bookmark')}<span>${t('bookmark')}</span></button>` : ''}
        </div>
        <p class="based-on">${t('based_on')}: <em>${b.title}</em>${b.authors ? `, ${b.authors}` : ''}${meta.pages ? `, ${t('pages_short')} ${meta.pages}` : ''}</p>
      </header>

      <div class="ch-layout">
        <div class="ch-main" id="chapter-body">
          ${ch.objectives.length ? html`<section class="objectives"><h2>${t('after_chapter')}</h2><ul>${ch.objectives.map((o) => html`<li>${icon('target', 'i-sm')}<span>${md(o)}</span></li>`)}</ul></section>` : ''}
          <section class="tldr"><h2>${icon('zap')}<span>${t('tldr')}</span></h2><ul>${ch.tldr.map((x) => html`<li>${md(x)}</li>`)}</ul></section>

          ${ch.sections.map((sec) => html`<section class="section" id="${sec.id}" data-sec="${sec.id}">
            <div class="sec-head"><h2>${md(sec.heading)}</h2><div class="sec-tools">${srcTag(sec)}<button type="button" class="sec-btn" data-act="copy" data-sec="${sec.id}" title="${t('copy_link')}">${icon('link', 'i-sm')}<span class="visually-hidden">${t('copy_link')}</span></button>${reportLink(b, meta, sec.id)}</div></div>
            ${sec.blocks.map(blockHtml)}
            ${notesOn ? html`<details class="note"${s.notes[sec.id] ? raw(' open') : ''}><summary>${icon('notebook-pen', 'i-sm')}<span>${t('my_notes')}</span></summary><textarea class="input note-text" data-note="${sec.id}" rows="3" placeholder="${t('note_placeholder')}" aria-label="${t('my_notes')}">${s.notes[sec.id] || ''}</textarea></details>` : ''}
          </section>`)}

          ${termIds.length ? html`<section class="terms"><h2>${t('key_terms')}</h2><p class="term-chips">${termIds.map((tid) => html`<button type="button" class="term chip-term" data-term="${tid}">${term(tid).term}</button>`)}</p></section>` : ''}

          <section class="keypoints"><h2>${icon('star')}<span>${t('core_remember')}</span></h2><ol>${ch.keyPoints.map((k) => html`<li>${md(k.x)}</li>`)}</ol></section>
          ${ch.summary ? html`<section class="summary"><h2>${t('summary')}</h2><p>${md(ch.summary)}</p></section>` : ''}
          ${ch.mistakes?.length ? html`<section class="mistakes"><h2>${t('common_mistakes')}</h2><ul>${ch.mistakes.map((m) => html`<li>${icon('triangle-alert', 'i-sm')}<span>${md(m)}</span></li>`)}</ul></section>` : ''}

          ${check.length && feature('quiz_and_mock_exam') ? html`<section class="quickcheck"><h2>${icon('list-checks')}<span>${t('quick_check')}</span></h2><div id="qc"></div></section>` : ''}

          <section class="ch-links">
            ${hasCards ? html`<a class="btn btn-soft" href="#/cards?go=1&ch=${id}">${icon('layers')}${t('chapter_cards')}</a>` : ''}
            ${hasQuiz ? html`<a class="btn btn-soft" href="#/quiz?ch=${id}">${icon('list-checks')}${t('chapter_quiz')}</a>` : ''}
            ${hasExam ? html`<a class="btn btn-soft" href="#/exam?ch=${id}">${icon('graduation-cap')}${t('chapter_exam')}</a>` : ''}
            <a class="btn btn-soft" href="#/cheat/${id}">${icon('printer')}${t('cheat_sheets')}</a>
          </section>

          <div class="done-row"><button type="button" class="btn ${studied ? 'btn-soft' : 'btn-primary'}" data-act="studied" aria-pressed="${studied}">${icon(studied ? 'circle-check' : 'check')}<span>${studied ? t('studied') : t('mark_studied')}</span></button></div>

          ${ch.related.length ? html`<section class="related"><h2>${t('related')}</h2><div class="related-list">${ch.related.map((rid) => chapterMeta(rid)).filter(Boolean).map((r) => html`<a class="related-item tone-${r.tone}" href="#/chapter/${r.id}">${icon(r.icon, 'i-sm')}<span>${r.number}. ${r.title}</span></a>`)}</div></section>` : ''}

          <nav class="pager" aria-label="${t('chapter_nav')}">
            ${nb.prev ? html`<a class="pager-link" href="#/chapter/${nb.prev.id}" rel="prev">${icon('arrow-left')}<span><small>${t('prev_chapter')}</small>${nb.prev.title}</span></a>` : html`<span></span>`}
            ${nb.next ? html`<a class="pager-link pager-next" href="#/chapter/${nb.next.id}" rel="next"><span><small>${t('next_chapter')}</small>${nb.next.title}</span>${icon('arrow-right')}</a>` : html`<a class="pager-link pager-next" href="#/practice"><span><small>${t('done_reading')}</small>${t('nav_practice')}</span>${icon('arrow-right')}</a>`}
          </nav>
        </div>
        <aside class="outline" aria-label="${t('in_chapter')}"><p class="outline-title">${t('in_chapter')}</p><ol>${ch.sections.map((sec) => html`<li><a href="#/chapter/${id}/${sec.id}" data-sec="${sec.id}">${md(sec.heading)}</a></li>`)}</ol></aside>
      </div>
    </div>
  </article>`;

  return {
    title: `${meta.number}. ${meta.title}`,
    html: out,
    noFocus: false,
    after(root) {
      paint(root);
      for (const holder of $$('.fig-art[data-svg]', root)) {
        const markup = holder.parentElement.querySelector('template.fig-src')?.content.textContent.trim();
        const node = safeSvgNode(markup);
        if (node) {
          holder.hidden = false;
          holder.append(node);
        }
      }
      const article = $('.chapter', root);
      const bar = $('.rd-progress span', root);

      article.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) handleAction(btn, id, article);
        const cell = e.target.closest('.is-test td');
        if (cell) cell.classList.toggle('revealed');
      });
      article.addEventListener('input', debounce((e) => {
        const ta = e.target.closest('textarea[data-note]');
        if (ta) mutate((st) => {
          if (ta.value.trim()) st.notes[ta.dataset.note] = ta.value;
          else delete st.notes[ta.dataset.note];
        });
      }, 400));

      const onScroll = () => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = `${max > 0 ? Math.min(100, (window.scrollY / max) * 100) : 0}%`;
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      const stop = () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('hashchange', stop);
        observer?.disconnect();
      };
      window.addEventListener('hashchange', stop, { once: true });
      onScroll();

      // scroll-spy for the outline
      const links = $$('.outline a', root);
      const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
        for (const en of entries) {
          if (en.isIntersecting) links.forEach((a) => (a.dataset.sec === en.target.dataset.sec ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
        }
      }, { rootMargin: '-20% 0px -70% 0px' }) : null;
      $$('.section', root).forEach((el) => observer?.observe(el));

      const target = params[1] && document.getElementById(params[1]);
      if (target) setTimeout(() => target.scrollIntoView({ block: 'start' }), 60);
      $('.outline', root)?.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-sec]');
        if (!a) return;
        e.preventDefault();
        document.getElementById(a.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      // quick check
      const qc = $('#qc', root);
      if (qc) {
        let answered = 0;
        const prepared = check.map(prepare);
        qc.innerHTML = html`${prepared.map((pq, i) => html`<div class="qc-item">${questionHtml(pq, { number: i + 1, total: prepared.length })}</div>`)}`.toString();
        $$('.qc-item', qc).forEach((el, i) => {
          bind($('.q', el), prepared[i], ({ ok }) => {
            recordAnswer(id, ok);
            if (!ok) addMistake(prepared[i].q.id);
            answered += 1;
            if (answered === prepared.length) toast(t('quick_check_done'));
          });
        });
      }
    },
  };
}

function handleAction(btn, id, article) {
  const act = btn.dataset.act;
  if (act === 'quick') {
    const quick = btn.dataset.v === '1';
    mutate((st) => {
      st.settings.quick = quick;
    });
    article.classList.toggle('is-quick', quick);
    $$('[data-act=quick]', article).forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
  } else if (act === 'size') {
    mutate((st) => {
      st.settings.size = Math.max(-1, Math.min(3, st.settings.size + Number(btn.dataset.d)));
    });
    document.dispatchEvent(new CustomEvent('folio:settings'));
  } else if (act === 'bookmark') {
    mutate((st) => {
      st.bookmarks = st.bookmarks.includes(id) ? st.bookmarks.filter((x) => x !== id) : [...st.bookmarks, id];
    });
    btn.setAttribute('aria-pressed', String(state().bookmarks.includes(id)));
    toast(state().bookmarks.includes(id) ? t('bookmarked') : t('bookmark_removed'));
  } else if (act === 'copy') {
    const url = `${location.origin}${location.pathname}#/chapter/${id}/${btn.dataset.sec}`;
    copyText(url).then((ok) => toast(ok ? t('link_copied') : url));
  } else if (act === 'studied') {
    const now = !state().studied[id];
    mutate((st) => {
      if (now) st.studied[id] = new Date().toISOString();
      else delete st.studied[id];
    });
    if (now) touchToday();
    btn.setAttribute('aria-pressed', String(now));
    btn.className = `btn ${now ? 'btn-soft' : 'btn-primary'}`;
    btn.innerHTML = html`${icon(now ? 'circle-check' : 'check')}<span>${now ? t('studied') : t('mark_studied')}</span>`.toString();
    if (now) toast(t('studied_toast'));
  } else if (act === 'selftest') {
    const wrap = btn.closest('.table-wrap');
    const on = !wrap.classList.contains('is-test');
    wrap.classList.toggle('is-test', on);
    if (!on) $$('.revealed', wrap).forEach((c) => c.classList.remove('revealed'));
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('span').textContent = on ? t('self_test_off') : t('self_test');
  }
}
