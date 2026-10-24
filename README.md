# Daily Taker

A personal voice recorder for GNOME (GJS + GTK4 + libadwaita + GStreamer) for
capturing meetings and conversations. It records your microphone **and** your
computer's audio output (e.g. the other side of a call) into a single file and,
on demand, generates a speaker-labelled transcript and an AI summary.

> **Derived work.** Daily Taker is a fork of
> [Vocalis](https://gitlab.gnome.org/World/vocalis) (tag `42.0`), which is the
> continuation of [GNOME Sound Recorder](https://gitlab.gnome.org/GNOME/gnome-sound-recorder).
> It is distributed under the same license as the original,
> **GPL-2.0-or-later**. See [Credits and license](#credits-and-license).

> **Language note.** The application UI, the design documents under `docs/` and
> `tools/README.md` are written in Brazilian Portuguese. This README is in
> English.

## What it does

- Records microphone and system audio mixed together, with separate level
  meters for each and a warning when no system audio is arriving. New
  recordings get a timestamped name (e.g. `Gravação 22 out 09:30`) and are
  selected in the list when you stop.
- **Generate transcript** (on demand): sends the audio to OpenRouter and stores
  the result next to the audio file as `<recording>.transcript.json`.
- **Generate summary** (on demand): summarizes the transcript text with
  `anthropic/claude-sonnet-5.5` after you confirm the cost and the upload to
  OpenRouter.
- Plays back the recording with a synchronized transcript, and supports
  renaming, exporting and deleting (with undo).

## Interface

Single window, dark theme with an orange accent:

- **Header bar**: app icon and name, **New recording** (Ctrl+R),
  **Preferences** (Ctrl+,) and the menu (keyboard shortcuts, About).
- **"Recordings" sidebar** (left): search by **name, transcript and current
  summary** (accent- and case-insensitive), a list grouped by date (TODAY,
  YESTERDAY, THIS WEEK, …) with a transcript status badge (● Transcribed,
  Transcribing…, ● Error), a ⋮ menu per item (Rename, Generate/Regenerate,
  Export audio, Delete) and an export button for the selected recording.
- **Detail pane** (right): title, date, duration and speakers; **Transcript**
  and **Summary** tabs; transcript search (highlights matching blocks and jumps
  between hits with Enter/Shift+Enter), Copy (with speakers and timestamps, or
  text only) and Export (`.md`/`.txt`). Clicking a block seeks the audio to it
  and plays; clicking a speaker name renames it. Without a transcript, a card
  shows the estimated cost and the **Generate transcript** button.
- **Summary tab**: headings, lists and bold text rendered safely; selectable
  text, model/date/cost in the footer and **Copy summary** (Markdown). The ⋮
  menu lets you regenerate and open **Previous versions…** to view, copy and
  restore a version. The current summary moves to history (up to 20 previous
  versions). Exporting `.md` includes the current summary; `.txt` remains the
  transcript only. Renaming a speaker or recording, and regenerating the
  transcript, keep the summary and its history but do not update their content
  automatically.
- **Single player** (bottom of the pane): play/pause, clickable and draggable
  waveform, position/duration, speed (0.75x to 2x), volume (click the icon to
  mute) and **Follow audio** (scrolls the transcript along). Speed, volume and
  the toggle are persisted.
- **Delete** moves the recording (audio, transcript and waveform) to the
  **system trash** after 8 s, with an **Undo** toast; consecutive deletions
  each get their own Undo. Closing the app confirms pending deletions. Delete
  and rename are blocked while a transcription or summary is running; paid
  results that have not been saved yet must be saved or explicitly discarded
  through the **Discard…** button, with confirmation.
- **Narrow windows**: below 1000 px the sidebar shrinks to 300 px (the badge
  shows only a dot) and the pane goes compact; below 720 px the sidebar
  collapses: selecting a recording opens the pane, with a Back button to return
  to the list.

### Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause the selected recording |
| B / N | Back / forward 10 s |
| F2 | Rename the selected recording |
| Delete | Delete the selected recording (with Undo) |
| Ctrl+S | Export the selected recording's audio |
| Ctrl+R | New recording |
| Ctrl+, | Preferences |
| Ctrl+? | Keyboard shortcuts |
| Ctrl+Q | Quit |
| Space (recording) | Pause / resume the recording |
| S (recording) | Stop the recording |
| Delete (recording) | Cancel (discard) the recording in progress, with confirmation |

Letter keys and Space are ignored while typing in a text field (search,
dialogs).

## Requirements

- gjs, GTK 4 >= 4.10, libadwaita >= 1.7
- GStreamer with `gst-plugins-base` and `gst-plugins-good` (typelibs `Gst`,
  `GstPlayer` and `GstPbutils`)
- libsecret (API key storage) and libsoup3 (networking)
- meson and ninja, to install
- ffmpeg is **not** required

## Installation (local, no root)

```sh
meson setup build --prefix $HOME/.local
ninja -C build install
dev.nicolas.DailyTaker
```

Make sure `~/.local/bin` is in your `PATH`. The application id is
`dev.nicolas.DailyTaker`, so it does not clash with an installed GNOME Sound
Recorder / Vocalis.

## Where data is stored

- Recordings and transcripts: `~/.local/share/daily-taker/`
- Cache: `~/.cache/daily-taker/`
- API key (only if the system keyring is unavailable):
  `~/.config/daily-taker/api-key`

To delete a transcript, just delete the matching `.transcript.json` file; the
audio is not affected.

## API key

Transcription and summaries use [OpenRouter](https://openrouter.ai/). Enter
your key in **Menu > Preferences** (it is stored in the system keyring and never
shown back), or set the `DAILY_TAKER_OP_KEY` environment variable before
launching the app. Preferences also lets you test and remove the key.

The **Summary model** is configurable in Preferences (default:
`anthropic/claude-sonnet-5.5`). A typical 1-hour meeting costs roughly
US$ 0.02–0.05, depending on text size and output length. The confirmation
dialog estimates the input plus up to 2,000 output tokens; for a different
model it shows "Estimated cost unavailable" instead of applying the default
model's price. The amount shown is an estimated ceiling ("up to US$ …"). For
alternative models without provider-reported cost, the footer shows "unknown
cost"; a partial output cut by the token limit is flagged "(summary truncated)".
Transcripts with fewer than 20 characters of content are rejected before the
dialog.

## Privacy

Nothing leaves your computer on its own. A recording's audio is only uploaded
to OpenRouter when you click **Generate transcript** (or **Regenerate**), and
each generation is billed to your OpenRouter account. The transcript text is
only sent to OpenRouter when you ask for **Generate summary** and confirm the
cost/privacy dialog. Nothing is sent when switching tabs.

Summary network failures/timeouts are not retried automatically; "Try again"
requires a new confirmation. Automatic retries happen only on 429/502/503/504.
If a transcript or summary was already paid for and only the write to disk
failed, the text is kept in memory and retrying **only saves**, with no new
charge. If the transcript backing a summary has disappeared or is unreadable,
the UI offers a confirmed discard rather than a save loop. Regenerating a full
transcript over invalid JSON preserves the old bytes in
`.transcript.json.unreadable-<timestamp>`; those backups are hidden and are
kept under the original name when the audio is renamed or deleted.

## Known limitations

- Closing during a transcription/summary in progress, or with an unsaved paid
  result, abandons that result **only after explicit confirmation**. Cancelling
  keeps the window, the in-memory result and the pending deletions. The paid
  copy retained after a disk failure does not persist once you confirm closing.

## Tests

```sh
bash tests/run.sh
```

Runs every `tests/*_test.js` with gjs. Tests that depend on audio, the keyring,
the network and the graphical interface are covered by
`docs/manual-checklist.md`.

## Development

- `bash tests/run.sh`: automated tests (plain gjs).
- `bash tools/snapshot.sh OUT.png [--component …] [--select N] [--at SEC] [--size WxH]`:
  renders the real window (or a single component) to a PNG with sample
  recordings, inside an isolated headless compositor — nothing shows on screen,
  no sound is played, and the user's data, settings and keyring are untouched.
  The `windowcheck`, `sidebarcheck` and `detailpanecheck` components are UI
  checks (PASS/FAIL). Details in `tools/README.md`.
- Comparison against the target mockup:
  `docs/superpowers/design/comparacao-2026-10-22.png` and
  `docs/superpowers/design/comparacao-notas.md`.

## Credits and license

Daily Taker is a fork of **[Vocalis](https://gitlab.gnome.org/World/vocalis)**
(tag `42.0`), the continuation of
**[GNOME Sound Recorder](https://gitlab.gnome.org/GNOME/gnome-sound-recorder)**.
The recorder, window, waveform and utility modules still derive from that code;
the transcription, summary, secrets, transcript store/view and the redesigned
interface are new work.

- Original code: Copyright 2013–2019 Meg Ford; Copyright 2019–2020 Bilal
  Elmoussaoui and Felipe Borges; and other GNOME Sound Recorder / Vocalis
  contributors. Original design by Reda Lazri, Garrett LaSage and Hylke Bons.
  See [`AUTHORS`](AUTHORS) and the per-file copyright headers in `src/`.
- Modifications: Copyright 2026 Nicolas Melo.
- License: **GNU General Public License, version 2 or (at your option) any
  later version** (GPL-2.0-or-later), the same as the original. See
  [`COPYING`](COPYING). Original per-file license notices are kept intact.

This project is not affiliated with or endorsed by the GNOME Project or the
Vocalis maintainers.
