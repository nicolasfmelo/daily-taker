# Daily Taker

Gravador de voz pessoal para GNOME (GJS + GTK4 + libadwaita + GStreamer) para
registrar reuniões e conversas. Ele grava o microfone junto com o som do
computador (por exemplo, a outra ponta de uma chamada) em um único arquivo e,
quando você pede, gera a transcrição com separação de locutores.

## O que ele faz

- Grava microfone e som do sistema misturados, com indicadores de nível
  separados para cada um e aviso quando o som do sistema não chega.
- Reproduz, renomeia, exporta e exclui gravações (com desfazer).
- **Gerar transcrição**: envia o áudio ao OpenRouter e salva o resultado ao lado
  do áudio, em `<gravação>.transcript.json`.
- Visualização da transcrição sincronizada com o áudio (clicar em um bloco pula
  para o trecho), renomear locutores, copiar (seleção, bloco ou tudo) e exportar
  em Markdown (`.md`) ou texto (`.txt`).
- Aba **Transcrições** com busca (sem diferenciar acentos) e filtro por data.

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

## Créditos e licença

Daily Taker é um fork do Vocalis (tag 42.0), que por sua vez é um fork do
GNOME Sound Recorder. O código é licenciado sob GPL-2.0+; veja `COPYING` e
`AUTHORS` para os créditos originais (Meg Ford, Bilal Elmoussaoui, Felipe
Borges e outros).
