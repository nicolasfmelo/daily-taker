# Daily Taker — Spec v2: redesenho da interface (alvo: mockup) + resumo

Data: 2026-10-22 · Status: rascunho para revisão · Complementa `2026-10-22-daily-taker-design.md` (v1)

Referência visual (alvo, "deixar igual"): `docs/superpowers/design/mockup-alvo-2026-10-22.png`.

## 1. Objetivo e critério de sucesso

Deixar a janela do Daily Taker **igual à mockup** e entregar a aba **Resumo** funcionando.
A v1 (gravação, transcrição, chave, copiar/exportar) já funciona e não muda de comportamento;
muda a estrutura da interface.

Sucesso: abrir o app e ver, lado a lado com a mockup, a mesma estrutura, cores e elementos;
selecionar uma gravação, ouvir com o player único, acompanhar o texto, gerar e ler o resumo.
A conferência é por captura de tela comparada com a mockup (seção 9).

### Decidido pelo usuário
Velocidade e volume entram · tema escuro e laranja **fixo** (não segue o sistema) · resumo via
`anthropic/claude-sonnet-5.5` no OpenRouter (mesma chave) · "deixar igual a da foto".

### Fora do escopo
Edição do texto, calendário, nuvem, vários idiomas de interface, tema claro, mais de um resumo por
gravação (v2 guarda só o último), rolagem por palavra (o destaque continua por bloco).

## 2. Estrutura da janela

Uma janela só, sem abas e sem página "Voltar":

```
┌ Header: [ícone] Daily Taker ······················ [● Nova gravação] [⚙] [– □ ×] ┐
├──────────────────────┬───────────────────────────────────────────────────────────┤
│ Gravações        [⇪] │ Título da gravação                                        │
│ [🔍 Buscar gravação] │ 22 out 2026 • 19min08s • 2 locutores                      │
│ HOJE                 │ [📄 Transcrição] [☰ Resumo]            [🔍] [⧉] [⤓]       │
│ ▌Daily · Projeto…    │ ───────────────────────────────────────────────────────── │
│   09:30 • 19min08s ● │ 00:00  ● Nicolas   Bom dia, pessoal…                      │
│ Ideias para o app    │ 00:18  ● Locutor 2 Finalizei a captura…                   │
│ Notas da reunião     │ ▌00:34 ● Nicolas   A ideia é conseguir ouvir… (atual)     │
│                      │ …                                                         │
│ [💾] Salvo neste     ├───────────────────────────────────────────────────────────┤
│      dispositivo     │ (▶) ▂▃▅▇▅▃▂ ──●─── 00:34/19:08  [1x ▾] 🔊──●──  Acompanhar áudio ◉ │
└──────────────────────┴───────────────────────────────────────────────────────────┘
```

Widgets: `Adw.ApplicationWindow` → `Adw.ToolbarView` (header + conteúdo) → `Adw.NavigationSplitView`
(sidebar fixa ~300–340 px; conteúdo flexível); em largura < 720 sp um `Adw.Breakpoint` recolhe a
sidebar sobre o conteúdo (lista → detalhe, com botão de voltar só nesse modo).
O player é uma barra inferior **única** dentro do painel de conteúdo (`Adw.ToolbarView` bottom bar).

A tela de **gravação em andamento** (Vocalis: cronômetro, onda, Mic/Sistema, pausar/parar/cancelar)
não aparece na mockup: continua como hoje, aberta pelo botão "Nova gravação" como página que cobre a
janela, mas com o novo tema. Ao parar, a nova gravação aparece selecionada na sidebar.

## 3. Tema (fixo, escuro, laranja)

`Adw.StyleManager.color-scheme = FORCE_DARK` na inicialização; CSS próprio em `data/style.css`
(substitui o conteúdo atual, e `style-hc.css` sai porque está obsoleto na libadwaita 1.9;
alto contraste via `@media (prefers-contrast: more)`). Valores medidos na mockup:

