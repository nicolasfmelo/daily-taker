# Ferramentas de desenvolvimento

Conferência visual da interface: renderizar a janela **real** do app (ou um
componente) num PNG, com dados de exemplo, sem tocar a tela, os dados, a
configuração, o chaveiro nem o áudio do usuário.

## `make-fixtures.sh` — gravações de exemplo

```sh
bash tools/make-fixtures.sh DIR          # áudio na duração real (~5 s para gerar)
FIXTURE_FAST=1 bash tools/make-fixtures.sh DIR   # áudio de 30 s (testes)
```

Cria `DIR/daily-taker/` (o `XDG_DATA_HOME` do app aponta para `DIR`):

| Gravação                | Data (mtime e `recorded_at`) | Duração        | Transcrição |
|-------------------------|------------------------------|----------------|-------------|
| `Daily · Projeto Atlas` | hoje 09:30                   | 1148 s (19:08) | sim         |
| `Ideias para o app`     | hoje 08:12                   | 272 s (04:32)  | sim         |
| `Notas da reunião`      | ontem 16:45                  | 760 s (12:40)  | sim         |
| `Sem transcrição`       | há 3 dias 14:05              | 95 s (01:35)   | não         |

- Áudio Ogg/Opus mono 32 kb/s, sem extensão (como as gravações do app), um tom
  com volume variando para a forma de onda não sair chapada.
- `<nome>.transcript.json` no formato v1 (`src/transcript.js`), 2 locutores:
  `0` renomeado "Nicolas" e `1` com o nome padrão "Locutor 2". Blocos da mockup
  em 00:00, 00:18, 00:34 e 00:47, seguidos de mais 7 blocos (até ~2:40) para a
  lista rolar. Gerados por `tools/fixtureData.js`.
- A duração exibida pelo app vem do arquivo (GstPbutils.Discoverer); o campo
  `duration` da transcrição tem o mesmo valor nominal. Com `FIXTURE_FAST=1` o
  áudio tem 30 s, então a lista mostra 00:30 — use o modo normal para capturas.
- As datas são relativas a hoje: rodar de novo atualiza datas e transcrições e
  reaproveita o áudio (se o modo for o mesmo).
- Segurança: recusa `DIR` dentro de `~/.local/share`, `~/.config` ou `~/.cache`
  (do home real, mesmo com `HOME` trocado) e recusa `DIR/daily-taker` que tenha
  arquivos não criados por ele (marca: `DIR/.daily-taker-fixtures`).

## `snapshot.sh` — captura da janela

```sh
bash tools/snapshot.sh OUT.png [--component window|windowcheck|playerbar|transcriptview|detailpane|detailpanecheck|sidebar|sidebarcheck]
                       [--select N] [--tab transcricao|resumo] [--at SEG] [--size LxA]
                       [--state recorder|none|running|error|ready]
                       [--find TEXTO] [--empty 0|1] [--query TEXTO]
```

