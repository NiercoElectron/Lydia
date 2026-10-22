# Decisions

Why Lydia is built the way it is: each decision, when it was made, why, and what was measured. The newest decisions
are at the bottom. The full measurements are in [spike-notes.md](spike-notes.md).

Each entry has a status: **adopted** (in use), **planned** (decided, not built yet), **replaced** (no longer in use, kept
for the history) or **open** (not decided yet).

## 1. A web app, packaged for the desktop later

- **Date:** 2026-10-17
- **Status:** adopted
- **Decision:** React, TypeScript and Vite, open source under the MIT license. It runs in the browser for now, and the
  desktop version will be packaged with Electron.
- **Why:** one codebase for Windows, macOS and Linux, with tools that are easy to start with.

## 2. Desktop only, with mouse and pen

- **Date:** 2026-10-19
- **Status:** adopted (see "Phone or desktop?" in the open questions)
- **Decision:** Lydia is for desktop computers. It takes mouse and pen (drawing tablet) input, not touch.
- **Why:** drawing on a computer with a tablet is the target. Supporting touch screens and phones would multiply the
  work.

## 3. Strokes stored as data

- **Date:** 2026-10-19
- **Status:** replaced by 5
- **Decision:** each stroke is kept as a list of points and drawn again whenever needed. Undo removes the last stroke.
  Projects are saved as JSON `.lyd` files (version 1). Finished strokes were later kept on an off-screen canvas, so
  they were not drawn again every frame.
- **Why:** simple, small files, and undo is easy.
- **Why it was replaced:** the work grows with every stroke, so big drawings get slow; and effects like smudge, blur
  or filters change pixels, which a list of strokes can't express.

## 4. The goal: Photoshop and Krita quality

- **Date:** 2026-10-19
- **Status:** adopted
- **Decision:** after watching an artist friend draw (she uses ibisPaint), the goal became to feel like Photoshop or
  Krita, with big canvases. Her list of tools (layers, blend modes, selection, transform, filters, rulers, symmetry,
  stabilizer) guides what comes later.
- **Why:** a drawing app is only worth using if an artist would choose it over the ones they already have.

## 5. Raster layers made of tiles, drawn with PixiJS

- **Date:** 2026-10-21
- **Status:** adopted (tested in the spike, branch `spike/pixi`)
- **Decision:** each layer is a grid of 256×256 pixel tiles, created only where there is paint. Painting and putting
  the image together happen on the graphics card through PixiJS (WebGL2). Lydia stays on the web, instead of being
  rewritten in another language.
- **Why:** tiles keep memory proportional to what is painted, and undo only has to keep the tiles a stroke changed.
  The graphics card paints and blends millions of pixels per frame. PixiJS takes care of textures and drawing, which
  would take a long time to write directly in WebGL.
- **Tile size:** 256×256 is a common choice; other sizes were not compared.
- **Evidence:** spike sections 1–6. A 10000×10000 paper ran at 144 FPS on my PC (RTX 4060 Ti, 144 Hz screen), and at
  60 FPS, the screen's maximum, on a MacBook Air M4. Exporting the whole paper as PNG took ~2.2 s on the PC and ~1 s on
  the Mac.

## 6. Version 1.0 means the desktop app

- **Date:** 2026-10-21
- **Status:** adopted
- **Decision:** Lydia stays at 0.x until it is packaged with Electron. That packaged version is 1.0.

## 7. Built in a spike first

- **Date:** 2026-10-21
- **Status:** adopted
- **Decision:** the riskiest parts (performance at 10000×10000, undo, many layers, memory) were tested in a throwaway
  prototype (`spike.html`, branch `spike/pixi`) before changing the main app.
- **Why:** finding out that an approach doesn't work is cheaper in a prototype.

## 8. Undo and redo by swapping tiles

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** before a stroke changes a tile for the first time, the tile's previous pixels are kept. Undo puts them
  back and keeps the current ones in their place, so the same step works for redo. The history is limited by memory,
  not by number of steps. Empty steps (a click outside the paper) are not recorded.
- **Evidence:** spike section 7. With copies kept on the graphics card: 13–271 tiles swapped in 2–10 ms.

## 9. Performance target

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** Lydia must work well with canvases up to 10000×10000 and 20 or more layers, well enough that someone
  would choose it over another drawing app. Bigger canvases are out of scope for now.

