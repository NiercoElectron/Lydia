# Lydia

An open source drawing app built with React, TypeScript and PixiJS (WebGL). It aims to feel like Photoshop or Krita, on canvases up to 10000×10000 pixels with 20 or more layers. It runs in the browser, and a desktop version is planned.

> **Work in progress:** Lydia is in early development. Many features are still missing, and things may change or break.

## Features

- Canvases up to 10000×10000 pixels, drawn by the graphics card
- Soft brush and eraser, with mouse or pen; the pen's pressure changes the brush size
- Layers: add, delete, choose, move (drag them in the list), rename (double-click), hide and show, change the opacity
- Undo and redo of every change, painting and layers alike (buttons, Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z or Ctrl+Y)
- Clear a layer (it can be undone too)
- Zoom and move around the drawing
- Export the drawing as a PNG or JPEG image, at full size
- Save and open projects as `.lyd` files
- Choose how much of the graphics card's memory Lydia may use (on the start screen)

### Shortcuts

| Shortcut                                     | Action                 |
| -------------------------------------------- | ---------------------- |
| Ctrl/Cmd + Z                                 | Undo                   |
| Ctrl/Cmd + Shift + Z, Ctrl + Y               | Redo                   |
| B / E                                        | Brush / eraser         |
| [ / ]                                        | Smaller / bigger brush |
| Ctrl + mouse wheel, or pinch on a trackpad   | Zoom                   |
| Mouse wheel, or two fingers on a trackpad    | Move around            |
| Space + drag, or drag with the middle button | Move around            |
| Ctrl/Cmd + 0                                 | Show the whole drawing |

## Roadmap

- [x] Start screen (new project / open project)
  - [x] Choose canvas size
  - [ ] Choose background color or transparent background
- [x] Color and brush size selection
- [x] Undo and redo (painting, clearing a layer and every layer change)
- [x] Layers: add, delete, choose, reorder, rename, hide, opacity
- [ ] Layers: blend modes
- [x] Eraser
- [x] Save and open projects (.lyd files; projects from Lydia 0.1 can't be opened)
- [x] Export drawings as PNG or JPEG
- [ ] Desktop app for Windows, macOS and Linux (Electron)

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
├── engine/       The drawing engine (tiles, layers, brush, undo, project files), no React
├── components/   UI pieces (drawing area, toolbar, layers panel)
├── screens/      Full screens (start screen, editor)
├── files.ts      Downloading files
├── settings.ts   Settings remembered by the browser
└── App.tsx       Chooses which screen to show
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
