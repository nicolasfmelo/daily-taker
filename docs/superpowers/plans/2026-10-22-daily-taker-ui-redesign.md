# Daily Taker — Plano A: UI igual à mockup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a interface atual (abas + player em cada linha) pela janela mestre-detalhe da mockup, com tema escuro/laranja fixo, player único (velocidade, volume, acompanhar áudio) e nome padrão por data/hora. A aba "Resumo" aparece, mas só funciona no Plano B.

**Architecture:** Um `Playback` (GstPlayer) único, de dono da janela, alimenta a barra do player. A `Sidebar` lista as gravações (agrupadas por data, com busca) e emite a seleção; o `DetailPane` mostra a gravação selecionada (cabeçalho, abas, blocos da transcrição). Lógica nova fica em módulos GTK-free com testes em `gjs`; a UI é fina. O gravador, o serviço de transcrição, a chave e o armazenamento de transcrições não mudam.

**Tech Stack:** GJS 1.88 (sintaxe legada `imports.*`), GTK 4.22, libadwaita 1.9 (`Adw.NavigationSplitView`, `Adw.Breakpoint`), GstPlayer, meson.

**Spec:** `docs/superpowers/specs/2026-10-22-daily-taker-ui-redesign.md` (alvo visual: `docs/superpowers/design/mockup-alvo-2026-10-22.png`). Spec v1: `docs/superpowers/specs/2026-10-22-daily-taker-design.md`. Mapa do código atual: seção "Pontos de acoplamento" abaixo.

## Global Constraints

- UI em pt-BR com acentuação correta; identificadores em inglês. Todo commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Tema fixo escuro: `Adw.StyleManager` `FORCE_DARK`. Tokens: janela/sidebar/player `#1A1D22`; painel `#1B1D22`; header `#25272E`; item selecionado `#26292F`; acento laranja `#FA841E` (variação `#F28416`); bloco atual `alpha(#F88712, .12)`; ok `#3FCF70`; texto secundário `#9CA4B8`; trilho do slider `#2F333B`; locutores `#3D9BFD`, `#A655FD`, `#3FCF70`, `#22D3EE`, `#F472B6`, `#FACC15` (ciclo pelo id).
- Janela única; sidebar ~300–340 px; abaixo de 720 sp a sidebar recolhe sobre o painel.
- Nome padrão de gravação: `Gravação 22 out 14:30` (dia sem zero, mês abreviado minúsculo pt-BR, 24 h); colisão → ` (2)`, ` (3)`…; gravações antigas não são renomeadas.
- Velocidades `0,75x · 1x · 1,25x · 1,5x · 2x`; volume 0–100 %; "Acompanhar áudio" padrão ligado; os três persistem em GSettings (`playback-rate`, `playback-volume`, `follow-audio`).
- Tempo na tela `mm:ss` (`h:mm:ss` a partir de 1 h); cópia/exportação continuam `HH:MM:SS` (não mudam).
- Nada vai à rede sem o clique do usuário; a chave nunca aparece em log, toast ou arquivo; texto de usuário (nomes, títulos, transcrição) nunca entra como markup (`use_markup: false`).
- Testes: `bash tests/run.sh` (`TZ=America/Sao_Paulo GJS_PATH=src:tests gjs`). Todo módulo novo importado pelo app entra em `src/dev.nicolas.DailyTaker.src.gresource.xml.in`; todo `.ui`/CSS em `data/dev.nicolas.DailyTaker.data.gresource.xml`.
- Verificação visual: `bash tools/snapshot.sh` (Task 1) renderiza a janela real com dados de fixture, sem tocar `~/.local/share/daily-taker` do usuário.

## Review Focus

1. Duas exclusões seguidas + "Desfazer": cada toast restaura/consolida a gravação certa; fechar a janela com exclusão pendente não perde nem apaga o que o usuário desfez (Task 11, fila pura com testes).
2. Excluir ou renomear a gravação que está tocando/selecionada: o player para ou segue, o painel não fica em branco, sem exceção (o código atual desreferencia `activePlayingRow` sem checar) (Tasks 5, 10, 11).
3. Parar uma gravação com outra tocando/selecionada, e o caminho de falha do gravador: a nova gravação vira a selecionada, o player para, a janela volta a um estado consistente (Task 10).
4. Cada estado do painel tem conteúdo definido: sem gravações, sem seleção, sem transcrição, gerando, erro, transcrição pronta, aba Resumo sem resumo (Tasks 8, 10).
5. Janela estreita (< 720 sp): selecionar abre o painel e voltar retorna à lista sem perder a seleção; atalhos de letra (`space`, `b`, `n`, `Delete`) não disparam ações enquanto se digita na busca ou no renomear (Tasks 9–11).

## Pontos de acoplamento do código atual (a manter funcionando)

