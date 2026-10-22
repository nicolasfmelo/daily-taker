# Daily Taker

Gravador de voz pessoal para GNOME (GJS + GTK4 + libadwaita + GStreamer) para
registrar reuniões e conversas. Ele grava o microfone junto com o som do
computador (por exemplo, a outra ponta de uma chamada) em um único arquivo e,
quando você pede, gera a transcrição com separação de locutores.

## O que ele faz

- Grava microfone e som do sistema misturados, com indicadores de nível
  separados para cada um e aviso quando o som do sistema não chega. A gravação
  nova recebe um nome com data e hora (ex.: `Gravação 22 out 09:30`) e aparece
  selecionada na lista ao parar.
- **Gerar transcrição** (sob demanda): envia o áudio ao OpenRouter e salva o
  resultado ao lado do áudio, em `<gravação>.transcript.json`.
- Ouve a gravação com a transcrição sincronizada, renomeia, exporta e exclui
  (com desfazer).

## Interface

Janela única, tema escuro com acento laranja:

- **Cabeçalho**: ícone e "Daily Taker", **Nova gravação** (Ctrl+R),
  **Preferências** (Ctrl+,) e o menu (atalhos de teclado, Sobre).
- **Sidebar "Gravações"** (à esquerda): busca **por nome e pelo conteúdo da
  transcrição** (sem diferenciar acentos nem maiúsculas), lista agrupada por data
  (HOJE, ONTEM, ESTA SEMANA, …) com o selo da transcrição (● Transcrita,
  Transcrevendo…, ● Erro), menu ⋮ por item (Renomear, Gerar/Gerar novamente,
  Exportar áudio, Excluir) e o botão de exportar o áudio da selecionada.
- **Painel de detalhe** (à direita): título, data, duração e locutores; abas
  **Transcrição** e **Resumo**; Buscar na transcrição (realça os blocos e pula
  entre os resultados com Enter/Shift+Enter), Copiar (com locutores e tempos ou
  só o texto) e Exportar (`.md`/`.txt`). Clicar num bloco pula o áudio para ele
  e toca; o nome do locutor é clicável para renomear. Sem transcrição, um cartão
  mostra o custo estimado e o botão **Gerar transcrição**.
- **Aba Resumo**: ainda "em breve" (o resumo com IA é o próximo plano).
- **Player único** (embaixo do painel): play/pausa, onda clicável e arrastável,
  posição/duração, velocidade (0,75x a 2x), volume (clique no ícone = mudo) e
  **Acompanhar áudio** (rola a transcrição junto). Velocidade, volume e o toggle
  ficam salvos.
- **Excluir** manda a gravação (áudio, transcrição e forma de onda) para a
  **lixeira do sistema** depois de 8 s, com **Desfazer** no aviso; várias
  exclusões seguidas têm cada uma o seu Desfazer. Fechar o app confirma as
  pendentes. Excluir e renomear ficam bloqueados durante a transcrição.
- **Janela estreita**: abaixo de 1000 px a sidebar fica com 300 px (o selo
  mostra só o ponto) e o painel compacto; abaixo de 720 px a sidebar recolhe:
  escolher uma gravação abre o painel, com o botão Voltar para a lista.

### Atalhos

| Tecla | Ação |
|---|---|
| Espaço | Reproduzir / pausar a gravação selecionada |
| B / N | Voltar / avançar 10 s |
| F2 | Renomear a selecionada |
| Delete | Excluir a selecionada (com Desfazer) |
| Ctrl+S | Exportar o áudio da selecionada |
| Ctrl+R | Nova gravação |
| Ctrl+, | Preferências |
| Ctrl+? | Atalhos de teclado |

As teclas de letra e o espaço não disparam enquanto se digita num campo (busca,
diálogos). Durante a gravação, espaço pausa/retoma e S para.

## Requisitos

- gjs, GTK 4, libadwaita
- GStreamer com `gst-plugins-base` e `gst-plugins-good` (typelibs `Gst`,
  `GstPlayer` e `GstPbutils`)
- libsecret (guarda da chave da API) e libsoup3 (acesso à rede)
- meson e ninja, para instalar
- ffmpeg não é necessário

## Instalação (local, sem root)

```sh
meson setup build --prefix $HOME/.local
ninja -C build install
dev.nicolas.DailyTaker
```

Certifique-se de que `~/.local/bin` está no `PATH`. O id do aplicativo é
`dev.nicolas.DailyTaker`.

## Onde ficam os dados

- Gravações e transcrições: `~/.local/share/daily-taker/`
- Cache: `~/.cache/daily-taker/`
- Chave da API (somente se o chaveiro do sistema não estiver disponível):
  `~/.config/daily-taker/api-key`

Para apagar uma transcrição basta apagar o arquivo `.transcript.json`
correspondente; o áudio não é afetado.

## Chave da API

A transcrição usa o [OpenRouter](https://openrouter.ai/). Informe sua chave em
**Menu > Preferências** (ela fica no chaveiro do sistema e nunca é exibida de
volta), ou defina a variável de ambiente `DAILY_TAKER_OP_KEY` antes de abrir o
aplicativo. Em Preferências também é possível testar e remover a chave.

## Privacidade

Nada sai do seu computador por conta própria. O áudio de uma gravação só é
enviado ao OpenRouter quando você clica em **Gerar transcrição** (ou
**Gerar novamente**), e cada geração é cobrada pelo OpenRouter na sua conta.

## Testes

```sh
bash tests/run.sh
```

Roda todos os `tests/*_test.js` com o gjs. Os testes que dependem de áudio,
chaveiro, rede e interface gráfica estão em `docs/manual-checklist.md`.

## Desenvolvimento

- `bash tests/run.sh`: testes automáticos (gjs puro).
- `bash tools/snapshot.sh OUT.png [--component …] [--select N] [--at SEG] [--size LxA]`:
  renderiza a janela real (ou um componente) num PNG, com gravações de exemplo,
  num compositor headless isolado — nada aparece na tela, nenhum som sai e os
  dados, a configuração e o chaveiro do usuário não são tocados. Os componentes
  `windowcheck`, `sidebarcheck` e `detailpanecheck` são verificações da interface
  (PASS/FAIL). Detalhes em `tools/README.md`.
- Comparação com a mockup: `docs/superpowers/design/comparacao-2026-10-22.png` e
  `docs/superpowers/design/comparacao-notas.md`.

## Créditos e licença

Daily Taker é um fork do Vocalis (tag 42.0), que por sua vez é um fork do
GNOME Sound Recorder. O código é licenciado sob GPL-2.0+; veja `COPYING` e
`AUTHORS` para os créditos originais (Meg Ford, Bilal Elmoussaoui, Felipe
Borges e outros).
