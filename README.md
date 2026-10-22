# Daily Taker

Gravador de voz pessoal para GNOME (GJS + GTK4 + libadwaita + GStreamer) que
vai evoluir para um registro diário de reuniões com transcrição.

## Origem e licença

Daily Taker é um fork do Vocalis
(tag 42.0), que por sua vez é um fork do GNOME Sound Recorder.
O código é licenciado sob GPL-2.0+; veja `COPYING` e `AUTHORS` para os
créditos originais (Meg Ford, Bilal Elmoussaoui, Felipe Borges e outros).

## Instalação (local, sem root)

Dependências: gjs, GTK 4, libadwaita, GStreamer (com `gst-plugins-base`,
`gst-plugins-good`, typelibs `Gst`, `GstPlayer`, `GstPbutils`), meson e ninja.

```sh
meson setup build --prefix $HOME/.local
ninja -C build install
dev.nicolas.DailyTaker
```

As gravações ficam em `~/.local/share/daily-taker/` e o cache em
`~/.cache/daily-taker/`. O id do aplicativo é `dev.nicolas.DailyTaker`.
