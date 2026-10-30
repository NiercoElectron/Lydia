# Changelog

Every version of Lydia and what changed in it, newest first. A version comes out when a stage of the roadmap is
finished, as the next middle number; the last number is for fixes to a version already out (until 0.8.5 it went up
with each small feature) ([decision 20](docs/decisions.md#20-version-numbers)). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **A color panel**, at the top right, in place of the browser's color picker
  ([decision 65](docs/decisions.md#65-the-color-panel)): a ring of hues around a triangle of the hue's shades, which
  turns with it; the brush's color and a background color, swapped with **X**; the color's code (#rrggbb); H, S and V
  sliders; and the colors painted with lately, kept for the next time.
- **A color tray** ([decision 66](docs/decisions.md#66-the-color-tray)), opened from the color panel: colors kept on
  purpose to pick again quickly, which stay until taken out. One list for all drawings, kept by the browser, and one
  for each drawing, saved in its file.

## [0.12.0] - 2026-10-29

### Added

- The **magic wand** (W) ([decision 64](docs/decisions.md#64-the-magic-wand)): it selects the area around the point
  clicked whose colors are close to the color there, found like the fill bucket's, with settings of its own:
  Tolerance, Look at, Expand (into the soft edge of the lines, so coloring inside leaves no light rim) and
  **Contiguous**, which off selects a color everywhere in the drawing. Shift adds and Alt takes away.
- Spanish throughout the interface and release history, with an Español option and automatic detection of
  Spanish system language variants such as es-ES, es-MX and es-AR.
- Brazilian Portuguese throughout the interface, including the Brush Designer and the release history.
  The start screen offers System, Português (Brasil) and English, remembers the choice, and detects Portuguese from
  the browser's preferred language. New layer and folder names use the chosen language; user names stay unchanged.
- **Error codes**: every error message starts with a code, like LYD-201, and stays in English whatever the
  language, so that it can be looked up in [docs/errors.md](docs/errors.md) or given in a report
  ([decision 63](docs/decisions.md#63-lydia-in-portuguese-and-spanish)). An error Lydia didn't expect is told under the
  code of what was being done, with its cause in parentheses.

## [0.11.1] - 2026-10-29

### Changed

- The **opacity shows live** while its slider moves whatever the blend modes of the layer, of the layers above it and
  of the folders it is in, clipped or not, and for a folder too
  ([decision 60](docs/decisions.md#60-the-live-opacity-with-any-blend-mode)). It used to be put together again a few
  tiles at a time, showing late on big drawings.
- **Moving and transforming show as they will be** while dragged, whatever the blend modes, the opacity, clipping
  and folders ([decision 61](docs/decisions.md#61-showing-a-move-as-it-will-be)). They used to show some layers as
  Normal, or clipped ones whole, until let go.
- On big drawings, the move starts showing at once (it took a few frames, which skipped), a new position costs a
  few milliseconds, and the live opacity is drawn faster too. Once a move is let go, a **bar** next to "Moving…" shows
  how far it is from being put down.
- The fill bucket's **All layers** sees the layers as the screen shows them, with blend modes, clipping and folders
  ([decision 62](docs/decisions.md#62-the-fill-bucket-sees-the-layers-as-they-show)): paint that doesn't show, like
  a clipped layer's outside its base, no longer stops the fill.

## [0.11.0] - 2026-10-28

### Added

- **Duplicate** (Ctrl+J) and **Merge down** (Ctrl+E) in the layers ([decision 54](docs/decisions.md#54-duplicating-and-merging-layers)).
  A copy costs no memory until it is painted on; merging keeps the picture as it was, as one step of undo.
- **Locking a layer's transparency**, with the lock in its row ([decision 55](docs/decisions.md#55-locking-a-layers-transparency)):
  the brush and the fill bucket then only color the paint already there, and the eraser can't be used. It is saved
  with the drawing.
- **Blend modes** for layers ([decision 56](docs/decisions.md#56-blend-modes)): Multiply, Screen, Overlay, Add, Darken,
  Lighten, Color Dodge, Color Burn, Soft Light, Hard Light, Difference, Hue, Saturation, Color and Luminosity, in a
  list above the opacity. Merging down uses them too.
- **Clipping masks** ([decision 57](docs/decisions.md#57-clipping-masks)): the clip in a layer's row (or Ctrl+Alt+G)
  makes it show only where the layer under it has paint, to color and shade inside the lines.
- **Folders of layers** ([decision 58](docs/decisions.md#58-folders-of-layers)), folders in folders too: New folder,
  Ctrl+G, dragging layers onto a folder to put them in. A folder lets what is in it pass through, or takes a blend
  mode of its own; it can be hidden, faded, clipped, copied, merged into one layer, deleted and moved with the move
  tool as one.

### Fixed

- Dragging quickly in the color picker made it stutter: the whole screen was drawn again for each step of the drag.
  Now it is drawn again at most once a frame.

## [0.10.0] - 2026-10-26

### Added

- **What's New?** on the start screen, at the right: what changed in each version, read from this changelog, the
  newest open and the others closed below it.
- A layer with paint off the paper has an icon in the layers that shows that paint, faded, around the paper, and hides
  it again ([decision 50](docs/decisions.md#50-showing-paint-off-the-paper)). It is off at first, and kept with the
  drawing.
- Pixel-perfect strokes ([decision 51](docs/decisions.md#51-pixel-perfect-strokes)). With a pixel brush, the
  **Pixel-perfect** button in the bar leaves out the doubled corners of lines drawn by hand, so each step of a line is a
  single pixel. It works at every size and with pixel brushes drawn in the Brush Designer, is off at first, and the
  browser remembers it.
- Straight lines ([decision 52](docs/decisions.md#52-straight-lines)). With the brush or the eraser, **Shift + click**
  paints a straight line from where the last stroke ended, shown while Shift is held; with **Ctrl** too, it keeps to
  the clean angles of pixel art (1:1, 2:1, 3:1…) with a pixel brush, or to every 15° with the others. A pixel brush's
  line has one pixel in each column, in steps as even as its angle lets them be.
- Exporting enlarged ([decision 53](docs/decisions.md#53-exporting-enlarged)). **Scale**, next to the exports, makes
  the PNG or JPEG 2, 3, 4, 6 or 8 times bigger, each pixel a sharp square, for pixel art. Each drawing keeps its
  choice. The image's resolution goes up as many times, so it prints at the same size, and its name says it
  (`@4x`). The scales a big drawing wouldn't fit at aren't offered.

### Changed

- Layers can have paint off the paper ([decision 49](docs/decisions.md#49-layers-off-the-paper)). Paint moved off the
  paper, with the move tool or a transform, is kept, hidden, and comes back when it is moved onto the paper again;
  meanwhile it shows faded around the paper. An image bigger than the paper keeps its size. Paint off the paper is
  saved: such a drawing is a version 4 `.lyd` file, which earlier versions of Lydia can't open (a drawing without any
  is saved as before).

### Fixed

- A stroke over the soft edge of a selection faded there the longer it went on in the same place, since the edge was
  cut out of it again at every movement of the pen ([decision 40](docs/decisions.md#40-selections)). Now it gets as
  much paint there as the edge lets through.

## [0.9.0] - 2026-10-25

### Added

- The brush's outline ([decision 45](docs/decisions.md#45-the-brushs-outline)). With the brush or the eraser, the
  outline of the brush's tip follows the pointer instead of the cursor: in its shape, as big as it paints at full
  pressure, and turned as it paints (Dashes turns with the stroke). The Pixel brush's outline goes along the pixels it
  would paint. Smaller than 8 pixels on the screen, the cursor's cross shows instead. The **Outline** button, next to
  Grid, turns it off and on.
- A stabilizer, for smoother strokes ([decision 46](docs/decisions.md#46-the-stabilizer)). **Stabilizer**, under
  **Advanced** in the bar of the brush and the eraser, from 0 (off) to 100, chooses how strong it is, for every brush, and the browser remembers
  it. **Smooth**: the brush chases the pen, lagging behind it, and keeps going when the pen holds still. **String**: the
  pen pulls the brush on a string, which only moves when the pen goes further than the string. When the pen comes up,
  the stroke goes on to where it left. While the brush lags, a line joins it to the pen.
- Tapered stroke ends ([decision 47](docs/decisions.md#47-tapered-stroke-ends-and-the-advanced-panel)). **Taper
  start** and **Taper end**, under **Advanced**, thin out the stroke over that many pixels of the paper from its start
  and before its end, with the mouse too. **Thins** chooses what: the **Size**, the **Opacity** or **Both**. The end
  thins out once the pen comes up. A stroke shorter than both tapers has them shortened to meet; a click paints a
  whole dot.
- **Advanced**, in the bar of the brush and the eraser: a panel, opened over the drawing, with the settings changed less
  often (the stabilizer and the taper). Clicking elsewhere or Esc closes it; its pin keeps it open, also the next time.
- Pixel brushes drawn in the Brush Designer ([decision 48](docs/decisions.md#48-pixel-brushes-drawn-in-the-brush-designer)).
  On the start screen, **Pixel** opens the Designer on a small paper (16, 32 or 64 pixels), zoomed in with the pixel
  grid, to draw the tip pixel by pixel with the Pixel brush. The new brush paints its tip as it was drawn, every
  pixel fully or not at all, at 1×, 2×, 3×… its size, the nearest to the brush size; choosing it sets the size to 1×.
  Its outline goes along its pixels. Versions of Lydia before this one open these brushes as smooth brushes.

### Changed

- The settings of the chosen tool always have the bar's first row, and the actions (Undo, the view, Export…) the
  second, so the drawing area no longer changes size, and the drawing no longer jumps, when another tool is chosen.

### Fixed

- Opening the Brush Designer a second time made its test area fail on the first stroke, and the whole screen with it
  ([decision 30](docs/decisions.md#30-the-brush-designer)).

## [0.8.5] - 2026-10-25

### Added

- A dark mode ([decision 44](docs/decisions.md#44-a-dark-mode)). On the start screen, **Interface** chooses
  **System** (as the computer is set, changing with it), **Light** or **Dark**, remembered by the browser. The gray
  around the paper gets darker too; the drawing never changes color.

## [0.8.4] - 2026-10-25

### Added

- The value of every slider can be typed in: clicking the number next to it turns it into a field. Enter, or clicking
  elsewhere, keeps the value (within the slider's range), and Esc leaves it as it was. The view's zoom and angle in the
  bar can be typed in the same way, and change around the middle of the screen.

## [0.8.3] - 2026-10-25

### Added

- A saved drawing opens as it was shown: with the same zoom, angle and flip, and the same part of it in the middle of
  the screen ([decision 38](docs/decisions.md#38-turning-and-flipping-the-view)). Before, it always opened straight,
  showing the whole paper.
- The start screen shows Lydia's version next to its name.
- A guide to every tool and shortcut, [docs/guide.md](docs/guide.md). The README links to it in place of its own
  table of shortcuts.

## [0.8.2] - 2026-10-23

### Added

- Importing images, with a tray to keep them in ([decision 43](docs/decisions.md#43-importing-images-the-tray)). The
  Tray button, at the foot of the tool column, opens it over the drawing and closes it again. Images go into it with
  Import… or by dropping their files on the window, and are dragged from there onto the drawing as often as needed.
  An image goes in as a smart object where it was dropped, with the handles showing: Enter puts it into a new layer
  above, named after the file, and Esc leaves it out. An image bigger than the paper is made smaller to fit it. The
  tray stays while Lydia is open, from one drawing to the next.

### Changed

- A transform's corner handles keep the proportions: dragging one away makes the object bigger, and dragging it in
  makes it smaller. Shift lets the proportions change (before, Shift kept them), as in Photoshop.

## [0.8.1] - 2026-10-23

### Fixed

- The Pixel brush paints the next pixel as soon as the pen enters it, wherever in its pixel a stroke started. Before,
  depending on that, the pen sometimes had to go past the middle of the next pixel before it was painted.

## [0.8.0] - 2026-10-23

The basic tools: a tool column, the eyedropper, turning and flipping the view, the fill bucket, selections, the move
tool, and smart objects that can be transformed without loss.

### Added

- A column of tools at the left edge of the editor, with icons, like in Photoshop and Krita
  ([decision 37](docs/decisions.md#37-a-tool-column-and-the-eyedropper)).
- An eyedropper (I): it picks the color the screen shows, with every visible layer, by clicking or dragging over the
  drawing, and sets the stroke's Opacity back to 100%. Holding Alt with the brush or the eraser picks colors too.
- Hand (H), zoom (Z) and rotate view (R) tools ([decision 38](docs/decisions.md#38-turning-and-flipping-the-view)).
  The zoom tool zooms in with a click, out with Alt + click, and smoothly by dragging to the right or the left. The
  rotate tool turns the view by dragging around the middle of the screen, in steps of 15° with Shift. Holding
  Shift + Space turns the view with any tool, as in Krita.
- Flipping the view like in a mirror, with M or the **Flip** button. The drawing itself doesn't change.
- The bar on top shows the view's zoom and angle, with **Straighten** (back to 0°) and **Flip** next to **Fit**.
- A fill bucket (F) ([decision 39](docs/decisions.md#39-the-fill-bucket)): it fills the region around the point
  clicked with the color and the Opacity. In the bar: **Tolerance**, whether it looks at **All layers** or only
  **This layer**, and **Expand**. Past the region, the fill goes behind the soft edge of the lines around it, up to
  where they are darkest (at most **Expand** pixels): no light rim is left, and a line keeps its soft edge even on
  the same layer as the color. On big drawings it works for a moment in the background, with "Filling…" in the bar,
  while the screen keeps going. Holding Alt with it picks a color.
- Selections ([decision 40](docs/decisions.md#40-selections)): **Rectangle select** (S) and **Lasso** (L), shown with
  marching ants. Shift + drag adds to the selection, Alt + drag takes away from it, and a click selects nothing. Their
  edges are soft, or hard (whole pixels, for pixel art) with a button in the bar; choosing a pixel brush makes them
  hard, and another brush soft again. The brush, the eraser and the fill bucket only work inside the selection, and
  Delete takes out what is inside it. Ctrl+A selects everything, Ctrl+D nothing, and Ctrl+Shift+I or **Invert** what
  wasn't selected. Every change of the selection can be undone.
- A move tool (V) ([decision 41](docs/decisions.md#41-moving-paint)): it drags the selected part of the active layer,
  or the whole layer when nothing is selected, by whole pixels, and the selection moves along. Shift keeps it level or
  upright. While it is dragged, the screen shows it at its new place, under the layers above. Paint moved off the paper
  is lost. Each move is one step of undo, together with the selection.
- Smart objects and transforming ([decision 42](docs/decisions.md#42-smart-objects-and-transforming)): Ctrl+T, or
  **Transform** in the bar of the move and selection tools, turns the selected part into a new layer, or the whole
  layer, into a smart object, which keeps its original pixels. Its handles scale it (Shift keeps the proportions, Alt
  scales from the middle), turn it from outside (Shift: in steps of 15°) and move it from inside; with Ctrl, a corner
  distorts it and a side skews it. Enter applies, Esc cancels. **Smooth** or **Whole** pixels (for pixel art) in the
  bar. Transforming it again never loses anything, and the move tool moves it without loss. It can't be painted on
  until **Convert to pixels**. Smart objects are saved in `.lyd` files with their original; drawings without them are
  still saved so that Lydia 0.7 can open them.

### Changed

- The Brush and Eraser buttons moved from the bar on top to the tool column.
- **Fit** (Ctrl+0) keeps the view turned and flipped, and fits the turned paper on the screen.
- While Space is held, the cursor is a hand.
- Tiles of a single color are sent to the graphics card without their pixels: the graphics card fills them with the
  color.
- The marching ants of a new selection show sooner: the pictures of its edge are made about 9 times faster.

## [0.7.0] - 2026-10-23

Brushes with filtered noise, and strokes painted in tiles of their own.

### Added

- Brushes with filtered noise ([decision 35](docs/decisions.md#35-brushes-with-filtered-noise)): random numbers,
  filtered the same way, make every dab different while the brush keeps its character. In the Brush Designer: the
  amount, the grain, layers of finer grains, the stretch, the contrast, whether the noise changes with each dab or
  each stroke, and how it forms each dab: mixed with the tip, as whole drops of paint, or wearing the tip away from
  its edge. Two new brushes use it: Bristles and Sponge.
- An Opacity slider for each stroke, and brushes that "wash" (a setting in the Brush Designer): a stroke doesn't pile
  up over itself ([decision 36](docs/decisions.md#36-strokes-are-painted-in-tiles-of-their-own)).

### Changed

- The brush previews, in the list and in the Brush Designer's test area, are painted by the graphics card with the
  same code as the drawing.

### Fixed

- The eraser no longer leaves empty tiles where there was no paint.

## [0.6.0] - 2026-10-23

### Added

- A **Pixel** brush, for pixel art ([decision 33](docs/decisions.md#33-the-pixel-brush)). It paints whole pixels with
  hard edges, from 1 pixel up, with a round tip worked out for each size (a plus at size 3). A straight line paints
  one pixel in each column, and the pen's pressure changes the size a pixel at a time. Its sample stroke in the brush
  list shows its pixels.
- A pixel grid ([decision 34](docs/decisions.md#34-a-pixel-grid)): from 800% zoom, lines between the pixels, in a
  color worked out from what is under them, so they show on any color. The **Grid** button (or G) turns it off and
  on, and Lydia remembers the choice.

### Fixed

- The `[` key makes the brush smaller down to size 1. Before, it stopped at 2.

## [0.5.2] - 2026-10-22

### Added

- A resolution (DPI) for each drawing, chosen in the New project window (300 DPI at first, with buttons for 72, 150,
  300 and 600). Paper sizes follow it, and the window shows the drawing's size on paper. Projects keep it when they
  are saved; older projects are 300 DPI.

### Fixed

- Exported PNG and JPEG images say the drawing's resolution, so a drawing made with a paper size prints at that size
  (an A4 drawing is 21×29.7 cm) and other programs open it at its size on paper
  ([decision 32](docs/decisions.md#32-each-drawing-has-a-resolution-dpi)). Before, programs had to guess, and shrank
  the drawing to the page in their own way.

## [0.5.1] - 2026-10-22

### Added

- A background color for new drawings, or a transparent background ([decision 31](docs/decisions.md#31-a-window-for-new-drawings-with-a-background-color-or-none)).
  A transparent background shows gray and white squares on the screen, and exports as a transparent PNG (a JPEG gets
  white instead). Projects keep their background when they are saved; older projects open on white paper, as before.
- Common sizes for new drawings: A5, A4, A3, US Letter, US Legal and Tabloid at 300 DPI, Full HD, 4K UHD and a
  2048×2048 square.

### Changed

- **New project…** opens a window with the size, the common sizes and the background, which remembers the last
  choices.

## [0.5.0] - 2026-10-22

The Brush Designer: make new brushes in Lydia itself.

### Added

- The Brush Designer, opened from the start screen ([decision 30](docs/decisions.md#30-the-brush-designer)). Draw the
  tip of a new brush in black and gray on a paper of 256, 512 or 1024 pixels, choose its settings (spacing, angle,
  turning with the stroke, random angle, scatter, flow and the pen's pressure), and try it in a test area that paints
  your strokes again after every change. **Save to my brushes** adds it to the brush list, chosen and ready in the
  next drawing, and **Export file** saves it as a `.lydbrush` file.

### Fixed

- Shortcuts like Ctrl+Z work right after typing in a text field, such as a layer's name: painting now takes the
  keyboard away from the field.

## [0.4.0] - 2026-10-22

Brushes that are files, so they can be shared and added
([decision 29](docs/decisions.md#29-brushes-are-files)).

### Added

- A brushes panel on the left, with six brushes: Soft round, Hard round, Airbrush, Chalk, Calligraphy and Dashes. Each
  one shows a sample stroke, and the browser remembers the chosen one.
- Brushes are `.lydbrush` files ([decision 29](docs/decisions.md#29-brushes-are-files)). Add brushes with
  **Import…** or by dropping their files on the window, and the browser keeps them. **Export** saves the chosen brush
  as a file, to share it, and **Delete** removes a brush that was added.
- Brushes can turn their tip (at a fixed angle, with the stroke or at random), scatter it, and put down less paint
  with each dab, also following the pen's pressure.

### Changed

- The eraser erases with the chosen brush's tip.

## [0.3.1] - 2026-10-22

### Added

- A choice on the start screen of how much of the graphics card's memory Lydia may use to keep layers ready, from
  0.5 to 8 GB (2 GB by default), each with how many tiles it keeps, and a big warning: too much can crash Lydia or
  slow down the whole computer. The browser remembers the choice.

## [0.3.0] - 2026-10-22

Complete layers, and layer changes that are fast on big drawings
([decisions 25 to 27](docs/decisions.md#25-every-layer-change-can-be-undone)).

### Added

- Delete the active layer with the new **Delete layer** button; the layer under it becomes active.
- Move a layer by dragging it up or down in the list. A line shows where it will go.
- Rename a layer by double-clicking its name. Enter keeps the new name, Escape keeps the old one.
- Undo and redo for every layer change: adding, deleting, moving, renaming, hiding, showing and changing the opacity.
  A whole drag of the opacity slider is a single step.

### Changed

- On big drawings with many layers, layer changes no longer freeze the screen: hiding, showing, moving and deleting
  layers, undoing those changes, and moving or letting go of the opacity slider. The new picture is prepared in the
  background and appears all at once when it is ready, with "Updating…" in the bar meanwhile.
- Layer changes are much faster: the graphics card now keeps up to 8,000 tiles (about 2 GB) instead of 2,000, so
  most changes no longer send the layers to it again. With 4 full layers of 10000×10000, moving a layer went from
  1.3 s to under 0.25 s.

### Fixed

- The opacity slider no longer changes size when the value reaches 100%.

## [0.2.2] - 2026-10-22

### Added

- Export the drawing as a JPEG image, with the new **Export JPEG** button. JPEG files are much smaller than PNG files
  (8.6 MB instead of 138 MB for a 10000×10000 painting) and look the same; PNG is still the choice for keeping every
  pixel exactly ([decision 24](docs/decisions.md#24-exporting-as-jpeg-too)).

## [0.2.1] - 2026-10-22

### Fixed

- A layer's opacity now changes while the slider moves, instead of only after it stops
  ([decision 23](docs/decisions.md#23-the-opacity-changes-live-while-the-slider-moves)).

## [0.2.0] - 2026-10-22

A new drawing engine, made for big drawings with many layers
([decision 5](docs/decisions.md#5-raster-layers-made-of-tiles-drawn-with-pixijs) and the ones after it).

### Added

- Canvases up to 10000×10000 pixels (up to 4096×4096 before).
- Layers panel: add a layer above the active one, choose the layer to paint on, hide and show layers, and change a
  layer's opacity.
- Redo, with the Redo button, Ctrl/Cmd+Shift+Z or Ctrl+Y.
- Zoom (Ctrl + mouse wheel, or pinch on a trackpad) and moving around the drawing (mouse wheel, two fingers on a
  trackpad, Space + drag, or dragging with the middle button). Fit (Ctrl/Cmd+0) shows the whole drawing.
- The pen's pressure changes the brush size.
- Shortcuts: B for the brush, E for the eraser, [ and ] for a smaller or bigger brush.
- The browser asks before closing a tab with unsaved changes.

### Changed

- Drawings are now made of pixels, kept in tiles of 256×256 and drawn by the graphics card (PixiJS and WebGL 2),
  instead of a list of strokes drawn again after every change. Lydia now needs a browser and graphics card that support
  WebGL 2.
- The brush is soft and round.
- Clear became Clear layer, and it can be undone.
- `.lyd` project files have a new format, with the tiles compressed, so big projects save and open quickly.

### Removed

- Projects saved by Lydia 0.1 can no longer be opened; Lydia explains why when you try. Lydia 0.1 is still on GitHub
  to open them ([decision 21](docs/decisions.md#21-a-new-project-file-without-opening-the-old-one)).

## [0.1.0] - 2026-10-22

The first usable version.

### Added

- Start screen: create a new drawing with a custom canvas size (up to 4096×4096), or open a project.
- Freehand drawing with mouse or pen, with smoothed strokes.
- Toolbar with brush color, brush size and eraser.
- Undo, with the Undo button or Ctrl/Cmd+Z.
- Clear the canvas.
- Save and open projects as `.lyd` files.
- Export the drawing as a PNG image.
- Sharp drawing on high-density screens.

[Unreleased]: https://github.com/NiercoElectron/Lydia/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/NiercoElectron/Lydia/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/NiercoElectron/Lydia/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/NiercoElectron/Lydia/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/NiercoElectron/Lydia/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/NiercoElectron/Lydia/compare/v0.8.5...v0.9.0
[0.8.5]: https://github.com/NiercoElectron/Lydia/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/NiercoElectron/Lydia/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/NiercoElectron/Lydia/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/NiercoElectron/Lydia/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/NiercoElectron/Lydia/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/NiercoElectron/Lydia/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/NiercoElectron/Lydia/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/NiercoElectron/Lydia/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/NiercoElectron/Lydia/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/NiercoElectron/Lydia/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/NiercoElectron/Lydia/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/NiercoElectron/Lydia/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/NiercoElectron/Lydia/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/NiercoElectron/Lydia/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/NiercoElectron/Lydia/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/NiercoElectron/Lydia/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NiercoElectron/Lydia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NiercoElectron/Lydia/releases/tag/v0.1.0
