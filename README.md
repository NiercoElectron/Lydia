# Lydia

An open source drawing app built with React, TypeScript and PixiJS (WebGL). It aims to feel like Photoshop or Krita, on canvases up to 10000×10000 pixels with 20 or more layers. It runs in the browser, and a desktop version is planned.

> **Work in progress:** Lydia is in early development. Many features are still missing, and things may change or break.

## Features

- Canvases up to 10000×10000 pixels, drawn by the graphics card, with common sizes (A4, US Letter, Full HD…) to
  choose from
- A background color for each drawing, or a transparent background (exported as a transparent PNG)
- A resolution (DPI) for each drawing, written into exported images, so paper sizes print at their size
- Tools in a column at the left, like in Photoshop and Krita: brush, eraser, fill bucket, eyedropper, rectangle select,
  lasso, move, hand, zoom and rotate view
- Brushes and eraser, with mouse or pen; the pen's pressure can change the brush size and how much paint it puts down
- A fill bucket, with a tolerance, looking at all the visible layers or only the active one, and expanding under the
  soft edge of the lines, so that no light rim is left between the color and the line
- An eyedropper that picks the color the screen shows, by clicking or dragging over the drawing (or holding Alt while
  painting)
- Selections with the rectangle and the lasso, shown with marching ants: added to (Shift) or taken away from (Alt), with
  soft or hard edges (hard with a pixel brush); the brush, the eraser and the fill bucket only work inside, and Delete
  takes out what is inside
- A move tool that drags what is selected, or the whole layer when nothing is, by whole pixels; the selection moves
  along
- Smart objects, like Photoshop's: scale, turn, skew or distort what is selected or a whole layer with handles, again
  and again without losing anything, smoothly or by whole pixels for pixel art
- Import images into a tray (the Tray button, at the foot of the tool column) and drag them onto the drawing as often
  as needed, as smart objects; the tray stays while Lydia is open
- An opacity for each stroke, and brushes that "wash": a stroke doesn't pile up over itself
- Brushes with filtered noise: every dab different, with the brush's own character, mixed with the tip, as whole
  drops of paint or wearing the tip away (Bristles, Sponge)
- Brushes are `.lydbrush` files: nine come with Lydia, and more can be added (Import…, or drop the files on the
  window), exported to share them, and deleted
- A Pixel brush for pixel art: whole pixels with hard edges, from 1 pixel up, with round tips drawn pixel by pixel
- A pixel grid from 800% zoom, in a color that shows on any pixel (the Grid button, or G)
- Brush Designer (on the start screen): draw the tip of a new brush, choose its settings, try it, and save it to the
  brush list or as a file
- Layers: add, delete, choose, move (drag them in the list), rename (double-click), hide and show, change the opacity
- Undo and redo of every change, painting and layers alike (buttons, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Ctrl+Y)
- Clear a layer (it can be undone too)
- Zoom, move, turn and flip the view (the drawing itself doesn't change), with the zoom and the angle shown in the bar
- Export the drawing as a PNG or JPEG image, at full size
- Save and open projects as `.lyd` files
- Choose how much of the graphics card's memory Lydia may use (on the start screen)

How to use each tool, and every shortcut: [docs/guide.md](docs/guide.md).

## Roadmap

Done: tiled canvases up to 10000×10000, layers (add, delete, reorder, rename, hide, opacity), undo and redo of
everything, brushes as files and the Brush Designer, the Pixel brush and a pixel grid, brushes with filtered noise,
stroke opacity, a tool column, the eyedropper, turning and flipping the view, the fill bucket, rectangle and lasso
selections, the move tool, smart objects and transforming, importing images with a tray, new drawings with common sizes, a resolution (DPI) and a
background color or transparency, `.lyd` projects, PNG and JPEG export. What changed in each version is in
[CHANGELOG.md](CHANGELOG.md).

Next, roughly in this order:

- [ ] Painting: pixel brushes drawn in the Brush Designer, the brush's outline under the pen, pen tilt (the brush
      follows how the pen leans, like a pencil), stabilizer (smoother strokes), tapered stroke ends
- [ ] Pixel art: pixel-perfect strokes (without the doubled corners of lines drawn by hand) and exporting enlarged (2×,
      4×) without blurring
- [ ] Layers: blend modes, clipping masks, alpha lock, duplicate and merge down
- [ ] Selections: magic wand
- [ ] Brushes: grain (a paper texture, for pencils), smudge and blur tools, a liquify tool (push, bloat and pucker
      the picture with the pen, and brush it back to how it was); in the Brush Designer, edit existing brushes and use
      an image as the tip
- [ ] Safety: autosave and recovery after a crash, and a message when the browser loses the graphics card
- [ ] Guides: symmetry, rulers (straight lines, ellipses, perspective) and shapes (rectangles, ellipses and more,
      outlined with the brush's own tip or filled, that stay editable and can be transformed)
- [ ] Text and filters (hue and saturation, levels, blur)
- [ ] 1.0: the desktop app for Windows, macOS and Linux (Electron), with a real brushes folder and memory limits read
      from the computer

## Getting started

You need [Node.js](https://nodejs.org) 20.19+ or 22.12+.

```bash
git clone https://github.com/NiercoElectron/Lydia.git
cd Lydia
npm install
npm run dev
```

Then open the address shown in the terminal (usually http://localhost:5173).

### Available scripts

| Command                | Description                                |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the development server               |
| `npm run build`        | Type-check and build for production        |
| `npm run preview`      | Preview the production build locally       |
| `npm run lint`         | Run ESLint                                 |
| `npm run format`       | Format all files with Prettier             |
| `npm run format:check` | Check that all files follow the code style |

## Project structure

```
src/
├── engine/          The drawing engine (tiles, layers, brush, undo, project and brush files), no React
├── components/      UI pieces (drawing area, tool column, toolbar, brushes and layers panels, Designer parts)
├── screens/         Full screens (start screen, editor, Brush Designer)
├── brushes/         The brushes that come with Lydia (.lydbrush files)
├── brushLibrary.ts  The brush list: the brushes above and the ones the user added
├── files.ts         Downloading files
├── settings.ts      Settings remembered by the browser
└── App.tsx          Chooses which screen to show
scripts/
└── make-brushes.mjs Makes the files in src/brushes (node scripts/make-brushes.mjs)
```

Dependencies only go one way: `screens` → `components` → `engine`. Code in `engine/` must not import React.

Why things are built the way they are: [docs/decisions.md](docs/decisions.md). Measurements from the prototype that
tested the engine: [docs/spike-notes.md](docs/spike-notes.md). What changed in each version:
[CHANGELOG.md](CHANGELOG.md).

## Contributing

Contributions are welcome! Feel free to open an issue to report a bug or suggest a feature.
For larger changes, please open an issue first so we can discuss the idea before you start working on it.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
