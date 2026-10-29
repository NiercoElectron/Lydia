# Tests of the app

Each file here uses Lydia in Google Chrome as a person would: it starts a development server of its own, opens a
drawing, clicks, presses keys, paints with the mouse, and checks what comes out: the colors on the screen, the
layers, what undo brings back, the files Lydia saves. They were written along with the features they check (the
decisions in [docs/decisions.md](../../docs/decisions.md) say what each feature was checked for).

## Running them

You need Google Chrome (Lydia needs WebGL 2, which Chrome has even with no window). If it isn't where it usually is,
set `CHROME_PATH` to it.

```bash
npm run test:app                          # all of them, one after the other (a few minutes)
npm run test:app -- folders blend-modes   # only these
node tests/app/folders.mjs                # one, with a line for each thing it checks
```

Each test prints `ok` or `FAIL` for each thing it checks, and `ALL PASSED` at the end when nothing failed;
`npm run test:app` prints the failed lines, and a line for each test. The tests use port 5198, so they don't disturb
the development server, and they write what they make (screenshots to look at, drawings they save and open again)
into `tests/app/output`, which isn't kept in git. `tests/app/files` has drawings saved by older versions of Lydia,
which it must still open; a test never needs what another one made, so they can run in any order.

Chrome runs without a window, on whatever graphics the computer has, so a test that measures time (like `move-tool`,
which checks that a frame stays short while dragging) can fail now and then on a busy computer: run it again alone.
Some things are better checked on a real screen with a pen, by a person: how a stroke feels, and speed on big
drawings with many layers.

## Writing one

Copy a test close to what you want to check: they all start the same way (the server, the browser, and small helpers
to click buttons, paint, read colors), then check one feature. The page gives tests a way in: `window.lydia` has the
engine, the projection, the stack of layers and the view (see `src/components/DrawSpace.tsx`). Paths come from
[setup.mjs](setup.mjs), and so does the way to start Chrome (`LAUNCH`), in English whatever the computer's language,
since the tests find buttons by their English names.
