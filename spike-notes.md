# PixiJS spike — notes

Branch: `spike/pixi` · Page: `/spike.html` · PixiJS 8.22 · Paper: 10000×10000 · Tiles: 256×256

The goal of this spike is to find out whether PixiJS with tiled layers can give Lydia a Photoshop/Krita-like
drawing experience on large canvases, before rewriting the editor.

## Machines

| Machine | CPU          | GPU         | RAM   | Monitor           | Pen tablet |
| ------- | ------------ | ----------- | ----- | ----------------- | ---------- |
| Mine    | i5-11400F    | RTX 4060 Ti | 32 GB | 2560×1440, 144 Hz | None       |
| Friend  | Ryzen 5 5500 | RTX 3050    | TBD   | TBD               | TBD        |
| Mac     | Apple M4     | Integrated  | 16 GB | Retina, 60 Hz     | None       |

The Mac is a MacBook Air: it has no fan, so it slows down under long heavy work to stay cool. Its memory is shared
between the processor and the graphics card.

## 1. Zoom and pan

- Mine: 144 FPS (the monitor's maximum) while zooming and panning, with the paper empty and with the whole paper painted.
- Mac: 60 FPS (the screen's maximum), with the paper empty and with the whole paper painted.
- Mac trackpad: pinch zooms and dragging with two fingers moves the view.

## 2. Brush

- Mine: 144 FPS while painting, including fast strokes with a big brush.
- Mac: 60 FPS the whole time while painting.
- The brush follows the cursor exactly at every zoom level.
- Paint used to go past the right and bottom edges of the paper, because 10000 is not a multiple of 256: the last
  column and row of tiles reached 10240. Fix: cut the edge tiles to the project size (applied).
- Pen pressure: not tested yet (needs a pen tablet).

## 3. Eraser

- Works with the `erase` blend mode: soft edges, and the paper underneath is not affected.

## 4. Export (10000×10000 PNG)

| Machine | Drawing      | Tiles | Assemble | Encode  | File size |
| ------- | ------------ | ----- | -------- | ------- | --------- |
| Mine    | Two dots     | 2     | 13 ms    | 1226 ms | 1.8 MB    |
| Mine    | Small stroke | 148   | 185 ms   | 1142 ms | 7.9 MB    |
| Mine    | Whole paper  | 1600  | 1230 ms  | 980 ms  | 1.8 MB    |
| Mac     | Whole paper  | 1600  | 618 ms   | 382 ms  | 1.8 MB    |

- The small stroke was measured in an automated test (headless Chrome) on my machine; the two dots in my browser.
- The Mac exported the whole paper in about 1 s, twice as fast as my PC. On Macs the processor and the graphics
  card share the same memory, so reading the tiles back is cheaper (about 0.4 ms per tile instead of 0.8 ms).
- The output is correct: full size, white background, drawing in the right place, eraser respected.
- Assembling grows with the number of tiles: about 0.8 ms per tile, almost all of it reading the tile back from the
  graphics card. With the whole paper painted it becomes the slowest part (1.2 s).
- Encoding takes around 1–1.2 s even for an almost empty image: it depends mostly on the image size (10000×10000),
  not on how much is drawn.
- Exporting the whole paper takes about 2.2 s in total.
- File size: a single solid color compresses very well (1.8 MB for both the almost white and the all black paper).
  A real drawing with many colors and details will produce a bigger file.
- The screen freezes during the export because it runs on the main thread. Chrome's live metrics measured the
  interaction of pressing P at 528 ms (INP), with an almost empty paper.
- For comparison, painting interactions measured 16–24 ms (INP), so the brush responds right away.
- While exporting, the full-size canvas uses around 400 MB of RAM (10000 × 10000 × 4 bytes), freed afterwards.

## 5. Memory

| Drawing     | Tab     | Dedicated GPU memory (whole system) |
| ----------- | ------- | ----------------------------------- |
| Empty paper | TBD     | 1.5 GB                              |
| Some lines  | ~108 MB | TBD                                 |
| Whole paper | ~110 MB | 2.1 GB                              |

- The tab's memory barely changes when painting, because the tiles live on the graphics card.
- GPU memory was measured in the Windows Task Manager (Performance → GPU → Dedicated GPU memory). It includes
  everything else using the graphics card, so what matters is the difference: painting the whole paper added
  about 0.6 GB.
- Expected: 1600 tiles × 256 KB ≈ 0.4 GB. The Task Manager only shows one decimal (±0.1 GB), and each tile may
  have some extra overhead as a render target. Worth measuring more precisely in the real app.
- On my friend's RTX 3050 (6–8 GB), a whole 10000×10000 layer would use under 10% of the graphics card's memory.
- Mac (Chrome's Task Manager): the tab used 121 MB with the paper empty and 171 MB with the whole paper painted.
  The GPU process used 380 MB with the paper empty and 1.1 GB with the whole paper painted (+0.7 GB). Unlike the
  measurement on my PC, this one includes the undo history: painting over tiles that already had paint keeps copies
  of them (up to 2000 copies, about 500 MB), so the tiles themselves are only part of it.

## 6. CPU throttling (Chrome DevTools, Performance tab)

- 4× slowdown: 110–144 FPS
- 6× slowdown: drops to ~32 FPS at times

A 6× slower CPU would be an old or very basic laptop. My friend's Ryzen 5 5500 is in the same performance range as
my i5-11400F (both 6-core desktop CPUs), so it should behave close to my machine. Not yet confirmed with a performance recording where the time goes.

## 7. Undo and redo

- Before a stroke paints on a tile for the first time, a copy of the tile is kept on the graphics card (or `null` if
  the tile didn't exist). Undo swaps the copies with the tiles; redo swaps them back, so one step works both ways.
- Mine: undo and redo of 13–271 tiles took 2–10 ms (time to send the work to the graphics card).
- Mac: undo and redo of 270 tiles took 6–7 ms.
- The history is limited by the number of tile copies (2000, about 500 MB), not by the number of steps: a dot changes
  1 tile, a big stroke can change hundreds.
- Tested: undo, redo, redo cleared after a new stroke, eraser strokes, and dropping the oldest steps past the limit.
  Pixels come back exactly as they were.
- Bugs found and fixed:
  - A click outside the paper added an empty step, so the next Ctrl+Z seemed to do nothing.
  - Dabs past the right and bottom edges counted as touching the last tiles (the tile grid goes up to 10240), creating
    steps that changed nothing. Fixed by cutting each dab to the paper before finding its tiles. A dab whose center is
    outside but whose edge touches the paper still paints, like in Photoshop and Krita.

## Optimizations for the real app

- Collect the dabs from pointer events and render them once per frame, instead of once per event
- Render into each tile only the dabs that touch it, instead of all the dabs of the event
- Stop rendering every frame when nothing changes (PixiJS renders continuously by default), to save battery on laptops
- Encode the exported PNG in a Web Worker, so the screen doesn't freeze, and show progress while exporting
- Read the tiles back from the graphics card faster when exporting (in bigger batches, or asynchronously),
  since it takes about 0.8 ms per tile
- Don't create tiles for eraser strokes where there is no paint (today the eraser creates empty tiles, wasting
  memory)

## Not covered by this spike

- Several layers composited together
- Saving and opening projects with tiles
- Integrating PixiJS with the React app

## Decision

**Provisional: adopt PixiJS with tiled layers.**

On my machine everything ran at 144 FPS, even with the whole 10000×10000 paper painted, and the export works at full
size. With the CPU slowed down 4×, it stayed smooth. Undo and redo with tile copies, the biggest technical risk left,
work and take only a few milliseconds.

The MacBook Air (M4, integrated graphics) also stayed at its screen's maximum of 60 FPS in every test, and exported
twice as fast as my PC.

Pending:

- Confirm on my friend's machine (Ryzen 5 5500, RTX 3050) with a pen tablet: smoothness, pressure, and how the
  brush feels to an artist. If it is not smooth there, revisit before migrating.
- Measure the graphics card memory more precisely (the Task Manager only shows one decimal).
- Test several layers: how many fully painted layers fit in memory and still draw smoothly.
