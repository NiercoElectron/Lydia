# Errors

When something goes wrong, Lydia's message starts with a code, like `LYD-201`. The messages are in English whatever
the language of the interface, so that they read the same for everyone, and the code can be looked up here or given
in a report ([decision 63](decisions.md#63-lydia-in-portuguese-and-spanish)). A message that ends with something in
parentheses had a cause Lydia didn't expect, given by the browser: it helps to give it in the report too.

The first digit says where an error comes from. A code is never given to another error, even once its own is no
longer used. The list in the code is in `src/errors.ts`.

## 0: inside Lydia

| Code    | Message                                       | What it means                                                                                                  |
| ------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| LYD-001 | Unpacked {actual} bytes, expected {expected}. | Pixels kept in memory came out the wrong size when unpacked. It should never happen: it is a mistake in Lydia. |

## 1: projects

| Code    | Message                                                                                | What it means                                                                                     |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| LYD-101 | This file is not a Lydia project.                                                      | The file chosen isn't a `.lyd` file saved by Lydia.                                               |
| LYD-102 | This project was made with Lydia 0.1, and this version of Lydia can no longer open it. | The very first versions saved projects in another way.                                            |
| LYD-103 | This project was made with a newer version of Lydia. Update Lydia to open it.          | The project has things this version doesn't know.                                                 |
| LYD-104 | This project file is damaged.                                                          | Part of the file is missing or changed, for example a download that stopped before the end.       |
| LYD-105 | Could not open the project.                                                            | Something else went wrong while opening it: the cause is in parentheses.                          |
| LYD-106 | Could not save the project.                                                            | Something went wrong while saving it, for example not enough memory: the cause is in parentheses. |

## 2: brushes

| Code    | Message                                                                                 | What it means                                                                                         |
| ------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| LYD-201 | This is not a Lydia brush.                                                              | The file isn't a `.lydbrush` file made by Lydia.                                                      |
| LYD-202 | This brush was made by a newer version of Lydia. Update Lydia to use it.                | The brush has things this version doesn't know.                                                       |
| LYD-203 | The tip of this brush is not a PNG image.                                               | The brush file is damaged: its tip can't be read.                                                     |
| LYD-204 | The tip of this brush is too big ({width}×{height} pixels). The biggest is {max}×{max}. | A tip can be at most 1024×1024 pixels.                                                                |
| LYD-205 | The tip of this brush has no paint.                                                     | The tip is all transparent, so it would paint nothing.                                                |
| LYD-206 | Only Lydia brushes ({extension} files) can be added.                                    | Only `.lydbrush` files go in the list of brushes.                                                     |
| LYD-207 | This file is too big to be a brush.                                                     | A brush file is at most 8 MB.                                                                         |
| LYD-208 | This brush is already in the list.                                                      | The same brush was added before.                                                                      |
| LYD-209 | Could not add this brush.                                                               | Something else went wrong while adding it: the cause is in parentheses.                               |
| LYD-210 | Could not use this brush.                                                               | The chosen brush couldn't be made ready to paint with: the cause is in parentheses.                   |
| LYD-211 | Could not delete the brush.                                                             | The browser didn't let Lydia take it out of its storage: the cause is in parentheses.                 |
| LYD-212 | Could not save the brush in this browser.                                               | The browser didn't let Lydia keep it, for example in a private window: the cause is in parentheses.   |
| LYD-213 | Could not make a picture of the tip.                                                    | The browser couldn't make the tip's image.                                                            |
| LYD-214 | Lydia has no brush called "{name}".                                                     | One of the brushes that come with Lydia is missing. It should never happen: it is a mistake in Lydia. |

## 3: images and the tray

| Code    | Message                                   | What it means                                                                       |
| ------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| LYD-301 | Not an image Lydia can open.              | The browser can't open this file as an image.                                       |
| LYD-302 | Could not add this image.                 | Something else went wrong while adding it to the tray: the cause is in parentheses. |
| LYD-303 | Could not put the image into the drawing. | Something went wrong while placing it: the cause is in parentheses.                 |
| LYD-304 | This image is too big for this browser.   | The exported image is bigger than the browser can make. Try a smaller **Scale**.    |
| LYD-305 | Could not export the image.               | Something else went wrong while exporting: the cause is in parentheses.             |

## 4: the browser and the graphics card

| Code    | Message                                                                    | What it means                                                                                   |
| ------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| LYD-401 | Lydia needs WebGL 2, which this browser or graphics card does not support. | Lydia draws with the graphics card through WebGL 2. Try another browser, or update its drivers. |
| LYD-402 | Could not start the drawing.                                               | Something else went wrong while starting it: the cause is in parentheses.                       |