`window.js` (447 linhas) concentra: dono do `GstPlayer` (:65-72), `items-changed` (:75-85), `connectChange` do serviço (:96-107), `row-deleted` + toast de desfazer (:125-128, :370-391, flag `toastUndo` única), `showTranscript`/`closeTranscript` (:183-205), callbacks do gravador (:228-256; `onRecorderStopped` assume `get_row_at_index(0)`), `set state` (:393-428), `_requestTranscription`/`_runTranscription`/`_onTranscriptionFailed` (:271-353). `row.js` (310) tem renomear (modo de edição), ações `recording.*` por linha (`play/pause/seek-*/delete/export/rename/save/transcribe/open-transcript`) e status da transcrição (`rowStatus`/`statusInfo`/`rowActions` de `transcriptionUi.js`). `recordingListWidget.js` (175) tem `_playRow`/`playRecordingAt`. `waveform.js` é um controle "onda rolando sob cursor fixo", **não** uma barra de busca. `transcriptView.js` (412): blocos em idle de 100 em 100, cópia, renomear locutor, exportar, regenerar, destaque por timer de 150 ms. Aceleradores em `application.js:67-83` (`recording.*` só resolvem dentro da linha). Chaves GSettings atuais: `window-size`, `window-position` (não usadas), `language`.

## File Structure

```
src/ novos (sem GTK)  speakerColors.js recordingGroups.js playerModel.js recordingName.js
                      sidebarModel.js deleteQueue.js playback.js(GstPlayer, testável sem som)
src/ novos (UI)       appTheme.js seekWaveform.js playerBar.js sidebar.js detailPane.js devSnapshot.js
src/ alterados        window.js transcriptView.js recorder.js recording.js application.js
                      transcriptSearch.js (exporta searchableText) preferences.js(sem mudança)
src/ removidos        row.js recordingListWidget.js transcriptsPage.js transcriptsPageModel.js
data/ui novos         sidebar.ui detail-pane.ui player-bar.ui
data/ui alterados     window.ui transcript-view.ui recorder.ui help-overlay.ui
data/ui removidos     row.ui transcripts-page.ui
data/                 style.css (reescrito) style-hc.css (removido) gschema (+3 chaves)
tools/                snapshot.sh make-fixtures.sh README.md
tests/                *_test.js dos módulos novos; removidos os de transcriptsPageModel
```

---

### Task 1: Fixtures e ferramenta de captura da janela

**Files:**
- Create: `tools/make-fixtures.sh`, `tools/snapshot.sh`, `tools/README.md`, `src/devSnapshot.js`
- Modify: `src/application.js` (chama `devSnapshot` só se a variável `DAILY_TAKER_SNAPSHOT` existir), gresource src

**Interfaces:**
- Produces: `bash tools/make-fixtures.sh DIR` cria em `DIR/daily-taker/` 3 gravações (`ffmpeg -f lavfi -i sine=d=… -c:a libopus`, nomes "Daily · Projeto Atlas", "Ideias para o app", "Notas da reunião") com `.transcript.json` no formato v1 (2 locutores, "Nicolas" renomeado e "Locutor 2", textos da mockup, 19 min 08 s no primeiro) e datas variadas (hoje, ontem). `bash tools/snapshot.sh OUT.png [--component playerbar|transcriptview|detailpane|sidebar|window] [--select N] [--tab transcricao|resumo] [--at SEG] [--size LxA]` (`window` = janela real, padrão; os demais renderizam o componente numa janela simples com dados de fixture — usados nas Tasks 6–9, antes de existir a janela nova; `--select/--tab/--at` valem para `window`) roda o app com `XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_CONFIG_HOME` apontando para um diretório temporário com as fixtures, **em compositor aninhado/headless** (sem tocar a tela do usuário), espera a janela, aplica seleção/aba/posição pedidas e grava o PNG da janela (via `Gtk.WidgetPaintable` + `Gsk.Renderer.render_texture` + `save_to_png`), sem som (sink de áudio nulo, volume 0). `src/devSnapshot.js` expõe `maybeSnapshot(window)` e não faz nada sem a variável.

- [ ] **Step 1:** Escrever `make-fixtures.sh` e verificar que gera os 3 pares áudio+JSON; `parseTranscript` (de `src/transcript.js`) lê os JSON gerados (teste `tests/fixtures_test.js` roda o script em diretório temporário e valida com `parseTranscript`; RED→GREEN).
- [ ] **Step 2:** Descobrir e documentar em `tools/README.md` uma receita que renderize a janela sem usar a tela real (ex.: `mutter --headless --wayland --virtual-monitor LxA` sob `dbus-run-session`, ou `weston --backend=headless`); implementar `snapshot.sh` e `devSnapshot.js`.
- [ ] **Step 3: Verificar:** `bash tools/snapshot.sh /tmp/baseline.png` gera um PNG não vazio com a UI **atual** (`--component window`) (linha de base antes/depois) e deixa `~/.local/share/daily-taker` intacto (conferir `ls -la` antes/depois). Sem warnings novos no stderr.
- [ ] **Step 4: Commit:** `feat: fixtures e captura de tela da janela para conferência visual`.

