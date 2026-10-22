# Changelog

Every version of Lydia and what changed in it, newest first. The middle number goes up with each big stage, and the
last one with each small fix or feature ([decision 20](docs/decisions.md#20-version-numbers)). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/NiercoElectron/Lydia/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/NiercoElectron/Lydia/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/NiercoElectron/Lydia/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/NiercoElectron/Lydia/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NiercoElectron/Lydia/releases/tag/v0.1.0