- `--component` (padrão `window`): `window` é a janela principal real. Os
  demais são renderizados sozinhos numa janela simples, com dados de fixture;
  são registrados em `COMPONENTS` em `src/devSnapshot.js`. Um nome não
  registrado falha com mensagem clara e sem PNG.
  - `window`: a janela mestre-detalhe real (`src/window.js`) com a biblioteca das
    fixtures. Espera a varredura da pasta (`RecordingList.loaded`) e as durações.
    `--select N` seleciona a gravação N da lista (1 = "Daily · Projeto Atlas"; 4 =
    "Sem transcrição"; padrão: nenhuma) e carrega painel, transcrição e player;
    `--tab transcricao|resumo` escolhe a aba; `--at SEG` posiciona o player
    pausado (realça o bloco daquele instante); `--query TEXTO` aplica a busca da
    sidebar; `--empty 1` esvazia só a lista em memória (painel "Nenhuma gravação
    ainda"; nenhum arquivo é tocado); `--state recorder` mostra a tela de
    gravação. O `Playback` da janela usa um `fakesink` durante a captura
    (`playbackOptions()` em `src/devSnapshot.js`, passado pelo `Application` à
    janela: o `window.js` não importa o devSnapshot). Imprime as larguras mínimas e
    o breakpoint aplicado (`nenhum`, `média` abaixo de 1000 sp, `estreita` abaixo
    de 720 sp, sidebar recolhida). Ex.:
    `bash tools/snapshot.sh /tmp/a.png --select 1 --at 34` (o alvo da mockup) e
    `bash tools/snapshot.sh /tmp/n.png --select 1 --size 600x900` (recolhida).
  - `windowcheck`: verificação da janela inteira na cópia das fixtures. Imprime
    `PASS`/`FAIL` por verificação: estado do painel de cada fixture (3 prontas, a
    4ª sem transcrição, com custo estimado); trocar de gravação com outra tocando
    para o áudio anterior (e continua parado 400 ms depois); clique num bloco
    pula e toca; renomear a selecionada recarrega o player na URI nova, pausado na
    mesma posição, com a visão no arquivo novo e a seleção mantida; nome inválido
    recusado; a selecionada que sai da lista (tocando) dá lugar à vizinha com o
    player parado; **Excluir com Desfazer** (fila `DeleteQueue`): excluir A (a
    selecionada, tocando) e logo depois B (pela tecla Delete) dá um toast por
    exclusão (`"<nome>" excluída`, sem markup, 8 s, Desfazer →
    `win.undo-delete(id)`), a vizinha selecionada com o player parado nela e o
    painel definido; uma transcrição que termina com a gravação na fila não é
    salva; Desfazer A devolve só A (na posição por data, selecionada) e B
    continua pendente; o toast de B sumir manda B para a lixeira isolada com A
    presente; Desfazer depois de confirmada não faz nada; **atalhos**
    (`handleShortcutKey`, o mesmo caminho do controlador de teclas, com o foco
    real; o GJS não cria `Gdk.KeyEvent`): espaço/B/Delete/F2 digitados na busca
    ficam para o campo, espaço num botão focado fica para o botão, tecla vinda de
    popover e Shift+B são ignorados, espaço com o foco na lista toca, N/B pulam
    ±10 s, `win.play-pause` toca e pausa, Ctrl+S (mesmo na busca) exporta pelo
    mesmo caminho do botão e do menu, na tela de gravação as ações `win.*` ficam
    desligadas; **renomear** pelo F2: diálogo pré-preenchido, sem markup, nome
    inválido ou vazio desliga Renomear, uma transcrição que começa com o diálogo
    aberto bloqueia (aviso "Aguarde a transcrição terminar para renomear."),
    nome de outra gravação avisa sem exceção, renomear mantém seleção, item da
    sidebar, título do painel e player; **excluir durante a transcrição** é
    recusado (tecla Delete, menu ⋮ aberto antes e o pedido na janela: continua na
    lista, fila vazia, aviso "Aguarde a transcrição terminar para excluir.";
    Excluir desligado no menu) e volta a funcionar quando ela termina;
    **confirmar** manda áudio e transcrição para a lixeira isolada; **lixeira
    impossível** (pasta das gravações sem escrita, `chmod 555` só durante o
    passo): aviso "Não foi possível mover a gravação para a lixeira.", a
    gravação volta para a lista e a sidebar, áudio e transcrição intactos,
    nada apagado; com a pasta liberada, excluir de novo funciona; começar a
    gravar para o player; parar insere a gravação nova (cópia de uma fixture,
    sem microfone) no topo, uma vez, e a seleciona com o player parado; parar
    sem nada gravado e falha do gravador avisam e voltam à lista; breakpoint
    conforme a largura, e recolher/Voltar mantém a seleção; lista vazia mostra a
    biblioteca vazia; **fechar a janela** com duas exclusões pendentes manda as
    duas para a lixeira (cada uma uma vez, na ordem em que foram feitas, com a
    transcrição) antes de sair, e fechar de novo/fila vazia não lança. Esperas
    (biblioteca, seleção) têm limite: uma que não chega falha com mensagem em vez
    de travar (conferido no
    `shutdown()` real, depois da captura). Tocar usa `fakesink`: nenhum som. Uma
    falha = sem PNG e saída ≠ 0; uma `FAIL` impressa depois da captura (o
    fechamento) também faz o `snapshot.sh` sair com erro. Rode também com `--size 600x900` (breakpoint real). Altera
    arquivos: só no ambiente isolado.
  - `playerbar`: a barra do player (`src/playerBar.js`) com a gravação mais
    recente das fixtures (19:08), pausada em `--at SEG` (padrão 0), volume de
    exemplo 60 % e `Gio.Settings` em memória. O `Playback` usa um `fakesink` e
    nunca toca. A captura espera os picos da onda (`peaks-updated`) e a posição
    (`ready` do componente, limite de 30 s) antes dos 1,5 s de assentamento.
    Ex.: `bash tools/snapshot.sh /tmp/p.png --component playerbar --at 34 --size 1200x120`
    (a janela simples tem altura mínima de 200 px).
  - `transcriptview`: a visão da transcrição (`src/transcriptView.js`, a do
    painel de detalhes), com a transcrição da gravação `--select N`
    (padrão 1 = a mais recente, "Daily · Projeto Atlas"). `--at SEG` posiciona um
    `Playback` pausado (fakesink, volume 0) e realça o bloco daquele instante;
    `--find TEXTO` aplica a busca interna (`.find-match`/`.find-active`).
    Espera o sinal `blocks-built` (lotes ociosos) e a posição.
    Tamanho padrão 1000x700.
    Ex.: `bash tools/snapshot.sh /tmp/t.png --component transcriptview --select 1 --at 34`
  - `detailpane`: o painel de detalhe (`src/detailPane.js`): cabeçalho, abas,
    Buscar/Copiar/Exportar e o painel do estado. Gravação `--select N` (padrão 1;
    `0` = nenhuma selecionada, "Selecione uma gravação"; a 4, "Sem transcrição",
    não tem transcrição); `--empty 1` = biblioteca vazia ("Nenhuma gravação
    ainda"). `--state none|running|error|ready` força o estado (padrão: `ready`
    com transcrição, `none` sem); `--tab resumo` mostra a aba Resumo; `--at SEG`
    posiciona o `Playback` (fakesink, sem som); `--find TEXTO` abre a barra de
    busca do painel. Espera `blocks-built`, a posição e a duração da gravação.
    Tamanho padrão 1100x760.
    Ex.: `bash tools/snapshot.sh /tmp/d.png --component detailpane --select 4`
  - `detailpanecheck`: verificação do `DetailPane` na cópia temporária das fixtures
    (troca de gravação, ordem invertida setTranscript/setRecording, renomear a
    gravação e salvar nome de locutor no arquivo novo, banner de erro/geração).
    Falha numa verificação = sem PNG e saída ≠ 0; sucesso imprime
    `detailpanecheck: N verificações OK` e captura o painel com o banner de erro.
    Altera arquivos: só roda no ambiente isolado (ver "Componentes que alteram
    dados" abaixo).
  - `sidebar`: a sidebar "Gravações" (`src/sidebar.js`) sobre um `RecordingList`
    real da cópia das fixtures (só leitura) e um serviço de transcrição falso
    (nunca chama a API). `--select N` seleciona o item N (padrão: nenhum);
    `--query TEXTO` aplica a busca (nome e conteúdo da transcrição; `reuniao`
    casa com as três transcritas, `zzzz` mostra "Nada encontrado para essa
    busca"); `--state running|error` põe a gravação 2 nesse status (spinner
    "Transcrevendo…" / "● Erro"); `--empty 1` = biblioteca vazia ("Nenhuma
    gravação ainda"). Espera a varredura assíncrona da pasta e a duração de
    cada gravação. Tamanho padrão 360x900 (a janela simples tem largura mínima
    de 360 px). Ex.: `bash tools/snapshot.sh /tmp/s.png --component sidebar --select 1`
  - `sidebarcheck`: verificação da `Sidebar` na cópia das fixtures. Imprime uma
    linha `PASS`/`FAIL` por verificação (seleção emite uma vez, clique na linha,
    `select(null)`, busca por nome e por conteúdo, seleção escondida pela busca
    → nenhuma, `select` de item escondido limpa a busca, `invalidateTranscript`
    no selo e na busca, status do serviço, menu ⋮ montado só ao abrir e as
    ações, Gerar desligado com duração 0 e religado por `notify::duration`
    com o menu aberto, Exportar do cabeçalho, renomear troca a chave do cache, remover a
    selecionada seleciona a vizinha, lista vazia). Uma falha = sem PNG e saída
    ≠ 0. Grava uma transcrição e renomeia: só no ambiente isolado.
- `--select N` (item N da lista, a partir de 1; 0 = nenhum no `detailpane`), `--tab`, `--at SEG` (posição
  do player): valem para `window` e para os componentes indicados acima.
- `--state recorder` (só com `--component window`): mostra a tela de gravação no
  lugar da lista, para conferir o tema nela. Só troca a página da janela; nenhuma
  gravação começa e nenhum dispositivo de áudio é aberto (`WINDOW_STATES` em
  `src/devSnapshot.js`). Com `--component detailpane`, `--state` é o estado do
  painel (`PANE_STATES`); com `--component sidebar`, o status da gravação 2
  (`SIDEBAR_STATES`: `running`, `error`).
- `--size LxA` (padrão `1536x1024`, o tamanho da mockup; `1000x700` para `transcriptview`;
  `1100x760` para `detailpane`; `360x900` para `sidebar`/`sidebarcheck`): tamanho do monitor
  virtual e da janela.
- Componentes que alteram dados (`MUTATING_COMPONENTS` em `src/devSnapshot.js`:
  `detailpanecheck`, `sidebarcheck`, `windowcheck`): o `snapshot.sh` exporta
  `DAILY_TAKER_SNAPSHOT_SANDBOX=1` e `DAILY_TAKER_SNAPSHOT_ROOT=<raiz temporária>`;
  antes de construir o componente (e de novo no início dele), `devSnapshot.js`
  exige a marca e que `GLib.get_user_data_dir()` esteja dentro dessa raiz
  (`isSandboxed`, testado em `tests/devSnapshot_test.js`). Fora disso recusa
  com mensagem clara e saída ≠ 0, sem alterar nada — inclusive com
  `DAILY_TAKER_SNAPSHOT` definido à mão na sessão real.
- Leva ~4 s. Saída ≠ 0 se nenhum PNG for gerado; `SNAPSHOT_VERBOSE=1` mostra o
  log completo do mutter/app; `SNAPSHOT_TIMEOUT` (padrão 60 s) limita a execução.

### Como funciona (receita do compositor headless)

1. `meson install -C build --destdir $tmp/stage` compila a árvore atual e a
   instala numa raiz temporária; o lançador é copiado com o prefixo trocado.
   **A instalação em `~/.local` não é tocada** (não precisa reinstalar para
   capturar).
2. Fixtures geradas (com cache) em `build/snapshot-fixtures/` e copiadas para
   `$tmp/data/daily-taker/` a cada execução, pois o app pode alterá-las.
3. O app roda como filho de um mutter headless num barramento D-Bus próprio,
   com ambiente limpo (`env -i`):

   ```sh
   env -i PATH=… LANG=… HOME=$tmp/home \
       XDG_DATA_HOME=$tmp/data XDG_CONFIG_HOME=$tmp/config \
       XDG_CACHE_HOME=$tmp/cache XDG_RUNTIME_DIR=$tmp/runtime \
       GSETTINGS_BACKEND=memory GSETTINGS_SCHEMA_DIR=$stage/…/glib-2.0/schemas \
       GDK_BACKEND=wayland GDK_DEBUG=no-portals GIO_USE_VFS=local \
       NO_AT_BRIDGE=1 GTK_A11Y=none \
       PULSE_SERVER=unix:$tmp/runtime/no-pulse PIPEWIRE_REMOTE=$tmp/runtime/no-pipewire \
       DAILY_TAKER_SNAPSHOT=OUT.png DAILY_TAKER_SNAPSHOT_SIZE=1536x1024 … \
       DAILY_TAKER_SNAPSHOT_SANDBOX=1 DAILY_TAKER_SNAPSHOT_ROOT=$tmp \
     setsid --wait timeout 60 dbus-run-session -- \
       mutter --headless --wayland --no-x11 --wayland-display snapshot-wayland \
              --virtual-monitor 1536x1024 -- gjs-console $tmp/launcher
   ```

   - Sem `DISPLAY`/`WAYLAND_DISPLAY`/`DBUS_SESSION_BUS_ADDRESS` do usuário:
     nada aparece na tela e o app não fala com a sessão real (nem com o
     chaveiro; `DAILY_TAKER_OP_KEY` também não passa).
   - `XDG_RUNTIME_DIR` temporário: o socket Wayland fica nele e os servidores
     PipeWire/Pulse reais (em `/run/user/…`) ficam inalcançáveis — nenhum som
     sai e o microfone não é aberto (o `Recorder` só é construído).
   - Mesmo que algo toque (`--at`), nenhum dispositivo de som real é aberto:
     `ALSA_CONFIG_PATH` aponta para uma configuração gerada em que o único PCM é
     `default`/`null` do tipo `null` (sem `hw`/cartões; CTL fica indefinido,
     porque o alsa-lib não tem CTL nulo) e `GST_PLUGIN_FEATURE_RANK` zera os
     sinks/fontes reais (alsa, pulse, pipewire, jack, openal, oss) e põe
     `fakeaudiosink` no topo, então `autoaudiosink`/playbin/GstPlayer tocam
     no nada e `autoaudiosrc` não acha fonte. `silencePlayback(player)` em
     `src/devSnapshot.js` (volume 0 + mudo, só durante captura) é usado pelos
     componentes avulsos; o `Playback` da janela, durante a captura, sai num
     `fakesink` (`playbackOptions()`), então nunca abre um dispositivo de som.
     Prova: `bash tools/snapshot.sh --probe-audio` roda playbin, autoaudiosink,
     autoaudiosrc, alsasink/alsasrc explícitos, o `pulsesrc` do gravador e um
     GstPlayer nesse mesmo ambiente, mostra o sink escolhido e confere em
     `/proc/<pid>/fd` que ninguém abriu `/dev/snd` (saída ≠ 0 se abrir).
   - `GSETTINGS_BACKEND=memory`: nada é escrito no dconf do usuário.
   - O mutter sai quando o app sai; o `dbus-run-session` encerra o barramento.
   - O `setsid` põe tudo num grupo de processos próprio; ao sair (inclusive por
     erro ou Ctrl+C) o script mata só esse grupo e apaga `$tmp`. O mutter e o
     gnome-shell do usuário nunca são tocados (confira com `pgrep -a mutter`).
4. `src/devSnapshot.js` (`maybeSnapshot`, chamado em `Application.vfunc_activate`,
   inerte sem `DAILY_TAKER_SNAPSHOT`) mostra a janela no tamanho pedido, espera
   1,5 s depois do `map` e grava o PNG: `Gtk.WidgetPaintable` → `Gtk.Snapshot`
   → `GskRenderNode` → `renderer.render_texture(node, 0,0,L,A)` →
   `texture.save_to_png`. A área é a da janela, sem a sombra da decoração.
   Depois fecha a janela (o app sai normalmente).

### Diferenças em relação à tela real

- Fontes padrão do sistema: a configuração do usuário (`~/.config/gtk-4.0`,
  dconf, portal de configurações) não é lida. O esquema de cores não depende
  disso: o app força o tema escuro (`src/appTheme.js`), então a captura sai
  escura como na sessão do usuário.
- O registro do GStreamer fica em cache em `build/snapshot-cache/`.
- O log do mutter traz avisos esperados (portais sem implementação, PipeWire
  indisponível); o script só mostra as linhas do app.
