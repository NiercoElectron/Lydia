# Decisions

Why Lydia is built the way it is: each decision, when it was made, why, and what was measured. The newest decisions
are at the bottom. The full measurements are in [spike-notes.md](spike-notes.md).

Each entry has a status: **adopted** (in use), **planned** (decided, not built yet), **replaced** (no longer in use, kept
for the history) or **open** (not decided yet).

This is my log, written in my voice: "I" is me, Enrico. I lead Lydia, and Claude Code, an AI coding assistant, writes
most of the code (decision 19). Where an idea or a suggestion came from Claude, the entry says so.

## 1. A web app, packaged for the desktop later

- **Date:** 2026-10-17
- **Status:** adopted
- **Decision:** React, TypeScript and Vite, open source under the MIT license. It runs in the browser for now, and the
  desktop version will be packaged with Electron.
- **Why:** one codebase for Windows, macOS and Linux, with tools that are easy to start with.

## 2. Desktop only, with mouse and pen

- **Date:** 2026-10-19
- **Status:** adopted
- **Decision:** Lydia is for desktop computers. It takes mouse and pen (drawing tablet) input, not touch.
- **Why:** drawing on a computer with a tablet is the target. Supporting touch screens and phones would multiply the
  work.
- **Confirmed (2026-10-22):** the artist friend, who drew on a phone, built a computer and now draws on it (see
  "Phone or desktop?" in the open questions).

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
- **How it was chosen:** after my artist friend saw the old Lydia freeze on a big drawing (2026-10-20), Claude
  suggested painting pixels with Canvas 2D for now, and moving to WebGL later, once Canvas 2D reached its limits. I
  looked into it myself and chose WebGL with PixiJS right away: at 10000×10000 with many layers, Canvas 2D would have
  reached them soon (no control over memory, reads that make everything wait, no shaders), and the pixel engine would
  have been written twice.
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
  last one with each small fix or small feature: one change, one number, so each version can be traced to the change it
  brought. Each version is marked with a git tag (`v0.1.0`, `v0.2.0`…), and what it changed is written in
  [CHANGELOG.md](../CHANGELOG.md): each change is added under "Unreleased" when it is made, and moves under its
  number when the version comes out. Changes that leave the app the same (documentation, notes, tests) get no number
  and no line in the changelog, since the numbers tell what the app itself does.
- **Changed (2026-10-25):** from 0.8.5 on, a version comes out only when a whole stage of the roadmap is finished
  (my choice): its changes gather under "Unreleased" as they are made, and come out together as the next middle
  number. The Painting stage will be 0.9.0. The last number is left for fixes to a version already out.
- **Versions:** 0.1.0 was the first usable version, still with strokes stored as data (decision 3); 0.2.0 brought the
  tile engine from the spike into the main app; 0.3.0 completed the layers (delete, move, rename, undo of every layer
  change); 0.4.0 made brushes files that can be shared and added (decision 29); 0.5.0 brought the Brush Designer
  (decision 30); 0.6.0 started pixel art, with the Pixel brush and the pixel grid (decisions 33 and 34); 0.7.0 brought
  brushes with filtered noise and strokes painted in tiles of their own (decisions 35 and 36); 0.8.0 brought the basic
  tools: the tool column, the eyedropper, turning and flipping the view, the fill bucket, selections, the move tool and
  smart objects (decisions 37 to 42), and 0.8.1 to 0.8.5 small features after it, one each. 1.0.0 will be the desktop app, packaged with Electron. The full list is in
  [CHANGELOG.md](../CHANGELOG.md).
- **Why:** the 0 tells anyone looking that Lydia is still in development and may change, and the numbers show how far
  along it is. A version for each small feature made five versions in two days; one for each stage is a version
  worth trying, and its changelog tells what the stage brought.

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
  show, and change the opacity. Deleting, reordering and blend modes come in a later version (deleting, moving and
  renaming came next, with decision 25).
- **Why:** the engine already works with layers, and an artist can't draw seriously without them.

## 23. The opacity changes live while the slider moves

- **Date:** 2026-10-22
- **Status:** adopted
- **Problem:** in 0.2.0 the layer only changed once the opacity slider stopped, because putting every tile of a big
  layer together again takes 200–350 ms (measured headless on a full 10000×10000 layer), far too slow for each step.
- **Decision:** while the slider moves, each tile of the active layer is shown with three sprites instead of its
  projection tile: its "below" tile (decision 10), the layer's own tile with the new opacity, and the layers above it,
  put together once. Each step then only changes the opacity of the middle sprite, and the graphics card puts the three
  together on every frame. When the slider is let go, the tiles are put together for good. If a layer above uses a
  blend mode other than normal, its look depends on what is under it, so it can't be put together on its own: then the
  tiles are put together at every step, as before.
- **Measured (headless, full 10000×10000 layer with layers above and below):** the first step takes ~340 ms (it puts
  the "above" tiles together), each next step ~2 ms, letting go ~35 ms. At full size the live tiles are exactly the
  final tiles; zoomed out, the screen can differ by 2/255 because each sprite is smoothed on its own.
- **Why:** Photoshop and Krita show the opacity while the slider moves. The extra graphics card memory (the "above"
  tiles) is only used while the slider is held.

## 24. Exporting as JPEG too

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** besides PNG, the drawing can be exported as JPEG, with a fixed quality of 0.95 (from 0 to 1), with an
  `Export JPEG` button next to `Export PNG`. A real File menu can come with the desktop app.
- **Measured (headless):**

  | Drawing                                    | PNG             | JPEG 0.95     | JPEG 0.9 | JPEG 1  |
  | ------------------------------------------ | --------------- | ------------- | -------- | ------- |
  | 4000×4000, lines on white paper            | 2.9 MB, 0.8 s   | 0.9 MB, 0.3 s | 0.7 MB   | 2.3 MB  |
  | 10000×10000, covered with soft color paint | 138.4 MB, 8.9 s | 8.6 MB, 2.8 s | 4.6 MB   | 57.6 MB |

  At 0.95 the colors are 0.2–0.6 (out of 255) away from the PNG on average. Painted areas never differ by more than
  13; next to thin colored lines on white a few pixels (0.4%) differ more, because JPEG keeps colors at half the
  resolution of the brightness.

- **Why:** JPEG files are much smaller, which is what most sites and messaging apps want. 0.95 still looks the same as
  the PNG. 1 makes files 2.5–7 times bigger for almost nothing; 0.9 makes them 20–45% smaller but loses more (up to
  20 instead of 13 in painted areas). PNG stays the choice for keeping every pixel exactly (line art, printing). The
  quality can become a setting later if someone needs it.

## 25. Every layer change can be undone

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:** the undo history has three kinds of steps instead of one. Besides the tiles a change painted over
  (decision 8), a step can keep the list of layers and the active layer from before a layer was added, deleted or
  moved, or the visibility, opacity and name a layer had before. Like the tile steps, each one works in both
  directions: undo swaps it in, redo swaps it back. A deleted layer stays alive inside its step, with its tiles,
  which count for the memory budget (decision 14) and the undo limit; when the step is forgotten and no other step
  needs the layer, its tiles leave the graphics card. Moving, deleting, hiding or showing a layer only puts together
  again the tiles where it has paint, since it is transparent everywhere else. A whole drag of the opacity slider is
  one step. Layers are moved by dragging them in the list, with pointer events (the same for the mouse and the pen),
  and renamed with a double-click, like in Photoshop and Krita.
- **Why:** deleting a layer by mistake must not lose work, and artists expect Ctrl+Z to undo anything. Keeping the
  same layers in the step, instead of copies, costs no memory until a layer is deleted.

## 26. Big layer changes are prepared in the background

- **Date:** 2026-10-22
- **Status:** adopted
- **Problem:** a layer change must put together again every tile where the layer has paint, and each of those tiles
  needs every layer at its place. With 8 full layers of 10000×10000 that is ~12,800 tiles sent from RAM to the graphics
  card, which keeps only 2,000 (decision 11), so it happens every time, not only the first. Measured on the RTX 4060
  Ti, the screen froze 1.1–1.4 s for each move, delete, hide, show or undo of one of them. With 20 layers it would be
  several seconds, and more with compressed tiles. Hiding and showing had this since 0.2.0, and so did the first step
  of the opacity slider (decision 23).
- **First try:** put the tiles together a few every frame and show each one as soon as it is ready, like Krita. The
  screen never froze, but the change spread over the picture "like a short video", which felt worse than a change
  that happens at once.
- **Decision:** the new versions of the tiles are put together out of sight, a few every frame (at most 5 ms of each
  frame, 2 ms while painting), and the screen shows them all at once when they are all ready. Meanwhile the bar shows
  "Updating…", and zooming and moving around keep working. Painting on a waiting tile puts it together right away,
  and exporting finishes the work first. The opacity slider (decision 23) works the same way: its live tiles are
  started out of sight and shown together, and when it is let go the final tiles replace them together. The textures
  of the replaced tiles are reused for the next change, and freed a few every frame once nothing is being updated,
  since creating and deleting thousands of textures at once took time too.
