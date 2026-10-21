# PixiJS spike — notes

Branch: `spike/pixi` · Page: `/spike.html` · PixiJS 8.22 · Paper: 10000×10000 · Tiles: 256×256

The goal of this spike is to find out whether PixiJS with tiled layers can give Lydia a Photoshop/Krita-like
drawing experience on large canvases, before rewriting the editor.

## Machines

| Machine | CPU          | GPU         | RAM   | Monitor           | Pen tablet |
| ------- | ------------ | ----------- | ----- | ----------------- | ---------- |
| Mine    | i5-11400F    | RTX 4060 Ti | 32 GB | 2560×1440, 144 Hz | None       |
| Friend  | Ryzen 5 5500 | RTX 3050    | TBD   | TBD               | TBD        |
| Mac     | TBD          | Integrated  | TBD   | Retina            | None       |

## 1. Zoom and pan

- Mine: 144 FPS (the monitor's maximum) while zooming and panning, with the paper empty and with the whole paper painted.

## 2. Brush

- Mine: 144 FPS while painting, including fast strokes with a big brush.
- The brush follows the cursor exactly at every zoom level.
- Paint used to go past the right and bottom edges of the paper, because 10000 is not a multiple of 256: the last
  column and row of tiles reached 10240. Fix: cut the edge tiles to the project size (tested, not yet applied to the
  spike code).
- Pen pressure: not tested yet (needs a pen tablet).

## 3. Eraser

- Works with the `erase` blend mode: soft edges, and the paper underneath is not affected.

## 4. Export (10000×10000 PNG)

| Drawing      | Tiles | Assemble | Encode  | File size |
| ------------ | ----- | -------- | ------- | --------- |
| Two dots     | 2     | 13 ms    | 1226 ms | 1.8 MB    |
| Small stroke | 148   | 185 ms   | 1142 ms | 7.9 MB    |
| Whole paper  | 1600  | 1230 ms  | 980 ms  | 1.8 MB    |

- The small stroke was measured in an automated test (headless Chrome) on my machine; the two dots in my browser.
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

## 6. CPU throttling (Chrome DevTools, Performance tab)

- 4× slowdown: 110–144 FPS
- 6× slowdown: drops to ~32 FPS at times

A 6× slower CPU would be an old or very basic laptop. My friend's Ryzen 5 5500 is in the same performance range as
my i5-11400F (both 6-core desktop CPUs), so it should behave close to my machine. Not yet confirmed with a performance recording where the time goes.

## Optimizations for the real app

- Collect the dabs from pointer events and render them once per frame, instead of once per event
- Render into each tile only the dabs that touch it, instead of all the dabs of the event
- Stop rendering every frame when nothing changes (PixiJS renders continuously by default), to save battery on laptops
- Encode the exported PNG in a Web Worker, so the screen doesn't freeze, and show progress while exporting
- Read the tiles back from the graphics card faster when exporting (in bigger batches, or asynchronously),
  since it takes about 0.8 ms per tile

## Not covered by this spike

- Undo/redo with tile copies (highest technical risk left)
- Several layers composited together
- Saving and opening projects with tiles
- Integrating PixiJS with the React app

## Decision

**Provisional: adopt PixiJS with tiled layers.**

On my machine everything ran at 144 FPS, even with the whole 10000×10000 paper painted, and the export works at full
size. With the CPU slowed down 4×, it stayed smooth.

Pending:

- Confirm on my friend's machine (Ryzen 5 5500, RTX 3050) with a pen tablet: smoothness, pressure, and how the
  brush feels to an artist. If it is not smooth there, revisit before migrating.
- Measure the export with the whole paper painted, and the GPU process memory.
- Test on the Mac (integrated graphics) as a reference for an average machine.