| Token | Valor | Uso |
|---|---|---|
| `--bg-window` | `#1A1D22` | fundo da janela, sidebar, player |
| `--bg-detail` | `#1B1D22` | painel de conteúdo |
| `--bg-header` | `#25272E` | barra de título |
| `--bg-item-selected` | `#26292F` | item selecionado da lista |
| `--accent` | `#FA841E` (variação `#F28416`) | botão "Nova gravação", aba ativa, barra do item selecionado/bloco atual, play, slider, toggle |
| `--accent-soft` | `alpha(#F88712, .12)` | fundo do bloco atual |
| `--ok` | `#3FCF70` | indicador "Transcrita" |
| `--text-dim` | `#9CA4B8` | textos secundários |
| `--track` | `#2F333B` | trilho do slider |
| locutores | azul `#3D9BFD`, roxo `#A655FD`, depois verde `#3FCF70`, ciano `#22D3EE`, rosa `#F472B6`, amarelo `#FACC15` | ponto colorido por locutor (ciclo pelo id) |

Tipografia: fonte do sistema (Cantarell/Inter conforme o GTK); título da gravação ~28 px em
negrito; "Gravações" ~28 px em negrito; texto dos blocos ~18 px; horários e secundários ~14 px. Cantos
arredondados de 12–16 px nos cartões e botões; botão "Nova gravação" em pílula laranja com texto
escuro/branco (conforme contraste da mockup). Os valores finais de espaçamento são ajustados até a
comparação visual (seção 9) ficar equivalente; o que o GTK não reproduzir idêntico é listado no relatório.

> **Divergência registrada na Task 12:** a mockup está desenhada a ~1,3× dos px lógicos
> (sidebar de 439 px na imagem = 338 px). Na comparação nessa proporção o texto dos blocos
> ficou com **20 px** (linha de ~29 px, quebra em ~540 px), "Gravações" com 30 px, a
> sidebar fixa em **336 px** (300 px entre 720 e 1000 sp, com o selo só no ponto) e a
> barra de título com 55 px. Detalhes em `docs/superpowers/design/comparacao-notas.md`.

## 4. Sidebar "Gravações"

- Cabeçalho: título "Gravações" + botão de ícone **Exportar áudio** (⇪): salva uma cópia do áudio da
  gravação selecionada (ação `Exportar` que o Vocalis já tem, com `Gtk.FileDialog`); desabilitado sem seleção.
- Campo de busca "Buscar gravação": filtra a lista por **nome e conteúdo da transcrição** (reusa
  `filterTranscripts`/`normalize`, sem acento e sem caixa; com debounce). Gravações sem transcrição
  só casam pelo nome.
- Lista agrupada por data, cabeçalhos em caixa alta: `HOJE`, `ONTEM`, `ESTA SEMANA`, `ESTE MÊS`,
  depois `<MÊS> DE <ANO>`. Ordem: mais recente primeiro.
- Item: ícone de onda (laranja no selecionado, cinza nos demais), título, linha secundária
  (`09:30 • 19min08s` no dia atual; `Ontem • 12min40s` / `dd/mm • …` nos outros), e à direita o
  indicador de transcrição: `● Transcrita` (verde), `⟳ Transcrevendo…`, `● Erro` (vermelho), ou nada
  quando não há transcrição. Menu `⋮` por item: Renomear, Gerar/Regenerar transcrição, Exportar áudio
  (salvar cópia), Excluir (com "Desfazer", como hoje).
- Selecionado: fundo `--bg-item-selected` e barra laranja de 3 px à esquerda.
- Rodapé fixo: ícone de disco + "Salvo neste dispositivo" (texto informativo, estático).
- Vazio: "Nenhuma gravação ainda" com botão "Nova gravação".

## 5. Painel de conteúdo

- Cabeçalho do painel: título (nome da gravação, editável pelo menu Renomear), subtítulo
  `22 out 2026 • 19min08s • 2 locutores` (data por extenso curta em pt-BR), abas **Transcrição** e
  **Resumo** (aba ativa com sublinhado laranja) e, à direita, três botões de ícone:
  **Buscar** (barra de busca dentro da transcrição: realça e rola até o próximo bloco que contém o
  texto; sem acento/caixa), **Copiar** (menu: "Com locutores e tempos" / "Só o texto"; na aba Resumo
  copia o resumo) e **Exportar** (menu `.md` / `.txt`; o `.md` inclui "## Resumo" quando existe).