- **Measured (RTX 4060 Ti, 8 full layers):** every layer change blocks the screen ~1 ms instead of 1.1–1.4 s; the new
  picture appears, in a single step, 2.0–2.6 s later. The longest frame meanwhile takes 13–34 ms (49 ms when the
  opacity slider is let go).
- **Why:** the goal is 20 or more layers at 10000×10000 (decision 9). That many pixels don't fit in the graphics card,
  so a change to all of them can't be instant, but the screen must never freeze, and I prefer a change that
  appears at once. Sending fewer tiles is still open: unpacking in workers (decision 14), batches (decision 18), a
  bigger cache on cards with more memory.

## 27. A bigger graphics card cache, used in a better order

- **Date:** 2026-10-22
- **Status:** adopted
- **Problem:** even prepared in the background (decision 26), a layer change on my drawing (4 full layers) took
  0.7–1 s to appear, which I found too slow. With 4 full layers of 10000×10000 (6,400 tiles), each change
  sent ~6,000 tiles from RAM to the graphics card again, because it kept only 2,000 (decision 11). Measured on the RTX
  4060 Ti: 1.3 s to move a layer.
- **Decision:** the graphics card keeps up to 8,000 tiles that are not painted (about 2 GB, so ~3 GB in all with the
  projection). When more tiles are needed than it keeps, the waiting tiles whose layers are already on the graphics
  card are put together first: going through them in the same order every time pushed out each tile just before it
  was needed again, so almost nothing was reused.
- **Measured (RTX 4060 Ti):** 4 full layers: moving a layer 1.3 s → 0.09–0.25 s, deleting it or undoing that 1.0–1.4 s
  → 80–90 ms, hiding or showing 30–313 ms → 38–46 ms, first step of the opacity slider 290 ms → 51 ms, all without
  sending a tile. 8 full layers (12,800 tiles, more than it keeps): 2.0–2.9 s → 1.1–1.4 s for most changes, ~4,700
  tiles sent instead of ~12,700; showing a layer again or undoing a delete still takes ~2.3 s.
- **Why:** my card has 8 GB, and so does the friend's RTX 3050. Cards with 4 GB or less may get slower, since
  Windows then keeps part of the textures in the computer's RAM. Browsers don't tell how much memory the graphics card
  has; the desktop app (1.0) can find out and choose the size from it.

## 28. The user chooses the graphics card memory, for now

- **Date:** 2026-10-22
- **Status:** adopted (until the desktop app)
- **Decision:** the start screen has a choice of how much of the graphics card's memory Lydia may use to keep layers
  ready (the cache of decision 27): 0.5, 1, 2, 3, 4, 6 or 8 GB, 2 GB by default, remembered by the browser. Each
  choice shows how many tiles it keeps (2 GB = 8,192), next to a reminder that a full layer has 1,600. Under it,
  a big red warning says that too much can crash Lydia or slow down the whole computer, and how to see the graphics
  card's memory on Windows. The smallest choice (2,048 tiles) is still more than the 1,600 tiles of a full layer,
  which the opacity slider keeps on the graphics card (decision 23).
- **Why:** browsers don't tell how much memory the graphics card has (decision 27), and a fixed 2 GB is too little
  for big cards and too much for small ones. Asking is the honest choice in the browser; the warning is there because
  a choice that is too big doesn't fail with an error: the computer gets slow, or the browser loses the graphics card.
  The desktop app (1.0) will read the graphics card's memory and the real RAM from the system and choose by itself,
  keeping this as an option in its preferences, like Photoshop.

## 29. Brushes are files

- **Date:** 2026-10-22
- **Status:** adopted (the brushes folder: planned for the desktop app)
- **Decision:**
  - A brush is a `.lydbrush` file. It is JSON text with three things in it:
    - a name;
    - the picture of its tip, a PNG inside the file (black paints, white doesn't);
    - how copies of the tip are placed along a stroke: the spacing, the angle, turning with the stroke, turning at
      random, scattering, how much paint each copy puts down (flow), and what the pen's pressure changes.
  - The brushes that come with Lydia are files of the same kind, in `src/brushes`, made by `scripts/make-brushes.mjs`.
  - In the browser:
    - brushes are added with **Import…** or by dropping their files on the window, and the browser keeps them
      (IndexedDB);
    - **Export** saves the chosen brush as a file;
    - **Delete** removes an added brush.
  - The desktop app (1.0) will read a real folder of brushes, where adding a brush is just copying its file there.
  - A Brush Designer, for drawing a tip and saving it as a brush, comes in 0.5.0.
- **Why:**
  - It was my idea: brushes that can be shared and added just by moving a file, like the brushes of Krita
    and Procreate.
  - **Only data, never code.** Brush files will come from anywhere, so nothing in a file is ever run. Before using a
    file, Lydia checks it: the tip must be a PNG of up to 1024×1024 with some paint in it, the numbers must be within
    limits, and the version must be one Lydia knows.
  - JSON keeps the settings readable, and lets the format grow: a missing field takes its usual value, and an unknown
    one is left alone.
  - A web page can't look into a folder of the computer by itself. Chrome and Edge can open a folder the user picks,
    but they ask for permission again at every visit, and Firefox and Safari can't do it at all. Importing works in
    every browser, so I chose it for the web version.
- **How:**
  - The tip is a texture with mipmaps (smaller copies of itself), so a big tip full of detail stays smooth when the
    brush is small.
  - Dabs can be turned, so the tiles a dab touches come from how far the tip's paint reaches from its center: √2 times
    half the size for a square tip, not just half the size.
  - Where the dabs go (`dabs.ts`) is the same code for the engine and for the sample strokes in the brush list.
  - The eraser uses the chosen brush's tip too.
- **Measured (RTX 4060 Ti):** a 9000 px stroke at size 500 on a 10000×10000 drawing takes 18–25 ms with any of the
  brushes, the same as with the soft brush before.
- **Left for later:** a "grain": a texture fixed to the paper that shows through the strokes, which pencils need. A
  grain inside the tip averages out where the dabs overlap, so a Pencil brush tried for this version looked like a
  soft round brush and was left out.

## 30. The Brush Designer

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:**
  - The Brush Designer is a screen of its own, opened from the start screen, with a paper of 256, 512 or 1024 pixels
    for the tip (512 by default).
  - The tip is drawn with Lydia's own engine, so zoom, undo, the eraser and the pen's pressure work as in a drawing.
    It is painted with the round brushes that come with Lydia (soft or hard edge), and instead of a color there is a
    strength: black paints fully, gray paints lightly.
  - The tip is the painted part of the paper, cut out with a margin of 2 pixels, like Photoshop does when it defines
    a brush. The brush size then measures the drawing, not the whole paper.
  - Next to the paper are the brush's name, its settings (decision 29) and a test area. The test area starts with a
    sample stroke and takes strokes from the mouse or the pen; every change to the tip or the settings paints all of
    them again, so the before and after can be compared.
  - **Save to my brushes** keeps the brush in the browser and makes it the chosen brush, ready in the next drawing.
    Saving again during the same visit changes that brush instead of adding another one. **Export file** saves the
    `.lydbrush` file.
- **Why:**
  - It was my idea, together with brushes as files (decision 29).
  - A screen of its own was my choice, over a window on top of the drawing. It keeps the Designer simple: the
    drawing and the Designer never run at the same time, nor share the keyboard.
  - Left out for now, also my choice: opening an existing brush to change it, using an image as the tip, and
    painting the tip with the other brushes.
- **How:** after every change to the paper (a stroke, undo, redo, clearing), its picture is exported, cut to the
  painted part and read as a tip again. The engine and the brush list share code with the Designer: the shortcuts,
  the engine's state for the screen (`engineHooks.ts`) and the drawing of strokes on an ordinary canvas
  (`dabCanvas.ts`).
- **Measured (RTX 4060 Ti):** the tip is ready 18–35 ms after a stroke on papers of 256 and 512 pixels, and
  73–97 ms on a paper of 1024.

## 31. A window for new drawings, with a background color or none

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:**
  - **New project…** on the start screen opens a window with the size of the drawing and its background.
  - The size can be typed in or chosen from common sizes: papers at 300 DPI (A5, A4, A3, US Letter, US Legal,
    Tabloid) and screens (Full HD, 4K UHD, a 2048 square). The list shows "Custom" when the size typed in is not one
    of them.
  - The background is a color (white at first) or transparent. **Transparent** turns the color off.
  - The window opens with the last choices, remembered by the browser.
  - The background is part of the drawing: the `.lyd` header has it (`"background": "#rrggbb"`, or `null` when it is
    transparent). Files saved before have no background and open on white paper, as before; Lydia 0.5.0 opens a
    transparent file on white paper.
- **Why:**
  - It was my request, and so was remembering the last choice. A choice of resolution (DPI) and a button to
    swap width and height were left out, also by my choice: another resolution can be typed in.
  - 300 DPI is the usual resolution for printing, and A3 at 300 DPI (3508×4961) is still well within Lydia's
    10000×10000.
- **How:**
  - The paper the projection puts under the layers (decision 10) is the background's color, or nothing when it is
    transparent.
  - Under a transparent background, the screen shows gray and white squares, like Photoshop and Krita. They keep
    their size on the screen at any zoom: they follow where the paper is, every frame, instead of zooming with it.
  - The graphics card keeps colors already multiplied by their alpha. On a transparent background, the export divides
    them back. Copied as they were, every soft edge would get a dark rim in the PNG (a half see-through red came out
    as dark red: 209, 0, 0 instead of 255, 0, 0, at alpha 209).
  - A JPEG has no transparency, so a transparent background becomes white in it.
- **Measured (RTX 4060 Ti):** exporting a painted 10000×10000 drawing takes as long with a transparent background as
  with white paper: 3.2 s instead of 3.5 s for PNG, about 2.4 s for JPEG.
- **Changed by decision 32:** paper sizes follow each drawing's resolution, chosen in the same window, instead of
  always 300 DPI.

## 32. Each drawing has a resolution (DPI)

- **Date:** 2026-10-22
- **Status:** adopted
- **Problem:** I printed an A4 drawing (2480×3508 pixels, made with the A4 size of decision 31) on an A4 sheet,
  and it came out smaller than the sheet, with white margins. The image itself was right: A4 at 300 DPI, painted to
  the edges.
- **Why it happens:**
  - Exported images didn't say their resolution: browsers write PNG and JPEG files without it. Programs then guess 72
    or 96 DPI, so an A4 drawing looks like a poster of 66×93 cm to them, and each program shrinks it to the page in its
    own way.
  - Printers can't print the last 3–5 mm of the sheet, and print programs shrink the image to fit inside that by
    default. A print setting for Letter paper, 1.8 cm shorter than A4, shrinks it more and leaves margins on the
    sides. Lydia can't change this: borderless printing, or "Fill" instead of "Fit", is chosen when printing.
- **Decision:**
  - Each drawing has a resolution, chosen in the New project window: 300 DPI at first, with buttons for 72, 150, 300
    and 600, and any other typed in (from 1 to 2400). The `.lyd` header keeps it (`"dpi"`); projects saved before
    are 300 DPI.
  - Exported PNG and JPEG images say the drawing's resolution, so printers and other programs (Word, Photoshop,
    GIMP) know its size on paper: an A4 drawing is 21×29.7 cm at any resolution.
  - Paper sizes follow the resolution: A4 is 2480×3508 pixels at 300 DPI and 1240×1754 at 150. A paper chosen from
    the list stays that paper when the resolution changes; a size typed in keeps its pixels, and only its size on
    paper changes. The window shows the size on paper, in centimeters and inches. A paper that would be bigger than
    10000 pixels at the chosen resolution (Tabloid at 600 DPI) can't be chosen.