---

### Task 2: Tema fixo e tokens de CSS

**Files:**
- Create: `src/appTheme.js`
- Modify: `data/style.css` (reescrever), `src/application.js` (`applyTheme()` no startup), gresource src (registrar `appTheme.js`) e data (remover `style-hc.css`), `data/style-hc.css` (remover), `src/waveform.js` (só cores nomeadas, se necessário)

**Interfaces:**
- Produces: `var applyTheme(): void` — `Adw.StyleManager.get_default().color_scheme = Adw.ColorScheme.FORCE_DARK`; define as cores nomeadas (`@define-color`) dos tokens do Global Constraints e as classes: `.bg-window`, `.bg-detail`, `.accent-pill` (botão "Nova gravação"), `.sidebar-item`, `.sidebar-item.selected`, `.badge-ok`, `.badge-error`, `.speaker-dot` + `.speaker-0…5`/`.speaker-none`, `.transcript-block`, `.transcript-block.current`, `.player-bar`, `.group-label`. Alto contraste só por `@media (prefers-contrast: more)`.

- [ ] **Step 1:** Reescrever `style.css` com os tokens e classes acima (mantendo `.recorder-time-label`, `.paused`, `button.large` para a tela de gravação) e carregar o CSS pelo mesmo mecanismo que o app já usa (localizar com `grep -n "css\|Css" src/*.js`); remover `style-hc.css` e a referência no gresource; aplicar `applyTheme()`.
- [ ] **Step 2: Verificar:** build limpo; `timeout 6 dev.nicolas.DailyTaker` rc 124 **sem** o warning `gtk-application-prefer-dark-theme`/`style-hc.css`; `tools/snapshot.sh` mostra a UI atual em escuro e laranja (tela de gravação e header incluídos). `bash tests/run.sh` verde.
- [ ] **Step 3: Commit:** `feat: tema escuro e laranja fixo`.

---

### Task 3: Módulos puros de apresentação

**Files:**
- Create: `src/speakerColors.js`, `src/recordingGroups.js`, `src/playerModel.js`, `src/recordingName.js`, `src/sidebarModel.js`; tests `tests/speakerColors_test.js`, `recordingGroups_test.js`, `playerModel_test.js`, `recordingName_test.js`, `sidebarModel_test.js`
- Modify: `src/transcriptSearch.js` (exportar `searchableText(t)`)

**Interfaces (todas `var`, sem GTK):**
- `speakerColors.js`: `SPEAKER_COLORS: string[6]`; `speakerColor(id: number|null): string` (null → `#9CA4B8`); `speakerClass(id: number|null): string` → `speaker-N` (`N = id % 6`) ou `speaker-none`.
- `recordingGroups.js`: `groupLabel(date: Date, now: Date): string` → `HOJE`, `ONTEM`, `ESTA SEMANA` (últimos 7 dias, fora hoje/ontem), `ESTE MÊS`, senão `SETEMBRO DE 2026`; `groupRecordings<T>(items: T[], now: Date, createdOf: (T)=>Date): {label: string, items: T[]}[]` (ordem preservada, agrupa consecutivos); `formatDurationShort(sec: number): string` → `19min08s`, `04min32s`, `1h05min` (≥ 1 h), `''` se sec ≤ 0; `itemSubtitle({created: Date, durationSec: number}, now: Date): string` → `09:30 • 19min08s` (hoje), `Ontem • 12min40s`, `dd/mm • …`; `detailSubtitle({created: Date, durationSec: number, speakerCount: number}): string` → `22 out 2026 • 19min08s • 2 locutores` (singular `1 locutor`; omite o que for desconhecido).
- `playerModel.js`: `formatShortClock(sec): string` (`00:34`, `1:02:03`); `positionLabel(pos, dur): string` → `00:34 / 19:08`; `RATES = [0.75, 1, 1.25, 1.5, 2]`; `rateLabel(r): string` → `0,75x`, `1x`, `1,25x`, `1,5x`, `2x`; `clampVolume(v): number` (0–1); `fractionFromX(x, width): number` (0–1); `bucketPeaks(peaks: number[], bars: number): number[]` (máximo por balde); `shouldScroll({follow, index, previousIndex}): boolean` (só quando segue e o índice mudou e é ≥ 0).
- `recordingName.js`: `defaultRecordingName(date: Date, exists: (name: string)=>boolean): string` → `Gravação 22 out 14:30`, colisão `Gravação 22 out 14:30 (2)`.
- `sidebarModel.js`: `recordingMatches(query: string, name: string, transcript: Transcript|null): boolean` (sem acento/caixa, termos em AND; sem transcrição só casa pelo nome; usa `normalize`/`searchableText`); `statusBadge(status: 'none'|'running'|'error'|'ready'): {kind: 'none'|'ok'|'running'|'error', label: string}` → `Transcrita` / `Transcrevendo…` / `Erro` / `''`.

