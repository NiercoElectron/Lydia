# Instructions for AI agents

You are working on **Lydia**, an open source drawing app (React 19, TypeScript, Vite, PixiJS 8 on WebGL 2, Electron for
the desktop app). Read this whole file before changing anything. People contributing by hand should read
[CONTRIBUTING.md](CONTRIBUTING.md) instead; these rules include it and add what an agent needs.

## Who decides

The maintainer, Enrico, decides what Lydia does. You write code and explain it; you don't choose the scope.

- **Before a new feature, offer options and let the person choose.** List the real choices (behavior, shortcuts, what
  is left out), recommend one, and wait. Don't build your own idea of the feature.
- **Before changing code, say what you will change and why**, in a few plain sentences.
- **Never invent a decision.** If something isn't decided and isn't obvious, ask. Look in
  [docs/decisions.md](docs/decisions.md) first: most questions are answered there.
- **Explain for a beginner.** The maintainer is a student. Say why, not only what, without jargon where a plain word
  works.
- **Reply in the language the person writes in.** Everything in the repository stays in English (see Language).

## Git

The person you are working for makes every commit, push, tag, merge and branch. **Do not run them.** When a change is ready, check
`git status` and `git log`, then give the commands for Git Bash, with messages in single quotes:

```bash
git add -A
git commit -m 'Add the Curves tool'
git push
```

- A commit message is one sentence saying what the change does, in the imperative, like
  `Keep the installed app on its own pages`, not `Fixed bug`.
- **No `Co-Authored-By` lines or other attribution in commit messages**, even if your tool adds them by default.

## Before you write code

1. Read the decisions about the part you will touch: [docs/decisions.md](docs/decisions.md) has one numbered decision
   per feature, with what was chosen, what was left out and how it was checked. Search it for the feature's name.
2. Read the code around it. Follow the patterns already there; don't bring new libraries without asking.
3. Find the test of that part in `tests/app/` and read it.

## Code rules

- **`src/engine/` never imports React.** Dependencies go one way: `screens` → `components` → `engine`.
- **Comments say why**, in plain English sentences, for someone new to the code. Each module starts with a comment saying
  what it is for. Keep comments true when the code changes.
- **Text on the screen** is English, written literally inside `t('...')` (see `src/i18n.ts`), so the translation script
  can find it. No text built from pieces.
- **Errors** are `LYD-NNN` codes in `src/errors.ts`, with an English message, and listed in
  [docs/errors.md](docs/errors.md). Take the next free number in the right hundred (0 inside Lydia, 1 projects, 2
  brushes, 3 images and the tray, 4 the browser and the graphics card). **Never reuse or renumber a code**, and never
  translate error messages.
- **Saved files must keep opening.** A `.lyd` from an older version must still open: new fields are optional when
  read, with a default for files that don't have them (see `src/engine/projectFile.ts`). `tests/app/files` has old
  drawings that must still open.
- **Prettier and ESLint** decide the style (`.prettierrc`: no semicolons, single quotes, 120 columns).
- **No Python** anywhere, including helper scripts. Use Node.

## Language and translations

- Everything in the repository is English: code, comments, docs, tests, commit messages.
- **Do not translate Lydia.** Don't edit `src/translations/` (`pt-BR.ts`, `es.ts`, `changelog.pt-BR.md`,
  `changelog.es.md`) unless the task is explicitly a translation. New texts stay in English; translators fill them in.
  `npm run translations` lists what is missing; say how many texts your change added.

## Tests

Tests live in `tests/app/*.mjs`. Each one starts its own Vite server, opens the app in headless Chrome with
Puppeteer, uses it like a person (clicks, keys, mouse strokes) and checks the result: pixels, layers, files, undo.
Read [tests/app/README.md](tests/app/README.md).

- **Every change gets a test**, in `tests/app/`, never in a temporary folder. Extend the test of that feature, or copy
  the closest one for a new feature.
