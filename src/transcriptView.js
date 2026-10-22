/* exported TranscriptView */
const { Adw, Gdk, Gio, GLib, GObject, GstPlayer, Gtk, Pango } = imports.gi;
const { buildBlocks, renameSpeaker } = imports.transcript;
const { copyBlock, copyText, exportFileName, formatClock } = imports.transcriptFormat;
const { saveTranscript } = imports.transcriptStore;
const {
    blockTitle, currentBlockIndex, exportContent, exportExtension, speakerEntry, viewHeader,
} = imports.transcriptViewModel;

// Blocos criados por iteração ociosa: milhares de blocos não travam a interface.
const CHUNK_SIZE = 100;
// Intervalo do destaque do bloco falado enquanto o player toca esta gravação.
const HIGHLIGHT_INTERVAL_MS = 150;

var TranscriptView = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/transcript-view.ui',
    InternalChildren: [
        'toastOverlay', 'scroller', 'titleLabel', 'dateTimeLabel', 'detailsLabel',
        'speakersLabel', 'blocksBox', 'regenerateStack', 'regenerateSpinner',
    ],
    Signals: {
        'seek-requested': { param_types: [GObject.TYPE_DOUBLE] },
        'transcript-changed': { param_types: [GObject.TYPE_JSOBJECT] },
        'regenerate-requested': {},
    },
}, class TranscriptView extends Gtk.Box {
    _init(params) {
        super._init(params);

        this._transcript = null;
        this._recordingFile = null;
        this._blocks = [];
        this._blockRows = [];
        this._fillSourceId = 0;
        this._player = null;
        this._playerState = GstPlayer.PlayerState.STOPPED;
        this._playerStateId = 0;
        this._highlightSourceId = 0;
        this._currentIndex = -1;
        this._running = false;

        const actions = new Gio.SimpleActionGroup();
        const copyAll = new Gio.SimpleAction({
            name: 'copy-all',
            parameter_type: new GLib.VariantType('b'),
        });
        copyAll.connect('activate', (_action, param) => {
            if (this._transcript)
                this._copy(copyText(this._transcript, { withSpeakers: param.get_boolean() }));
        });
        actions.add_action(copyAll);

        const exportAction = new Gio.SimpleAction({
            name: 'export',
            parameter_type: new GLib.VariantType('s'),
        });
        exportAction.connect('activate', (_action, param) => this._export(param.get_string()[0]));
        actions.add_action(exportAction);

        this._regenerateAction = new Gio.SimpleAction({ name: 'regenerate' });
        this._regenerateAction.connect('activate', () => this.emit('regenerate-requested'));
        actions.add_action(this._regenerateAction);

        this.insert_action_group('transcript', actions);

        this.connect('map', () => this._syncHighlight());
        this.connect('unmap', () => this._syncHighlight());
    }

    get recordingFile() {
        return this._recordingFile;
    }

    get transcript() {
        return this._transcript;
    }

    // O destaque acompanha o player só quando ele toca ESTA gravação.
    attachPlayer(player, state) {
        this._player = player;
        this._playerState = state ?? GstPlayer.PlayerState.STOPPED;
        if (this.get_root())
            this._connectPlayer();
    }

    vfunc_root() {
        super.vfunc_root();
        this._connectPlayer();
    }

    vfunc_unroot() {
        this.release();
        if (this._playerStateId) {
            this._player.disconnect(this._playerStateId);
            this._playerStateId = 0;
        }
        super.vfunc_unroot();
    }

    _connectPlayer() {
        if (!this._player || this._playerStateId)
            return;
        this._playerStateId = this._player.connect('state-changed', (_player, state) => {
            this._playerState = state;
            this._syncHighlight();
        });
    }

    // Saindo da página: nada de trabalho em segundo plano.
    release() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        this._stopHighlightTimer();
    }

    // Durante uma nova transcrição renomear fica bloqueado: o resultado sobrescreveria o nome.
    set running(running) {
        this._running = running;
        for (const row of this._blockRows) {
            if (row.speakerButton)
                row.speakerButton.sensitive = !running;
        }
        this._regenerateAction.enabled = !running;
        this._regenerateStack.visible_child_name = running ? 'running' : 'idle';
        this._regenerateSpinner.spinning = running;
    }

    setTranscript(t, recordingFile) {
        this._transcript = t;
        this._recordingFile = recordingFile;
        this._blocks = buildBlocks(t);
        this._currentIndex = -1;

        this._fillHeader();
        this._fillBlocks();
        this._scroller.vadjustment.value = 0;
        this._syncHighlight();
    }

    _fillHeader() {
        const header = viewHeader(this._transcript);
        this._titleLabel.label = header.title;
        this._dateTimeLabel.label = header.dateTime;
        this._dateTimeLabel.visible = header.dateTime !== '';
        const details = [`Duração: ${header.duration}`];
        if (header.language)
            details.push(`Idioma: ${header.language}`);
        this._detailsLabel.label = details.join(' · ');
        this._speakersLabel.label = header.speakers ? `Locutores: ${header.speakers}` : '';
        this._speakersLabel.visible = header.speakers !== '';
    }

    _fillBlocks() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        for (let child; (child = this._blocksBox.get_first_child());)
            this._blocksBox.remove(child);
        this._blockRows = [];

        // Lê this._blocks a cada lote: renomear um locutor troca os blocos no meio do caminho.
        let next = 0;
        const addChunk = () => {
            const end = Math.min(next + CHUNK_SIZE, this._blocks.length);
            for (; next < end; next++) {
                const row = this._createBlock(next);
                this._blockRows.push(row);
                this._blocksBox.append(row.box);
                if (next === this._currentIndex)
                    row.box.add_css_class('current');
            }
            return next < this._blocks.length;
        };

        // O primeiro lote entra já; o resto em segundo plano.
        if (!addChunk())
            return;
        this._fillSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (addChunk())
                return GLib.SOURCE_CONTINUE;
            this._fillSourceId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    _createBlock(index) {
        const block = this._blocks[index];
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            css_classes: ['transcript-block'],
        });

        const top = new Gtk.Box({ spacing: 6 });
        let speakerButton = null;
        if (block.speaker === null) {
            top.append(new Gtk.Label({
                label: blockTitle(block),
                xalign: 0,
                hexpand: true,
                css_classes: ['heading', 'dim-label'],
            }));
        } else {
            speakerButton = new Gtk.Button({
                child: new Gtk.Label({
                    label: block.label,
                    ellipsize: Pango.EllipsizeMode.END,
                    css_classes: ['heading'],
                }),
                tooltip_text: 'Renomear locutor',
                sensitive: !this._running,
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'speaker-button'],
            });
            const speaker = block.speaker;
            speakerButton.connect('clicked', () => this._renameSpeakerDialog(speaker));
            top.append(speakerButton);
            top.append(new Gtk.Label({
                label: formatClock(block.start),
                xalign: 0,
                hexpand: true,
                css_classes: ['dim-label', 'numeric'],
            }));
        }

        const copyButton = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: 'Copiar bloco',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
        });
        copyButton.update_property([Gtk.AccessibleProperty.LABEL], ['Copiar bloco']);
        copyButton.connect('clicked', () => this._copy(copyBlock(this._blocks[index])));
        top.append(copyButton);

        const text = new Gtk.Label({
            label: block.text,
            selectable: true,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            xalign: 0,
        });
        this._addSeekOnClick(text, block.start);

        box.append(top);
        box.append(text);
        return { box, speakerButton };
    }

    // Um clique simples no texto pula o áudio; arrastar para selecionar não.
    // Controlador "legacy" na fase de captura: os gestos de seleção do rótulo
    // reivindicam a sequência e cancelariam um GtkGestureClick comum.
    _addSeekOnClick(label, start) {
        const controller = new Gtk.EventControllerLegacy({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        let pressed = false;
        controller.connect('event', (_controller, event) => {
            const type = event.get_event_type();
            if (type === Gdk.EventType.BUTTON_PRESS) {
                pressed = event.get_button() === Gdk.BUTTON_PRIMARY;
            } else if (type === Gdk.EventType.BUTTON_RELEASE && pressed) {
                pressed = false;
                const [hasSelection] = label.get_selection_bounds();
                if (!hasSelection)
                    this.emit('seek-requested', start);
            }
            return Gdk.EVENT_PROPAGATE;
        });
        label.add_controller(controller);
    }

    _syncHighlight() {
        const active = this._isPlayingThis() && this.get_mapped();
        if (active && !this._highlightSourceId) {
            this._highlightSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIGHLIGHT_INTERVAL_MS, () => {
                if (!this._isPlayingThis() || !this.get_mapped()) {
                    this._highlightSourceId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._updateHighlight();
                return GLib.SOURCE_CONTINUE;
            });
            this._updateHighlight();
        } else if (!active) {
            this._stopHighlightTimer();
        }
        // Parado (fim do áudio ou outra gravação): nenhum bloco fica destacado.
        if (!this._isThisLoaded() || this._playerState === GstPlayer.PlayerState.STOPPED)
            this._setCurrent(-1);
    }

    _stopHighlightTimer() {
        if (this._highlightSourceId) {
            GLib.source_remove(this._highlightSourceId);
            this._highlightSourceId = 0;
        }
    }

    _isThisLoaded() {
        return Boolean(this._player && this._recordingFile &&
            this._player.get_uri() === this._recordingFile.get_uri());
    }

    _isPlayingThis() {
        return this._playerState === GstPlayer.PlayerState.PLAYING && this._isThisLoaded();
    }

    _updateHighlight() {
        this._setCurrent(currentBlockIndex(this._blocks, this._player.position));
    }

    _setCurrent(index) {
        if (index === this._currentIndex)
            return;
        this._blockRows[this._currentIndex]?.box.remove_css_class('current');
        this._currentIndex = index;
        this._blockRows[index]?.box.add_css_class('current');
    }

    _renameSpeakerDialog(speaker) {
        const { text, placeholder } = speakerEntry(this._transcript, speaker);
        const entry = new Gtk.Entry({
            text,
            placeholder_text: placeholder,
            activates_default: true,
        });
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading: 'Renomear locutor',
            body: 'Deixe em branco para voltar ao nome padrão.',
            extra_child: entry,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('rename', 'Renomear');
        dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'rename';
        dialog.close_response = 'cancel';
        // A transcrição pode ter sido trocada enquanto o diálogo estava aberto.
        const transcript = this._transcript;
        const recordingFile = this._recordingFile;
        dialog.connect('response', (_dialog, response) => {
            if (response === 'rename' && transcript === this._transcript && !this._running)
                this._applySpeakerName(recordingFile, speaker, entry.text);
        });
        dialog.present();
        entry.grab_focus();
    }

    _applySpeakerName(recordingFile, speaker, name) {
        const renamed = renameSpeaker(this._transcript, speaker, name);
        try {
            saveTranscript(recordingFile, renamed);
        } catch (e) {
            this._toast('Não foi possível salvar o nome do locutor');
            return;
        }
        this._transcript = renamed;
        this._blocks = buildBlocks(renamed);
        this._fillHeader();
        // Renomear não muda a divisão em blocos: atualiza os já criados no lugar,
        // sem perder a rolagem; os que faltam já nascem com o nome novo.
        this._blockRows.forEach((row, i) => {
            if (row.speakerButton)
                row.speakerButton.child.label = this._blocks[i].label;
        });
        this.emit('transcript-changed', renamed);
    }

    _export(ext) {
        if (!this._transcript)
            return;
        const transcript = this._transcript;
        const dialog = new Gtk.FileDialog({
            title: 'Exportar transcrição',
            initial_name: exportFileName(transcript, ext),
            modal: true,
        });
        dialog.save(this.get_root(), null, (_dialog, result) => {
            let file;
            try {
                file = dialog.save_finish(result);
            } catch (e) {
                // Cancelado pelo usuário: nada a avisar.
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this._toast('Não foi possível exportar a transcrição');
                return;
            }
            try {
                const content = exportContent(transcript, exportExtension(file.get_basename(), ext));
                file.replace_contents(new TextEncoder().encode(content), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this._toast('Transcrição exportada');
            } catch (e) {
                this._toast('Não foi possível exportar a transcrição');
            }
        });
    }

    _copy(text) {
        this.get_clipboard().set(text);
        this._toastOverlay.add_toast(new Adw.Toast({ title: 'Copiado', timeout: 2 }));
    }

    _toast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({ title, use_markup: false }));
    }
});