- **Why:** at first every image was going to say 300 DPI, the resolution of the paper sizes, which I chose over
  a resolution for each drawing. Then it showed that a size typed in for another resolution (an A4 at 150 DPI) would
  print at half its size, and I chose to add the resolution right away. The screen ignores it: it only matters
  on paper.
- **How:**
  - PNG files get a "pHYs" chunk (pixels per meter: 11,811 for 300 DPI) before the image data; in JPEG files, the
    "JFIF" part that browsers already write says the dots per inch.
  - The paper sizes are kept in millimeters or inches and worked out in pixels at the chosen resolution, so the sizes
    and the exported resolution always agree.
  - The common resolutions are buttons, not a list of suggestions under the field: in the browser Lydia is tested
    with, that list took the keys typed into the field.
- **Checked:** Pillow, a Python library for images, reads exported PNG and JPEG files of an A4 drawing as 21×29.7 cm,
  at 300 DPI and at 150 DPI, also after saving and opening the project.

## 33. The Pixel brush

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:**
  - A new brush that comes with Lydia, **Pixel**, paints whole pixels of the paper with hard edges, for pixel art. The
    other brushes stay smooth at every size.
  - Its size is its width in pixels, as with the other brushes, from 1 pixel up. Its tip is round and worked out for
    each size: it paints the pixels whose centers are within half the size from the tip's center. At size 3 that
    would be a full square, so there the tip is a plus. The smallest sizes, as I drew them:

    ```
    1  #     2  ##    3  .#.    4  .##.    5  .###.
                ##       ###       ####       #####
                         .#.       ####       #####
                                   .##.       #####
                                              .###.
    ```

  - An odd size is centered on the pixel under the pen, and an even size on the corner between pixels nearest to it.
  - Strokes have no gaps: a straight line paints one pixel in each column (or row), and the pixels under the pen when
    the stroke ends are always painted.
  - The pen's pressure changes the size a pixel at a time, and the lightest touch paints one pixel.
  - The `.lydbrush` file says `"pixel": "round"`. Versions of Lydia without pixel brushes ignore that and paint with
    the tip's picture, a hard circle, as a smooth brush.
- **Why:**
  - I want Lydia to appeal to pixel artists too. A smooth brush at 1 or 2 pixels blurs its edges and can't
    paint one exact pixel.
  - The shapes are the ones pixel artists draw by hand. I chose the size as the width, like the other brushes,
    and a new brush instead of a pixel mode for every brush.
- **How:**
  - Each size has its own texture of the tip, made the first time it is used. It is painted at its own size with
    "nearest" sampling, so each pixel of the tip is exactly one pixel of the paper. The textures unused for the longest
    time are forgotten once they add up to more than 4 million pixels (16 MB).
  - The dabs are placed by the same code as for the other brushes (`dabs.ts`), with whole sizes, moved to the nearest
    pixels and never turned. The spacing is 1% of the size, and at least 1 pixel: a dab on every pixel up to size
    149, and on bigger tips, a few pixels apart, where it makes no difference.
  - For a pixel brush, the spacing is measured along the longer side (the larger of the distances across and down).
    Measured in a straight line, a sloped line got extra pixels at its steps.
  - Since 0.8.1, a pixel brush counts the spacing from the edge of the pixel the stroke started in, not from the pen:
    counted from the pen, depending on where in its pixel the stroke started, the pen sometimes had to go past the
    middle of the next pixel before it was painted (I noticed it). Now, going straight, each pixel is painted as
    the pen enters it. A dab at every edge the pen crosses, across and down, was tried first: it left holes where a
    line turns between mostly across and mostly down and, filled, about twice as many doubled corners near 45° (220
    instead of 95 in 208 simulated strokes; 126 with the start counted from the edge). Painting every pixel at once
    and taking the doubled corners out afterwards is the pixel-perfect mode, planned with the pixel art stage.
  - A dab that would paint the same pixels as the one before is skipped.
  - The brush list shows the Pixel brush's sample stroke 4 times smaller, enlarged, so that its pixels show.
- **Measured (RTX 4060 Ti):**
  - A 9000 px stroke on a 10000×10000 drawing, waiting until the graphics card has painted it, takes as long as with
    Hard round measured the same way: 70 ms at size 500, 24–29 ms at sizes 1 to 100.
  - With the pen's pressure going up and down all along a stroke at size 500, it takes about 520 ms instead of 74,
    about 1.3 ms per movement of the pen: each new size makes its tip, about 1.2 ms for a tip of 500 pixels, mostly
    to send it to the graphics card. That still fits in a frame, and a tip of 100 pixels takes 25 times less.
- **Next:** pixel brushes drawn in the Brush Designer (also in 0.6), then the pixel art stage of the roadmap: a pixel
  grid (done next, decision 34), pixel-perfect strokes and exporting enlarged.

## 34. A pixel grid

- **Date:** 2026-10-22
- **Status:** adopted
- **Decision:**
  - From 800% zoom, lines show between the pixels of the paper, like the pixel grids of Photoshop and Aseprite. The
    **Grid** button (or G) turns it off and on, and Lydia remembers the choice. It is on at first, and the Brush
    Designer has it too.
  - Each line takes its color from what the screen shows under it: each of red, green and blue moves half the way
    across (a value under the middle goes up by half, one above it goes down by half), and the line goes halfway to
    that color. So a line is light gray (191) on white, dark gray (64) on black and on middle gray, and a duller red
    (191, 64, 64) on red: always the same contrast, 64 out of 255, on any color, also on the squares of a transparent
    background.
  - The lines are one pixel of the display wide at any zoom and display scale, and only inside the paper.
- **Why:**
  - I couldn't tell the pixels apart when drawing with the Pixel brush. My idea was lines in the inverse color of
    what is under them, so that they always contrast. But, as Claude pointed out, the inverse of middle gray (128) is
    the same gray (127), so the lines disappeared there and were weak on the grays near it. Moving each color half the
    way across keeps my idea and gives every color the same contrast; I chose it, and the grid showing on its own from
    800% with a button to turn it off.
  - From 800% each pixel is at least 8 pixels of the screen; closer lines would cover the drawing.
  - Halfway to the line color shows the lines without covering the drawing, about as strong as Aseprite's grid (black
    at a quarter of opacity). It is one number to change (`STRENGTH` in `pixelGrid.ts`).
