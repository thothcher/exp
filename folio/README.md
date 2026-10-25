# Folio

A private team platform that turns book PDFs into study-site folders, using your
**BOOK-TO-STUDY-SITE master prompt**.

You upload PDFs and fill in a form (the book parameters, PART A of the prompt). Folio puts the form
values into the prompt, runs it through the Claude API in the phases the prompt describes, stops at
your two approval gates, and gives you a **folder** you can open locally or publish.

Nobody can register. An administrator creates accounts, sets what each person may spend, and sees who
generated what.

## Start

You need [Node.js](https://nodejs.org) 22.13 or newer.

```
npm install
npm run create-admin        # asks for a username and password
npm start                   # then open http://localhost:3100
```

On Windows you can also double-click `START-FOLIO.bat`.

1. Sign in, open **Settings**, paste the Anthropic API key and press *Test the connection*.
2. Open **People** to add your teammates. Each gets a temporary password and must choose their own.
3. **New book**: drop the PDF, fill in the form, press *Start conversion*.

Want to look around first? Switch on **Dry-run mode** in Settings. Folio then builds a placeholder
site without calling the AI, so you can walk through the whole flow, both gates and the preview, for
free.

## How a conversion works

| Step | What happens | You |
|---|---|---|
| 1. Read the book | Folio reads the PDF in chunks and maps the structure: chapters, page ranges, what to skip. | |
| 2. **Gate 1: the plan** | A unit map appears. | Rename, re-range, reorder, skip, add or delete units. Pick the pilot chapter. Approve. |
| 3. Pilot chapter | One chapter is written completely: reading layers, flashcards, questions, exam items. | |
| 4. **Gate 2: the pilot** | The pilot opens in a live preview (phone, tablet, desktop). | Read it as a student would. Approve, or rewrite it with notes. |
| 5. The other chapters | Written in parallel in the style of the approved pilot. Each chapter is checked by a second pass that re-answers every question from the source pages. | Retry or rewrite any unit, with notes. |
| 6. Whole-book assets | The Big Picture page and the interface translation. | |
| 7. The folder | `Download folder` gives a zip of the finished site. | |

Everything is saved after each step. If the server restarts, a key is wrong, or the budget runs out,
the book stops with a clear message and **Resume** continues where it stopped. Finished chapters are never
paid for twice.

Set `Approval gates` to *Autonomous* in the form (Advanced) and Folio runs to the end without stopping.

## The master prompt

- **PART B** (the fixed instructions) lives in the database. Edit it under **Master prompt**. Every
  save is a new version, and any version can be made active again. A book keeps the version it
  started with, so an edit never changes a half-finished book.
- **PART A** (the book parameters) is the form on *New book*, generated from `server/pipeline/params.js`.
  The server writes the values out as the same `<book_parameters>` YAML block you would paste by hand.
  The **Setup** tab of every book shows the exact text that is sent to the model.
- A short adapter from Folio goes in front of the master prompt. It tells the model that Folio does the
  engineering (site code, search index, validation, offline support), so the model only writes content.
  It is in `server/pipeline/prompts.js`.
- Your original file is kept in `prompts/master-prompt.source.md` and imported on the first start.

## What comes out

A static site folder, built from the content the model wrote plus a fixed, tested site engine
(`engine/`), exactly as section 5 of your prompt describes:

```
{slug}-study-site/
  index.html  sw.js  manifest.webmanifest  server.js  start.bat  README.md  CREDITS.md
  css/  js/  assets/fonts/
  content/  book.json  chapters/NN-slug.json  cards.json  questions.json  exam.json  glossary.json  ui.json
  search-index.json
  docs/REPORT.md          coverage, what was skipped, what needs checking against the book
```

It runs with no build step and no server code: double-click `start.bat`, or put the folder on any static
host. To publish on GitHub Pages, create a repository, copy the folder's contents into it, push, and
enable Pages for the main branch. Folio never publishes anything itself.

The engine ships: chapters with Quick/Full reading layers, glossary tooltips, flashcards with spaced
repetition (Leitner, 5 boxes), quiz and timed mock exam, exam hub (write, then compare with the model
answer), compare tables with a hide-and-recall self-test, search (Ctrl+K), Big Picture, progress and
mastery, study planner, notes and bookmarks, printable cheat sheets, export/import of progress, light
and dark themes, three design presets, and offline use.

Not in engine 1.0, and always switched off: matching/ordering/connections games, timeline, and a
book-specific interactive. Figures are redrawn as simple SVG diagrams (page scans are never published,
as your prompt requires).

**Improving the engine** is one place: edit files in `engine/`, then press *Rebuild site folder* in the
book's menu, and the same book is re-exported with the new engine. The colours, corner radius and
shadows of the generated sites are CSS variables in `css/tokens.css`, generated per book from the preset
(`server/pipeline/design.js`).

## Cost control

- Before you start, the form shows an **estimate** (likely range). After the structure scan the estimate
  uses the real tokens-per-page measured from your PDF, and Gate 1 shows it again.
- Each person has a **monthly budget** and each book has a **spending limit**. There is also a team limit.
  Limits are checked before every request. A book that reaches one stops and can be resumed after the
  limit is raised.
- **Usage and spend** shows spend per day, person, model, kind of work, and the most expensive books.
- Prices are editable in Settings (they are per million tokens), so estimates stay right when rates change.
- Cheaper structure scan: set the *Model for reading the structure* to a smaller model in Settings. You review
  the plan at Gate 1 before anything else is written.

## Security

- No sign-up page. Accounts exist only if an administrator creates them. Disabled accounts are signed out at once.
- Passwords are hashed with scrypt. Five wrong attempts lock an account for 15 minutes. Unknown
  users and wrong passwords give the same message.
- Sessions: random token, only its hash is stored, HttpOnly + SameSite=Strict cookie, idle and absolute
  timeouts, a per-session CSRF token, and an Origin check on every change. Changing a password signs out
  the other devices.
- The API key is encrypted (AES-256-GCM) with `APP_SECRET`, is never sent to any browser and never
  written to the log.
- Uploads must be real PDFs, are stored under random names outside the web root, and are never served.
- Everything the model writes is treated as untrusted. Text is escaped when rendered, SVG figures pass a strict
  allowlist twice (on the server and again in the browser), and previews are served with their own strict
  Content-Security-Policy.
- The dashboard is served with `script-src 'self'; style-src 'self'`, and the generated sites are written to work
  under the same policy (no inline scripts or styles), so you can host them with a strict policy too.
- Members only see their own books. Only administrators see the team, spend, the activity log and settings.
- Every sign-in, change and download is in the **Activity log**.

### Putting it online

Folio listens on `127.0.0.1` by default. To share it with your team:

1. Put it behind HTTPS with a reverse proxy (Caddy and nginx both work), for example with Caddy:
   `folio.example.com { reverse_proxy 127.0.0.1:3100 }`
2. Set `TRUST_PROXY=1` and a long random `APP_SECRET` in `.env`.
3. Back up the `data/` folder (database, uploads, books). Keep `APP_SECRET` with it: without it the saved API key cannot be read.

Do not expose it over plain HTTP.

## Folders

```
server/    API, auth, pipeline (scan, plan, chapters, assembly), prompts
public/    the dashboard (plain JavaScript modules, no build step)
engine/    the study-site engine copied into every generated folder
prompts/   your master prompt as imported
scripts/   create-admin, icons, tests
data/      created on first start: database, uploads, books (back this up)
```

Icons come from [Iconify](https://iconify.design): Solar for the dashboard, Lucide for the generated
sites. They are bundled, so the apps never contact Iconify. To add an icon, use its name in the source and run `npm run icons`.

## Tests

```
npm test
```

runs static checks (syntax, missing interface strings, inline styles, icons), a full dry-run conversion,
an integration test of the real API code path against a fake Anthropic server (streaming, retry after a 429, the
JSON repair turn, caching, cost and budget limits), and a security suite.