- [ ] **Step 1: Testes falhando** (`bash tests/run.sh` → "is not a function"): para cada módulo, os exemplos literais acima como asserções (ex.: `groupLabel` com `now` = 22/10 14:30 e datas 22/10 09:30 → HOJE, 21/10 → ONTEM, 18/10 → ESTA SEMANA, 03/10 → ESTE MÊS, 15/09/2026 → `SETEMBRO DE 2026`; `defaultRecordingName(new Date(2026,9,22,14,30), ()=>false)` → `Gravação 22 out 14:30`, e com `exists` verdadeiro para o 1º → `… (2)`; `recordingMatches('reuniao','Reunião',null)` true; `bucketPeaks([.1,.9,.2,.3],2)` → `[.9,.3]`; `speakerClass(7)` → `speaker-1`; `speakerColor(null)` → `#9CA4B8`).
- [ ] **Step 2: Implementar os módulos** conforme as assinaturas (horários sempre no fuso local; sem `undefined`/`NaN` em nenhuma saída — um teste por módulo com entradas faltando).
- [ ] **Step 3:** `bash tests/run.sh` PASS. **Step 4: Commit:** `feat: módulos puros de apresentação (grupos, player, cores, nomes)`.

---

### Task 4: Nome padrão da gravação por data/hora

**Files:**
- Modify: `src/recorder.js` (`start()` usa `defaultRecordingName(new Date(), exists)` com `exists` = arquivo existe em `RecordingsDir`), gresource src (registrar `recordingName.js`, `playerModel.js`, `speakerColors.js`, `recordingGroups.js`, `sidebarModel.js`)

**Interfaces:**
- Consumes: `defaultRecordingName` (Task 3). Produces: nova gravação nasce como `Gravação 22 out 14:30`.

- [ ] **Step 1:** Trocar o laço `Recording %d` pelo `defaultRecordingName`; nomes não podem conter `/` (o formato não contém).
- [ ] **Step 2: Verificar:** `bash tests/run.sh` verde; build/instala; `timeout 6 dev.nicolas.DailyTaker` rc 124 limpo; teste headless do `Recorder.start()` com fonte `audiotestsrc` (como em `tests/recorder_pipeline_test.js`) mostra o arquivo com o nome esperado e ` (2)` numa segunda gravação no mesmo minuto.
- [ ] **Step 3: Commit:** `feat: nome padrão de gravação por data e hora`.

---

### Task 5: `Playback` — player único

**Files:**
- Create: `src/playback.js`, `tests/playback_test.js`
- Modify: gresource src (registrar `playback.js`)

**Interfaces:**
- Produces: `class Playback extends GObject.Object` (GstPlayer). Propriedades: `uri: string|null` (somente leitura), `playing: boolean`, `rate: number`, `volume: number` (0–1), `position: number` (s), `duration: number` (s). Sinais: `state-changed(boolean playing)`, `position-updated(double seconds)`, `duration-changed(double seconds)`, `ended`. Métodos: `load(uri: string|null)` (para e troca; `null` descarrega), `play()`, `pause()`, `toggle()`, `seek(seconds)` (limita a [0, duration]), `stop()`, `setRate(r)` (valida contra `RATES`; falha do GstPlayer → volta a 1 e emite `rate-failed`), `setVolume(v)`. `ended` pausa e posiciona em 0.

- [ ] **Step 1: Testes falhando** (`testAsync`, GstPlayer com sink de áudio `fakesink` e volume 0, arquivo de `ffmpeg -f lavfi -i sine=d=3 -c:a libopus` em dir temporário, sem som): `load` → `duration-changed` ≈ 3; `play` → `state-changed(true)` e `position-updated` crescente; `seek(2)` → posição ≥ 2; `seek(99)` limita à duração; `setRate(1.5)` e `setRate(3)` (inválida → ignorada); `load(null)` zera `uri`/`playing`; `toggle` alterna; `ended` ao fim reposiciona em 0; `stop()` duas vezes não lança.
- [ ] **Step 2: Implementar** `Playback` (um `GstPlayer.Player` com `PlayerGMainContextSignalDispatcher`; `position-updated` do player; guardas contra uso após `load(null)`).
- [ ] **Step 3:** `bash tests/run.sh` PASS sem ruído. **Step 4: Commit:** `feat: Playback — player único com velocidade e volume`.