- A test prints `ok` or `FAIL` per check and must end with the line `ALL PASSED`: the runner reads the last line.
- Tests use ports **5198 to 5201** (`LYDIA_TEST_PORT`), so they don't disturb a development server on 5173. Run one
  with `LYDIA_TEST_PORT=5199 node tests/app/name.mjs`.
- What tests make (screenshots, saved drawings) goes to `tests/app/output/`, which git ignores. A throwaway script that
  imports the app goes there too (importing `../setup.mjs`), and is deleted afterwards.
- Look at screenshots of what you changed on the screen: a passing test can still draw something wrong.
- Timing tests (`ALONE` in `tests/app/run.mjs`) can fail on a busy machine. Run them again alone before calling it a
  failure, and say that you did.

Before saying a change is done, run everything (it takes a few minutes):

```bash
npm run lint
npx prettier --check .
npm run build
npm run test:app
```

**Report results as they are.** If something failed, say what and show the output. Never call a change done or tested
when it wasn't.

## Documentation, with every feature

A feature isn't finished until these are updated:

- **[CHANGELOG.md](CHANGELOG.md)**, under `## [Unreleased]`, in Added, Changed or Fixed, written for people who draw.
- **[docs/guide.md](docs/guide.md)**: how to use it, and the shortcuts table if it has a key.
- **[README.md](README.md)**: the features list, if it is a new feature.
- **[ROADMAP.md](ROADMAP.md)**: take the feature out once it is done, and add what was left for later.
- **[docs/decisions.md](docs/decisions.md)**: a new numbered decision (or an addition to the one it belongs to), with
  Date, Status, Problem, Decision, How and Checked. It is written in the **maintainer's first person** ("my choice",
  "I chose"), and only says he chose what he really chose; credit the agent where it is true ("Claude found…"). The
  Checked part says which test checks what.

Format docs and tests with `npx prettier --write <files>`.

## Environment traps

- **The development server reloads every file you save.** While `npm run dev` or `npm run desktop` is running, write
  each source file **once** per change: two quick writes of the same file can leave Vite serving a stale module. Make all
  the edits to a file, then save it. If you had to write one twice, tell the maintainer to restart the server. Don't run
  `prettier --write` on source files for the same reason; write them formatted.
- **Never kill all Node or Electron processes**: the maintainer's own server and editor run on them. Only stop Electron
  processes whose command line has `lydia-desktop-` (the desktop test's), and remove leftover `lydia-desktop-*` and
  `lydia-documents-*` folders in the system's temp folder after desktop tests.
- **Some editors set `ELECTRON_RUN_AS_NODE`**, which breaks Electron. Run desktop builds and the desktop test without it:
  `env -u ELECTRON_RUN_AS_NODE npm run desktop:build`.
- The desktop app ignores `LYDIA_DEV_URL` once installed; in development it loads Vite's server (see
  `electron/main.mjs`).

## Versions and releases

Only when the maintainer asks. Versions follow [decision 20](docs/decisions.md#20-version-numbers): the middle number for
a group of features, gathered so that a version is worth an update and the number doesn't grow for little (no very
small ones), and the last one only for fixes to a version already out. Preparing a release:

1. CHANGELOG: `## [Unreleased]` becomes `## [x.y.z] - date`, with one summary sentence under it (What's New shows it),
   and the compare links at the bottom.
2. README: the roadmap's done paragraph, if the version brings something new; ROADMAP.md without what it brings.
3. decisions.md: the sentence listing the versions, near the top (search for the previous version number).
4. `package.json` and the two `"name": "lydia"` entries at the top of `package-lock.json`.
5. Run `tests/app/whats-new.mjs`.
6. Build the Windows installer (`env -u ELECTRON_RUN_AS_NODE npm run desktop:build`). The macOS `.dmg` is built on a Mac.
   The GitHub release needs `Lydia-Setup-x.y.z.exe`, its `.blockmap`, `latest.yml` and the `.dmg`, marked Latest.
