# Lydia

A simple, open source drawing app built with React, TypeScript and the HTML canvas. It runs in the browser, and a desktop version is planned.

> **Work in progress:** Lydia is in early development. Many features are still missing, and things may change or break.

## Features

- Freehand drawing with mouse or pen (drawing tablets)
- Undo (button or Ctrl/Cmd+Z)
- Clear the canvas
- Export the drawing as a PNG image
- Start screen to create a new project (with a custom canvas size) or open an existing one
- Save and open projects as `.lyd` files

## Roadmap

- [x] Start screen (new project / open project)
  - [x] Choose canvas size
  - [ ] Choose background color or transparent background
- [x] Color and brush size selection
- [x] Undo
- [ ] Redo, and undo for every action (including clear)
- [ ] Layers (add, delete, reorder, hide)
- [x] Eraser
- [x] Save and open projects (.lyd files)
- [x] Export drawings as PNG
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
├── drawing/      Pure drawing logic (types, rendering, file handling), no React
├── hooks/        React hooks that hold the app state and actions
├── components/   Reusable UI pieces (canvas, toolbar)
├── screens/      Full screens (start screen, editor)
└── App.tsx       Chooses which screen to show
```

Dependencies only go one way: `components` → `hooks` → `drawing`. Code in `drawing/` must not import React.

## Contributing

Contributions are welcome! Feel free to open an issue to report a bug or suggest a feature.
For larger changes, please open an issue first so we can discuss the idea before you start working on it.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
