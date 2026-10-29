# Histórico de alterações

## [0.11.1] - 2026-10-29

### Changed

- A **opacidade aparece em tempo real** ao mover o controle, com qualquer modo de mesclagem nas camadas e pastas, com ou sem recorte. Antes, a composição era refeita em pequenos grupos de blocos, causando atraso em desenhos grandes. [decisão 60](docs/decisions.md#60-the-live-opacity-with-any-blend-mode).
- **Movimentos e transformações mostram o resultado final** durante o arraste, respeitando mesclagem, opacidade, recortes e pastas. Antes, algumas camadas apareciam como Normal ou sem recorte até soltar. [decisão 61](docs/decisions.md#61-showing-a-move-as-it-will-be).
- Em desenhos grandes, o movimento começa a aparecer imediatamente, cada nova posição leva poucos milissegundos e a opacidade também é desenhada mais rápido. Ao soltar, uma **barra** ao lado de “Movendo…” mostra o progresso da aplicação.
- A opção **Todas as camadas** do preenchimento considera a imagem como aparece na tela, com mesclagem, recortes e pastas. Pintura invisível, como a parte de uma camada recortada fora da base, não bloqueia mais o preenchimento. [decisão 62](docs/decisions.md#62-the-fill-bucket-sees-the-layers-as-they-show).

## [0.11.0] - 2026-10-28

### Added

- **Duplicar** (Ctrl+J) e **Mesclar com a de baixo** (Ctrl+E) no painel de camadas. A cópia só ocupa memória adicional quando é pintada; a mesclagem preserva a imagem e pode ser desfeita em uma etapa. [decisão 54](docs/decisions.md#54-duplicating-and-merging-layers).
- **Bloqueio da transparência** pelo cadeado na linha da camada: pincel e preenchimento só alteram áreas já pintadas, e a borracha fica indisponível. A configuração é salva no desenho. [decisão 55](docs/decisions.md#55-locking-a-layers-transparency).
- **Modos de mesclagem** em uma lista acima da opacidade: Multiplicar, Divisão, Sobrepor, Adicionar, Escurecer, Clarear, Subexposição de cores, Superexposição de cores, Luz suave, Luz intensa, Diferença, Matiz, Saturação, Cor e Luminosidade. A mesclagem de camadas também os considera. [decisão 56](docs/decisions.md#56-blend-modes).
- **Máscaras de recorte**: o clipe na linha da camada (ou Ctrl+Alt+G) limita sua exibição às áreas pintadas da camada abaixo, para colorir e sombrear dentro dos contornos. [decisão 57](docs/decisions.md#57-clipping-masks).
- **Pastas de camadas**, inclusive aninhadas: use Nova pasta, Ctrl+G ou arraste camadas para dentro delas. Podem usar Passagem direta ou um modo próprio; podem ser ocultadas, ter a opacidade alterada, receber recorte, ser copiadas, mescladas, excluídas e movidas como uma unidade. [decisão 58](docs/decisions.md#58-folders-of-layers).

### Fixed

- Arrastar rapidamente no seletor de cores causava engasgos porque a tela inteira era redesenhada a cada mudança. Agora ela é redesenhada no máximo uma vez por quadro.

## [0.10.0] - 2026-10-26

### Added

- **Novidades** à direita da tela inicial: alterações de cada versão lidas deste histórico, com a mais recente aberta e as demais recolhidas.
- Um ícone nas camadas com pintura fora do papel permite mostrar esse conteúdo esmaecido ao redor do papel ou ocultá-lo. Começa desativado e é salvo com o desenho. [decisão 50](docs/decisions.md#50-showing-paint-off-the-paper).
- Traços com **Pixel perfeito**: com pincéis de pixel, o botão elimina cantos duplicados dos traços à mão livre, deixando um pixel por degrau da linha. Funciona em todos os tamanhos e com pincéis criados no editor. Começa desativado e a escolha é lembrada pelo navegador. [decisão 51](docs/decisions.md#51-pixel-perfect-strokes).
- Linhas retas: **Shift + clique** com pincel ou borracha pinta uma linha a partir do fim do último traço, com prévia enquanto Shift está pressionado. Com **Ctrl**, usa ângulos regulares de pixel art (1:1, 2:1, 3:1…) com pincéis de pixel, ou passos de 15° com os demais. As linhas de pixel têm um pixel por coluna e degraus tão regulares quanto o ângulo permite. [decisão 52](docs/decisions.md#52-straight-lines).
- Exportação ampliada: **Escala** amplia PNG ou JPEG em 2, 3, 4, 6 ou 8 vezes, mantendo cada pixel como um quadrado nítido. A escolha é salva no desenho. A resolução cresce na mesma proporção para preservar o tamanho impresso; o nome indica a ampliação (`@4x`). Escalas que excedem os limites de tamanho não são oferecidas. [decisão 53](docs/decisions.md#53-exporting-enlarged).

### Changed

- Camadas podem guardar pintura fora do papel. Conteúdo movido para fora por movimento ou transformação fica oculto, reaparece quando retorna e é mostrado esmaecido durante a operação. Imagens maiores que o papel mantêm o tamanho. Desenhos com esse conteúdo são salvos como arquivos `.lyd` de versão 4, incompatíveis com versões anteriores; os demais mantêm o formato anterior. [decisão 49](docs/decisions.md#49-layers-off-the-paper).

### Fixed

- Traços sobre bordas suaves de seleções perdiam intensidade ao permanecer no mesmo lugar, pois a borda era aplicada repetidamente. Agora a quantidade de tinta respeita a borda sem se reduzir a cada movimento. [decisão 40](docs/decisions.md#40-selections).

## [0.9.0] - 2026-10-25

### Added

- **Contorno** do pincel: a ponta acompanha o ponteiro com sua forma, tamanho em pressão máxima e rotação. O contorno do pincel Pixel segue os pixels que seriam pintados. Abaixo de 8 pixels na tela, aparece a cruz do cursor. O botão Contorno, ao lado de Grade, ativa ou desativa a opção. [decisão 45](docs/decisions.md#45-the-brushs-outline).
- **Estabilizador** em **Avançado**, de 0 (desativado) a 100, para todos os pincéis, com preferência salva no navegador. No modo **Suave**, o pincel segue a caneta com atraso e continua quando ela para. Em **Corda**, só se move quando a caneta ultrapassa a corda. Ao levantar a caneta, o traço segue até sua última posição. Uma linha liga o pincel à caneta durante o atraso. [decisão 46](docs/decisions.md#46-the-stabilizer).
- Afinamento nas extremidades: **Afinar início** e **Afinar fim**, em **Avançado**, reduzem o traço ao longo da quantidade escolhida de pixels, inclusive com mouse. **Afinamento** escolhe **Tamanho**, **Opacidade** ou **Ambos**. O fim é calculado ao levantar a caneta. Em traços curtos, os dois comprimentos são reduzidos para se encontrar; um clique pinta um ponto inteiro. [decisão 47](docs/decisions.md#47-tapered-stroke-ends-and-the-advanced-panel).
- **Avançado** abre sobre o desenho um painel com opções menos frequentes, como estabilizador e afinamento. Clicar fora ou pressionar Esc fecha o painel; fixá-lo mantém aberto, inclusive na próxima visita.
- Pincéis de pixel no editor de pincéis: **Pixel** na tela inicial abre um papel de 16, 32 ou 64 pixels, ampliado e com grade, para desenhar a ponta pixel a pixel. O pincel pinta cada pixel por inteiro ou não pinta, em 1×, 2×, 3×… o tamanho da ponta, usando o múltiplo mais próximo. Selecioná-lo define 1×; o contorno segue os pixels. Versões anteriores abrem esses pincéis como pincéis suaves. [decisão 48](docs/decisions.md#48-pixel-brushes-drawn-in-the-brush-designer).

### Changed

- As opções da ferramenta ficam sempre na primeira linha da barra e as ações (Desfazer, visualização, Exportar…) na segunda. Trocar de ferramenta não muda mais o tamanho da área de desenho nem desloca a imagem.

### Fixed

- Abrir o editor de pincéis pela segunda vez fazia a área de teste e a tela inteira falharem no primeiro traço. [decisão 30](docs/decisions.md#30-the-brush-designer).

## [0.8.5] - 2026-10-25

### Added

- Modo escuro: em **Interface**, na tela inicial, escolha **Sistema** (acompanha o computador), **Claro** ou **Escuro**. O navegador lembra a escolha. A área cinza ao redor do papel também escurece; as cores do desenho não mudam. [decisão 44](docs/decisions.md#44-a-dark-mode).

## [0.8.4] - 2026-10-25

### Added

- Valores dos controles deslizantes podem ser digitados clicando no número. Enter ou um clique fora confirma dentro dos limites; Esc mantém o valor anterior. Zoom e ângulo também podem ser digitados e mudam em torno do centro da tela.

## [0.8.3] - 2026-10-25

### Added

- Desenhos salvos reabrem com o mesmo zoom, ângulo, espelhamento e posição central. Antes, sempre abriam sem rotação, mostrando o papel inteiro. [decisão 38](docs/decisions.md#38-turning-and-flipping-the-view).
- A tela inicial mostra a versão ao lado do nome Lydia.
- Um guia de ferramentas e atalhos em [docs/guide.md](docs/guide.md). O README aponta para ele no lugar da antiga tabela de atalhos.

## [0.8.2] - 2026-10-23

### Added

- Importação de imagens com uma bandeja: o botão Bandeja, abaixo das ferramentas, abre e fecha o painel. Importe ou solte arquivos na janela e arraste as imagens para o desenho quantas vezes precisar. A imagem entra como objeto inteligente com alças: Enter confirma em uma nova camada acima, com o nome do arquivo; Esc cancela. Nesta versão, imagens maiores eram reduzidas para caber no papel. A bandeja permanece entre desenhos enquanto o Lydia estiver aberto. [decisão 43](docs/decisions.md#43-importing-images-the-tray).

### Changed

- As alças dos cantos preservam as proporções: arraste para fora para ampliar e para dentro para reduzir. Shift permite alterar as proporções (antes, Shift as preservava), como no Photoshop.

## [0.8.1] - 2026-10-23

### Fixed

- O pincel Pixel pinta o próximo pixel assim que a caneta entra nele, independentemente de onde o traço começou. Antes, às vezes era necessário passar do centro do próximo pixel.

## [0.8.0] - 2026-10-23

Ferramentas básicas: coluna de ferramentas, conta-gotas, rotação e espelhamento da visualização, preenchimento, seleções, movimento e objetos inteligentes com transformações sem perda.

### Added

- Coluna de ferramentas com ícones à esquerda do editor, como no Photoshop e no Krita. [decisão 37](docs/decisions.md#37-a-tool-column-and-the-eyedropper).
- Conta-gotas (I): captura a cor visível com todas as camadas ao clicar ou arrastar e restaura a opacidade do traço para 100%. Segurar Alt com pincel ou borracha também captura cores.
- Ferramentas Mão (H), Zoom (Z) e Girar visualização (R). Clique amplia, Alt + clique reduz, e arrastar horizontalmente ajusta o zoom suavemente. A rotação ocorre ao redor do centro da tela, em passos de 15° com Shift. Shift + Espaço permite girar com qualquer ferramenta, como no Krita. [decisão 38](docs/decisions.md#38-turning-and-flipping-the-view).
- Espelhamento da visualização com M ou **Espelhar**, sem alterar o desenho.
- Zoom e ângulo na barra superior, com **Endireitar** (restaura 0°) e **Espelhar** ao lado de **Ajustar à tela**.
- Preenchimento (F): colore a região clicada com a cor e a opacidade escolhidas. **Tolerância**, **Todas as camadas** ou **Esta camada** e **Expandir** controlam a operação. A expansão avança por trás das bordas suaves até a parte mais escura, no máximo os pixels escolhidos, sem deixar halos claros. Desenhos grandes são processados em segundo plano com “Preenchendo…” na barra. Alt captura uma cor. [decisão 39](docs/decisions.md#39-the-fill-bucket).
- Seleções com **Seleção retangular** (S) e **Laço** (L), com contorno animado. Shift + arraste adiciona; Alt + arraste remove; clique desmarca. As bordas podem ser suaves ou duras para pixel art, acompanhando o tipo de pincel até serem alteradas manualmente. Pincel, borracha e preenchimento respeitam a seleção; Delete apaga seu conteúdo. Ctrl+A seleciona tudo, Ctrl+D desmarca, e Ctrl+Shift+I ou **Inverter** inverte. As alterações podem ser desfeitas. [decisão 40](docs/decisions.md#40-selections).
- Ferramenta Mover (V): desloca a seleção da camada ativa ou a camada inteira em pixels inteiros, levando a seleção junto. Shift mantém o movimento horizontal ou vertical. A prévia respeita as camadas acima. Nesta versão, pintura movida para fora do papel era perdida. Cada movimento é uma etapa de desfazer junto com a seleção. [decisão 41](docs/decisions.md#41-moving-paint).
- Objetos inteligentes e transformações: Ctrl+T ou **Transformar** converte a seleção em uma nova camada ou a camada inteira em objeto inteligente, preservando os pixels originais. Alças redimensionam, giram por fora e movem por dentro; Alt usa o centro, Shift controla proporções e passos de 15°, e Ctrl distorce cantos ou inclina lados. Enter aplica e Esc cancela. Pixels **Suaves** ou **Inteiros** na barra. Novas transformações e movimentos preservam o original. Para pintar, use **Converter em pixels**. Arquivos `.lyd` guardam o original; desenhos sem objetos inteligentes continuam compatíveis com Lydia 0.7. [decisão 42](docs/decisions.md#42-smart-objects-and-transforming).

### Changed

- Os botões Pincel e Borracha passaram da barra superior para a coluna de ferramentas.
- **Ajustar à tela** (Ctrl+0) preserva rotação e espelhamento e enquadra o papel girado.
- Segurar Espaço mostra o cursor de mão.
- Blocos de cor única são enviados à placa de vídeo sem os pixels: a placa os preenche com a cor.
- O contorno animado das novas seleções aparece mais cedo: as imagens das bordas são geradas cerca de nove vezes mais rápido.

## [0.7.0] - 2026-10-23

Pincéis com ruído filtrado e traços pintados em blocos próprios.

### Added

- Pincéis com ruído filtrado: números aleatórios filtrados variam cada aplicação, preservando o caráter do pincel. No editor: quantidade, granulação, camadas finas, alongamento, contraste, ruído por cópia ou por traço e tipos Mistura, Gotas e Desgaste. Dois pincéis novos usam o recurso: Cerdas e Esponja. [decisão 35](docs/decisions.md#35-brushes-with-filtered-noise).
- Controle de **Opacidade** por traço e opção **Lavagem** no editor de pincéis: o traço não acumula tinta sobre si mesmo. [decisão 36](docs/decisions.md#36-strokes-are-painted-in-tiles-of-their-own).

### Changed

- As prévias na lista e na área de teste usam a placa de vídeo com o mesmo código do desenho.

### Fixed

- A borracha não deixa mais blocos vazios onde não havia pintura.

## [0.6.0] - 2026-10-23

### Added

- Pincel **Pixel** para pixel art: pinta pixels inteiros com bordas duras a partir de 1 pixel, com ponta redonda calculada para cada tamanho (uma cruz no tamanho 3). Linhas retas têm um pixel por coluna e a pressão altera o tamanho em passos de um pixel. A prévia na lista mostra os pixels. [decisão 33](docs/decisions.md#33-the-pixel-brush).
- Grade de pixels a partir de 800% de zoom, com cores calculadas a partir do conteúdo para permanecer visível. **Grade** ou G ativa e desativa, com preferência lembrada pelo Lydia. [decisão 34](docs/decisions.md#34-a-pixel-grid).

### Fixed

- A tecla `[` reduz o pincel até o tamanho 1; antes, parava em 2.

## [0.5.2] - 2026-10-22

### Added

- Resolução (DPI) por desenho, escolhida em Novo projeto: 300 DPI inicialmente, com botões para 72, 150, 300 e 600. Os formatos de papel acompanham a resolução e o diálogo mostra o tamanho impresso. A resolução é salva; projetos antigos usam 300 DPI.

### Fixed

- PNG e JPEG exportados informam a resolução do desenho, preservando o tamanho de impressão (A4: 21×29,7 cm) e de abertura em outros programas. Antes, os programas precisavam estimar e ajustavam à página de maneiras diferentes. [decisão 32](docs/decisions.md#32-each-drawing-has-a-resolution-dpi).

## [0.5.1] - 2026-10-22

### Added

- Cor de fundo ou fundo transparente para novos desenhos. A transparência aparece como quadrados cinza e brancos e é preservada em PNG; JPEG usa branco. O fundo é salvo no projeto; projetos antigos continuam com papel branco. [decisão 31](docs/decisions.md#31-a-window-for-new-drawings-with-a-background-color-or-none).
- Tamanhos comuns: A5, A4, A3, Carta (EUA), Ofício (EUA) e Tabloide a 300 DPI, Full HD, 4K UHD e quadrado de 2048×2048.

### Changed

- **Novo projeto…** abre um diálogo com tamanho, formatos comuns e fundo, lembrando as últimas escolhas.

## [0.5.0] - 2026-10-22

Editor de pincéis: crie pincéis dentro do próprio Lydia.

### Added

- Editor de pincéis na tela inicial: desenhe a ponta em preto e cinza em papel de 256, 512 ou 1024 pixels, configure espaçamento, ângulo, rotação com o traço, ângulo aleatório, dispersão, fluxo e pressão da caneta. A área de teste redesenha os traços após cada mudança. **Salvar nos meus pincéis** adiciona e seleciona o pincel para o próximo desenho; **Exportar arquivo** salva um `.lydbrush`. [decisão 30](docs/decisions.md#30-the-brush-designer).

### Fixed

- Atalhos como Ctrl+Z funcionam logo após digitar em campos, como o nome da camada: pintar retira o foco do campo de texto.

## [0.4.0] - 2026-10-22

Pincéis em arquivos, para compartilhar e importar. [decisão 29](docs/decisions.md#29-brushes-are-files).

### Added

- Painel à esquerda com seis pincéis: Redondo suave, Redondo duro, Aerógrafo, Giz, Caligrafia e Traços. Cada um mostra uma amostra e o navegador lembra o selecionado.
- Arquivos `.lydbrush`: use **Importar…** ou solte arquivos na janela para guardá-los no navegador. **Exportar** salva o pincel selecionado para compartilhar; **Excluir** remove pincéis adicionados. [decisão 29](docs/decisions.md#29-brushes-are-files).
- Pincéis podem girar a ponta em ângulo fixo, com o traço ou aleatoriamente, dispersá-la e aplicar menos tinta a cada cópia, também conforme a pressão da caneta.

### Changed

- A borracha apaga usando a ponta do pincel selecionado.

## [0.3.1] - 2026-10-22

### Added

- Escolha na tela inicial da memória da placa de vídeo disponível para camadas, de 0,5 a 8 GB (padrão: 2 GB), com quantidade de blocos e aviso: valores altos podem travar o Lydia ou deixar o computador lento. O navegador lembra a escolha.

## [0.3.0] - 2026-10-22

Camadas completas e alterações rápidas em desenhos grandes. [decisões 25 to 27](docs/decisions.md#25-every-layer-change-can-be-undone).

### Added

- **Excluir camada** remove a camada ativa e seleciona a que estava abaixo.
- Arraste camadas para cima ou para baixo na lista. Uma linha indica a posição de destino.
- Clique duas vezes no nome para renomear. Enter confirma e Escape mantém o nome anterior.
- Desfazer e refazer para adicionar, excluir, mover, renomear, ocultar, mostrar e alterar a opacidade de camadas. Todo o arraste do controle de opacidade conta como uma etapa.

### Changed

- Alterações em camadas, desfazer e ajustes de opacidade não congelam mais a tela em desenhos grandes. A nova composição é preparada em segundo plano e aparece inteira quando pronta, com “Atualizando…” na barra durante o processamento.
- Alterações são mais rápidas: a placa de vídeo mantém até 8.000 blocos (cerca de 2 GB), em vez de 2.000, evitando reenvios. Com quatro camadas inteiras de 10000×10000, mover uma camada caiu de 1,3 s para menos de 0,25 s.

### Fixed

- O controle de opacidade não muda mais de tamanho ao chegar a 100%.

## [0.2.2] - 2026-10-22

### Added

- **Exportar JPEG** salva imagens muito menores que PNG (8,6 MB contra 138 MB em uma pintura de 10000×10000), com aparência semelhante. PNG continua disponível para preservar cada pixel exatamente. [decisão 24](docs/decisions.md#24-exporting-as-jpeg-too).

## [0.2.1] - 2026-10-22

### Fixed

- A opacidade da camada muda durante o arraste do controle, em vez de apenas ao soltá-lo. [decisão 23](docs/decisions.md#23-the-opacity-changes-live-while-the-slider-moves).

## [0.2.0] - 2026-10-22

Novo mecanismo de desenho, feito para desenhos grandes com muitas camadas. [decisão 5](docs/decisions.md#5-raster-layers-made-of-tiles-drawn-with-pixijs).

### Added

- Telas de até 10000×10000 pixels (antes, até 4096×4096).
- Painel de camadas: adicionar acima da ativa, selecionar, ocultar, mostrar e alterar a opacidade.
- Refazer pelo botão, Ctrl/Cmd+Shift+Z ou Ctrl+Y.
- Zoom com Ctrl + roda do mouse ou gesto de pinça no trackpad. Navegação pela roda, dois dedos, Espaço + arraste ou botão do meio. Ajustar à tela (Ctrl/Cmd+0) mostra o desenho inteiro.
- A pressão da caneta altera o tamanho do pincel.
- Atalhos: B para pincel, E para borracha, `[` e `]` para reduzir e ampliar o pincel.
- O navegador pede confirmação ao fechar uma aba com alterações não salvas.

### Changed

- Desenhos passam a usar pixels em blocos de 256×256, renderizados pela placa de vídeo (PixiJS e WebGL 2), em vez de uma lista de traços redesenhados a cada mudança. O Lydia passa a exigir WebGL 2.
- O pincel é redondo e suave.
- Limpar passa a ser Limpar camada e pode ser desfeito.
- Arquivos `.lyd` usam novo formato com blocos comprimidos para salvar e abrir projetos grandes rapidamente.

### Removed

- Projetos do Lydia 0.1 não podem mais ser abertos; o app explica o motivo. O Lydia 0.1 continua disponível no GitHub para abri-los. [decisão 21](docs/decisions.md#21-a-new-project-file-without-opening-the-old-one).

## [0.1.0] - 2026-10-22

A primeira versão utilizável.

### Added

- Tela inicial: criar desenho com tamanho personalizado (até 4096×4096) ou abrir projeto.
- Desenho à mão livre com mouse ou caneta e traços suavizados.
- Barra com cor, tamanho do pincel e borracha.
- Desfazer pelo botão ou Ctrl/Cmd+Z.
- Limpar a tela.
- Salvar e abrir projetos `.lyd`.
- Exportar o desenho como PNG.
- Desenho nítido em telas de alta densidade.