- **How:**
  - While the grid shows, the drawing (with the squares of a transparent background) is drawn into a picture the size
    of the screen, and the screen shows that picture through a shader that changes the pixels the lines go through.
    Where the lines go is worked out for each pixel of the display, so they are never blurred or doubled.
  - PixiJS's filters do the same, but in PixiJS 8.22 a filter makes PixiJS warn whenever the window changes size or
    the drawing is closed: PixiJS throws away its own picture of the last frame while the filter still points at it.
    So Lydia keeps its own picture.
  - Under 800%, or with the grid off, the drawing goes to the screen directly, as before.
- **Measured (RTX 4060 Ti):** a frame of a 10000×10000 drawing at 800% takes 1.85 ms with the grid and 1.88 ms
  without: no difference that can be measured.
- **Checked:** the colors of the lines on white, black, the two middle grays (127 and 128), red and the squares, read
  from the screen; each line exactly between two pixels and one pixel of the display wide, also at a display scale of
  150%.

## 35. Brushes with filtered noise

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - A brush can have "filtered noise" in its dabs: random numbers filtered so that no two dabs are alike, but all of
    them keep the brush's character. It was my idea: a sequence of numbers filtered in a way that brings
    randomness to the stamp without losing what it looks like.
  - The noise goes over any tip: drawn in the Brush Designer, imported, or worked out (the Pixel brush's tips are not
    used with noise). Its settings, in the Brush Designer and in the `.lydbrush` file:
    - **Amount:** how much of the paint the noise decides; at 0 there is no noise.
    - **Grain:** how many grains fit across the tip.
    - **Layers:** layers of finer grains added on top (up to 4), for a more natural texture.
    - **Stretch:** how many times longer than tall the grains are: streaks across the tip.
    - **Contrast:** soft noise, or sharp specks.
    - **New noise for each stroke, not each dab:** each brush chooses. New noise for each dab gives rough edges and
      blotches all different; the same noise along a stroke gives streaks that run along it, like bristles.
  - The noise forms each dab in one of three ways, chosen for each brush ("Kind"):
    - **Mix:** the noise takes paint away from the tip, softly, following the tip's own edge.
    - **Drops:** whole drops of paint, with hard and ragged edges, where the tip has paint: many where it has a lot,
      few where it has little. A drop is painted whole or not at all, so the tip's edge never cuts one. The amount
      sets how many drops there are, and the layers how ragged their edges are.
    - **Worn:** the tip worn away from its edge in: full in the middle, with a hard and ragged edge.
  - Two brushes that come with Lydia use it: **Bristles** (the same noise along the stroke, stretched into streaks
    that turn with the stroke, washed: see decision 36) and **Sponge** (new noise for each dab, dabs far apart, turned
    and scattered).
- **Why:**
  - I chose to have the graphics card work the noise out, for each pixel of each dab, while painting it: nothing
    has to be prepared, every dab is truly different, and it is sharp at any size. Pictures of noise made beforehand
    and picked at random would repeat.
  - Painting the noise over the tip's picture costs the same as over a tip worked out by numbers, so the noise goes
    over any tip.
  - With Mix alone, the tip's edge cut the grains in two, with a sharp circle on a hard tip or a fade on a soft one.
    I wanted whole grains, like drops of paint, and no fade; Drops and Worn do that in two ways, and I chose to keep
    the three.
  - New noise for each dab mostly shows at the edges of a stroke: where the dabs overlap, their different noises
    average out, as the grain inside the Pencil brush did (decision 29). Inside a stroke, the noise only shows when
    it is the same along the stroke and the stroke is washed (decision 36).
