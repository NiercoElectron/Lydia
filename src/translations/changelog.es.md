# Historial de cambios

## [0.14.0] - 2026-10-30

### Added

- **Textura del papel** para pinceles ([decisión 67](docs/decisions.md#67-the-paper-grain)): una textura fija en el papel, cuyos surcos quedan blancos con poca presión y se rellenan con más presión, como un lápiz sobre papel real. En el Editor de pinceles, en **Textura del papel**: elige una de las cuatro opciones de Lydia (Papel, Áspero, Lienzo, Ruido) o importa una imagen y ajusta la **Profundidad** y la **Escala**. La textura se guarda en el archivo del pincel.
- Un pincel **Lápiz**, con la textura Papel.
- **Modifica cualquier pincel** en el Editor de pinceles ([decisión 70](docs/decisions.md#70-changing-brushes-and-images-as-tips)): **Empezar con**, en la pantalla inicial, abre un pincel con su punta y configuración. Un pincel propio se puede sobrescribir o guardar con **Guardar copia**; los incluidos en Lydia siempre se convierten en copias, conservando el original.
- **Una imagen como punta:** **Usar imagen…** coloca la imagen en el papel del Editor de pinceles, donde se puede retocar, e **Invertir** invierte las zonas claras y oscuras del papel.

### Changed

- Al ampliar, los píxeles se **suavizan**, como en ibisPaint y Procreate, para que las líneas finas no parezcan escalones ([decisión 68](docs/decisions.md#68-smooth-pixels-when-zoomed-in)). Siguen siendo cuadrados nítidos para pixel art mientras hay un pincel de píxeles seleccionado y donde aparece la cuadrícula de píxeles.
- Con lápiz, el **contorno del pincel** sigue el tamaño de la pintura: usa la presión actual durante el trazo y la última presión mientras el lápiz está en el aire ([decisión 69](docs/decisions.md#69-the-brushs-outline-follows-the-pen)). Con ratón, sigue mostrando el tamaño a presión máxima.

### Fixed

- Una punta pintada por todo el papel de 1024×1024 creaba un pincel cuyo archivo no se podía abrir.

## [0.13.0] - 2026-10-29

### Added

- Un **panel de colores**, en la esquina superior derecha, sustituye al selector de colores del navegador ([decisión 65](docs/decisions.md#65-the-color-panel)): un anillo de tonos alrededor de un triángulo de matices que gira con el tono elegido; el color del pincel y el de fondo, intercambiables con **X**; el código del color (#rrggbb); controles de H, S y V; y los colores usados recientemente, guardados para la próxima visita.
- Una **bandeja de colores** ([decisión 66](docs/decisions.md#66-the-color-tray)), que se abre desde el panel de colores: colores guardados para volver a elegirlos rápidamente, que permanecen hasta quitarlos. Una lista para todos los dibujos, guardada por el navegador, y otra para cada dibujo, guardada en su archivo.

## [0.12.0] - 2026-10-29

### Added

- La **varita mágica** (W) ([decisión 64](docs/decisions.md#64-the-magic-wand)): selecciona el área alrededor del punto elegido cuyos colores se parecen al de ese punto, como el relleno, con ajustes propios: Tolerancia, Referencia, Expandir (sobre el borde suave de las líneas, para colorear por dentro sin dejar un borde claro) y **Contiguo**, que, desactivado, selecciona el color en todo el dibujo. Mayús añade y Alt quita.
- Español en toda la interfaz y el historial de versiones, con la opción Español y detección automática de variantes del idioma del sistema como es-ES, es-MX y es-AR.
- Portugués brasileño en toda la interfaz, incluidos el Editor de pinceles y el historial de versiones. La pantalla inicial ofrece Sistema, Português (Brasil) y English, recuerda la elección y detecta el portugués a partir del idioma preferido del navegador. Los nombres de las capas y carpetas nuevas usan el idioma elegido; los nombres del usuario se conservan.
- **Códigos de error**: cada mensaje de error empieza con un código, como LYD-201, y permanece en inglés en cualquier idioma, para consultarlo en [docs/errors.md](docs/errors.md) o incluirlo en un informe ([decisión 63](docs/decisions.md#63-lydia-in-portuguese-and-spanish)). Los errores inesperados usan el código de la operación en curso, con la causa entre paréntesis.

## [0.11.1] - 2026-10-29

### Changed

- La **opacidad se muestra en tiempo real** al mover el control, con cualquier modo de fusión en las capas y carpetas, con o sin recorte. Antes, la composición se reconstruía en pequeños grupos de bloques, causando retrasos en dibujos grandes. [decisión 60](docs/decisions.md#60-the-live-opacity-with-any-blend-mode).
- **Los movimientos y las transformaciones muestran el resultado final** durante el arrastre, respetando fusión, opacidad, recortes y carpetas. Antes, algunas capas aparecían como Normal o sin recorte hasta soltar. [decisión 61](docs/decisions.md#61-showing-a-move-as-it-will-be).
- En dibujos grandes, el movimiento empieza a verse de inmediato, cada nueva posición tarda pocos milisegundos y la opacidad también se dibuja más rápido. Al soltar, una **barra** junto a «Moviendo…» indica el progreso de la aplicación.
- La opción **Todas las capas** del relleno considera la imagen tal como aparece en pantalla, con fusión, recortes y carpetas. La pintura invisible, como la parte de una capa recortada que queda fuera de su base, ya no bloquea el relleno. [decisión 62](docs/decisions.md#62-the-fill-bucket-sees-the-layers-as-they-show).

## [0.11.0] - 2026-10-28

### Added

- **Duplicar** (Ctrl+J) y **Combinar hacia abajo** (Ctrl+E) en el panel de capas. La copia solo ocupa memoria adicional cuando se pinta sobre ella; la combinación conserva la imagen y se puede deshacer en un paso. [decisión 54](docs/decisions.md#54-duplicating-and-merging-layers).
- **Bloqueo de transparencia** mediante el candado en la fila de la capa: el pincel y el relleno solo modifican zonas ya pintadas, y el borrador queda deshabilitado. La configuración se guarda con el dibujo. [decisión 55](docs/decisions.md#55-locking-a-layers-transparency).
- **Modos de fusión** en una lista sobre la opacidad: Multiplicar, Trama, Superponer, Añadir, Oscurecer, Aclarar, Sobreexponer color, Subexponer color, Luz suave, Luz fuerte, Diferencia, Tono, Saturación, Color y Luminosidad. También se aplican al combinar capas. [decisión 56](docs/decisions.md#56-blend-modes).
- **Máscaras de recorte**: el clip en la fila de la capa (o Ctrl+Alt+G) limita su visibilidad a las zonas pintadas de la capa inferior, para colorear y sombrear dentro de los contornos. [decisión 57](docs/decisions.md#57-clipping-masks).
- **Carpetas de capas**, también anidadas: usa Nueva carpeta, Ctrl+G o arrastra capas a su interior. Pueden usar Paso a través o un modo propio; se pueden ocultar, atenuar, recortar, copiar, combinar, eliminar y mover como una unidad. [decisión 58](docs/decisions.md#58-folders-of-layers).

### Fixed

- Arrastrar rápidamente en el selector de color causaba saltos porque toda la pantalla se redibujaba con cada cambio. Ahora se redibuja como máximo una vez por fotograma.

## [0.10.0] - 2026-10-26

### Added

- **Novedades** a la derecha de la pantalla inicial: cambios de cada versión leídos de este historial, con la más reciente abierta y las demás plegadas.
- Un icono en las capas con pintura fuera del papel permite mostrar ese contenido atenuado alrededor del papel u ocultarlo. Empieza desactivado y se guarda con el dibujo. [decisión 50](docs/decisions.md#50-showing-paint-off-the-paper).
- Trazos con **Píxel perfecto**: con pinceles de píxeles, el botón elimina las esquinas duplicadas de los trazos a mano alzada, dejando un píxel por escalón. Funciona en todos los tamaños y con pinceles creados en el editor. Empieza desactivado y el navegador recuerda la elección. [decisión 51](docs/decisions.md#51-pixel-perfect-strokes).
- Líneas rectas: **Shift + clic** con pincel o borrador pinta una línea desde el final del último trazo, con vista previa mientras se mantiene Shift. Con **Ctrl**, usa ángulos regulares de pixel art (1:1, 2:1, 3:1…) con pinceles de píxeles, o pasos de 15° con los demás. Las líneas de píxeles tienen un píxel por columna y escalones tan regulares como permite el ángulo. [decisión 52](docs/decisions.md#52-straight-lines).
- Exportación ampliada: **Escala** amplía PNG o JPEG 2, 3, 4, 6 u 8 veces, manteniendo cada píxel como un cuadrado nítido. La elección se guarda con el dibujo. La resolución aumenta en la misma proporción para conservar el tamaño impreso; el nombre indica la ampliación (`@4x`). No se ofrecen escalas que superen los límites de tamaño. [decisión 53](docs/decisions.md#53-exporting-enlarged).

### Changed

- Las capas pueden guardar pintura fuera del papel. El contenido desplazado fuera mediante movimiento o transformación queda oculto, reaparece al volver y se muestra atenuado durante la operación. Las imágenes mayores que el papel conservan su tamaño. Los dibujos con ese contenido se guardan como archivos `.lyd` de versión 4, incompatibles con versiones anteriores; los demás conservan el formato anterior. [decisión 49](docs/decisions.md#49-layers-off-the-paper).

### Fixed

- Los trazos sobre bordes suaves de selecciones perdían intensidad al permanecer en el mismo sitio, porque el borde se aplicaba repetidamente. Ahora la cantidad de pintura respeta el borde sin reducirse con cada movimiento. [decisión 40](docs/decisions.md#40-selections).

## [0.9.0] - 2026-10-25

### Added

- **Contorno** del pincel: la punta sigue al puntero con su forma, tamaño a presión máxima y rotación. El contorno del pincel Píxel sigue los píxeles que pintaría. Por debajo de 8 píxeles en pantalla aparece la cruz del cursor. El botón Contorno, junto a Cuadrícula, activa o desactiva la opción. [decisión 45](docs/decisions.md#45-the-brushs-outline).
- **Estabilizador** en **Avanzado**, de 0 (desactivado) a 100, para todos los pinceles, con preferencia guardada en el navegador. En modo **Suave**, el pincel sigue al lápiz con retraso y continúa cuando este se detiene. En **Cuerda**, solo se mueve cuando el lápiz supera la cuerda. Al levantar el lápiz, el trazo continúa hasta su última posición. Una línea une el pincel y el lápiz durante el retraso. [decisión 46](docs/decisions.md#46-the-stabilizer).
- Afinado en los extremos: **Afinar inicio** y **Afinar final**, en **Avanzado**, reducen el trazo a lo largo de la cantidad elegida de píxeles, también con ratón. **Afinado** elige **Tamaño**, **Opacidad** o **Ambos**. El final se calcula al levantar el lápiz. En trazos cortos, ambas longitudes se reducen hasta encontrarse; un clic pinta un punto entero. [decisión 47](docs/decisions.md#47-tapered-stroke-ends-and-the-advanced-panel).
- **Avanzado** abre sobre el dibujo un panel con opciones menos frecuentes, como estabilizador y afinado. Pulsar fuera o Esc cierra el panel; fijarlo lo mantiene abierto, también en la próxima visita.
- Pinceles de píxeles en el editor: **Píxel** en la pantalla inicial abre un papel de 16, 32 o 64 píxeles, ampliado y con cuadrícula, para dibujar la punta píxel a píxel. El pincel pinta cada píxel entero o no lo pinta, a 1×, 2×, 3×… el tamaño de la punta, usando el múltiplo más cercano. Al seleccionarlo se establece 1×; el contorno sigue los píxeles. Las versiones anteriores abren estos pinceles como pinceles suaves. [decisión 48](docs/decisions.md#48-pixel-brushes-drawn-in-the-brush-designer).

### Changed

- Las opciones de la herramienta permanecen en la primera fila de la barra y las acciones (Deshacer, vista, Exportar…) en la segunda. Cambiar de herramienta ya no modifica el tamaño del área de dibujo ni desplaza la imagen.

### Fixed

- Abrir el editor de pinceles por segunda vez hacía que el área de prueba y toda la pantalla fallaran con el primer trazo. [decisión 30](docs/decisions.md#30-the-brush-designer).

## [0.8.5] - 2026-10-25

### Added

- Modo oscuro: en **Interfaz**, en la pantalla inicial, elige **Sistema** (sigue al equipo), **Claro** u **Oscuro**. El navegador recuerda la elección. La zona gris alrededor del papel también se oscurece; los colores del dibujo no cambian. [decisión 44](docs/decisions.md#44-a-dark-mode).

## [0.8.4] - 2026-10-25

### Added

- Los valores de los controles deslizantes se pueden escribir pulsando el número. Enter o un clic fuera confirma dentro de los límites; Esc conserva el valor anterior. El zoom y el ángulo también se pueden escribir y cambian alrededor del centro de la pantalla.

## [0.8.3] - 2026-10-25

### Added

- Los dibujos guardados se vuelven a abrir con el mismo zoom, ángulo, reflejo y posición central. Antes, siempre se abrían sin rotación, mostrando todo el papel. [decisión 38](docs/decisions.md#38-turning-and-flipping-the-view).
- La pantalla inicial muestra la versión junto al nombre Lydia.
- Una guía de herramientas y atajos en [docs/guide.md](docs/guide.md). El README enlaza con ella en lugar de la antigua tabla de atajos.

## [0.8.2] - 2026-10-23

### Added

- Importación de imágenes con una bandeja: el botón Bandeja, bajo las herramientas, abre y cierra el panel. Importa o suelta archivos en la ventana y arrastra las imágenes al dibujo tantas veces como necesites. La imagen entra como objeto inteligente con controles: Enter confirma en una nueva capa superior con el nombre del archivo; Esc cancela. En esta versión, las imágenes mayores se reducían para caber en el papel. La bandeja permanece entre dibujos mientras Lydia esté abierto. [decisión 43](docs/decisions.md#43-importing-images-the-tray).

### Changed

- Los controles de las esquinas conservan las proporciones: arrastra hacia fuera para ampliar y hacia dentro para reducir. Shift permite cambiar las proporciones (antes, Shift las conservaba), como en Photoshop.

## [0.8.1] - 2026-10-23

### Fixed

- El pincel Píxel pinta el siguiente píxel en cuanto el lápiz entra en él, independientemente de dónde empezó el trazo. Antes, a veces había que pasar del centro del siguiente píxel.

## [0.8.0] - 2026-10-23

Herramientas básicas: columna de herramientas, cuentagotas, rotación y reflejo de la vista, relleno, selecciones, movimiento y objetos inteligentes con transformaciones sin pérdida.

### Added

- Columna de herramientas con iconos a la izquierda del editor, como en Photoshop y Krita. [decisión 37](docs/decisions.md#37-a-tool-column-and-the-eyedropper).
- Cuentagotas (I): toma el color visible con todas las capas al pulsar o arrastrar y restablece la opacidad del trazo al 100%. Mantener Alt con pincel o borrador también toma colores.
- Herramientas Mano (H), Zoom (Z) y Girar vista (R). Un clic amplía, Alt + clic reduce y arrastrar horizontalmente ajusta el zoom suavemente. La rotación se realiza alrededor del centro de la pantalla, en pasos de 15° con Shift. Shift + Espacio permite girar con cualquier herramienta, como en Krita. [decisión 38](docs/decisions.md#38-turning-and-flipping-the-view).
- Reflejo de la vista con M o **Reflejar**, sin modificar el dibujo.
- Zoom y ángulo en la barra superior, con **Enderezar** (restablece 0°) y **Reflejar** junto a **Ajustar a pantalla**.
- Relleno (F): colorea la región pulsada con el color y la opacidad elegidos. **Tolerancia**, **Todas las capas** o **Esta capa** y **Expandir** controlan la operación. La expansión avanza por detrás de los bordes suaves hasta su parte más oscura, como máximo los píxeles elegidos, sin dejar halos claros. Los dibujos grandes se procesan en segundo plano con «Rellenando…» en la barra. Alt toma un color. [decisión 39](docs/decisions.md#39-the-fill-bucket).
- Selecciones con **Selección rectangular** (S) y **Lazo** (L), con contorno animado. Shift + arrastrar añade; Alt + arrastrar quita; un clic deselecciona. Los bordes pueden ser suaves o duros para pixel art, siguiendo el tipo de pincel hasta cambiarlos manualmente. Pincel, borrador y relleno respetan la selección; Delete borra su contenido. Ctrl+A selecciona todo, Ctrl+D deselecciona y Ctrl+Shift+I o **Invertir** invierte. Los cambios se pueden deshacer. [decisión 40](docs/decisions.md#40-selections).
- Herramienta Mover (V): desplaza la selección de la capa activa o toda la capa en píxeles enteros, junto con la selección. Shift mantiene el movimiento horizontal o vertical. La vista previa respeta las capas superiores. En esta versión, la pintura movida fuera del papel se perdía. Cada movimiento es un paso de deshacer junto con la selección. [decisión 41](docs/decisions.md#41-moving-paint).
- Objetos inteligentes y transformaciones: Ctrl+T o **Transformar** convierte la selección en una nueva capa, o toda la capa en un objeto inteligente, conservando los píxeles originales. Los controles redimensionan, giran por fuera y mueven por dentro; Alt usa el centro, Shift controla proporciones y pasos de 15°, y Ctrl distorsiona esquinas o inclina lados. Enter aplica y Esc cancela. Píxeles **Suaves** o **Enteros** en la barra. Las nuevas transformaciones y los movimientos conservan el original. Para pintar, usa **Convertir en píxeles**. Los archivos `.lyd` guardan el original; los dibujos sin objetos inteligentes siguen siendo compatibles con Lydia 0.7. [decisión 42](docs/decisions.md#42-smart-objects-and-transforming).

### Changed

- Los botones Pincel y Borrador pasaron de la barra superior a la columna de herramientas.
- **Ajustar a pantalla** (Ctrl+0) conserva la rotación y el reflejo y encuadra el papel girado.
- Mantener Espacio muestra el cursor de mano.
- Los bloques de un solo color se envían a la tarjeta gráfica sin sus píxeles: la tarjeta los rellena con el color.
- El contorno animado de las nuevas selecciones aparece antes: las imágenes de los bordes se generan unas nueve veces más rápido.

## [0.7.0] - 2026-10-23

Pinceles con ruido filtrado y trazos pintados en bloques propios.

### Added

- Pinceles con ruido filtrado: números aleatorios filtrados varían cada aplicación conservando el carácter del pincel. En el editor: cantidad, grano, capas finas, estiramiento, contraste, ruido por copia o por trazo y tipos Mezcla, Gotas y Desgaste. Dos pinceles nuevos usan esta función: Cerdas y Esponja. [decisión 35](docs/decisions.md#35-brushes-with-filtered-noise).
- Control de **Opacidad** por trazo y opción **Lavado** en el editor de pinceles: el trazo no acumula pintura sobre sí mismo. [decisión 36](docs/decisions.md#36-strokes-are-painted-in-tiles-of-their-own).

### Changed

- Las vistas previas en la lista y en el área de prueba usan la tarjeta gráfica con el mismo código que el dibujo.

### Fixed

- El borrador ya no deja bloques vacíos donde no había pintura.

## [0.6.0] - 2026-10-23

### Added

- Pincel **Píxel** para pixel art: pinta píxeles enteros con bordes duros desde 1 píxel, con punta redonda calculada para cada tamaño (una cruz en tamaño 3). Las líneas rectas tienen un píxel por columna y la presión cambia el tamaño en pasos de un píxel. La vista previa en la lista muestra los píxeles. [decisión 33](docs/decisions.md#33-the-pixel-brush).
- Cuadrícula de píxeles a partir de un zoom del 800%, con colores calculados a partir del contenido para que siga siendo visible. **Cuadrícula** o G activa y desactiva la opción, y Lydia recuerda la preferencia. [decisión 34](docs/decisions.md#34-a-pixel-grid).

### Fixed

- La tecla `[` reduce el pincel hasta el tamaño 1; antes se detenía en 2.

## [0.5.2] - 2026-10-22

### Added

- Resolución (DPI) por dibujo, elegida en Nuevo proyecto: 300 DPI inicialmente, con botones para 72, 150, 300 y 600. Los formatos de papel siguen la resolución y el diálogo muestra el tamaño impreso. La resolución se guarda; los proyectos antiguos usan 300 DPI.

### Fixed

- Los PNG y JPEG exportados indican la resolución del dibujo, conservando el tamaño de impresión (A4: 21×29,7 cm) y de apertura en otros programas. Antes, los programas tenían que estimarlo y ajustaban a la página de distintas maneras. [decisión 32](docs/decisions.md#32-each-drawing-has-a-resolution-dpi).

## [0.5.1] - 2026-10-22

### Added

- Color de fondo o fondo transparente para nuevos dibujos. La transparencia aparece como cuadrados grises y blancos y se conserva en PNG; JPEG usa blanco. El fondo se guarda en el proyecto; los proyectos antiguos siguen con papel blanco. [decisión 31](docs/decisions.md#31-a-window-for-new-drawings-with-a-background-color-or-none).
- Tamaños comunes: A5, A4, A3, Carta (EE. UU.), Legal (EE. UU.) y Tabloide a 300 DPI, Full HD, 4K UHD y cuadrado de 2048×2048.

### Changed

- **Nuevo proyecto…** abre un diálogo con tamaño, formatos comunes y fondo, recordando las últimas elecciones.

## [0.5.0] - 2026-10-22

Editor de pinceles: crea pinceles dentro del propio Lydia.

### Added

- Editor de pinceles en la pantalla inicial: dibuja la punta en negro y gris sobre papel de 256, 512 o 1024 píxeles, configura espaciado, ángulo, rotación con el trazo, ángulo aleatorio, dispersión, flujo y presión del lápiz. El área de prueba redibuja los trazos después de cada cambio. **Guardar en mis pinceles** añade y selecciona el pincel para el siguiente dibujo; **Exportar archivo** guarda un `.lydbrush`. [decisión 30](docs/decisions.md#30-the-brush-designer).

### Fixed

- Atajos como Ctrl+Z funcionan justo después de escribir en campos, como el nombre de la capa: pintar retira el foco del campo de texto.

## [0.4.0] - 2026-10-22

Pinceles en archivos, para compartir e importar. [decisión 29](docs/decisions.md#29-brushes-are-files).

### Added

- Panel a la izquierda con seis pinceles: Redondo suave, Redondo duro, Aerógrafo, Tiza, Caligrafía y Guiones. Cada uno muestra una muestra y el navegador recuerda el seleccionado.
- Archivos `.lydbrush`: usa **Importar…** o suelta archivos en la ventana para guardarlos en el navegador. **Exportar** guarda el pincel seleccionado para compartir; **Eliminar** quita pinceles añadidos. [decisión 29](docs/decisions.md#29-brushes-are-files).
- Los pinceles pueden girar su punta en un ángulo fijo, con el trazo o aleatoriamente, dispersarla y aplicar menos pintura con cada copia, también según la presión del lápiz.

### Changed

- El borrador borra usando la punta del pincel seleccionado.

## [0.3.1] - 2026-10-22

### Added

- Elección en la pantalla inicial de la memoria de la tarjeta gráfica disponible para capas, de 0,5 a 8 GB (predeterminado: 2 GB), con cantidad de bloques y aviso: los valores altos pueden bloquear Lydia o ralentizar el equipo. El navegador recuerda la elección.

## [0.3.0] - 2026-10-22

Capas completas y cambios rápidos en dibujos grandes. [decisiones 25 a 27](docs/decisions.md#25-every-layer-change-can-be-undone).

### Added

- **Eliminar capa** quita la capa activa y selecciona la inferior.
- Arrastra capas hacia arriba o hacia abajo en la lista. Una línea indica la posición de destino.
- Haz doble clic en el nombre para cambiarlo. Enter confirma y Escape conserva el nombre anterior.
- Deshacer y rehacer para añadir, eliminar, mover, cambiar nombres, ocultar, mostrar y cambiar la opacidad de las capas. Todo el arrastre del control de opacidad cuenta como un paso.

### Changed

- Los cambios en capas, deshacer y los ajustes de opacidad ya no congelan la pantalla en dibujos grandes. La nueva composición se prepara en segundo plano y aparece completa cuando está lista, con «Actualizando…» en la barra durante el proceso.
- Los cambios son más rápidos: la tarjeta gráfica mantiene hasta 8000 bloques (unos 2 GB), en lugar de 2000, evitando reenvíos. Con cuatro capas completas de 10000×10000, mover una capa pasó de 1,3 s a menos de 0,25 s.

### Fixed

- El control de opacidad ya no cambia de tamaño al llegar al 100%.

## [0.2.2] - 2026-10-22

### Added

- **Exportar JPEG** guarda imágenes mucho menores que PNG (8,6 MB frente a 138 MB en una pintura de 10000×10000), con aspecto similar. PNG sigue disponible para conservar cada píxel exactamente. [decisión 24](docs/decisions.md#24-exporting-as-jpeg-too).

## [0.2.1] - 2026-10-22

### Fixed

- La opacidad de la capa cambia durante el arrastre del control, en lugar de solo al soltarlo. [decisión 23](docs/decisions.md#23-the-opacity-changes-live-while-the-slider-moves).

## [0.2.0] - 2026-10-22

Nuevo motor de dibujo, diseñado para dibujos grandes con muchas capas. [decisión 5](docs/decisions.md#5-raster-layers-made-of-tiles-drawn-with-pixijs).

### Added

- Lienzos de hasta 10000×10000 píxeles (antes, hasta 4096×4096).
- Panel de capas: añadir encima de la activa, seleccionar, ocultar, mostrar y cambiar la opacidad.
- Rehacer mediante el botón, Ctrl/Cmd+Shift+Z o Ctrl+Y.
- Zoom con Ctrl + rueda del ratón o gesto de pinza en el panel táctil. Navegación con la rueda, dos dedos, Espacio + arrastrar o el botón central. Ajustar a pantalla (Ctrl/Cmd+0) muestra el dibujo completo.
- La presión del lápiz cambia el tamaño del pincel.
- Atajos: B para pincel, E para borrador, `[` y `]` para reducir y ampliar el pincel.
- El navegador pide confirmación al cerrar una pestaña con cambios sin guardar.

### Changed

- Los dibujos pasan a usar píxeles en bloques de 256×256, renderizados por la tarjeta gráfica (PixiJS y WebGL 2), en lugar de una lista de trazos redibujados con cada cambio. Lydia pasa a necesitar WebGL 2.
- El pincel es redondo y suave.
- Limpiar pasa a ser Limpiar capa y se puede deshacer.
- Los archivos `.lyd` usan un nuevo formato con bloques comprimidos para guardar y abrir proyectos grandes rápidamente.

### Removed

- Los proyectos de Lydia 0.1 ya no se pueden abrir; la aplicación explica el motivo. Lydia 0.1 sigue disponible en GitHub para abrirlos. [decisión 21](docs/decisions.md#21-a-new-project-file-without-opening-the-old-one).

## [0.1.0] - 2026-10-22

La primera versión utilizable.

### Added

- Pantalla inicial: crear un dibujo con tamaño personalizado (hasta 4096×4096) o abrir un proyecto.
- Dibujo a mano alzada con ratón o lápiz y trazos suavizados.
- Barra con color, tamaño del pincel y borrador.
- Deshacer mediante el botón o Ctrl/Cmd+Z.
- Limpiar el lienzo.
- Guardar y abrir proyectos `.lyd`.
- Exportar el dibujo como PNG.
- Dibujo nítido en pantallas de alta densidad.
