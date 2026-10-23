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
- **Versions:** 0.1.0 was the first usable version, still with strokes stored as data (decision 3); 0.2.0 brought the
  tile engine from the spike into the main app; 0.3.0 completed the layers (delete, move, rename, undo of every layer
  change); 0.4.0 made brushes files that can be shared and added (decision 29); 0.5.0 brought the Brush Designer
  (decision 30). 1.0.0 will be the desktop app, packaged with Electron. The full list is in [CHANGELOG.md](../CHANGELOG.md).
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
  so a change to all of them can't be instant, but the screen must never freeze, and Enrico prefers a change that
  appears at once. Sending fewer tiles is still open: unpacking in workers (decision 14), batches (decision 18), a
  bigger cache on cards with more memory.

## 27. A bigger graphics card cache, used in a better order

- **Date:** 2026-10-22
- **Status:** adopted
- **Problem:** even prepared in the background (decision 26), a layer change on Enrico's drawing (4 full layers) took
  0.7–1 s to appear, which Enrico found too slow. With 4 full layers of 10000×10000 (6,400 tiles), each change
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
- **Why:** Enrico's card has 8 GB, and so does the friend's RTX 3050. Cards with 4 GB or less may get slower, since
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
  - It was Enrico's idea: brushes that can be shared and added just by moving a file, like the brushes of Krita
    and Procreate.
  - **Only data, never code.** Brush files will come from anywhere, so nothing in a file is ever run. Before using a
    file, Lydia checks it: the tip must be a PNG of up to 1024×1024 with some paint in it, the numbers must be within
    limits, and the version must be one Lydia knows.
  - JSON keeps the settings readable, and lets the format grow: a missing field takes its usual value, and an unknown
    one is left alone.
  - A web page can't look into a folder of the computer by itself. Chrome and Edge can open a folder the user picks,
    but they ask for permission again at every visit, and Firefox and Safari can't do it at all. Importing works in
    every browser, so Enrico chose it for the web version.
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
  - It was Enrico's idea, together with brushes as files (decision 29).
  - A screen of its own was Enrico's choice, over a window on top of the drawing. It keeps the Designer simple: the
    drawing and the Designer never run at the same time, nor share the keyboard.
  - Left out for now, also Enrico's choice: opening an existing brush to change it, using an image as the tip, and
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
  - It was Enrico's request, and so was remembering the last choice. A choice of resolution (DPI) and a button to
    swap width and height were left out, also by Enrico's choice: another resolution can be typed in.
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
- **Problem:** Enrico printed an A4 drawing (2480×3508 pixels, made with the A4 size of decision 31) on an A4 sheet,
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
- **Why:** at first every image was going to say 300 DPI, the resolution of the paper sizes, which Enrico chose over
  a resolution for each drawing. Then it showed that a size typed in for another resolution (an A4 at 150 DPI) would
  print at half its size, and Enrico chose to add the resolution right away. The screen ignores it: it only matters
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
  visible window: no lines. Enrico couldn't make them appear again either.
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
