# Comparação com a mockup (2026-10-22)

Imagem lado a lado: `comparacao-2026-10-22.png` (esquerda: `mockup-alvo-2026-10-22.png`
sem a moldura; direita: a janela real, `tools/snapshot.sh --component window --select 1
--at 34 --size 1160x766`, ampliada 1,3×).

## Escala da mockup

A mockup tem 1536×1024 px com uma moldura escura de 14 px (sombra/cantos de uma janela);
a janela em si ocupa 1508×996. Ela **não está em 1:1**: tudo está desenhado a ~1,3× dos
tamanhos lógicos do GTK:

- a sidebar tem 439 px na imagem, e o plano fixa 300–340 px → 439 / 1,3 = 338;
- a altura de maiúscula do título "Daily · Projeto Atlas" é 27 px (fonte de ~37 px), e a
  spec fala em títulos de ~28 px → 27 / 1,3 ≈ 21 px de maiúscula = fonte de 28 px;
- o mesmo vale para o texto dos blocos (maiúscula de 19 px = fonte de ~26 px na imagem,
  20 px lógicos), a barra de título (72 → 55 px), o player (128 → 98 px) etc.

Por isso a comparação é feita na **mesma proporção**: a janela capturada com 1508/1,3 ×
996/1,3 = 1160×766 px lógicos e ampliada 1,3×. Numa tela 1× com a janela em 1508 px de
largura, o app fica com a mesma composição da mockup, só ~23 % menor (a mockup
corresponde a uma tela com escala de ~130 %). Ampliar tudo 1,3× em px lógicos violaria a
sidebar de 300–340 px do plano e deixaria a barra de título e os botões da libadwaita
fora do padrão.

## Medidas (px lógicos; mockup = px da imagem ÷ 1,3)

"Antes" = estado no início da Task 12 (commit e43767c); "depois" = este acabamento.

| Elemento | Mockup | Antes | Depois | Diferença restante / motivo |
|---|---|---|---|---|
| Barra de título: altura, fundo | 55, #23272C | 47, transparente (#1A1D22) | 55, #25272E | — (o fundo da mockup é um pouco mais escuro que o token #25272E; vale o token) |
| Ícone do app (visível) | ~35 | ~21 (28 px) | ~32 (42 px) | arte do PNG tem bordas suaves |
| "Daily Taker" | ~20 px negrito | 17 px | 20 px | — |
| Nova gravação (pílula) | 142×37 | 160×35 | ~160×37 | largura pelo texto da fonte do sistema |
| Engrenagem | contorno, ~21 | preenchida, 16 | contorno (ícone novo), 20 | desenho próprio, traço um pouco diferente |
| Menu ☰ no cabeçalho | não tem | tem | tem | mantido: único acesso a Atalhos e Sobre |
| Divisor antes dos botões da janela | tem | não | tem | — |
| Botões da janela | círculos ~31, traço fino | ~24 | ~30 | ícones da libadwaita, traço mais grosso |
| Sidebar: largura | 338 | 300 a 1160 px (fração), 280 abaixo de 1000 sp | 336 fixa; 300 na janela média | — |
| "Gravações" | ~30 px, 800 | 28 px | 30 px | — |
| Exportar (⇪) | 38×38, borda #3E4249 | 36, borda #2F333B | 38, borda #3B3F48 | — |
| Busca | 298×38, borda #3D434A | 265×37, borda #2F333B | 298×38, borda #3B3F48, ícone 18 | — |
| Rótulo de grupo (HOJE) | 13 px, caixa alta | igual | igual | a mockup põe "Notas da reunião" (Ontem) em HOJE; o app mostra ONTEM (correto) |
| Item: altura / ícone / título | 66 / 26 / ~15–16 px | 66 / 24 / 15 px | 66 / 26 / 16 px | — |
| Item selecionado: barra, contorno | 4–5 px, contorno #383C44 | 3 px, sem contorno | 4 px, contorno sutil | — |
| Selo "Transcrita" | inteiro | "Tr…" a 1160 px | inteiro; só o ponto na janela média | — |
| Rodapé "Salvo neste dispositivo" | centro a 41 px do fundo | 27 px | ~41 px | — |
| Título do painel / subtítulo | 28 / ~16–17 px | 28 / 16 | 28 / 17 | — |
| Margens do painel (esq./dir.) | 25 / 19 | 30 / 30 | 25 / 19 | — |
| Abas: sublinhado, peso | 3 px; ativa seminegrito, outra normal | 2 px; inativa ficava em negrito com foco/hover | 3 px; peso fixo em todos os estados | — |
| Buscar/Copiar/Exportar | 40×38, espaço 12, borda #3B3F48 | 36×36, espaço 10, borda #2F333B | ~40×38, espaço 12, borda #3B3F48 | — |
| ⋮ do painel (Gerar novamente) | não tem | branco | cinza secundário | exigido pelo plano |
| Coluna do horário / ponto / nome | 28 / 112 / 142 da borda do bloco | 32 / 117 / 142 | 28 / 112 / 142 | — |
| Ponto do locutor | 14 | 12 | 14 | — |
| Nome do locutor | 16 px negrito, ~#D4DEF3 | 16 px 600, #9CA4B8 | 16 px negrito, #D6DCE8 | — |
| Texto do bloco | ~20 px, linha ~29 | 18 px, linha ~26 (35 a 20 px) | 20 px, linha ~29 | fonte do sistema (Adwaita Sans) no lugar da fonte da mockup (parecida com Noto Sans): quebras de linha quase iguais, uma palavra muda de linha no 2º bloco |
| Largura do texto | ~540 (quebra em ~700 px da imagem) | até a borda do painel | até ~544 (`max-width-chars` 44) | — |
| Bloco de 2 linhas (passo) | 111 | ~135 | 110 | — |
| Bloco atual: barra, fundo | 4–5 px; fundo ≈ alpha(laranja, .07) | 3 px; alpha .12 | 4 px + contorno sutil; alpha .12 | o fundo segue o token do plano (.12), um pouco mais quente que a mockup |
| Resultado ativo da busca | — | contorno amarelo de 1 px (quase igual ao atual) | contorno amarelo de 2 px + barra amarela; com o atual, barra laranja + contorno amarelo; alto contraste: tracejado de 3 px | — |
| Rolagem da transcrição | 1º bloco no topo | centraliza o bloco atual | igual (Acompanhar áudio centraliza o bloco atual) | escolha de comportamento (Task 7): em 1160×766 a lista sobe ~50 px para centralizar o bloco de 00:34 |
| Player: altura | 98 | 92 | 99 | sombra de rolagem da libadwaita acima da barra |
| Play/pausa | 53 | 56 | 54 | a captura está pausada (▶); a mockup mostra tocando (⏸) |
| Onda: barras | 2,3 px / 2,1 px de intervalo, alturas variadas | 3/2 px, máximo por balde (todas no topo) | 2/2 px, RMS + percentis 5–95 com piso | a mockup põe o marcador a ~1/3 da onda em 00:34 de 19:08; o app o põe a 3 % (correto) |
| Velocidade "1x ▾" | 67×35 | ~62×33 | ~66×35 | — |
| Ícone de volume / slider | ~20 / 92 | 16 / 110 | 20 / 96 | — |
| "Acompanhar áudio" + switch | 15 px; 52×24 | 14,7 px; 48×26 | 15 px; switch da libadwaita | tamanho do switch é o da libadwaita |
| Bordas e cantos da janela | cantos ~12 px, sombra | — | os do mutter/GTK | a captura não inclui a decoração do compositor |