## 10. A projection: the screen shows one picture, not every layer

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** like Krita, Lydia keeps one extra grid of tiles with the paper and all the visible layers already put
  together (the "projection"), and the screen draws only that. While painting, only the tiles that change are put
  together again, using a cached "below" (the paper and every layer under the active one).
- **Why:** drawing every layer every frame makes the frame rate depend on the number of layers.
- **Evidence:** spike sections 8–9. 10 full layers: ~72 FPS drawing every layer, 144 FPS with the projection.

## 11. Layers live in RAM; the graphics card is a cache

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** the pixels of every layer are kept in RAM, which is much bigger. The graphics card keeps only the
  tiles it needs right now (up to 2000 tiles, least recently used ones leave first), plus the projection and "below".
  Tiles painted on the graphics card are read back into RAM in the background.
- **Why:** a full 10000×10000 layer takes ~400 MB on the graphics card, so 10 of them almost filled an 8 GB card.
- **Evidence:** spike section 10. 20 full layers: graphics card memory stable at 3.2 GB of 8 GB, still 144 FPS.
  Switching layers went from 3.7 s to instant by putting "below" together only when needed.

## 12. Reading pixels back without waiting

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** pixels are read back from the graphics card asynchronously (WebGL2 pixel buffers and fences), never
  with a read that makes the processor wait. Each read uses a new buffer.
- **Why:** a waiting read stops everything until the graphics card finishes its work, which froze the screen while
  painting. Chrome warns, and gets slower, when a read buffer is reused (tested in a minimal page).
- **Evidence:** spike section 10. The freeze while painting went away; saving to RAM went from 19–94 tiles in
  99–573 ms to 12–62 tiles in 4–79 ms.

## 13. Smaller tiles in RAM: single colors and compression

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** a tile of a single color is kept as just that color. The other tiles are compressed with LZ4 in a
  background worker.
- **Why LZ4:** tiles are unpacked every time they go back to the graphics card, sometimes while painting, so unpacking
  speed matters more than size. On painted tiles: LZ4 keeps 60% of the size and unpacks in 0.8 ms; deflate keeps 24%
  but takes 2.6 ms.
- **Evidence:** spike section 11. 20 layers filled with a single color: the browser tab went from ~8 GB to 165 MB.
  A layer full of detailed painting: ~400 MB to ~230 MB.

## 14. A memory budget: compress only when RAM is short

- **Date:** 2026-10-22
- **Status:** adopted in 0.2.0; unpacking in workers still planned
- **Decision:** keep tiles uncompressed while there is RAM to spare, and compress the least recently used ones beyond a
  budget. A compressed tile that is needed again is unpacked and kept uncompressed for a while too. Browsers only tell
  roughly how much RAM the computer has (Chrome says at most 8 GB), so the budget is a quarter of that guess (2 GB on
  most computers). The desktop app will be able to use the real amount.
- **Why:** with every tile compressed, painting over several layers of detailed painting spent most of the time
  unpacking (650 ms of a ~1 s stroke over 6 layers). Krita and Photoshop also work with a memory limit.
- **Evidence:** test without a screen, with the budget forced to 512 MB and two 10000×10000 layers full of detailed
  painting: the uncompressed tiles stayed at 512 MB, the rest got compressed, and the image stayed exactly the same
  after hiding and showing layers, undo and redo.

## 15. Painted tiles stay on the graphics card until they are saved

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** the graphics card cache never throws out a painted tile that isn't saved in RAM yet, and those tiles
  don't count against its budget. Saving goes on while painting, more slowly, skipping the tiles of the current stroke.
- **Why:** with very big brushes, the cache threw out tiles painted moments before and had to read them back while the
  processor waited (up to 379 times per stroke). Counting them against the budget pushed out every other tile.
- **Evidence:** spike section 11. Time spent painting a big stroke: 958 ms to 222 ms; after pushing it to the limit,
  144 FPS with strokes of ~1300 tiles.

## 16. Tiles under the brush are made ready before the stroke

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** while the pointer moves over the paper without painting, the tiles under the brush are prepared, a few
  per frame.
- **Why:** the first dab of a big brush covers dozens of tiles at once, and each needs every layer at that place.
- **Evidence:** spike section 11. First event of a stroke: 25–45 ms to 0.5–1.5 ms.