---

### Task 6: `SeekWaveform` e `PlayerBar`

**Files:**
- Create: `src/seekWaveform.js`, `src/playerBar.js`, `data/ui/player-bar.ui`; gresource (src+data)
- Modify: `data/style.css` (`.player-bar`), gschema (+`playback-rate` double 1.0, `playback-volume` double 1.0, `follow-audio` boolean true)

**Interfaces:**
- Produces: `SeekWaveform extends Gtk.DrawingArea`: `setPeaks(peaks: number[])`, propriedade `position` (0–1), sinal `seek-requested(double fraction)` (clique e arraste usam `fractionFromX`); desenha barras (`bucketPeaks` pela largura) — parte tocada em laranja, resto em `#9CA4B8` com alpha, marcador circular. `PlayerBar extends Gtk.Box` (template `player-bar.ui`): `bind(playback: Playback)`, `setRecording(recording: Recording|null)` (carrega picos com `recording.loadPeaks()`/`peaks-updated`; `null` desabilita tudo), propriedade `followAudio: boolean` ligada a `Settings 'follow-audio'`; controles: botão redondo laranja play/pausa, onda, `00:34 / 19:08` (`positionLabel`), menu de velocidade (`rateLabel`, 5 itens, marca o atual), botão de volume (clique = mudo/desmudo) + `Gtk.Scale` 0–100 %, `Gtk.Switch` + rótulo "Acompanhar áudio". Persistência: lê `playback-rate`/`playback-volume` ao criar e grava ao mudar.

- [ ] **Step 1:** Implementar `SeekWaveform` e `PlayerBar` (sem estado do app além do `Playback` injetado).
- [ ] **Step 2: Verificar:** build limpo; `tools/snapshot.sh /tmp/p.png --component playerbar` (adicionar o componente em `devSnapshot.js`) mostra a barra com onda e controles no tema; `bash tests/run.sh` verde.
- [ ] **Step 3: Commit:** `feat: barra do player com onda clicável, velocidade e volume`.

---

### Task 7: `TranscriptView` no layout da mockup

**Files:**
- Modify: `src/transcriptView.js`, `data/ui/transcript-view.ui`, `data/style.css`, `src/transcriptViewModel.js` (+`findMatches`), `tests/transcriptViewModel_test.js`

**Interfaces:**
- Consumes: `speakerClass`, `formatShortClock`, `shouldScroll`.
- Produces: mesmos sinais de hoje (`seek-requested`, `transcript-changed`, `regenerate-requested`) e `setTranscript(t, recordingFile)`/`release()`/`running`; **novos**: `embedded: boolean` (padrão `false` = comportamento atual, com cabeçalho interno, grupo de ações `transcript` e `attachPlayer(player, state)`, para o `Window` antigo continuar funcionando até a Task 10) e `bindPlayback(playback: Playback)` (usado quando `embedded = true`); novo: `followAudio: boolean` (propriedade), `setFindQuery(query: string): {count: number, index: number}`, `findNext()`, `findPrevious()` (realça o bloco e rola até ele). Layout de bloco: coluna de horário (`mm:ss`), ponto colorido (`speaker-N`), nome do locutor (botão para renomear, como hoje), texto selecionável; bloco atual com `.current` (barra laranja à esquerda, horário/ponto laranja); **Copiar bloco** em menu que aparece ao passar o mouse. Com `embedded = true` o cabeçalho interno (título/metadados/ações) não é mostrado (vai para o `DetailPane`); a Task 10 apaga os caminhos não-embutidos junto com o `Window` antigo. `viewModel.findMatches(blocks: Block[], query: string): number[]` (índices dos blocos que contêm a consulta, sem acento/caixa).

- [ ] **Step 1: Testes falhando** (`findMatches`: `'reuniao'` acha bloco com "Reunião", AND de termos, consulta vazia → `[]`).
- [ ] **Step 2:** Refatorar o layout dos blocos mantendo o comportamento já revisado (preenchimento em idle de 100, seleção de texto sem seek, copiar bloco/tudo via métodos públicos `copyAll(withSpeakers)`, renomear locutor com bloqueio durante execução, destaque por timer de 150 ms usando `playback.position`, remoção do idle em `release()`); rolar até o bloco atual só quando `shouldScroll(...)`.
- [ ] **Step 3: Verificar:** `tools/snapshot.sh /tmp/t.png --component transcriptview --at 34` (adicionar o componente em `devSnapshot.js`) mostra os blocos como na mockup (horário, ponto azul/roxo, nome, texto; bloco 00:34 realçado em laranja); testes verdes; sem warnings novos.
- [ ] **Step 4: Commit:** `feat: blocos da transcrição no layout da mockup, com busca interna`.

---

### Task 8: `DetailPane`