- **Aba Transcrição**: blocos como na mockup: coluna de horário (`mm:ss`, ou `h:mm:ss` a partir de 1 h;
  os formatos de cópia/exportação continuam `HH:MM:SS`), ponto colorido por locutor, nome do locutor
  (clicável para renomear, como hoje) e o texto (selecionável). O bloco que está tocando fica com
  fundo `--accent-soft`, barra laranja à esquerda, horário e ponto em laranja. Clicar no bloco (sem
  seleção ativa) pula o áudio e toca. Copiar bloco passa a ficar em um menu do bloco (aparece ao
  passar o mouse), para o visual ficar limpo.
- **Sem transcrição**: cartão central "Esta gravação ainda não foi transcrita" com o custo estimado e
  botão **Gerar transcrição** (mesmo fluxo da v1: chave, confirmação de custo, erros, retry). Durante
  a geração, cartão com spinner. Regenerar fica no menu do cabeçalho do painel.
- **Aba Resumo**: ver seção 7.
- Nenhuma gravação selecionada: "Selecione uma gravação".

## 6. Player único

Barra inferior do painel, ligada à gravação **selecionada** (um só `GstPlayer`; trocar de gravação para
a reprodução e carrega a nova na posição 0). Substitui o player das linhas.

- Botão redondo laranja play/pausa (também `Espaço`, quando o foco não está em campo de texto).
- Waveform da gravação (picos já calculados por `Recording.loadPeaks`) com marcador de posição;
  clicar/arrastar na onda dá seek.
- `00:34 / 19:08` (posição / duração).
- **Velocidade**: menu `0,75x · 1x · 1,25x · 1,5x · 2x` (`GstPlayer.set_rate`, preservando o tom se
  o plugin permitir; se a taxa falhar, volta a 1x e avisa com toast).
- **Volume**: ícone (clique = mudo) + slider 0–100 % (`set_volume`).
- **Acompanhar áudio** (toggle, padrão ligado): ligado = o bloco atual é realçado e a lista rola
  para mantê-lo visível; desligado = só realça, sem rolar. Pular por clique no bloco funciona nos
  dois modos.
- Velocidade, volume e o toggle persistem em `GSettings` (`playback-rate`, `playback-volume`,
  `follow-audio`).

## 7. Resumo (novo)

- **Geração sob demanda**, nunca automática: botão **Gerar resumo** na aba Resumo (e item no menu ⋮).
- **Modelo**: `anthropic/claude-sonnet-5.5` por padrão (preço medido no catálogo: US$ 2/M tokens de
  entrada, US$ 10/M de saída; contexto de 1 M tokens), configurável em Preferências (campo de texto
  "Modelo do resumo"). Endpoint `POST https://openrouter.ai/api/v1/chat/completions`, mesma chave.
- **Confirmação antes de enviar**: "Gerar resumo com Claude Sonnet 5.5? Custo estimado: US$ 0,04" e um
  aviso de privacidade (na primeira vez e sempre curto depois): "O texto da transcrição será enviado
  ao OpenRouter". Estimativa de tokens = `ceil(caracteres / 3)` para a entrada + saída máxima de 2 000
  tokens; mostrar em US$ com o mesmo formatador da v1. Nada é enviado sem o clique de confirmação.
- **Entrada**: transcrição em blocos `Nome · mm:ss\ntexto` (locutores renomeados incluídos). Sem
  divisão em pedaços (cabe no contexto).
- **Prompt** (pt-BR, estável e testável): pede, em Markdown e sem inventar o que não foi dito:
  `## Resumo` (3–6 linhas), `## Decisões`, `## Próximos passos` (com responsável quando citado),
  `## Pontos de atenção`; seções sem conteúdo são omitidas; responder no idioma da transcrição.
- **Saída/Persistência**: texto Markdown salvo em `summary` no `X.transcript.json`:
  `{"text": "...", "model": "...", "generated_at": "ISO-8601", "cost_usd": 0.04}` (campo opcional;
  `version` continua 1; leitores antigos ignoram). Escrita atômica, junto da transcrição; regenerar
  substitui o resumo anterior (com confirmação).
- **Exibição**: Markdown simples renderizado com segurança (títulos, negrito, listas; todo texto
  escapado antes de virar markup, `use_markup` nunca recebe texto cru). Rodapé discreto: modelo, data e custo.
