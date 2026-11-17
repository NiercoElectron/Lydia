# Roadmap

What is planned for Lydia, roughly in order. There are no dates: Lydia is made in free time, and the order changes
when people who draw with it ask for something. What is already done, version by version, is in
[CHANGELOG.md](CHANGELOG.md), and why each part is the way it is, in [docs/decisions.md](docs/decisions.md).

The next ones each have an issue, labeled [planned](https://github.com/NiercoElectron/Lydia/labels/planned), where
you can say what you need from them. Want something that isn't here? Open an issue with **Idea**, and say how you do it
in another app if you know.

## Next

- **[Lydia for Linux](https://github.com/NiercoElectron/Lydia/issues/2).** An AppImage that opens with a double click,
  with Lydia in the menu of apps and updates that arrive by themselves. A first build already ran on Linux, with the
  pen's pressure working.
- **[Open an image to edit it](https://github.com/NiercoElectron/Lydia/issues/3).** A PNG or JPEG opened in Lydia
  becomes a new drawing. Today an image only gets in by being placed in a drawing already open.
- **[Paste an image](https://github.com/NiercoElectron/Lydia/issues/4).** Ctrl+V puts an image copied elsewhere (a
  screenshot, a picture from a browser) straight into the drawing, and into the tray.
- **[Open and save Photoshop, Krita and OpenRaster files](https://github.com/NiercoElectron/Lydia/issues/5).**
  `.psd`, `.kra` and `.ora` drawings open in Lydia with their layers, and a drawing can be saved as any of them, so
  work can come from those apps and go back to them.

## Ideas we'd like to do

- **Whole scales for pixel art.** When transforming with **Pixels: Whole**, the corners stop at 2×, 3×, 4×…, so pixel
  art made bigger has no pixels of different sizes.
- **Smart objects shrunk a lot stay smooth.** Today a smart object made much smaller shows jagged edges
  ([decision 42](docs/decisions.md#42-smart-objects-and-transforming)).
- **A faster fill bucket on huge areas.** A fill over all of a 10000×10000 drawing takes most of a second.
- **Adding and removing points** on a curve already drawn.
- **Several drawings open**, each in a tab.

## Without the warning when installing

Windows and macOS warn when installing Lydia, because it isn't signed with a paid certificate (see
[installing the desktop app](docs/guide.md#installing-the-desktop-app)). The ways out being looked at:

- **The Microsoft Store**, which signs the apps it has: no warning, and updates through the Store.
- **Signing the Windows installer**, for example through the SignPath Foundation, which signs open source projects for
  free.
- **Apple's Developer ID** for the Mac, which would also let Lydia update itself there.