- **How:**
  - The noise: random numbers at the corners of a grid (the sequence), blended smoothly between the corners (the
    filter). The size of the grid's cells is the grain; finer grids are added for the layers; a grid longer one way
    than the other gives the stretch; a curve at the end gives the contrast. Each dab has its own seed (`dabs.ts`),
    so a dab across 4 tiles has the same noise in all 4.
  - Drops: each cell of the noise's grid may hold a drop, with a random center, size and ragged edge. It is there
    when a random number is under the tip's paint at its center. A drop reaches less than a cell from its own cell,
    so each pixel only looks at the 3×3 cells around it, and the dab's square is a cell bigger on every side. The edge
    is smoothed over one pixel measured on the grid: measured on the distance to a drop, which jumps where two
    neighboring pixels measure to different drops, it drew thin lines along the cells.
  - Worn: the shader blurs the tip (the average of points on two rings around each point, with nothing outside the
    tip's square), and only the inner half of the blur is worn away, so the shape stays inside the tip's own edge.
    The tip's smaller copies alone, and a blur over a square, flattened round tips on four sides.
  - All the dabs of a tile are drawn at once, one square copied for each dab ("instances"), by a shader of its own
    (`noiseDabs.ts`). It needs WebGL 2's shading language: PixiJS only uses it when the shader starts with
    `#version 300 es`.
  - The code that paints dabs (`dabPainter.ts`) is shared by the drawing and the brush previews (the list, the Brush
    Designer's test area). The previews are painted by the graphics card too, on a small renderer of their own, and
    copied to their canvases: a preview always looks like the drawing, noise included, and the noise exists only once.
- **Measured (RTX 4060 Ti):** a 9000 px stroke at size 500 on a 10000×10000 drawing takes 70–100 ms with noise of 4
  layers, against about 45 ms without noise (the numbers vary by ±20% between runs): about 0.3 ms for each movement of
  the pen. One layer costs about the same as none. At size 100 and below there is little difference. Drops and Worn
  cost about as much as Mix (76 and 62 ms).

## 36. Strokes are painted in tiles of their own

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - A stroke is painted first into tiles of its own, white, with the paint in their alpha. When it ends, it is put
    into the layer with the stroke's color and opacity, or taken out of it with the eraser. Meanwhile the screen shows
    the layer with the stroke on it, as it will be.
  - This brings:
    - **Opacity for each stroke** (the Opacity slider): a stroke never covers more than its opacity, however many
      times it passes over a place; two strokes add up as usual.
    - **Wash**, a setting of each brush, like Krita's painting mode of that name: the stroke doesn't pile up over
      itself, each place keeps the most paint one dab gave it. A brush with 30% flow stays at 30%. With noise that is
      the same along the stroke, its streaks show inside the stroke (Bristles).
    - The eraser no longer leaves empty tiles where there was no paint.
- **Why:**
  - Without it, the dabs pile up: a place that gets 30% of paint from 25 dabs in a row ends up almost fully painted,
    which hid the noise inside the strokes. I chose to do it now, as it also brings the opacity for each stroke
    from the roadmap.
- **How:**
  - The stroke's tiles come from a pool (64 kept), with the size of the layer's tiles. Dabs go into them with the
    normal blend, or with "max" for a washed brush.
  - When the screen puts a tile together, the active layer's tile and the stroke are first put together in a
    texture of their own, which then gets the layer's opacity and blend mode: on a half-transparent layer, the stroke
    doesn't show twice where it covers paint.
  - At the end of the stroke, each tile of the layer is kept for undo and then gets the stroke. The screen is not put
    together again: it already shows exactly that.
  - PixiJS ignores the blend mode of the object it is asked to render, so the stroke's sprite goes inside a container
    (the eraser at 50% erased nothing until then).
- **Measured (RTX 4060 Ti):** the same 9000 px stroke at size 500 takes about 20–55 ms more than painting straight
  into the layer (each touched tile is put together in two steps): about 0.2 ms for each movement of the pen. At size
  100 and below there is no difference. A big stroke also uses a texture of 256 KB for each tile it touches, until it
  ends.
- **Checked:** opacity (a stroke at 50% that crosses itself stays at 50%, a second one adds up to 75%), wash (30% flow
  stays at 30%), the screen during and after a stroke against putting it all together again, also on a layer at 50%,
  the eraser on empty paper (no tiles, no undo step), and undo.

## 37. A tool column, and the eyedropper

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - The tools are in a narrow column at the left edge of the editor, like in Photoshop and Krita, with icons from
    [Lucide](https://lucide.dev) (`lucide-react`, ISC license). Resting the pointer on a button shows the tool's name
    and shortcut. The bar on top keeps the brush's settings (color, size, opacity) and the grid. The Brush Designer
    keeps its own Brush and Eraser buttons.
  - The tools of this stage, in this order (my choice): the eyedropper; the hand, zoom and rotate tools; the fill
    bucket; rectangle and lasso selections, with moving, scaling and rotating what is selected.
  - The eyedropper (I) picks the color the screen shows: the paper and every visible layer, with their opacities.
    Clicking picks a color, and dragging keeps picking as it moves. Outside the paper, and where nothing is painted on
    a transparent paper, the color stays as it was. It stays the chosen tool after picking, as in Photoshop and Krita.
  - Picking a color sets the stroke's opacity back to 100% (my choice): the picked color is the one the screen
    shows, and painting it at a lower opacity would come out lighter than what was picked.
  - Holding Alt with the brush or the eraser picks colors too, as in Photoshop.
- **Why:**
  - A column has room for the tools still to come, where the bar on top would run out of space, and painters know
    those icons from other programs.
  - Picking what the screen shows is what Photoshop and Krita do at first, and what the painter expects: the color
    they see. Picking from the active layer only can come later, if it is missed.
  - Alt is the key of Photoshop and Clip Studio Paint. Krita uses Ctrl, which Lydia already uses for undo, zoom and
    Ctrl+0.
- **How:**
  - `tools.ts` lists the tools. The engine knows the chosen one, and the view sends the left button to it.
  - The color comes from the screen's tile at that point (the projection): one pixel read from the graphics card, which
    waits for it. That works right after painting, before the painted tiles are saved in RAM. The graphics card keeps
    colors multiplied by their alpha, so they are divided back, as when exporting: on a transparent paper, half
    see-through paint gives its own color (within 1, from rounding).
  - The cursor is Lucide's pipette, black with a white edge so it shows on any color, picking at its tip. PixiJS sets
    the canvas's cursor to its "default" style when the pointer first moves over it, so that style changes too.
  - Alt alone moves the keyboard to the browser's menu in some browsers, so Lydia stops that. Whether Alt is down is
    also read from every pointer event, so Alt let go in another window (after Alt+Tab) doesn't leave the eyedropper
    on.
  - The Brush Designer paints in grays of its own and doesn't listen for colors, so there Alt and I do nothing.
  - Known limit: while a layer's opacity slider moves, and for a moment after, its tiles are read as they were before.
- **Measured (RTX 4060 Ti):** reading a pixel takes 0.2 ms, up to about 3 ms when the graphics card is busy.
- **Checked:** the column, its titles and keys (B, E, I); the cursor; clicking and dragging; white paper, outside the
  paper and a transparent paper; a layer at 50% (half the color over white); Alt with the brush and the eraser, which
  paint and erase nothing then; Alt let go elsewhere; and the Brush Designer, where Alt and I do nothing.

## 38. Turning and flipping the view

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - Three tools for the view:
    - **Hand** (H): dragging moves the view, like holding Space.
    - **Zoom** (Z): a click zooms in 2× around the point clicked, Alt + click zooms out. Dragging zooms smoothly
      around the point where the drag started: in to the right, out to the left, like Photoshop's "scrubby zoom".
    - **Rotate view** (R): dragging around the middle of the screen turns the view as far as the pointer goes around
      it. With Shift, it turns in steps of 15°.
  - Holding Shift + Space turns the view with any tool, as in Krita (my choice). There it turns freely, since
    Shift is already held.
  - M flips the view, as in Krita (my choice); the rectangle selection will get another key. The flip is a
    mirror of the screen, around its middle: a view turned one way looks turned the other way in a mirror, so the
    angle changes sign. The drawing itself never changes.
  - The bar on top shows the zoom and the angle, with **Straighten** (back to 0°), **Flip** and **Fit** (my
    choice). **Fit** keeps the view turned and flipped and fits the turned paper, as in Photoshop (my choice).
  - Since 0.8.3, a `.lyd` file keeps the view it had when it was saved (zoom, angle, flip, and the point of the paper
    in the middle of the screen, which stays in the middle in a window of another size), and opens with it. My artist
    friend had a drawing turned, and it opened straight again. A file without a view, or with one that makes no sense,
    opens showing the whole paper, as before; older versions of Lydia ignore it.
- **Why:**
  - Painters turn the paper like a sheet on a desk, to draw each line at the angle their hand draws best. Looking at
    a drawing in a mirror shows mistakes in its proportions that the eye got used to.
  - Before, there was no way to see the zoom.
- **How:**
  - The view is the transform of the container that holds the drawing ("world"): its position, rotation and scale,
    negative across when flipped. Going from the screen to the paper and back uses the same numbers, and the test
    checks them against PixiJS's own transform.
  - Each tool is a gesture: what the pointer does as it goes down, moves and comes up. The fill bucket and the
    selections will fit in the same way.
  - The pixel grid gets the transform from the screen to the paper, and finds the lines from the four corners of each
    pixel of the display. With the view straight that is the same as before; turned, the lines are a little wider and
    stepped.
  - The squares under a transparent paper are now part of the drawing, so they turn and flip with it. They get
    smaller as the view zooms in, to keep their size on the screen.
  - The zoom changes many times a second while zooming, so the bar listens for it apart from the rest of the screen,
    and only the bar updates then.
  - Space, Shift and Alt count as let go when the window loses the keyboard, since letting them go in another window
    never reaches Lydia.
- **Checked:** the tools' keys and cursors; the hand; the zoom tool's click, Alt + click and drag, around the right
  point; turning a quarter turn, in steps of 15° with Shift, and back with **Straighten**; Shift + Space and Space with
  the brush (nothing painted); flipping with M and **Flip**, a mirror of the screen; painting and picking exactly under
  the pointer on a turned and flipped view; **Fit** and Ctrl + wheel on a turned view; the pixel grid and the
  transparent paper's squares on a turned view.

## 39. The fill bucket

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - The fill bucket (F) fills the region around the point clicked: the pixels connected to it, side by side or above
    and below, whose colors are close to the color there. It fills with the color and the Opacity of the bar, as one
    step of undo. Holding Alt with it picks a color, as with the brush.
  - Its settings in the bar, chosen by me:
    - **Tolerance**, from 0 to 255, 32 at first as in Photoshop: how far each of red, green, blue and alpha may be
      from the color clicked.
    - **Look at**: **All layers**, the visible layers put together without the paper (at first, my choice), or
      **This layer**.
    - **Expand**, from 0 to 50 pixels, 20 at first: at most how far the fill goes past its edge, under the lines.
  - Past the edge of the region, the fill goes on into the soft edge of the lines around it, as long as their color
    keeps getting further from the one clicked: up to where the line is darkest, like Clip Studio Paint's "to the
    darkest pixel". There it fills behind the paint already there, so the soft edge of the line stays on top of the
    color (my choice). Inside the region it fills over the paint, so a flat color can be changed for another.
  - It always fills only the region that touches the point clicked; I left out the choice of filling every pixel
    of that color.
- **Why:**
  - The most common way of coloring is lines on one layer and flat color under them on another: with **All layers**
    that works without changing anything.
  - Without **Expand**, the soft pixels at the edge of a line are too far from the color clicked and stay unfilled:
    a light rim between the color and the line. Around a circle in the test, 124 such pixels without it, none with
    it.
  - At first **Expand** grew the region by a square of 2 pixels and filled over the paint. With the line on the same
    layer, I saw the fill cut into the soft edge of a line drawn with Soft round: hard and stepped on the side of
    the color, while the other side stayed soft. Filling behind the paint, up to where the line is darkest, keeps the
    line as it was on both sides, the same as with the line on a layer of its own. Since it stops at the line by
    itself, **Expand** is now only a limit, and can be bigger.
  - Then, zoomed in, I saw a band of dark red between the red fill and a black Soft round line: the soft edge of
    the line over the color. I chose to keep it rather than cut the line cleanly at its middle: it is the line's own
    softness, as Photoshop and Krita show a soft line over a color. A narrower band comes from a harder brush.
- **How:**
  - The fill first waits until every painted tile is saved in RAM (decisions 12 and 15). Then the processor works
    from RAM, 6 ms of every frame, so the screen keeps going: the bar says "Filling…", and painting, undoing and
    changing the layers wait. The hand, zoom, rotate and eyedropper tools still work.
  - A "scanline" fill that goes across tiles. The first time it reaches a tile, it marks which of its pixels are close
    enough in one tight loop, and then only walks those marks. A tile of a single color (or empty) is filled whole at
    once, so an empty layer of 10000×10000 fills in about half a second.
  - The edge starts from the filled pixels next to one that isn't, and goes one pixel further at each step, into
    the 8 pixels around, while the color there is at least as far from the one clicked as where it comes from. A pixel
    already as far as can be (255, a fully opaque line on an empty layer) is the darkest, so the edge stops there
    instead of crossing the whole line. Behind the paint, the color shows only where the paint lets it through:
    paint + color × (1 − the paint's alpha).
  - The layer's new pixels are worked out in RAM too, and sent to the graphics card only where it has a copy of the
    tile. A first version painted the fill on the graphics card: then every filled tile had to be read back to RAM,
    hundreds at once after a big fill, and the screen stopped for up to 300 ms.
  - A tile of a single color is no longer sent to the graphics card as pixels: the graphics card fills its texture
    with the color. That helps everywhere big flat areas are shown or undone.
  - A fill of more than 32 tiles is put together out of sight and shown all at once, like a layer change
    (decision 26); a smaller one shows right away.
  - The layers are put together with the normal blend, the only one Lydia has on the screen so far.
- **Measured (RTX 4060 Ti, 10000×10000):** an empty layer, about 0.5 s from the click until the fill is on the
  screen; with six long lines across the paper, about 1.5 s. The longest frame meanwhile: 42 ms. Before the work was
  spread over frames and done in RAM, the same fill took 3.6 s and stopped the screen for up to 300 ms.
- **Checked:** the button, the key and the cursor; the settings in the bar; an empty layer, and undo; inside a circle
  drawn on the layer above, with **All layers**, without and with **Expand**; the fill going into the active layer and
  not the line's; a Soft round line with the fill on the same layer (with **Expand** at 0, white shows between them;
  at 20, none, and the red fades into the black); **Tolerance** (two grays 20 apart: both with 32, one with 10);
  **This layer**; Alt; 50% opacity on a transparent paper; 10000×10000, with undo and redo; and that tiles filled
  whole go into RAM as a single color, the same as on the graphics card.

## 40. Selections

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - Two selection tools: **Rectangle select** (S) and **Lasso** (L). Their keys are my choice: M already flips
    the view, as in Krita. The rectangle follows the sides of the paper, even with the view turned.
  - Shift + drag adds to the selection and Alt + drag takes away from it, as in Photoshop and Krita (my choice).
    Without a key, a new selection takes the place of the old one, and a click selects nothing.
  - The edges are soft at first, and hard (whole pixels, for pixel art) with a button in the bar (my choice).
    Choosing a pixel brush makes them hard, and choosing another brush soft again (my choice, after a soft edge
    across a line of pixel art left a gray row in a transformed part of it: see decision 42).
  - The brush, the eraser and the fill bucket only work inside the selection, as much as each pixel is selected.
    Delete takes out the paint inside it. Ctrl+A selects everything, Ctrl+D nothing, and Ctrl+Shift+I what wasn't
    selected; the bar has the same as buttons. Every change of the selection is a step of undo.
  - The selection's edge shows as "marching ants": black and white dashes that move.
  - Next, in steps of their own: moving what is selected (V; without a selection, the whole layer, my choice),
    then scaling and turning it.
- **Why:**
  - That is how selections work in Photoshop and Krita, so painters know it already. Soft edges keep the edge of what
    is painted inside smooth; pixel art needs whole pixels.
- **How:**
  - A selection is kept like a layer: by tile, how much each pixel is selected, from 0 to 255, in RAM. A tile selected
    whole is only marked so, and a tile not selected at all isn't kept. A selection never changes: every change makes
    a new one, sharing the tiles that stay the same, so an undo step only keeps the old one.
  - A rectangle or a lasso is a polygon. For each row of tiles, lines across it (four per row of pixels for soft
    edges, one through the middle of the pixels for hard ones) find the stretches inside the polygon, and measure
    exactly how much of each pixel they cover. A tile that every line covers whole is selected whole without looking
    at its pixels. Where the outline crosses itself, a place is inside if the outline goes round it ("nonzero" rule).
  - To show the edge, the selected tiles are drawn into a picture the size of the screen, placed like the drawing,
    and a shader draws the dashes where a pixel is selected (half or more) and the next one isn't. That works at any
    zoom and with the view turned or flipped, like the pixel grid (decision 34). Tiles selected whole side by side
    are one rectangle: with everything selected on 10000×10000, 40 sprites instead of 1600.
  - Strokes skip the tiles not selected at all, and in the others, the stroke's own tile (decision 36) is cut to the
    selection after each step: what isn't selected is taken out of it with the "erase" blend, using a texture of the
    part not selected (made from the selected one on the graphics card). The screen shows the stroke cut already,
    and it goes into the layer cut.
  - The fill bucket multiplies its fill by how much each pixel is selected. Delete works in RAM like the fill
    (decision 39): both share the code that changes a layer's tiles a few every frame, as one step of undo.
- **Measured (RTX 4060 Ti, 10000×10000):** a lasso of 2000 points round the whole paper is worked out in about
  150 ms (1231 tiles, 1080 of them whole). With everything selected, a frame while the view moves takes 3.3 ms (7.8 ms
  before tiles selected whole were joined into rectangles).
- **Checked:** the tools, their keys and the bar; a rectangle, and a click that selects nothing; the ants on the edge
  and not inside; soft and hard edges; adding and taking away; the lasso; the brush, the eraser and the fill bucket
  only inside; everything selected; Delete and its undo; Invert and its undo; undoing a click that selected nothing;
  a rectangle on a turned view.

## 41. Moving paint

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - The **Move** tool (V, as in Photoshop) drags the selected part of the active layer, as much as each pixel is
    selected; when nothing is selected, the whole layer (my choice). It moves by whole pixels of the paper, and
    Shift keeps it level or upright. The selection moves along with the paint, and the move is one step of undo
    together with the selection. A click without dragging does nothing.
  - Paint moved off the paper is lost: the layers only have tiles over the paper. Photoshop and Krita keep it, with
    layers that can be bigger than the paper; that would be a stage of its own.
  - A hidden layer isn't moved, since nothing of it shows.
  - Next, in a step of its own: scaling and turning what is selected.
- **Why:**
  - That is how the move tool works in Photoshop and Krita. Whole pixels keep hard edges and pixel art sharp; scaling
    and turning, which can't keep them, come with the transform step.
- **How:**
  - While it is dragged, the screen shows the moved part on its own, between what is under it and what is over it.
    Tiles where the layer loses paint, or where layers above have paint, are shown with three pictures instead of
    their projection tile: the "below" tile (decision 10) with what is left of the active layer, the moved part, and
    the layers above put together. Elsewhere the projection tile already has everything under the moved part, and
    nothing goes over it. A new position only moves the moved part's container, so a frame costs about the same as
    without a move.
  - The pictures are copies, made on the graphics card once the pointer starts moving, a few tiles every frame, with
    "Moving…" in the bar; they are shown all at once when they are ready. What is left of a tile, and its moved part,
    are cut with the selection like strokes (decision 40).
  - Once it is let go, the layer's new tiles are worked out in RAM, like the fill (decision 39), from its tiles as they
    were before: what is left of each tile, with the moved part that lands on it over that. Tiles moved whole onto
    places where nothing is left are copied row by row. The screen keeps showing the move until the new tiles are put
    together, and changes over to them in the same frame.
  - An undo step of a layer's pixels can also keep the selection from before, so undoing a move brings both back.
  - Until it is let go, two things look a little different from the result: layers above with a blend mode other than
    normal (they are put together on their own, as with the live opacity, decision 23), and the moved part over what
    is left of a layer at less than full opacity.
  - Making the pictures of a selection's edge for the marching ants was slow (each pixel's four bytes were written one
    by one): it now writes each pixel as one number, about 9 times faster, for every new selection.
- **Measured (RTX 4060 Ti, 10000×10000, a layer with pixels in all 1600 tiles):** the moved layer shows about 0.2 s
  after the drag starts, a frame while it is dragged takes 6.5 ms, and putting it down takes about 0.55 s (0.4 s for a
  soft lasso 6000 pixels wide, inside the layer); the longest frame on the way was 42–56 ms, as with the fill. The
  marching ants of a selection with 96 tiles on its edge went from 167 ms to 19 ms.
- **Checked:** the button, the key and the bar; the whole layer, shown at its new place while dragged and put there
  once let go; undo and redo; a click; the selected part only, with the selection moving along, and undoing both; a
  layer above covering the moved part, while dragged and after; Shift; paint moved off the paper and back; a hidden
  layer; a whole 10000×10000 layer.

## 42. Smart objects and transforming

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - Scaling, turning, skewing and distorting make **smart objects**, like Photoshop's: a layer that keeps its original
    pixels and where its corners are, so transforming it again and again never loses anything. I chose this over a
    plain transform, which works out the pixels again from the last result every time.
  - **Ctrl+T**, or **Transform** in the bar of the move and selection tools, starts a transform. On a smart object, it
    transforms it. On a normal layer (my choice), the selected part goes into a new layer above as a smart
    object, or, with nothing selected, the whole layer becomes one. Browsers keep Ctrl+T for a new tab, so there only
    the button works; the desktop app will have the key.
  - The handles (my choice, with skewing and distorting in this stage too): a corner scales both ways and a side
    one way, from the opposite corner or side (Shift keeps the proportions, Alt scales from the middle); outside the
    object turns it (Shift: in steps of 15°); inside moves it, by whole pixels. With Ctrl, a corner moves alone
    (distort) and a side moves its two corners (skew). Enter applies it, Esc leaves everything as it was.
  - Since the tray (decision 43), a corner **keeps the proportions** by default: dragging it away makes the object
    bigger and dragging it in makes it smaller, and Shift lets the proportions change, as in Photoshop since 2019.
    I found that the proportions changed too easily by mistake the other way round.
  - **Smooth** (bicubic, for painting) or **Whole** pixels (for pixel art), in the bar while transforming (my
    choice). Each smart object keeps its choice, and it can be changed again later without loss.
  - A smart object can't be painted on, erased or filled, and Clear layer and Delete leave it alone. With those tools
    the bar says so and offers **Convert to pixels**, which makes it a normal layer again (my choice). The move
    tool moves a whole smart object, without loss; the selection doesn't matter on it.
  - Smart objects are saved in `.lyd` files with their original, so they stay smart objects when opened again.
- **Why:**
  - Transforming the same thing several times is common (trying sizes, placing a piece), and each new working out of
    the pixels blurs them a little more. Keeping the original avoids that for good, which is what Photoshop does with
    smart objects and Krita with transform masks.
- **How:**
  - A smart object keeps its source (the layer's tiles when it was made, shared, since tiles never change), the
    rectangle of the source with paint, and the four corners on the paper where that rectangle goes. A homography (a
    3×3 matrix) maps the rectangle to the corners: with a parallelogram it is an ordinary affine map, and with any other
    four corners it gives perspective. The layer's own tiles are the source drawn there, so everything else (the
    screen, the eyedropper, the fill bucket, exporting) works with them as with any layer.
  - The source is drawn on the graphics card in blocks of 4×4 tiles, each copied with a border of 2 pixels from the
    blocks around it, so that blocks join without seams. A shader takes every pixel of the paper back to the source
    through the inverse homography, which gets perspective exactly right, and works out its color from the 16 pixels
    around that point (Catmull-Rom, kept from going past the colors around it) or from the one pixel there.
  - While it is transformed, the screen shows it like a move (decision 41): the projection tiles where the layer has
    paint, or where layers above have paint, are shown as their "below" tile and the layers above, with the object
    drawn by the shader between them. A new position of the handles only changes the four corners of each block and
    one matrix.
  - Once applied, the object is drawn into the layer's tiles on the graphics card and read back into RAM in the
    background, like a stroke (decision 15). The tiles are put together out of sight and shown all at once.
  - In a `.lyd` file (version 3), a smart object's layer also has its source's tiles, the rectangle with paint, the
    corners and whether it is smooth. A tile that the layer and its source share is stored once. Drawings without smart
    objects are still saved as version 2, which Lydia 0.7 can open. A file whose corners would fold the object over
    itself is a damaged file.
  - An undo step of a layer's pixels can keep the layer's smart object from before. A selected part becoming a new
    layer is a group of steps (the part taken out, the new layer, the selection gone, the object drawn), undone and
    redone as one.
  - Shrinking a lot can make fine details flicker into jagged ones, since each pixel only looks at the 16 source pixels
    nearest to it. Smoothing those first is noted for later.
- **Measured (RTX 4060 Ti, 10000×10000, a layer with pixels in all 1600 tiles):** the handles show 0.45 s after a
  transform starts; a frame while the handles are dragged takes 3 ms (12 ms when each tile was drawn on its own, before
  the blocks); applying takes 0.35 s; the longest frame on the way was 35–49 ms. Scaled to a quarter and back, a
  smart object has its exact pixels again.
- **Checked:** the button and the bar; making a smart object and scaling it, shown while dragged; moving it; undo and
  redo; Esc; scaling it to a quarter and back without loss; whole pixels making no new soft edges; turning it; Ctrl on
  a corner; the brush stopped on it, Convert to pixels and its undo; the move tool on it; a selected part going into a
  new layer, and one undo putting everything back; a whole 10000×10000 layer. Saving and opening: version 3 with a
  smart object and version 2 without; the smart object, its whole pixels and the image the same once opened; its exact
  original pixels back at its first size; a file from before; corners folded over themselves.

## 43. Importing images: the tray

- **Date:** 2026-10-23
- **Status:** adopted
- **Decision:**
  - Images are imported into a **tray**: a panel that the **Tray** button, at the foot of the tool column, opens
    floating over the drawing and closes again (my choice). Images are added with Import… in it, or by dropping
    their files anywhere on the window, which opens it. From there, an image is dragged onto the drawing as often as
    needed, without importing it again.
  - An image dragged onto the drawing goes in as a **smart object** (decision 42), centered where it was dropped,
    with the handles already showing (my choice), like Photoshop's Place: it can be moved, scaled, turned or
    distorted right away. Enter puts it into a new layer above the active one, named after the file, as one undo
    step; Esc leaves it out. An image file dropped straight onto the drawing also goes into it there.
  - The tray is kept **only while Lydia is open** (my choice): it stays the same from one drawing to the next,
    and is empty again after the page is closed or reloaded. It isn't saved in `.lyd` files.
  - An image bigger than the paper is **made smaller to fit it** (my choice), keeping its proportions.
- **Why:**
  - Reference pictures, textures and pieces used again and again are common in drawing, and finding the file each time
    is slow. Going in as a smart object keeps the image's pixels however it is scaled while placing it.
- **How:**
  - The tray keeps each image's file, which is compressed and small, and a small picture of it to show (160 pixels on
    its longer side). The image is decoded again each time it goes into a drawing, so the tray never holds big images
    in memory.
  - Dragging uses the browser's own drag and drop, carrying only the image's number in the tray. Only the drawing
    takes it, and not the tray itself, which floats over the drawing.
  - The image's pixels become its source's tiles, with its top left corner at the paper's, made premultiplied (canvas
    pixels aren't), a few tiles every frame; the corners put it where it was dropped, on whole pixels, so at 100% its
    pixels are its own. It is shown like any transform (decision 42), between the active layer and the layers above,
    which is where it goes; a hidden active layer stays hidden meanwhile.
  - A smart object's source is on the paper's grid of tiles, so it can't be bigger than the paper: that is why a
    bigger image is made smaller first (by the browser, at its best quality). Scaling it up past the paper's size later
    is softer than the file. Letting layers go past the edge of the paper, noted for later (paint moved off the paper
    is lost too), would remove this limit.
- **Measured (headless browser, 10000×10000):** a 6000×6000 image shows with its handles 0.8 s after it is dropped and
  is put in 0.25 s after Enter.
- **Checked:** the button opening and closing the tray; images dropped on the window going into it, and one dropped on
  the drawing also going into it; dragging from the tray, centered where dropped, with its own pixels (also half
  transparent ones) once in, in a new smart object layer above named after the file; one undo taking it out, and redo;
  the same image going in again; Esc; scaling it with a corner before Enter; an image bigger than the paper; a hidden
  active layer; a second image waiting for the first; taking an image out of the tray; a file that isn't an image; the
  tray staying for the next drawing.

## 44. A dark mode

- **Date:** 2026-10-25
- **Status:** adopted
- **Decision:**
  - Lydia's interface can be light or dark. **Interface** on the start screen chooses **System** (as the computer is
    set, changing with it), **Light** or **Dark** (my choice). It starts on System, and the browser remembers it.
  - The gray around the paper gets darker in dark mode, as in Photoshop and Krita (my choice). The drawing, the
    Brush Designer's test area and the squares of a transparent paper are paper, and keep their colors.
  - It came first in the roadmap, before the Painting stage: every new screen would have added colors to change.
