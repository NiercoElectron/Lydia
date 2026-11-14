# Contributing to Lydia

Thank you for wanting to help. Bugs, ideas, code and translations are all welcome.

## Reporting a bug

Open an issue with **Bug** and say:

- what you did, step by step, and what happened instead of what you expected;
- Lydia's version (next to its name, at the top of the start screen), the system, and the desktop app or the browser;
- the error's code, if Lydia showed one: a message that starts with `LYD-` and a number, with what is in parentheses
  after it. [docs/errors.md](docs/errors.md) says what each code means.

A drawing (`.lyd`) or a screenshot that shows the problem helps a lot.

## Asking for a feature

Open an issue with **Idea**, and say what you want to draw or do, and how you do it in another app (Photoshop, Krita,
Clip Studio…) if you know. Lydia aims to feel like those, so "like X in Krita" is a good start.

## Working on the code

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+, and Google Chrome for the tests.

```bash
git clone https://github.com/NiercoElectron/Lydia.git
cd Lydia
npm install
npm run dev       # in the browser, at http://localhost:5173
npm run desktop   # or in the desktop app's window
```

Before a change:

- **Read why things are as they are**: [docs/decisions.md](docs/decisions.md) has a numbered decision for each part of
  Lydia, with what was chosen, what was left out and how it was checked. A change that goes against one should say so.
- **Open an issue first for a bigger change**, so we can talk about it before you spend time on it.

While making it:

- **The engine has no React**: code in `src/engine/` must not import React. Dependencies go one way:
  `screens` → `components` → `engine`.
- **Comments say why**, in plain words, for someone who doesn't know the code yet.
- **Text on the screen is in English**, inside `t('...')` (see `src/i18n.ts`), and translations are added separately:
  `npm run translations` lists the texts not translated yet.
- **Errors get a code**: a new message is added to `src/errors.ts` with the next free `LYD-` number, and to
  [docs/errors.md](docs/errors.md).

Before sending it:

```bash
npm run lint
npm run format       # Prettier
npm run build        # type-checks too
npm run test:app     # the app in Chrome, a few minutes (see tests/app/README.md)
```

- **Add a test** in `tests/app/` for what you changed: copy one that checks something close to it.
- **Write it down**: a new feature goes into [CHANGELOG.md](CHANGELOG.md) under Unreleased, [the guide](docs/guide.md)
  and the README's list; a choice that someone might ask about later goes into [docs/decisions.md](docs/decisions.md).
- **Commit messages** are one sentence saying what the change does, like `Add the Curves tool` or
  `Keep the installed app on its own pages`.

Then open a pull request saying what it changes and why, and how you checked it.

## Translating

Lydia is in English, Brazilian Portuguese and Spanish. The texts are in `src/translations/` (`pt-BR.ts`, `es.ts`), and
what changed in each version is in `changelog.pt-BR.md` and `changelog.es.md`. `npm run translations` lists what is
missing. Fixes to a translation are welcome, and so is a new language: open an issue first.

## License

What you send is under the same [MIT License](LICENSE) as the rest of Lydia.