- **Erros**: mesmas classes da v1 (sem chave → Preferências; 401/402/429/502/rede com toast e
  "Tentar de novo"; timeout de inatividade como na transcrição). Falha ao salvar o resumo não joga fora
  o texto pago: retém em memória e o retry só salva (mesmo padrão do `retrySave`).
- Sem transcrição → a aba Resumo mostra "Gere a transcrição primeiro".
- A chave nunca aparece em log, toast ou arquivo.

## 8. Arquitetura (o que muda)

Novos módulos GTK-free (testáveis em `gjs` puro): `summarizer.js` (monta requisição, estima custo,
chama o chat, mapeia erros reaproveitando `TranscribeError`), `summaryMarkdown.js` (Markdown simples →
Pango seguro), `speakerColors.js`, `recordingGroups.js` (agrupar por data e rótulos "HOJE/ONTEM/…"),
`playerModel.js` (formatos `mm:ss`, taxas, decisões de seguir/rolar), `recordingName.js` (nome padrão por data e hora). Novos módulos de UI:
`sidebar.js`, `detailPane.js`, `playerBar.js`, `summaryView.js`, `appTheme.js` (tema fixo). Reaproveitados
sem mudar a lógica: gravador/pipeline, `transcriber`, `transcriptionService`, `secrets`, `transcriptStore`,
`transcriptSearch`, `transcriptFormat`, `Recording`/`RecordingList`, `waveform.js`.
Alterado: `Recorder.start()` passa a nomear por data e hora (decisão 2 da seção 11), com teste de
formato e de unicidade em `gjs` puro (`recordingName.js`).
Removidos: a aba "Transcrições" (`transcriptsPage*`), o `AdwViewSwitcher`, a página `transcript` com
"Voltar", o player embutido em `row.js`/`row.ui` (a linha da lista vira o item da sidebar).
`Window` passa a coordenar: seleção da sidebar → `detailPane` + `playerBar`; serviços e diálogos de
custo/erro continuam centralizados nele.

## 9. Testes e verificação

- **Automatizados** (`bash tests/run.sh`): requisição e estimativa de custo do resumo, erros, retry de
  salvamento, Markdown seguro (inclusive `&`, `<`, `>` e Pango), agrupamento por data (fusos, virada
  de dia/semana/mês), formatos de tempo, ciclo de cores por locutor, decisão de rolagem/seguir, busca
  da sidebar por nome e conteúdo, persistência do campo `summary` sem quebrar JSON antigo.
- **Visual**: captura da janela (tentar `spectacle`; senão captura manual do usuário) comparada com a
  mockup: cada região (header, sidebar, painel, player), cores e estados (selecionado, bloco atual,
  badge). O relatório lista o que ficou diferente e por quê.
- **Manual**: `docs/manual-checklist.md` ganha a seção do redesenho (seleção, player, velocidade,
  volume, acompanhar áudio, busca na sidebar e na transcrição, resumo gerar/regenerar/copiar/exportar,
  estreito).

## 10. Riscos

1. **GTK/libadwaita não reproduz a imagem pixel a pixel** (sombras, fontes, cantos): aproximamos por CSS e
   listamos diferenças. 2. **Reescrita da navegação** mexe em `window.js` (447 linhas) e nas linhas da
   lista: risco de regressão em renomear/excluir/desfazer e na transcrição em andamento; os testes de
   lógica pura e o checklist cobrem. 3. **Mudança de velocidade** no `GstPlayer` pode alterar o tom ou
   falhar em alguns formatos: fallback 1x + aviso. 4. **Resumo**: o texto sai do PC (aviso explícito);
   custo por chamada pequeno, mas mostrado antes. 5. **Largura**: sidebar + painel exigem janela
   larga; abaixo de 720 sp recolhe.

## 11. Decisões finais do usuário (antes eram perguntas abertas)

1. **Botão ⇪ da sidebar** = **Exportar áudio** da gravação selecionada (sem importar áudio).
2. **Nome padrão de novas gravações** = data e hora: `Gravação 22 out 14:30` (dia sem zero à
   esquerda, mês abreviado em pt-BR minúsculo, 24 h). Se o nome já existir, acrescenta ` (2)`, ` (3)`…
   Gravações antigas (`Recording N`, `Gravação N`) não são renomeadas.
3. **Janela estreita**: a sidebar recolhe sobre o conteúdo abaixo de 720 sp.