- **Why:**
  - Painters spend hours in front of the screen, often with little light around, and the programs they know are
    dark. A light interface around a drawing also makes its colors look darker than they are.
- **How:**
  - Every color of the interface is a CSS variable, with a light and a dark set. `color-scheme` makes the browser's
    own buttons, fields, lists and windows light or dark too, so they need no colors of their own.
  - `theme.ts` keeps the choice, follows the computer's setting while it is System, and puts the colors on the page
    (`data-theme` on its root) before anything is shown. Until Lydia starts, the page follows the computer.
  - The gray around the paper is drawn by the graphics card, so the engine reads it from the CSS (`--around-paper`)
    whenever the colors change.
  - The brushes' sample strokes are black on a transparent canvas; on a dark card they are shown inverted, white.
- **Checked:** System following the computer as it changes, Light and Dark against it, the choice remembered after
  a reload; the gray around the paper in the editor and the Brush Designer, in both; the sample strokes; screenshots
  of the start screen, the editor with the tray and the Brush Designer in dark mode, and the editor in light mode, the
  same as before.

## 45. The brush's outline

- **Date:** 2026-10-25
- **Status:** adopted
- **Decision:**
  - With the brush or the eraser, the outline of the brush's **tip** follows the pointer, in its shape and turned as
    it paints (my choice), like in Krita and Photoshop: Calligraphy shows a thin slanted ellipse, Dashes a bar that
    turns with the stroke while painting. The Pixel brush's outline goes along the edges of the pixels it would
    paint there.
  - It shows the brush's **full size**, the size at full pressure, and doesn't change with the pen's pressure while
    painting (my choice), as in Photoshop.
  - It takes the cursor's place. When the brush is **smaller than 8 pixels on the screen**, the cursor's cross shows
    instead (my choice), so the point where it paints can still be seen.
  - The **Outline** button in the bar, next to Grid, turns it off and on (my choice), in the editor and the Brush
    Designer; the browser remembers it.
  - It was the first item of the Painting stage, the smallest one and the one used all the time.
