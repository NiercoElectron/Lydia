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

## 8. Several layers

- Each layer is its own container of tile sprites, stacked in the world from the bottom to the top. Visibility,
  opacity and the multiply blend mode are set on the layer's container. Undo steps remember which layer they belong to.
- The export puts the layers together one by one, with their visibility, opacity and blend mode.
- Tested (headless Chrome): paint stays in the right order between layers, undo and redo go back to the right layer,
  and opacity, multiply and hiding give the same colors on the screen and in the PNG.

### Stress test: whole layers filled with paint (F key)

| Full layers | Tiles | FPS, no slowdown | FPS, CPU 4× slower |
| ----------- | ----- | ---------------- | ------------------ |
| 1           | 1600  | 144              | –                  |
| 5           | 8000  | –                | ~120               |
| 10          | 16000 | ~72              | ~75                |

- Mine. The FPS was measured with the whole paper on the screen, where every tile of every layer is drawn.
- With 10 full layers the FPS halves, even on an RTX 4060 Ti.
- Slowing down the CPU barely changes the result, so the time is not spent in Lydia's JavaScript but in drawing:
  every frame draws all 16000 tiles, and since the graphics card can only use a limited number of different textures
  at once (usually 16), that takes around 1000 separate drawing commands per frame.
- Graphics card memory (Windows Task Manager, dedicated GPU memory of the whole system): 2.1 GB with 1 full layer,
  **7.5 of 8.0 GB** with 10 full layers (66 FPS at that moment). That is about 0.6 GB per full layer, more than the
  0.4 GB of the pixels alone, as seen before. The graphics card was almost full.
- The graphics card was only 28% busy, so it was not short of computing power: the time goes into the number of
  drawing commands, and possibly into memory running out.
- Filling a whole layer took 69 ms (190–365 ms with the CPU 4× slower). It is only a testing tool, not a real action.

**Conclusion:** keeping every layer on the graphics card doesn't scale. There are two separate problems:

1. **Memory (the hard limit).** With 8 GB, about 10 full layers of 10000×10000 fill the graphics card. My friend's
   RTX 3050 has 6–8 GB, and the Mac shares its 16 GB with the whole system. A real drawing can easily have more than
   10 layers. Krita keeps the layers' pixels in normal memory (RAM, compressed, and on disk when needed) and uses the
   graphics card only to show the result. Lydia would need something similar: only the layer being painted on and the
   image shown on the screen on the graphics card, the other layers in RAM.
2. **Drawing every layer every frame (the FPS).** Ways to fix it, from the most important:
   - **Projection** (what Krita does): keep one extra grid of tiles with all the layers already put together, and
     update only the tiles that change while painting. The screen then draws 1600 tiles, no matter how many layers
     there are. It costs the memory of one more full layer.
   - **Lower resolution when zoomed out**: with the whole paper on the screen, each screen pixel covers about
     11 × 11 pixels of the paper. Drawing smaller copies of the tiles would be much cheaper.
   - **Skip the tiles outside the screen** when zoomed in (PixiJS calls this culling).

The projection fixes the FPS but not the memory; moving the other layers to RAM fixes the memory. Both are needed for
drawings with many layers.

## 9. Projection

- Layers are no longer drawn on the screen. They only hold their tiles, visibility, opacity and blend mode. The screen
  draws the projection: one grid of 1600 tiles with the white paper and all the visible layers already put together.
- When a stroke, undo, redo or fill changes a tile, only that tile of the projection is put together again (the paper,
  then that tile of each visible layer, from the bottom to the top). Changing a layer's visibility, opacity or blend
  mode puts the whole projection together again.
- The export now reads only the 1600 projection tiles, instead of every tile of every layer.
- Tested (headless Chrome): exactly the same colors as the stack of layers, on the screen and in the PNG.
- Headless Chrome without a graphics card (only good to compare the two versions): with 10 full layers, a frame took
  67.6 ms with the stack and 27.7 ms with the projection.

| Full layers | Tiles | FPS with the stack | FPS with the projection |
| ----------- | ----- | ------------------ | ----------------------- |
| 10          | 16000 | ~72                | **144** (steady)        |

