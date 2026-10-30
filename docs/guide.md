# Using Lydia

What each part of Lydia does, and its shortcuts. Every shortcut is also in the [table at the end](#all-shortcuts).
On a Mac, Cmd works wherever Ctrl is written.

- [The start screen](#the-start-screen)
- [The editor](#the-editor)
- [Brush and eraser](#brush-and-eraser)
- [Eyedropper](#eyedropper)
- [Fill bucket](#fill-bucket)
- [Selections](#selections)
- [Move](#move)
- [Transforming and smart objects](#transforming-and-smart-objects)
- [The tray: importing images](#the-tray-importing-images)
- [Layers](#layers)
- [The view](#the-view)
- [Undo and redo](#undo-and-redo)
- [Saving and exporting](#saving-and-exporting)
- [The Brush Designer](#the-brush-designer)
- [When something goes wrong](#when-something-goes-wrong)
- [All shortcuts](#all-shortcuts)

## The start screen

- **New project…** opens a window to choose the paper:
  - a size: paper sizes (A4, US Letter…) and screen sizes (Full HD…), or any width and height from 16 to 10000
    pixels;
  - a **Resolution** in DPI (72, 150, 300, 600, or typed in), which only matters for printing: exported images say it,
    so they print at the size of their paper;
  - a background color, or **Transparent**.

  Lydia remembers the last choice.

- **Open project** opens a `.lyd` file saved by Lydia.
- **Brush Designer** draws a new brush (see [below](#the-brush-designer)). Choose first the kind of brush, **Smooth**
  or **Pixel** (for pixel art), and the size of the paper for its tip: 256, 512 or 1024 pixels for a smooth brush,
  16, 32 or 64 for a pixel brush.
- **Interface**: the colors of Lydia's buttons and panels: **System** (as the computer is set, changing with it),
  **Light** or **Dark**. The drawing never changes color.
- **Language**: **System** (the browser's language: Brazilian Portuguese or Spanish, English for any other, changing
  with it), **Português (Brasil)**, **English** or **Español**. Names given to layers and brushes stay as they were;
  new layers and folders are named in the language chosen.
- **What's New?**, at the right (below, in a narrow window): what changed in each version, the newest open. Click a
  version to open or close it.
- **Graphics card memory**: how much of the graphics card's memory Lydia may use to keep layers ready. More makes
  switching layers and undoing faster, but choosing more than the card has makes everything very slow or loses the
  drawing. Choose at most half of your card's memory; if you're not sure, keep the default.

## The editor

- **At the top:** the settings of the chosen tool on the first row; on the second, Undo, Redo, Clear layer, the view (zoom, angle, Straighten,
  Flip, Fit), Export PNG, Export JPEG, Save and Back. What Lydia is busy with ("Saving…", "Filling…") shows at the
  end.
- **At the left:** the tools, with the **Tray** button at their foot, then the brushes.
- **At the right:** the layers.

Back goes to the start screen, and asks first when there are changes that weren't saved. So does closing the tab.

Every slider has its number next to it: click the number to type a value. Enter, or clicking elsewhere, keeps it
(within the slider's range), and Esc leaves it as it was. The zoom and the angle in the bar work the same way.

## Brush and eraser

**Brush (B)** paints with the chosen brush and color; **Eraser (E)** takes paint away with the same brush.

- **Color**, **Size** (1 to 500 pixels; **[** and **]** make it smaller and bigger) and **Opacity** in the bar.
  Opacity is how much a stroke covers, however many times it passes over the same place.
- With a pen, the pressure changes the size or the amount of paint, as each brush is made to.
- Hold **Alt** to pick a color from the drawing while painting.
- **Straight lines:** **Shift + click** paints a straight line from where the last stroke ended, and again from
  there; while Shift is held, the line shows. Hold **Ctrl** too to keep it to a few angles: with a pixel brush, the
  clean angles of pixel art (1 pixel across for 1, 2 or 3 down, or the other way round, across and down), in equal
  steps; with the others, every 15°.
- **The outline:** over the drawing, the brush shows the outline of its tip instead of the cursor, as big as it paints
  at full pressure and turned as it paints (brushes like Dashes turn it with the stroke). The Pixel brush's outline
  goes along the pixels it will paint. A brush smaller than 8 pixels on the screen shows a cross instead. The
  **Outline** button, next to Grid, turns it off, for the cross always.
- **Advanced**, in the bar, opens a panel over the drawing with the settings changed less often: the stabilizer and
  the taper, below. Clicking elsewhere (which doesn't paint) or Esc closes it. Its **pin** keeps it open, also the
  next time; the Advanced button then closes it.
- **The stabilizer** smooths the strokes, for steady lines with a shaky hand. **Stabilizer**, under Advanced, goes from
  0 (off) to 100 and is the same for every brush:
  - **Smooth**: the brush chases the pen, lagging behind it and cutting its wobbles. The stronger, the more it lags.
    When the pen holds still, the brush keeps going until it reaches it;
  - **String**: the pen pulls the brush on a string. The brush doesn't move while the pen stays within the string's
    length (longer the stronger), and follows it straight when it goes further. Good for clean curves and lines.

  While the brush lags, a line joins it to the pen, and the outline is where the brush is. When the pen comes up, the
  stroke goes on to where it left.

- **The taper** thins out the ends of every stroke, even with the mouse, like a stroke of ink. Under Advanced:
  - **Taper start** and **Taper end**: over how many pixels of the paper (0 is not at all) the stroke thins out from
    its start, and before its end. The end thins out the moment the pen comes up, since only then is it known;
  - **Thins**: what thins out, the **Size**, the **Opacity** or **Both**.

  A stroke shorter than both tapers has them shortened alike until they meet, and a click paints a whole dot.

- **The brushes:** nine come with Lydia (Soft round, Hard round, Pixel, Airbrush, Chalk, Calligraphy, Dashes, Bristles,
  Sponge). Click one to paint with it.
  - **Import…** adds brushes from `.lydbrush` files; dropping the files on the window does the same.
  - **Export** saves the chosen brush as a file, to share it.
  - **Delete** takes an added brush out of Lydia (the ones that come with Lydia stay).
- **The Pixel brush** is for pixel art: whole pixels with hard edges, from 1 pixel up. While it or any other pixel
  brush is chosen, new selections get hard edges (see [Selections](#selections)).
- **Pixel-perfect**, in the bar while a pixel brush is chosen, leaves out the doubled corners of lines drawn by hand:
  where a line steps a pixel across and then a pixel down, the pixel of the corner shows as the pen goes over it and
  goes again, so each step is a single pixel. It works at every size, is off at first, and is remembered.
- **Pixel brushes drawn in the Brush Designer** paint their tip as it was drawn, pixel by pixel, at 1×, 2×, 3×… its
  size: the **Size** goes to the nearest of them (a tip of 5 pixels paints 5 at sizes up to 7, 10 at sizes 8 to 12…).
  Choosing one sets the Size to 1×.
- **The pixel grid** shows the pixels from 800% zoom: the **Grid** button, or **G**, turns it on and off.
- With a selection, the brush and the eraser only work inside it. A smart object can't be painted on (see
  [Transforming](#transforming-and-smart-objects)).

## Eyedropper

**Eyedropper (I)**: click, or drag over the drawing, to pick the color the screen shows there, with every visible
layer. The brush's Opacity goes back to 100%, so it paints that same color. Holding **Alt** with the brush, the eraser
or the fill bucket does the same.

## Fill bucket

**Fill (F)**: click to fill an area of one color with the brush's color.

- **Tolerance** (0 to 255): how different a color can be from the one clicked and still be filled.
- **Look at:** **All layers** finds the area in the layers as the screen shows them (with their blend modes, clipping
  and folders), without the paper; **This layer** only in the active layer. The fill always goes into the active
  layer.
- **Expand** (0 to 50 pixels): how far the fill goes past its edge, behind the soft edge of the lines around it, up to
  where they are darkest, so that no light rim is left between the color and the line.
- With a selection, only what is selected is filled. Hold **Alt** to pick a color.

## Selections

**Rectangle select (S)** drags a rectangle; **Lasso (L)** draws around any shape; **Magic wand (W)** selects the
area around the point clicked, like the fill bucket fills it.

- Hold **Shift** to add to the selection, or **Alt** to take away from it.
- **Edges:** **Soft** or **Hard** (whole pixels, for pixel art) for new selections with the rectangle and the lasso.
- The magic wand's settings, its own, start like the fill bucket's:
  - **Tolerance** (0 to 255, 32 at first): how far a color may be from the one clicked and still be selected.
  - **Look at**: **All layers** (the visible layers as they show, without the paper) or **This layer**. With a folder
    active, **This layer** looks at the layers in it.
  - **Expand** (0 to 50 pixels, 20 at first): the selection goes on into the soft edge of the lines around it, up to
    where they are darkest, so that coloring inside on a layer under the lines leaves no light rim.
  - **Contiguous** (on at first): only the area connected to the point clicked. Off, every pixel of a close color in
    the drawing, to change a color everywhere in pixel art for example.
- **Select all** (Ctrl+A), **Deselect** (Ctrl+D) and **Invert** (Ctrl+Shift+I) in the bar.
- **Delete** (or Backspace) takes the paint out of what is selected, in the active layer.
- The brush, the eraser and the fill bucket only work inside a selection.

## Move

**Move (V)**: drag to move what is selected, or the whole layer when nothing is selected, by whole pixels. The
selection moves along.

- Hold **Shift** to move only across, or only up and down.
- While it is dragged, it shows as it will be, with the blend modes, clipping and folders. Once let go, a bar next to
  **Moving…** in the top bar shows how far it is from being put down; you can paint again when it is gone.
- On a smart object, it moves the whole object, without losing anything.
- Paint moved off the paper is kept, hidden: move it back and it comes back. While the layer is moved (or
  transformed), what is off the paper shows faded around it, and the layer's icon in the [layers](#layers) shows it
  at any time. Only what moves goes off the paper: the brush, the fill bucket and selections stay on it.

## Transforming and smart objects

Transforming scales, turns, skews or distorts. **Ctrl+T** starts it, or **Transform** in the bar of the selection and
move tools (in a browser, Ctrl+T opens a new tab instead, so use the button there).

- With a selection, the selected part goes into a new layer above as a **smart object**. Without one, the whole layer
  becomes one. On a smart object, it transforms it.
- **The handles:**
  - drag a **corner** to scale, keeping the proportions; with **Shift**, the proportions change;
  - drag a **side** to scale one way;
  - hold **Alt** to scale from the middle;
  - drag **inside** to move it, and **outside** to turn it (**Shift**: in steps of 15°);
  - **Ctrl** + drag a corner distorts it, and Ctrl + drag a side skews it.
- **Pixels:** **Smooth** for painting, or **Whole** for pixel art.
- **Enter** (or Apply) applies it; **Esc** (or Cancel) leaves everything as it was.

A smart object keeps its original pixels, so transforming it again and again never loses anything, even scaled down
and up again. It shows a box icon in the layers. It can't be painted on, erased or filled, and Clear layer and Delete
leave it alone: **Convert to pixels**, in the bar of those tools, makes it a normal layer again (it can be undone).

## The tray: importing images

The **Tray** button, at the foot of the tool column, opens the tray over the drawing, and closes it again.

- **Import…** in the tray adds images. Dropping image files anywhere on the window adds them too, and opens the tray;
  an image dropped right onto the drawing also goes into it there.
- **Drag an image from the tray onto the drawing**, as often as needed. It goes in as a smart object, centered where
  it was dropped, with the handles showing: move it, scale it or turn it, then **Enter** puts it into a new layer
  above the active one, named after the file, and **Esc** leaves it out.
- An image bigger than the paper keeps its size: the part off the paper shows faded while it is placed, and stays
  in the layer, hidden, to be moved onto the paper later. (Only an image bigger than 10000 pixels is made smaller.)
- Pointing at an image in the tray shows a **×** that takes it out of the tray.
- The tray stays the same from one drawing to the next while Lydia is open, and is empty again after the page is
  closed or reloaded.

## Layers

- **New layer** adds an empty layer above the active one; **Delete layer** deletes the active one (the last layer
  stays).
- **Duplicate** (Ctrl+J) puts a copy of the active layer above it. **Merge down** (Ctrl+E) puts the active layer's
  paint onto the layer under it in the same folder, as it shows; that layer keeps its own opacity and blend mode.
  Both layers must be shown, and the one under can't be a smart object.
- **Folders** keep layers in order, and can hold other folders:
  - **New folder** adds one; **Ctrl+G** puts the active layer into a new folder. With an open folder active, a new
    layer goes into it, on top. **New layer outside** adds one above the folder the active layer is in (or above the
    active folder), out of it.
  - **Drag** a layer onto a folder's row to put it in (the row lights up), or between rows to put it there, in or out
    of folders. Dragging a folder moves all that is in it.
  - The arrow in a folder's row opens and closes it in the list.
  - Hiding a folder hides all that is in it, and its **Opacity** applies to all of it. Its **Blend** is **Pass
    Through** at first: the layers in it mix with all that is under them, as if there were no folder. Give it another
    mode, and what is in it is put together on its own first, like one layer.
  - A folder can't be painted on: choose a layer in it. The **move tool** moves all of its layers together.
  - **Duplicate** copies it with all that is in it, **Merge folder** (Ctrl+E) makes it one layer, and **Delete
    folder** deletes it with all that is in it.
- Click a layer to paint on it. **Drag** it up or down to move it in the list.
- **Double-click** a name to rename it: Enter keeps the new name, Esc the old one.
- The box at the left of each layer hides it or shows it.
- The **lock** in each layer's row locks its transparency: the brush and the fill bucket then only color the paint
  already there (to shade or recolor inside the lines), and the eraser can't be used. Click it again to unlock. It is
  kept with the drawing.
- The **clip** in each layer's row (or **Ctrl+Alt+G** for the active layer) clips the layer to the one under it: it
  then shows only where that layer has paint. Clip shadows and lights to a layer with a part's flat color (filled
  inside its lines), and they never go past that part; a layer with only the lines shows them on the lines only. The
  row moves in, with an arrow down. Several layers in a row can be clipped to the same layer; hiding that layer hides
  them too. A folder can be clipped too, or be what layers are clipped to. Click the clip again to unclip. It can be
  undone, and is kept with the drawing.
- A layer with paint off the paper (see [Move](#move)) has an icon at the right of its name: click it to show that
  paint, faded, around the paper, and again to hide it. It is kept with the drawing.
- **Blend**, above the list, is how the active layer's paint goes onto what is under it:
  - **Normal**: the paint covers what is under it.
  - **Darken**, **Multiply**, **Color Burn**: darken. Multiply is like layers of ink, good for shadows (white changes
    nothing).
  - **Lighten**, **Screen**, **Color Dodge**, **Add (Linear Dodge)**: lighten, for light and glows (black changes
    nothing).
  - **Overlay**, **Soft Light**, **Hard Light**: more contrast, darkening the dark parts and lightening the light ones.
  - **Difference**: how far apart the colors are.
  - **Hue**, **Saturation**, **Color**, **Luminosity**: take only that from the layer's colors, the rest from what is
    under (Color is good for coloring a gray drawing).
  - Over a transparent part, the paint shows as it is, whatever the mode. A change can be undone, and is kept with the
    drawing.
- **Opacity**, above the list, is the active layer's.
- **Clear layer**, in the top bar, takes all the paint out of the active layer.

## The view

Changing the view never changes the drawing.

- **Move around:** the **Hand (H)**, or hold **Space** and drag, or drag with the middle mouse button, or the mouse
  wheel (two fingers on a trackpad).
- **Zoom**, from 1% to 3200%: **Ctrl** + mouse wheel (or pinch on a trackpad), or the **Zoom (Z)** tool: click to zoom
  in, **Alt** + click to zoom out, and drag right or left to zoom smoothly.
- **Turn:** the **Rotate view (R)** tool (**Shift**: in steps of 15°), or hold **Shift + Space** and drag with any
  tool. **Straighten** turns it back.
- **Flip** like in a mirror, to check a drawing with fresh eyes: **M**, or the Flip button.
- **Fit**, or **Ctrl+0**, shows the whole drawing.
- The bar shows the zoom and the angle: click either one to type it (a zoom from 1% to 3200%, any angle).

## Undo and redo

**Ctrl+Z** undoes; **Ctrl+Shift+Z** or **Ctrl+Y** redoes. Everything can be undone: strokes, fills, selections, moves,
transforms and every change to the layers. Lydia keeps up to 500 MB of undo; past that, the oldest steps are
forgotten.

## Saving and exporting

- **Save** downloads the drawing as a `.lyd` file, with its layers and smart objects, to open it again later. It
  opens as it was shown: with the same zoom, angle and flip. Paint off the paper is saved too; versions of Lydia
  before 0.10 can't open a drawing that has some.
- **Export PNG** saves the picture at full size, keeping a transparent background transparent.
- **Export JPEG** makes a much smaller file, without transparency (a transparent background becomes white).
- **Scale**, next to them, exports the image 2, 3, 4, 6 or 8 times bigger, each pixel a sharp square of pixels, for
  pixel art (other programs blur small images when they enlarge them). Each drawing keeps its choice. The file's name
  says it, like `lydia-...@4x.png`. A big drawing only offers the scales it fits at: at most 16384 pixels across,
  and no more pixels than a paper of 10000 × 10000.

Exported images carry the drawing's resolution, so they print at the size of their paper (an image enlarged 4 times
says 4 times as many pixels in an inch, so it too prints at that size, only sharper).

## The Brush Designer

Opened from the start screen, it draws the tip of a new brush.

- Paint the tip on the paper: black paints fully, gray paints lightly, white doesn't paint. **Brush** and **Eraser**,
  with **Edge** (Soft or Hard), **Strength** and **Size** in the bar; **Clear paper** starts again.
- Give it a **Name**, and choose how it paints: Spacing, Angle, Turn with the stroke, Random angle, Scatter, Flow,
  Wash (the stroke doesn't pile up over itself) and the pen's pressure. **Noise** gives every copy of the tip a
  texture (Mix, Drops or Worn), with its Grain, Layers, Stretch and Contrast. Pointing at each setting explains it.
- **Try it** paints with the brush as it is now, at any size; **Clear** wipes the test area.
- **Save to my brushes** adds it to the brush list, and **Export file** saves it as a `.lydbrush` file.

**A pixel brush** (Pixel on the start screen) is drawn on a small paper, zoomed in with the pixel grid, with Lydia's
Pixel brush: each pixel of the tip paints fully (black) or not at all (white), with no edge or strength to choose.
The tip is cut to its painted pixels. The settings that turn the tip or give it noise are left out; the new brush
starts placing its tip at every pixel (Spacing 1%), at one size whatever the pen's pressure.

## When something goes wrong

A message about something that went wrong starts with a code, like `LYD-201`, and is in English whatever the
language chosen. [errors.md](errors.md) lists every code with what it means. When asking for help or reporting a
problem, give the code, and what is in parentheses after the message if there is something.

## All shortcuts

| Shortcut                                       | What it does                                       |
| ---------------------------------------------- | -------------------------------------------------- |
| B / E                                          | Brush / eraser                                     |
| F / I                                          | Fill bucket / eyedropper                           |
| S / L / W                                      | Rectangle select / lasso / magic wand              |
| V                                              | Move                                               |
| H / Z / R                                      | Hand / zoom / rotate view                          |
| [ / ]                                          | Smaller / bigger brush                             |
| Alt (hold), with the brush, eraser or bucket   | Pick a color                                       |
| Shift + click, with the brush or eraser        | Straight line from the end of the last stroke      |
| Shift + Ctrl + click, with the brush or eraser | The same, keeping to a few angles                  |
| G                                              | Pixel grid on / off                                |
| Ctrl + Z                                       | Undo                                               |
| Ctrl + Shift + Z, Ctrl + Y                     | Redo                                               |
| Shift / Alt + drag or click, with S, L or W    | Add to / take away from the selection              |
| Ctrl + A / Ctrl + D / Ctrl + Shift + I         | Select everything / nothing / invert the selection |
| Delete, Backspace                              | Take out what is selected                          |
| Shift + drag, with V                           | Move only across, or only up and down              |
| Ctrl + J / Ctrl + E                            | Duplicate the layer / merge it down                |
| Ctrl + T, or Transform in the bar              | Transform (in a browser, use the button)           |
| Enter / Esc, while transforming                | Apply / cancel                                     |
| Shift + drag a corner                          | Scale without keeping the proportions              |
| Alt + drag a handle                            | Scale from the middle                              |
| Ctrl + drag a corner / a side                  | Distort / skew                                     |
| Shift + drag outside, or with R                | Turn in steps of 15°                               |
| Space + drag, or drag with the middle button   | Move around                                        |
| Mouse wheel, or two fingers on a trackpad      | Move around                                        |
| Ctrl + mouse wheel, or pinch on a trackpad     | Zoom                                               |
| Alt + click, with Z                            | Zoom out                                           |
| Shift + Space + drag                           | Turn the view                                      |
| M                                              | Flip the view                                      |
| Ctrl + 0                                       | Show the whole drawing                             |