- **Why:**
  - Without it, the size of the brush is only known after painting. The shape matters too: a brush that isn't round
    paints differently in each direction.
- **How:**
  - Browsers draw cursors only up to 128 pixels, and a brush can be far bigger on the screen. So the graphics card
    draws the outline, over everything, from where the pointer is, turned and flipped with the view. It is drawn again
    only when what it shows changes: where the pointer is, the size, the angle, the tip or the view.
  - A tip's outline is worked out once, from its picture: shrunk to at most 64 squares across, the outline goes where
    the tip paints 5% of the most it paints anywhere (marching squares). So a soft tip's outline is nearly as big as
    all it paints, and the small holes of a grainy tip (Chalk) don't show. Loops around tiny specks are left out, and
    each loop keeps only the points needed to follow its shape.
  - The random parts of a brush aren't shown: the random turn of each dab (Chalk), its scatter and the noise that
    goes past the tip (Sponge).
- **Checked:** the outline over the paper and the cursor hidden; its size against the brush's; centered on the
  pointer and following it; hidden off the drawing, with Space, with other tools and below 8 pixels (the cross
  then); the eraser; redrawn bigger when zooming in; Calligraphy turned; Dashes across before painting and turned
  down while painting downward; the Pixel brush at 3200% along the edges of its pixels; the Outline button off and
  on, remembered; screenshots of the outline over a dab of each brush.