**Files:**
- Create: `src/detailPane.js`, `data/ui/detail-pane.ui`; gresource; `tests/detailPaneModel_test.js` (lógica pura em `src/sidebarModel.js` ou `src/playerModel.js`, ver abaixo)

**Interfaces:**
- Consumes: `TranscriptView`, `detailSubtitle`, `transcriptionUi` (`confirmMessage` é do `Window`).
- Produces: `DetailPane extends Gtk.Box`: `setRecording(recording: Recording|null)`, `setTranscript(t: Transcript|null)`, `setState(state: 'none'|'running'|'error'|'ready')`, `bindPlayback(playback)`, `view: TranscriptView`, `tab: 'transcricao'|'resumo'` (get/set). Sinais: `generate-requested(boolean regenerate)`, `export-requested(string ext)`, `copy-requested(boolean withSpeakers)`. Cabeçalho: título (`recording.name`, `use_markup:false`), subtítulo `detailSubtitle`, abas **Transcrição**/**Resumo** (botões alternados ligados a um `Gtk.Stack`, sublinhado laranja na ativa), botões de ícone **Buscar** (revela barra de busca → `view.setFindQuery`, Enter/Shift+Enter = próximo/anterior, Esc fecha), **Copiar** (menu "Com locutores e tempos" / "Só o texto") e **Exportar** (menu `.md` / `.txt`). Painel central por estado: sem seleção "Selecione uma gravação"; sem gravações "Nenhuma gravação ainda" + botão Nova gravação; sem transcrição cartão "Esta gravação ainda não foi transcrita" + custo estimado (texto vindo do `Window`) + botão **Gerar transcrição**; `running` cartão com spinner "Transcrevendo…"; `error` cartão com a mensagem e "Tentar de novo"; `ready` o `TranscriptView`. Aba Resumo (Plano B preenche): `Adw.StatusPage` "Resumo em breve" + botão "Gerar resumo" desabilitado.

- [ ] **Step 1: Testes falhando** (`tests/detailPaneModel_test.js` em módulo puro `paneState(recording: object|null, hasRecordings: boolean, status): 'empty-library'|'no-selection'|'not-transcribed'|'running'|'error'|'ready'`; casos da lista acima — Review Focus 4).
- [ ] **Step 2:** Implementar `paneState` (em `src/sidebarModel.js`) e o `DetailPane` (ver Interfaces).
- [ ] **Step 3: Verificar:** `tools/snapshot.sh /tmp/d.png --component detailpane` com a gravação 1 (pronta), a 2 (sem transcrição) e a aba Resumo (parâmetros `--select`/`--tab` também valem aqui) renderizam cada painel sem warnings; `bash tests/run.sh` verde.
- [ ] **Step 4: Commit:** `feat: painel de detalhe com abas, estados e busca na transcrição`.

---

### Task 9: `Sidebar`

**Files:**
- Create: `src/sidebar.js`, `data/ui/sidebar.ui`; gresource; `data/style.css` (itens)
- Modify: `src/transcriptSearch.js` (já exporta `searchableText` na Task 3)

**Interfaces:**
- Consumes: `RecordingList` (`Gio.ListStore`), `groupLabel`/`itemSubtitle`/`formatDurationShort`, `recordingMatches`, `statusBadge`, `rowStatus`/`statusInfo` de `transcriptionUi.js`, `loadTranscript`.
- Produces: `Sidebar extends Gtk.Box`: construtor `(recordingList, transcriptionService)`; `selected: Recording|null` (get); `select(recording: Recording|null)`; `refreshStatus(uri: string)`; `invalidateTranscript(uri)`; sinais `recording-selected(Recording|null)`, `rename-requested(Recording)`, `delete-requested(Recording)`, `transcribe-requested(Recording, boolean regenerate)`, `export-audio-requested(Recording)`. Cabeçalho "Gravações" + botão ⇪ **Exportar áudio** (habilitado só com seleção); `Gtk.SearchEntry` "Buscar gravação" (debounce; filtra por `recordingMatches` com cache de transcrição por URI); lista com `Gtk.FilterListModel` sobre o `RecordingList` e `ListBox` com `set_header_func` mostrando `group-label` (HOJE/ONTEM/…); item: ícone de onda (laranja no selecionado), nome, `itemSubtitle`, selo de status à direita (`● Transcrita` verde / spinner `Transcrevendo…` / `● Erro` vermelho / nada); menu ⋮ (Renomear, Gerar/Regenerar transcrição, Exportar áudio, Excluir); selecionado = fundo `#26292F` + barra laranja 3 px; rodapé fixo ícone de disco + "Salvo neste dispositivo"; vazio "Nenhuma gravação ainda". Ordem: mais recente primeiro (já é a do `RecordingList`).

- [ ] **Step 1:** Implementar conforme Interfaces (não cria players nem peaks por linha; o `loadPeaks` é só da barra do player).
- [ ] **Step 2: Verificar:** `tools/snapshot.sh /tmp/s.png --component sidebar` (adicionar o componente em `devSnapshot.js`) mostra a sidebar como a mockup (grupos, subtítulos, selo "Transcrita", seleção); busca "reuniao" filtra; `bash tests/run.sh` verde.
- [ ] **Step 3: Commit:** `feat: sidebar de gravações agrupada, com busca e selos de status`.

---

### Task 10: Casca da janela (split view) e integração

**Files:**
- Modify: `src/window.js`, `data/ui/window.ui`, `data/ui/recorder.ui`, `src/application.js`, gresource src e data (tirar os removidos)
- Remove: `src/row.js`, `data/ui/row.ui`, `src/recordingListWidget.js`, `src/transcriptsPage.js`, `data/ui/transcripts-page.ui`, `src/transcriptsPageModel.js`, `tests/transcriptsPageModel_test.js`, e o `AdwViewSwitcher`/`switcherBar`/`titleStack` do `window.ui`

**Interfaces:**
- Consumes: `Sidebar`, `DetailPane`, `PlayerBar`, `Playback`, `TranscriptionService`, `RecorderWidget`.
- Produces: `Window` com `Adw.ToolbarView`: header (ícone do app + "Daily Taker", botão laranja **Nova gravação**, engrenagem = Preferências, menu primário reduzido a Atalhos/Sobre); conteúdo `Adw.NavigationSplitView` (sidebar = `Sidebar`; content = `DetailPane` + `PlayerBar` na barra inferior); `Adw.Breakpoint` `max-width: 720sp` recolhe a sidebar (botão de voltar do `NavigationSplitView` só nesse modo). `WindowState` passa a `BROWSE | RECORDER` (a tela de gravação continua cobrindo a janela, com o tema novo). Métodos públicos: `selectRecording(recording: Recording|null)`, `playback: Playback`, `addToast(title: string)`.
- Comportamento: selecionar → `detailPane.setRecording/setTranscript/setState`, `playerBar.setRecording`, `playback.load(recording.uri)` (para o áudio anterior); sem seleção → painel vazio e player desabilitado; `items-changed` mantém/ajusta a seleção (se a selecionada sumiu, seleciona a vizinha ou nenhuma, **parando o player** — Review Focus 2); ao parar uma gravação nova, ela vira a selecionada e o player para (Focus 3); falha do gravador continua levando a um estado consistente (toast e volta ao BROWSE); `seek-requested` da transcrição → `playback.seek` + `play`; `playerBar.followAudio` é ligado a `transcriptView.followAudio` (bind de propriedade); `connectChange` do serviço atualiza `sidebar.refreshStatus`, `detailPane.setState` e `transcriptView.running` quando é a gravação selecionada.

- [ ] **Step 1:** Reescrever `window.ui` e `window.js` com a nova casca, removendo os módulos listados e **mantendo** (migrados nesta task, sem mudar a lógica já revisada): `_requestTranscription`/`_runTranscription`/`_onTranscriptionFailed`/`_onTranscriptionDone`/`guardedSave`/retry (agora chamados por `sidebar.transcribe-requested` e `detailPane.generate-requested`).
- [ ] **Step 2:** Excluir e renomear ficam temporariamente por ações simples (completados na Task 11); o app não pode travar nem lançar exceção ao selecionar, tocar, parar gravação, ou com a lista vazia.
- [ ] **Step 3: Verificar:** `bash tests/run.sh` verde (sem os testes removidos); build limpo; `timeout 6 dev.nicolas.DailyTaker` rc 124 sem erros de template/import/gresource; `tools/snapshot.sh /tmp/a.png --select 1 --at 34` e a mockup lado a lado: estrutura (header, sidebar, painel, player) equivalente; conferir `--size 600x900` (colapsado) renderiza a lista; nenhuma exceção no stderr.
- [ ] **Step 4: Commit(s):** `feat: janela mestre-detalhe com player único` (pode ser mais de um commit).

---

### Task 11: Renomear, excluir/desfazer, exportar áudio, aceleradores

**Files:**
- Create: `src/deleteQueue.js`, `tests/deleteQueue_test.js`
- Modify: `src/window.js`, `src/sidebar.js`, `src/application.js`, `data/ui/help-overlay.ui`, gresource src (registrar `deleteQueue.js`)

**Interfaces:**
- Produces (`deleteQueue.js`, sem GTK): `class DeleteQueue { add(recording, index): number /*id*/; undo(id): {recording, index}|null; commit(id): Recording|null; commitAll(): Recording[]; has(recording): boolean }` — cada exclusão tem id próprio; `undo` devolve o item e o remove da fila; `commit` devolve a gravação a apagar (e a remove da fila); `commitAll` devolve todas as pendentes. Window: um `Adw.Toast` por exclusão com botão "Desfazer" (ação com parâmetro = id) e `dismissed` → `commit(id)` → `recording.delete()`; `vfunc_close_request` → `commitAll()` e apaga (o usuário já viu o aviso). Renomear: `Adw.MessageDialog` com `Gtk.Entry` (pré-preenchido, valida com `recordingNameProblem`, `use_markup:false`) → `recording.name = …`; bloqueado enquanto a transcrição daquela gravação roda (`rowActions`). Exportar áudio: `Gtk.FileDialog.save` + `recording.save(dest)` (botão ⇪ e menu ⋮). Aceleradores: `win.play-pause` (`space`), `win.seek-backward`/`win.seek-forward` (`b`/`n`, ±10 s), `win.rename` (`F2`), `win.delete` (`Delete`), `win.export-audio` (`<Primary>s`) — todos desabilitados no estado RECORDER e ignorados quando o foco está em campo de texto (Review Focus 5); `recorder.*` mantêm `space`/`s`/`Delete` só no estado RECORDER.

- [ ] **Step 1: Testes falhando** (`deleteQueue`): dois `add` seguidos → ids distintos; `undo(id1)` devolve o primeiro e mantém o segundo na fila; `commit(id2)` devolve a segunda; `commitAll` com um pendente devolve só ele; `undo` de id já confirmado → `null` (Review Focus 1).
- [ ] **Step 2:** Implementar `DeleteQueue` e migrar `sendNotification`/`win.undo`/`toastUndo` para ela (remover a flag única e o handler substituível); implementar renomear, exportar áudio e os aceleradores; atualizar `help-overlay.ui` (pt-BR, "Voltar 10 s"/"Avançar 10 s").
- [ ] **Step 3: Verificar:** testes verdes; build/instala; headless (hook temporário **removido** antes do commit, ou `devSnapshot`): excluir duas gravações seguidas e desfazer a primeira restaura a certa; excluir a gravação selecionada para o player e o painel vai para a vizinha/vazio; renomear mantém a seleção e atualiza título do painel e item da sidebar; `space` digitado na busca não alterna o player.
- [ ] **Step 4: Commit:** `feat: renomear, excluir com desfazer em fila, exportar áudio e atalhos`.

---

### Task 12: Persistência, fidelidade visual e documentação

**Files:**
- Modify: `data/style.css` (ajustes finos), `README.md`, `docs/manual-checklist.md`, `tools/README.md`, `data/ui/help-overlay.ui`, `docs/superpowers/specs/2026-10-22-daily-taker-ui-redesign.md` (só se a implementação divergir: registrar a divergência)
- Create: `docs/superpowers/design/comparacao-2026-10-22.png` (captura final lado a lado) e `docs/superpowers/design/comparacao-notas.md` (o que ficou diferente da mockup e por quê)

- [ ] **Step 1: Persistência:** confirmar que velocidade, volume e "Acompanhar áudio" são lidos ao abrir e gravados ao mudar (teste headless: alterar via `Settings`, reabrir `PlayerBar`).
- [ ] **Step 2: Passe de fidelidade:** com `tools/snapshot.sh --select 1 --at 34` (1536×1024, fixtures iguais ao texto da mockup), comparar região a região com `mockup-alvo-2026-10-22.png` (header, "Gravações" + busca, grupos, item selecionado, selo "Transcrita", título/subtítulo, abas, ícones, blocos com pontos azul/roxo, bloco atual em laranja, player com onda/velocidade/volume/toggle, rodapé "Salvo neste dispositivo"); ajustar CSS (espaçamentos, tamanhos de fonte, raios, cores) até ficar visualmente equivalente; registrar em `comparacao-notas.md` cada diferença que o GTK/libadwaita não permitir, com o motivo.
- [ ] **Step 3: Docs:** `README.md` (nova interface, atalhos, nome padrão, `tools/snapshot.sh` na seção Desenvolvimento) e `docs/manual-checklist.md` (seção do redesenho: seleção, player, velocidade, volume, acompanhar áudio, busca na sidebar e na transcrição, exportar áudio, renomear/excluir em fila, janela estreita, aba Resumo "em breve").
- [ ] **Step 4: Verificar tudo:** `bash tests/run.sh` verde; build limpo do zero; `timeout 6 dev.nicolas.DailyTaker` rc 124 com stderr só com o aviso do cookie X do ambiente; `xmllint` nos `.ui`/gresource/gschema alterados; `git grep -n "transcripts-page\|row.ui\|recordingListWidget\|style-hc"` vazio (fora de docs).
- [ ] **Step 5: Commit:** `feat: acabamento visual da UI nova, persistência e documentação`.
