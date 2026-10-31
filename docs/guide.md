# Using Lydia

What each part of Lydia does, and its shortcuts. Every shortcut is also in the [table at the end](#all-shortcuts).
On a Mac, Cmd works wherever Ctrl is written.

- [The start screen](#the-start-screen)
- [The editor](#the-editor)
- [Colors](#colors)
- [Brush and eraser](#brush-and-eraser)
- [Smudge and blur](#smudge-and-blur)
- [Liquify](#liquify)
- [Symmetry](#symmetry)
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

- **Recover** shows up when there are drawings closed with changes that weren't saved (see
  [Autosave](#autosave-and-recovering-a-drawing)).
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
- **At the right:** the colors, and the layers under them.

Back goes to the start screen, and asks first when there are changes that weren't saved. So does closing the tab.

Every slider has its number next to it: click the number to type a value. Enter, or clicking elsewhere, keeps it
(within the slider's range), and Esc leaves it as it was. The zoom and the angle in the bar work the same way.

## Colors

The color panel, at the top right, holds the brush's color, also used by the fill bucket.

- **The ring** chooses the hue: click it or drag round it.
- **The triangle** inside it holds that hue's shades: its pure color in the corner that points at the hue on the
  ring, white and black in the others. It turns with the hue. Click or drag in it; dragging past its edge goes along
  the edge.
- **The two squares:** the brush's color in front, the **background color** behind. **X**, or the arrows next to them,
  swap the two.
- **The code** of the color (#rrggbb): type one to use it; #rgb counts on Enter.
- **H**, **S** and **V**: the hue (0 to 360°), the saturation (how far from gray) and the value (how far from black),
  as sliders, for small changes.
- **The colors painted with lately**, under them, the newest first: each stroke of the brush and each fill adds its
  color. Click one to use it again. They are kept for the next time.

The eyedropper (I, or Alt while painting) changes the brush's color too.

**The color tray** keeps colors on purpose, to pick them again quickly: unlike the colors painted with lately, they stay
until taken out. The button with a palette, next to the color's code, opens and closes it, floating over the drawing.

- **All drawings**: the same colors in every drawing, kept by this browser.
- **This drawing**: the drawing's own colors, saved in its file, so they come back when it is opened, on any
  computer.
- **+** keeps the brush's color at the end of a list; click a color to use it; **×**, over a color, takes it out.

## Brush and eraser

**Brush (B)** paints with the chosen brush and color; **Eraser (E)** takes paint away with the same brush.

- **Size** (1 to 500 pixels; **[** and **]** make it smaller and bigger) and **Opacity** in the bar.
  Opacity is how much a stroke covers, however many times it passes over the same place.
- With a pen, the pressure changes the size or the amount of paint, as each brush is made to.
- Hold **Alt** to pick a color from the drawing while painting.
- **Straight lines:** **Shift + click** paints a straight line from where the last stroke ended, and again from
  there; while Shift is held, the line shows. Hold **Ctrl** too to keep it to a few angles: with a pixel brush, the
  clean angles of pixel art (1 pixel across for 1, 2 or 3 down, or the other way round, across and down), in equal
  steps; with the others, every 15°.
- **The outline:** over the drawing, the brush shows the outline of its tip instead of the cursor, as big as it paints
  and turned as it paints (brushes like Dashes turn it with the stroke). With the mouse, that is its size at full
  pressure; with a pen, the size it paints at the pen's pressure, and in the air at the last pressure it painted with. The Pixel brush's outline
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

- **The brushes:** ten come with Lydia (Soft round, Hard round, Pixel, Airbrush, Pencil, Chalk, Calligraphy, Dashes,
  Bristles, Sponge). Click one to paint with it.
- **The paper grain:** some brushes, like Pencil, have the texture of a paper, fixed to the drawing. Pressed lightly,
  they only paint its higher places, leaving the grooves white; pressed harder, they fill more of them. Going over the
  same place again in one stroke doesn't fill them. With the mouse, a brush paints as at full pressure, which still
  leaves some grooves white.
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
- **The pixel grid** shows the pixels from 800% zoom, as sharp squares: the **Grid** button, or **G**, turns it on
  and off.
- With a selection, the brush and the eraser only work inside it. A smart object can't be painted on (see
  [Transforming](#transforming-and-smart-objects)).

## Smudge and blur

**Smudge (U)** drags the paint along, like a finger. **Blur (J)** softens the paint it goes over, more each time it
passes.

- Both work with the tip of the chosen brush, so a textured brush smudges with its texture.
- **Size** and **Strength** are in the bar, and each tool keeps its own. With Smudge, the Strength is how far the paint
  goes: at 50%, a little more than the brush's size, and at 100% it never fades. With a pen, pressing harder makes it
  stronger; the size stays.
- They only read the active layer, and only change that layer: a line on the layer above isn't pulled in.
- With a selection, they only change what is inside it. With the layer's transparency locked, they only color the paint
  already there.
- **The stabilizer**, under Advanced, works here too.

## Liquify

**Liquify (Q)** moves the picture on the active layer instead of painting on it. Choose what it does in the bar:

- **Push** moves the picture along the stroke. At 100% it follows the pen.
- **Bloat** makes the middle of the brush bigger, and **Pucker** smaller, pulling in what is around it.
- **Twirl** turns the picture around the middle of the brush.
- **Reconstruct** brushes the picture back to how it was, to the very pixels.

More about it:

- Each stroke is on the layer at once, and Ctrl+Z undoes it. There is nothing to apply, and you can paint on the layer
  right after.
- Bloat, Pucker, Twirl and Reconstruct go on working while the pen holds still: hold it longer for more.
- **Size** and **Strength** are in the bar, kept apart from the brush's. With a pen, pressing harder makes it stronger; the
  size stays. The brush is always round and soft, whichever is chosen.
- Many strokes don't make the picture softer, because each pixel is worked out from the original.
- **How far back Reconstruct goes:** to the layer as it was before the strokes in a row. Painting, or anything else that
  changes the drawing, or choosing another layer, starts again from the layer as it is then. Ctrl+Z still goes back as
  far as ever.
- It only changes the active layer. With a selection, only what is inside it; with the layer's transparency locked, only
  the colors. A smart object can't be changed until it is converted to pixels.

## Symmetry

**Symmetry**, at the end of the bar, paints the other sides as you paint one. **Y** turns it on and off.

- **Left and right**, **Up and down** and **Four parts** are mirrors. **Radial** goes around the center, in as many
  **Parts** as you choose, from 2 to 12.
- Blue lines show where it is. They aren't part of the drawing: they never come out in an exported image.
- **Move center**: click or drag on the drawing to put the center anywhere on the paper, then press it again to go back to
  the tool. **Center** puts it back in the middle.
- The brush, the eraser, straight lines, Smudge, Blur and Liquify follow it. A stroke and its copies are one step of undo,
  and no darker where they cross.
- Smudge and Liquify work with the paint on the layer, so where a stroke meets its copy they move each other's paint.
- A brush with a paper grain falls on different grooves on each side, like real paper. A pixel brush stays on the pixels,
  and its tip doesn't turn in a radial symmetry.
- Each drawing keeps its own, in its file.

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

Transforming scales, turns, skews, distorts or bends. **Ctrl+T** starts it, or **Transform** in the bar of the selection and
move tools (in a browser, Ctrl+T opens a new tab instead, so use the button there).

- With a selection, the selected part goes into a new layer above as a **smart object**. Without one, the whole layer
  becomes one. On a smart object, it transforms it.
- **The handles:**
  - drag a **corner** to scale, keeping the proportions; with **Shift**, the proportions change;
  - drag a **side** to scale one way;
  - hold **Alt** to scale from the middle;
  - drag **inside** to move it, and **outside** to turn it (**Shift**: in steps of 15°);
  - **Ctrl** + drag a corner distorts it, and Ctrl + drag a side skews it.
- **The mesh:** **Mesh**, in the bar, shows a grid of points in place of the corners and the sides, and **Free** goes
  back to them, keeping the bend, so both can be used in one transform:
  - drag a **point** to bend the picture there, in a smooth curve;
  - **Points** chooses how many there are each way, 3×3 to 6×6: few bend wide areas, more bend details;
  - drag **inside** to move it, and **outside** to turn it, as ever.

  After Enter, the mesh stays with the smart object: transforming it again shows the points where they were.

- **Pixels:** **Smooth** for painting, or **Whole** for pixel art.
- **Ctrl+Z** and **Ctrl+Shift+Z** (or Undo and Redo) go back and forward through each drag while it is made.
- **Enter** (or Apply) applies it, as one step of undo; **Esc** (or Cancel) leaves everything as it was.

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
- Zoomed in, the pixels are smoothed. While a pixel brush is chosen, and where the pixel grid shows, they are sharp
  squares instead, for pixel art. The **Sharp** button, next to Grid, shows them that way at every zoom from 100%.

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

### Autosave and recovering a drawing

Lydia keeps a copy of the drawing in the browser, every 2 minutes if it changed. It never interrupts painting: a stroke
just puts it off. **Autosave**, on the start screen, chooses 1, 2 or 5 minutes, or off. Hover over **Save** to see when
the last copy was made.

If the browser closes or crashes with changes that weren't saved, **Recover**, on the start screen, lists the drawing
with a picture, its size and its time. **Open** goes on from there, and **Delete** throws the copy away. The five newest
drawings are kept. After **Discard**, the last copy stays there too, in case it was a mistake.

- A copy can be up to the interval old: what came after it is gone.
- It isn't a replacement for **Save**: the copies are inside this browser, so clearing the site's data takes them too,
  and they can't be opened in another browser.
- If a copy can't be written, the bar says so (`LYD-108`). The drawing is fine: save it.

If the browser loses the graphics card (after a new driver, a heavy game or the computer going to sleep), Lydia says so
and opens the drawing again by itself. Only the last strokes, the selection and the undo history can be gone. If it
can't open it again, the drawing is in **Recover**.

## The Brush Designer

Opened from the start screen, it draws the tip of a new brush, or changes a brush: **Start from** chooses one, which
opens with its tip on the paper and its settings (the Pixel brush isn't there: its tip is worked out for each size).

- Paint the tip on the paper: black paints fully, gray paints lightly, white doesn't paint. **Brush** and **Eraser**,
  with **Edge** (Soft or Hard), **Strength** and **Size** in the bar; **Clear paper** starts again.
- **Use image…** puts an image on the paper, made smaller if it doesn't fit: dark places paint, light or transparent
  ones don't. It can be retouched and undone like anything painted. **Invert** turns the paper around: what painted
  doesn't, and the other way round.
- Give it a **Name**, and choose how it paints: Spacing, Angle, Turn with the stroke, Random angle, Scatter, Flow,
  Wash (the stroke doesn't pile up over itself) and the pen's pressure. **Noise** gives every copy of the tip a
  texture (Mix, Drops or Worn), with its Grain, Layers, Stretch and Contrast. Pointing at each setting explains it.
- **Paper grain** gives the brush the texture of a paper (see [Brush and eraser](#brush-and-eraser)): choose its
  **Picture**, one of the four that come with Lydia (Paper, Rough, Canvas, Noise) or **Import…** any image (darker is
  higher, where light pressure already paints), its **Depth** (how much of the paper a light touch leaves out; 0% is
  no grain) and its **Scale** (how big the picture is on the paper). The picture goes in the brush's file.
- **Try it** paints with the brush as it is now, at any size; **Clear** wipes the test area.
- **Save to my brushes** adds it to the brush list, and **Export file** saves it as a `.lydbrush` file. A brush that
  comes with Lydia never changes: it opens as a copy. Your own is saved with **Save changes**, or kept as a new brush,
  leaving it as it was, with **Save copy**.

**A pixel brush** (Pixel on the start screen) is drawn on a small paper, zoomed in with the pixel grid, with Lydia's
Pixel brush: each pixel of the tip paints fully (black) or not at all (white), with no edge or strength to choose.
The tip is cut to its painted pixels. The settings that turn the tip or give it noise or a paper grain are left
out; the new brush starts placing its tip at every pixel (Spacing 1%), at one size whatever the pen's pressure.

## When something goes wrong

A message about something that went wrong starts with a code, like `LYD-201`, and is in English whatever the
language chosen. [errors.md](errors.md) lists every code with what it means. When asking for help or reporting a
problem, give the code, and what is in parentheses after the message if there is something.

## All shortcuts

| Shortcut                                       | What it does                                       |
| ---------------------------------------------- | -------------------------------------------------- |
| B / E                                          | Brush / eraser                                     |
| U / J                                          | Smudge / blur                                      |
| Q                                              | Liquify                                            |
| Y                                              | Symmetry on and off                                |
| F / I                                          | Fill bucket / eyedropper                           |
| S / L / W                                      | Rectangle select / lasso / magic wand              |
| V                                              | Move                                               |
| H / Z / R                                      | Hand / zoom / rotate view                          |
| [ / ]                                          | Smaller / bigger brush                             |
| X                                              | Swap the brush's color and the background color    |
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