- Mine: 144 FPS (the monitor's maximum) with 10 full layers. The graphics card was 20% busy.
- Dedicated GPU memory: 7.4 of 8.0 GB, with almost nothing spilling into shared memory (0.1 GB). Still almost full: the
  memory problem is not solved yet.
- Filling a layer now also puts its projection tiles together: 79–100 ms per layer.

**Conclusion:** the projection fixes the FPS. The number of layers no longer changes how much is drawn per frame.

## 10. Layers in RAM, graphics card as a cache

- The pixels of every layer live in RAM, one array per tile. Tiles without paint are not stored, so the eraser no longer
  leaves empty tiles behind.
- The graphics card only keeps a cache of up to 2000 layer tiles (about 500 MB). When it is full, the least recently
  used tiles leave it; a painted tile is read back into RAM first, so nothing is lost.
- "Below": a second grid with the paper and every layer under the active one already put together. While painting,
  each tile only puts together below + the active layer + the layers above it.
- Undo keeps references to the pixels in RAM, without copying them (pixels are never changed, only replaced).
- Tested (headless Chrome, with the cache cut to 300 tiles to force tiles in and out of RAM): same colors as before,
  the projection stays identical bit by bit after sending ~28000 tiles back and forth, and undo and redo work.

### Stress test: 20 full layers (mine)

| What                                | Before (everything on the GPU)  | Now                            |
| ----------------------------------- | ------------------------------- | ------------------------------ |
| Dedicated GPU memory (whole system) | 7.4 of 8 GB with only 10 layers | **3.2 of 8 GB** with 20 layers |
| FPS                                 | 144                             | 144                            |
| Tab memory (RAM)                    | ~110 MB                         | ~8.0–8.4 GB                    |

- The graphics card memory stays put no matter how many layers there are. This was the goal.
- Filling a layer took 35 ms, plus 483 ms to read its 1600 tiles back into RAM (about 0.3 ms per tile).
- Choosing another layer took **3.7 s**: it put everything together again from RAM (32470 tiles sent to the graphics
  card, about 0.11 ms each). Fixed afterwards: choosing a layer doesn't change the image, so the projection stays as
  it is, and each "below" tile is put together again only the first time it is painted on.
- Painting on the top layer had a hitch. Probably the tiles of the stroke being read back into RAM all at once when
  the pen is lifted. Changed afterwards: they are read back a few at a time between frames (at most 4 ms per frame),
  and only while not painting.
- Retested with 17 full layers: choosing another layer is now instant, and the hitch got smaller but is still there,
  painting on the top layer and on a middle one. The background saving only managed about 1 tile per frame (19–94
  tiles over 99–573 ms, about 5–6 ms per tile), compared to 0.3 ms per tile when saving 1600 tiles in a row.
- Why: reading pixels back makes the processor wait until the graphics card has finished all the work it was given
  (like stopping a production line to inspect one piece). The first read of each frame pays for that wait, which takes
  most of a frame at 144 Hz. Reading many tiles at once pays it only once, but freezes the screen for longer.
- Fix (done): read back without waiting. WebGL2 can copy the pixels into a buffer on the graphics card and signal when
  they are ready (a "pixel buffer object" and a "fence"), so the processor fetches them a frame or two later. Each tile
  has a version that goes up every time it is painted; a read that finishes after the tile was painted again is
  thrown away, and the tile is read again.
- A second source of waiting: painting again over a tile before its pixels reached RAM needs its pixels from before
  the stroke for undo. Now a read without waiting is started right before the new dabs (the graphics card works in
  order, so it gets the tile as it was), and the undo step keeps an "IOU" that is filled in when the read finishes.
  Only an undo pressed before that (a frame or two) has to wait.
- Tested (headless Chrome, real cache size): a session of strokes painted back to back over the same places, on the
  top layer and on a middle one, made **0 waiting reads** (it was 297 before). All the earlier tests still pass,
  including undo right after a stroke.
- Waiting reads are still used when a painted tile must leave the cache before its read finished (only when one
  operation paints more tiles than the cache holds) and for undo right after a stroke.
- Retested (mine): the hitch is gone, and the background saving got much faster (12–62 tiles in 4–79 ms, it was
  19–94 tiles in 99–573 ms).
- But Chrome printed a warning hundreds of times: "READ-usage buffer was written, then fenced, but written again before
  being read back. This discarded the shadow copy that was created to accelerate readback." (and then "too many
  errors", because Chrome only shows the first 256 WebGL messages; there were no real WebGL errors). Tested in a
  minimal WebGL page: Chrome prints it whenever a read buffer is reused, even after it was read correctly, and the
  copy it throws away is what makes fetching fast. Fixed: a new buffer for every read, deleted afterwards. 0 warnings.
- Retested (mine, 20 full layers): console clean, 144 FPS, strokes of 9–29 tiles saved to RAM in 10–36 ms.
- RAM: 400 MB per full layer, because nothing is compressed yet. 20 full layers take 8 GB, too much for a 16 GB Mac.
  Next: store tiles of a single color as just that color, and compress the others.

## 11. Compressing the tiles in RAM

What changed:

- A tile of a single color (a filled area) is kept as just that color: 4 bytes instead of 256 KB.
- The other tiles are compressed with LZ4 by a worker, on another core of the processor, in the background. LZ4 was
  chosen because it unpacks fast: a tile is unpacked every time it goes back to the graphics card, sometimes while
  painting. Checked against another LZ4 library: each reads what the other writes.
- New keys: S scribbles thousands of random soft strokes of random colors over the active layer (realistic pixels,
  unlike F, whose tiles all have one color); L shows the layers and how much memory they take.
- The undo history is limited by memory (500 MB) instead of by number of tiles.
- Each tile now gets only the dabs that touch it (it was in the list of optimizations below).

Compression methods compared on tiles made by S (per 256×256 tile, on my processor):

| Method                                | Size left | Unpack |
| ------------------------------------- | --------- | ------ |
| LZ4 (chosen)                          | 60%       | 0.8 ms |
| LZ4 compiled to WebAssembly           | 59%       | 0.3 ms |
| Deflate with a filter (what PNG does) | 24%       | 2.6 ms |

On made-up line art and flat colors, LZ4 leaves 2–5% of the size. Soft gradients are what compresses worst.

Tested in a browser without a screen (the graphics card is simulated there, but the processor times are real):

- A layer filled with F: 1600 tiles in 0.0 MB (it was 400 MB).
- A layer scribbled with S: about 227 MB (it was 400 MB). One worker takes ~5.5 s to compress it, in the background.
- The image stays exactly the same after tiles go to RAM and back, and after undo, redo and export.
- **Problem:** painting on layer 3 of 6 scribbled layers, right after switching to it, spent 650 ms of a ~1 s stroke
  unpacking (818 tiles). Every new tile the brush touches needs the tiles of all the layers at that place, and each
  one has to be unpacked first. With 20 such layers it would be about 3 times worse. Hiding a scribbled layer (H):
  ~5 s unpacking.

Conclusion:

- Tiles of a single color: a clear win, with no downside.
- Compression trades RAM for processor time, and unpacking becomes the bottleneck when many layers are full of
  detailed painting.
- For the real app, do what Krita and Photoshop do: a **memory budget**. Keep tiles uncompressed while there is RAM
  to spare and compress only the least recently used ones beyond it (on a 32 GB PC, 20 full layers would never be
  compressed; on a 16 GB Mac, part of them would). Also: unpack in workers instead of the main thread, put "below"
  back together in the background after switching layers, and use LZ4 compiled to WebAssembly.
- 20 layers full of detailed painting at 10000×10000 is the extreme case: 8 GB uncompressed, ~4.5 GB with LZ4, ~2 GB
  with deflate. Krita and Photoshop also have to use the disk for this.

Retested (mine):

- 20 layers filled with F: the tab takes **165 MB** (it was about 8 GB), still 144 FPS while painting. The graphics
  card process: 2.5 GB.
- 5 layers scribbled with S: each scribble freezes the screen for about 1 s; once compressed, ~230 MB per layer.
- Painting on a middle layer of the scribbled ones, with a big brush (strokes of 540–680 tiles): the FPS drops below
  70 at times and is unstable. The same problem the test without a screen found.
- To find out whether unpacking is the only cause, `spike.html?raw` keeps every tile uncompressed (tiles of a single
  color are still kept as just the color). It was still unstable that way (strokes of 790–960 tiles), so there was a
  second cause.
- The second cause: a stroke that big needs about 5 times as many tiles as it touches (every layer at each place), more
  than the 2000 the graphics card cache keeps. So the cache threw out tiles painted moments before, and throwing out a
  painted tile meant reading it back while the processor waited (46 to 379 times per stroke, in the test without a
  screen). Fixed: the cache now only throws out tiles that are not painted, and painted tiles stay until the background
  saving has them in RAM (the cache can go over its budget meanwhile). Time spent painting a big stroke, without
  compression: 289 / 958 / 423 ms before, 217 / 222 / 152 ms after. With compression it is still ~1 s per stroke,
  almost all of it unpacking, which confirms the memory budget.
- Retested with `?raw` (mine): much less unstable, but the screen still froze for a moment at the start of each
  stroke. The first dab of a big brush covers dozens of tiles at once, and each of them needed every layer at that
  place sent to the graphics card in the same frame: 25–45 ms for the first event (140–245 new textures), against
  ~2 ms for each of the following ones.
- Fixed: while the pointer moves over the paper without painting, the tiles under the brush are made ready, using at
  most 3 ms of each frame. Starting a stroke after the pointer rested for a moment: 0.5–1.5 ms for the first event.
- Retested (mine), pushing it to the limit: scribbling 4 layers back to back, then scribbling fast with a big brush on
  one of them. The faster the brush moved, the worse it got: below 7 FPS at times, and once a freeze of ~200 ms. Three
  causes:
  1. A mistake in the cache fix above: painted tiles still counted against the budget. With ~6400 painted tiles
     waiting to be saved, every other tile was thrown out after each tile was put together, and sent again the next
     time.
  2. The background saving (~400 tiles per second here) stopped while painting, so painted tiles piled up.
  3. Painting over tiles not saved yet needs a read for undo for each of them (~400 per stroke here).
- Fixed: the budget counts only tiles that are not painted, and the saving goes on while painting (fewer tiles per
  frame, skipping the tiles of the current stroke). Same scenario in the test without a screen: time spent painting
  per stroke 109–222 ms before, 35–54 ms after; the worst event 13 ms before, 3 ms after.
- Still open, for the real app: reading tiles back costs a lot per tile, so saving is slow; reading many tiles in one
  go (copying them into one big texture first) would make it much faster. And painted tiles that are not saved yet
  have no limit on the graphics card.
- Retested (mine), same test: much better. 144 FPS with strokes of ~1300 tiles over scribbled layers, and the
  background saving got faster too (8000 tiles in 11.6 s, ~690 per second).
- Undo of a long stroke with a big brush, right after painting it: 440–930 ms for 1100–1200 tiles (mine). To keep the
  tiles for redo, undo read every painted tile that wasn't saved yet while the processor waited, and the tiles kept
  for undo that were still on their way were fetched to RAM and sent back to the graphics card. Fixed: undo keeps an
  IOU for redo instead of waiting, and puts IOU pixels back straight from the read's buffer on the graphics card
  (WebGL2 can copy a buffer into a texture), with no trip to RAM. Nothing waits for the graphics card anymore. In the
  test without a screen, for 561 tiles: undo 468 → 251 ms (what is left is sending saved tiles from RAM, which is
  much slower on the simulated graphics card than on a real one), redo right after 272 → 14 ms.
- Retested (mine): undo of strokes of 1000–1180 tiles in 386–420 ms (it was 440–930 ms); small strokes 2–3 ms. What is
  left is sending ~1000 tiles from RAM to the graphics card, ~0.35 ms each.
- For the real app: keep a copy on the graphics card of the tiles of the last stroke, so undoing it doesn't send
  anything from RAM. Section 7 kept every undo copy on the graphics card and swapped 271 tiles in under 10 ms, so a
  stroke of ~1200 tiles would take roughly 40 ms.

## Optimizations for the real app

- Collect the dabs from pointer events and render them once per frame, instead of once per event
- A memory budget for the tiles in RAM, with unpacking in workers (see section 11)
- Put "below" back together in the background after switching layers, starting with the tiles on the screen
- Stop rendering every frame when nothing changes (PixiJS renders continuously by default), to save battery on laptops
- Encode the exported PNG in a Web Worker, so the screen doesn't freeze, and show progress while exporting
- Read the tiles back from the graphics card in bigger batches (copy many tiles into one big texture and read it in
  one go), for exporting and for the background saving (see section 11)
- Don't create tiles for eraser strokes where there is no paint (today the eraser creates empty tiles, wasting
  memory)