## 17. Undo never waits for the graphics card

- **Date:** 2026-10-22
- **Status:** adopted; one improvement planned
- **Decision:** when undo has to keep pixels that are only on the graphics card, it starts a read without waiting.
  Pixels from a read that hasn't been fetched yet are copied back to the tile on the graphics card itself, without a
  trip to RAM. When the history forgets a step (it is limited by memory), the reads that step was still waiting for are
  cancelled, so they don't hold up the background saving.
- **Evidence:** spike section 11. Undo of strokes of 1000–1200 tiles: 440–930 ms to 386–420 ms; small strokes 2–3 ms.
  In the main app, a test that painted 2400 strokes over unsaved tiles, almost without pauses, left tens of thousands
  of reads waiting and the saving never finished; after cancelling the forgotten ones, everything was saved ~16 s
  after the painting stopped.
- **Planned:** keep a copy of the last stroke's tiles on the graphics card, so undoing even a huge stroke takes about
  40 ms.

## 18. Reading tiles back in batches

- **Date:** 2026-10-22
- **Status:** planned
- **Decision:** copy many tiles into one big texture and read it back in one go, for saving and for exporting.
- **Why:** each read costs a lot by itself, so saving managed only ~400–690 tiles per second.

## 19. How the work is split

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** I lead the project, and Claude Code (an AI coding assistant) writes most of the code. I set the goals
  and the scope, review every step, test and measure on real machines, and decide what goes in and what is good
  enough. Claude says what it is going to do and why before each step. Afterwards, a separate session with no history
  will read the whole code and write the documentation.
- **Why:** it puts my time where it matters most for the product: deciding what to build and making sure it is right.
  In the spike, the problems that mattered most were found by my tests on real hardware, not by automated tests: paint
  going past the edge of the paper, the graphics card filling up with 10 layers, Chrome's warnings, the freeze at the
  start of a stroke, the slowdown with fast strokes and the slow undo of big strokes.

## 20. Version numbers

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** versions follow semantic versioning: three numbers, MAJOR.MINOR.PATCH. The first number stays at 0
  until Lydia is packaged with Electron (decision 6). The middle number goes up with each big stage finished, and the
  last one with small fixes. Each version is marked with a git tag (`v0.1.0`, `v0.2.0`…).
- **Versions:**
  - **0.1.0** (tag `v0.1.0`, branch `main` on 2026-10-22): the first usable version. Start screen with a custom canvas
    size, drawing with mouse or pen, brush color and size, eraser, undo, save and open `.lyd` projects, PNG export. It
    still uses strokes stored as data (decision 3).
  - **0.2.0** (next): the tile engine from the spike inside the main app.
  - **1.0.0:** the desktop app, packaged with Electron.
- **Why:** the 0 tells anyone looking that Lydia is still in development and may change, and the numbers show how far
  along it is.

## 21. A new project file, without opening the old one

- **Date:** 2026-10-22
- **Status:** adopted in 0.2.0
- **Decision:** `.lyd` files are now binary: a short header in JSON (size, layers, where each tile is) followed by the
  tiles, compressed with LZ4. Tiles of a single color only store their color. Lydia 0.2 doesn't open the files of
  Lydia 0.1 (which stored strokes); it explains why instead.
- **Why:** saving and opening must stay fast with 20 layers of 10000×10000. A format other programs open, like
  OpenRaster (one PNG per layer, which Krita and GIMP read), would take ~2 s per layer to write; it can be added later
  as an extra option. Only I have used Lydia so far, so keeping the old files working wasn't worth the code, and Lydia
  0.1 is still on GitHub to open them.

## 22. Layers on the screen from 0.2.0

- **Date:** 2026-10-22
- **Status:** adopted in 0.2.0
- **Decision:** 0.2.0 already has a layers panel: add a layer (above the active one), choose the active layer, hide and
  show, and change the opacity. Deleting, reordering and blend modes come in a later version.
- **Why:** the engine already works with layers, and an artist can't draw seriously without them.

## Open questions

### Phone or desktop?

- **Date:** 2026-10-19
- **Status:** open
- **Question:** the artist friend draws on her phone, while Lydia is desktop only (decision 2). To ask her: does she
  draw on a computer too, how big are her canvases, and how many layers does a typical drawing have?