## 46. The stabilizer

- **Date:** 2026-10-25
- **Status:** adopted
- **Decision:**
  - A stabilizer smooths the strokes of the brush and the eraser, in **two ways** to choose from (my choice), as
    Photoshop and Krita have:
    - **Smooth**: the brush chases the pen, closing part of the distance at every moment, so it lags behind and cuts
      the wobbles and the corners; when the pen holds still, the brush keeps going until it reaches it;
    - **String** (Photoshop's "pulled string"): the brush doesn't move while the pen stays within a string's length,
      and is pulled straight behind it when the pen goes further.
  - Its **strength**, from 0 (off) to 100, is a slider in the bar, the same for every brush (my choice), and the
    browser remembers it with the way chosen. It starts off. (Moved into the Advanced panel the same day, decision
    47.)
  - When the pen comes up, the stroke goes on straight to where it left (my choice), like Photoshop's "catch-up", so
    lines end where they were drawn to.
  - While the brush lags, the outline (decision 45) is where the brush is, which is where the paint goes, and a line
    joins it to the pen (my choice), as in Krita.
- **Why:**
  - Steady lines and smooth curves are hard by hand, more so with a mouse or a small tablet; the stabilizer is one of
    the settings painters change the most. The two ways suit different work: Smooth for painting and sketching, String
    for clean lines that must not wobble at all.
- **How:**
  - The stabilizer sits between the pointer and the brush (`stabilizer.ts`): it gets the pen's points and gives back
    the points the brush passes through, with the pressure, and the brush places its dabs along them as before.
  - Smooth works in time, not in points, so it lags the same however many points the browser sends: in every
    millisecond, the brush closes the same share of its distance to the pen. At full strength it closes about two
    thirds of it in 0.3 s, and that time grows with the square of the strength, so the low strengths, for a light
    touch, get more of the slider. The brush is worked out every 4 ms along the line between two points of the pen,
    so it draws a curve and not a few jumps, and every frame while the pen holds still.
  - The string's length is measured on the screen (up to 80 pixels), so it feels the same at any zoom.
  - The bar's two rows: the strength slider and the two ways made the brush's settings too long to share a row with
    the actions at 1600 pixels across, so the drawing area got shorter whenever the brush was chosen, and the drawing
    jumped. The fill bucket's settings already did that. Now the tool's settings always have the first row and the
    actions the second, and the drawing area keeps its size with every tool.
- **Checked:** the slider showing with the brush and the eraser only; a shaky line drawn with Smooth at 60 wobbling
  5 pixels instead of 25, and ending where the pen came up; with the pen held still, the brush first behind it, then
  reaching it; the line from the brush to the pen; String not moving within the string, pulled behind the pen beyond
  it, catching up when the pen comes up; 0 painting right under the pen; the settings remembered; the drawing area's
  height the same with every tool and while transforming.

## 47. Tapered stroke ends, and the Advanced panel

- **Date:** 2026-10-25
- **Status:** adopted
- **Decision:**
  - The ends of every stroke of the brush and the eraser can **taper**: **Taper start** and **Taper end**, two
    sliders (my choice), say over how many **pixels of the paper** (my choice) the stroke thins out from its start and
    before its end, from 0 (not at all) to 500. **Thins** chooses what thins out: the **Size**, the **Opacity** or
    **Both** (my choice). They are the same for every brush, like the stabilizer (my choice), and the browser
    remembers them.
  - The end can only thin out once the pen comes up, when the stroke's length is known, so it does then, as in Clip
    Studio Paint. A stroke shorter than both tapers has them shortened alike until they meet; a click, with no length,
    paints a whole dot.
  - The stabilizer and the taper are under **Advanced** (my idea): a button in the bar of the brush and the eraser
    that opens a panel over the drawing. Clicking elsewhere or Esc closes it, and a click on the drawing then only
    closes it, without painting. Its pin keeps it open, also the next time (my idea). With the taper, the brush's
    settings no longer fitted in the bar's first row: at 1600 pixels across, and less on a 1366 laptop, it would have
    taken a second row again, and the drawing would jump when changing tools (decision 46).
- **Why:**
  - Tapered ends give lines the look of ink, and are what a pen's pressure gives for free; with a mouse, or a light
    hand, they are the only way to get it. ibisPaint and Clip Studio have them.
- **How:**
  - The taper is part of working out the dabs (`dabs.ts`): each dab knows how far along the stroke it is, and gets a
    share of its size or paint that grows evenly from 5% at the tip to all of it at the taper's length. The spacing
    between dabs follows the thinner size, so a thin tip has no gaps.
  - For the end, the brush keeps the stroke's points. When the pen comes up, it works the whole stroke out again,
    now knowing its length. The random parts of a brush (its scatter, its turns, its noise) come from numbers drawn
    from a seed kept for each stroke instead of `Math.random`, so the stroke worked out again is the same, dab for
    dab, up to where the taper changes it. Only the tiles touched by the dabs from there on are painted again, from
    the start, in the stroke's own tiles (decision 36), before the stroke goes into the layer, so it is still one undo
    step. A stroke with no taper is not worked out again.
- **Checked:** Advanced opening with the stabilizer and the taper, a click on the drawing only closing it, Esc, pinned
  staying open and painting, gone with other tools and back with the brush, the drawing area's size unchanged; Taper
  start thin at the start and full past 100 pixels; Taper end full while painting and thin at the end once the pen
  came up; one undo and redo of a tapered stroke; Thins Opacity fainter but as wide; a stroke shorter than both tapers;
  a click; the Pixel brush, Chalk (with noise and random turns) and Soft round tapered (screenshot); a stroke of 300
  points ending in 0.14 s; the settings remembered.

## Open questions

### Thin diagonal lines (seen once)

- **Date:** 2026-10-22
- **Status:** open
- **What was seen:** zoomed in a little on a drawing with big strokes (size 500, mouse), thin lines one pixel wide
  appeared inside the strokes of the top layer, all exactly at 45° (down to the right), one per dab of the brush. On
  them the layer looked ~10% see-through. That matches the diagonal where the graphics card splits each dab's square
  into two triangles.
- **What was tried:** big and fast strokes, changing pressure, undo and redo, moving the layer, the opacity slider,
  sending the layer to RAM and back, and zoom levels from 0.3× to 2.5×, on the same graphics card, headless and in a
  visible window: no lines. I couldn't make them appear again either.
- **Next time:** save the project with the lines on screen (to see whether they are in the layer's pixels or only on
  the screen), and write down what was done just before.

### Phone or desktop?

- **Date:** 2026-10-19
- **Status:** answered (2026-10-22)
- **Question:** the artist friend drew on a phone, while Lydia is desktop only (decision 2). Does the friend draw on a
  computer too?
- **Answer:** yes: the friend built a computer and left the phone for it. Lydia stays desktop only.

### A typical drawing of the artist friend

- **Date:** 2026-10-19
- **Status:** open
- **Question:** how big are the friend's canvases, and how many layers does a typical drawing have? The memory Lydia
  needs grows with both (decisions 9 and 11).

### Margins when printing

- **Date:** 2026-10-22
- **Status:** open
- **What was seen:** an A4 drawing printed on an A4 sheet still comes out with white margins, even after exported
  images got their resolution (decision 32).
- **Most likely cause:** the printer. Most printers can't print the last 3–5 mm of the sheet, and print programs
  shrink the image to fit inside what the printer can reach. Only borderless printing avoids it, and not every
  printer has it (it often needs photo paper; laser printers rarely have it).
- **Next time:** measure the drawing's width on the printed sheet. About 20 cm with white on all four sides means the
  print program shrank it; 21 cm with the drawing's edges cut off means it printed at its size and the printer just
  can't reach the edges. Then look for a borderless option in the printer's settings, and write down the printer's
  model and the program used to print.