## Not covered by this spike

- Saving and opening projects with tiles
- Integrating PixiJS with the React app

## Decision

**Provisional: adopt PixiJS with tiled layers.**

**Performance target:** Lydia must work well with canvases up to 10000×10000 and **20 or more layers**, well enough
that someone would choose it over another drawing app. Bigger canvases are out of scope for now and will be looked at
later.

On my machine everything ran at 144 FPS, even with the whole 10000×10000 paper painted, and the export works at full
size. With the CPU slowed down 4×, it stayed smooth. Undo and redo with tile copies, the biggest technical risk left,
work and take only a few milliseconds.

The MacBook Air (M4, integrated graphics) also stayed at its screen's maximum of 60 FPS in every test, and exported
twice as fast as my PC.

Many layers (sections 8–11): the screen draws only the projection, so the FPS doesn't depend on the number of layers.
The layers live in RAM, with the graphics card as a cache, so 20 full layers fit; tiles of a single color take almost
no memory. Pushed to the limit, the weak spots found all have a fix, either already in the spike or on the list above.

Pending:

- Confirm on my friend's machine (Ryzen 5 5500, RTX 3050) with a pen tablet: smoothness, pressure, and how the
  brush feels to an artist. If it is not smooth there, revisit before migrating.
- Measure the graphics card memory more precisely (the Task Manager only shows one decimal).
- Test section 11 on the Mac (16 GB): RAM with F and S layers, and how painting feels over several S layers.
- Ask my friend the canvas size and number of layers of a typical drawing of hers: memory grows with both.
