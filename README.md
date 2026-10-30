# Lydia

An open source drawing app built with React, TypeScript and PixiJS (WebGL). It aims to feel like Photoshop or Krita, on canvases up to 10000×10000 pixels with 20 or more layers. It runs in the browser, and a desktop version is planned.

> **Work in progress:** Lydia is in early development. Many features are still missing, and things may change or break.

## Features

- Canvases up to 10000×10000 pixels, drawn by the graphics card, with common sizes (A4, US Letter, Full HD…) to
  choose from
- A background color for each drawing, or a transparent background (exported as a transparent PNG)
- A resolution (DPI) for each drawing, written into exported images, so paper sizes print at their size
- Tools in a column at the left, like in Photoshop and Krita: brush, eraser, fill bucket, eyedropper, rectangle select,
  lasso, magic wand, move, hand, zoom and rotate view
- Brushes and eraser, with mouse or pen; the pen's pressure can change the brush size and how much paint it puts down
- The brush's outline under the pointer, in the shape of its tip and as big as it paints (the Outline button)
- A stabilizer for smoother strokes: the brush chases the pen (Smooth) or is pulled by it on a string (String)
- Tapered stroke ends, thinner, fainter or both, even with the mouse
- A fill bucket, with a tolerance, looking at all the visible layers or only the active one, and expanding under the
  soft edge of the lines, so that no light rim is left between the color and the line
- An eyedropper that picks the color the screen shows, by clicking or dragging over the drawing (or holding Alt while
  painting)
- Selections with the rectangle, the lasso and the magic wand, shown with marching ants: added to (Shift) or taken
  away from (Alt), with soft or hard edges (hard with a pixel brush); the brush, the eraser and the fill bucket only
  work inside, and Delete takes out what is inside
- A move tool that drags what is selected, or the whole layer when nothing is, by whole pixels; the selection moves
  along, and paint moved off the paper is kept, to be brought back
- Smart objects, like Photoshop's: scale, turn, skew or distort what is selected or a whole layer with handles, again
  and again without losing anything, smoothly or by whole pixels for pixel art
- Import images into a tray (the Tray button, at the foot of the tool column) and drag them onto the drawing as often
  as needed, as smart objects, at their own size; the tray stays while Lydia is open
- An opacity for each stroke, and brushes that "wash": a stroke doesn't pile up over itself
- Brushes with filtered noise: every dab different, with the brush's own character, mixed with the tip, as whole
  drops of paint or wearing the tip away (Bristles, Sponge)
- Brushes are `.lydbrush` files: nine come with Lydia, and more can be added (Import…, or drop the files on the
  window), exported to share them, and deleted
- A Pixel brush for pixel art: whole pixels with hard edges, from 1 pixel up, with round tips drawn pixel by pixel
- Pixel-perfect strokes: pixel brushes can leave out the doubled corners of lines drawn by hand
- Straight lines with Shift + click, kept to the angles of pixel art (or every 15°) with Ctrl
- A pixel grid from 800% zoom, in a color that shows on any pixel (the Grid button, or G)
- Brush Designer (on the start screen): draw the tip of a new brush, choose its settings, try it, and save it to the
  brush list or as a file
- Pixel brushes drawn in the Brush Designer, pixel by pixel, that paint their tip at 1×, 2×, 3×… its size
- Layers: add, delete, duplicate, merge down, choose, move (drag them in the list), rename (double-click), hide and
  show, change the opacity and the blend mode (Multiply, Screen, Overlay… 16 in all), lock their transparency, clip
  them to the layer under them, keep them in folders (folders in folders too),
  and show their paint off the paper
- Undo and redo of every change, painting and layers alike (buttons, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Ctrl+Y)
- Clear a layer (it can be undone too)
- Zoom, move, turn and flip the view (the drawing itself doesn't change), with the zoom and the angle shown in the bar
- Export the drawing as a PNG or JPEG image, at full size or enlarged (2× to 8×) with sharp square pixels
- Save and open projects as `.lyd` files
- Choose how much of the graphics card's memory Lydia may use (on the start screen)
- A light or a dark interface, or as the computer is set (on the start screen)
- English, Brazilian Portuguese or Spanish, selected on the start screen or detected from the system language; the browser
  remembers the choice

How to use each tool, and every shortcut: [docs/guide.md](docs/guide.md).

## Language

On the start screen, **Language / Idioma** offers **System / Sistema**, **Português (Brasil)**, **English** and **Español**.
System uses Brazilian Portuguese or Spanish when the browser's first preferred language is Portuguese or Spanish,
and English otherwise.
The choice is remembered between visits and follows system language changes while System is selected.
Names you give to layers and brushes stay as you wrote them; default names for new layers use the current language.

Interface translations are in `src/translations/pt-BR.ts` and `src/translations/es.ts`, with English source text as keys. Values such as
`{name}` are substituted without translating user data. Context keys (for example, `blend.Screen`) distinguish
labels that need different translations. The translated release histories are in `src/translations/changelog.pt-BR.md` and
`src/translations/changelog.es.md`; new releases fall back to English until a translation is added. `npm run test:app -- language language-ui` checks
language preferences, translation coverage, release history and switching languages in the interface.

Error messages are not translated: they stay in English, each starting with a code such as `LYD-201`, listed with
what each means in [docs/errors.md](docs/errors.md).

## Roadmap

Done: tiled canvases up to 10000×10000, layers (add, delete, reorder, rename, hide, opacity, duplicate, merge down,
blend modes, clipping masks, alpha lock, folders), undo and redo of
everything, brushes as files and the Brush Designer, the Pixel brush and a pixel grid, brushes with filtered noise,
stroke opacity, a tool column, the eyedropper, the brush's outline, a stabilizer, tapered stroke ends, pixel brushes drawn in the Brush Designer, pixel-perfect strokes, straight lines, turning and flipping the view, the fill bucket, rectangle, lasso and
magic wand selections, the move tool, smart objects and transforming, importing images with a tray, a dark mode, new drawings
with common sizes, a resolution (DPI) and a background color or transparency, `.lyd` projects, PNG and JPEG export, enlarged too, the
interface in English, Brazilian Portuguese and Spanish, and error codes.
What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

Next, roughly in this order:

- [ ] Colors: a color triangle (a ring of hues around a triangle of shades) in place of the color picker
- [ ] Interface: a new look and layout for the screens, made from a friend's design and compared with the one now
- [ ] Brushes: grain (a paper texture, for pencils), smudge and blur tools, a liquify tool (push, bloat and pucker
      the picture with the pen, and brush it back to how it was) and a mesh mode for transforming (a grid of points
      that bend the picture where each one is dragged), pen tilt (the brush follows how the pen leans, like a
      pencil); in the Brush Designer, edit existing brushes and use an image as the tip
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
| `npm run test:app`     | Run the tests of the app in Chrome         |

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
tests/
└── app/             Tests that use the app in Chrome as a person would (see tests/app/README.md)
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