## O que fica diferente, e por quê

- **Fonte**: a mockup usa uma fonte humanista (parecida com Noto Sans); o app usa a
  fonte do sistema (a captura usa o padrão do GTK, Adwaita Sans; na sessão do usuário,
  a fonte configurada). Larguras de palavra mudam um pouco, então uma ou outra quebra
  de linha cai em lugar diferente.
- **Rolagem com "Acompanhar áudio"**: o app centraliza o bloco que está tocando (decisão
  da Task 7, coerente com a spec); a mockup mostra a lista no topo.
- **Estado de reprodução**: a captura usa o player pausado em 00:34 (nada toca no ambiente
  isolado); a mockup mostra o botão de pausa e a parte tocada da onda até ~1/3, o que não
  bate com 00:34 de 19:08.
- **Menu ☰**: a mockup não tem; ele é o único acesso a "Atalhos de teclado" e "Sobre".
- **⋮ do painel**: a mockup não tem; o plano exige (Gerar novamente). Está discreto.
- **Agrupamento**: a mockup põe uma gravação de "Ontem" sob HOJE; o app mostra ONTEM.
- **Fundo do bloco atual**: o token do plano (alpha .12) é um pouco mais forte que o da
  imagem (~.07).
- **Ícones**: os da libadwaita/Adwaita (botões da janela, busca, cópia, exportar,
  volume) têm traço diferente dos da mockup; a engrenagem contornada foi desenhada para o
  app.
- **Sombra e moldura da janela**: são do compositor, não do app.

## Aba Resumo — Plano B

A aba antes reservada agora usa o mesmo cabeçalho, abas e player. O conteúdo
tem títulos de 24/20 px, corpo/listas de 18 px, seleção e rolagem; o rodapé
mostra modelo, data e custo. Os cartões de ausência/geração/erro ficam definidos,
e a versão anterior usa banner com Restaurar/Voltar. Conferência reproduzível:

```sh
bash tools/snapshot.sh OUT.png --select 1 --tab resumo --summary-state ready
bash tools/snapshot.sh OUT.png --component detailpane --select 1 --tab resumo --summary-version 1
```

Capturas somente no compositor isolado; sem alterações de escala em relação
ao Plano A. O Markdown é escapado para Pango, não HTML interpretado.
