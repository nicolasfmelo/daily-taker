/* exported RecordingsListWidget */
const { Adw, GObject, GstPlayer, Gtk, Gst } = imports.gi;
const { Row, RowState } = imports.row;

var RecordingsListWidget = new GObject.registerClass({
    Signals: {
        'row-deleted': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_INT] },
        'transcribe-requested': { param_types: [GObject.TYPE_OBJECT] },
    },
}, class RecordingsListWidget extends Adw.Bin {
    _init(model, player, transcriptionService) {
        super._init();
        this.list = Gtk.ListBox.new();
        this.list.valign = Gtk.Align.START;
        this.list.margin_start = 8;
        this.list.margin_end = 8;
        this.list.margin_top = 12;
        this.list.margin_bottom = 12;
        this.list.activate_on_single_click = true;
        this.list.add_css_class('boxed-list');

        this.set_child(this.list);

        this._player = player;
        this._transcriptionService = transcriptionService;

        // Um único ouvinte para a lista toda: as linhas são recriadas/removidas à vontade
        // e o serviço não oferece desconexão. Só linhas ainda presentes são atualizadas.
        this._transcriptionService.connectChange(uri => {
            for (let i = 0, row; (row = this.list.get_row_at_index(i)); i++) {
                if (row._recording.uri === uri)
                    row.refreshTranscriptionStatus();
            }
        });

        this._player.connect('state-changed', (_player, state) => {
            if (state === GstPlayer.PlayerState.STOPPED && this.activePlayingRow) {
                this.activePlayingRow.state = RowState.PAUSED;
                this.activePlayingRow.waveform.position = 0.0;
            } else if (state === GstPlayer.PlayerState.PLAYING) {
                this.activePlayingRow.state = RowState.PLAYING;
            }
        });

        this._player.connect('position-updated', (_player, pos) => {
            const duration = this.activePlayingRow._recording.duration;
            this.activePlayingRow.waveform.position = pos / duration;
        });

        this.list.bind_model(model, recording => {
            let row = new Row(recording, this._transcriptionService);

            row.waveform.connect('gesture-pressed', _ => {
                if (!this.activePlayingRow || this.activePlayingRow !== row) {

                    if (this.activePlayingRow)
                        this.activePlayingRow.waveform.position = 0.0;

                    this.activePlayingRow = row;
                    this._player.set_uri(recording.uri);
                }
            });

            row.waveform.connect('position-changed', (_wave, _position) => {
                this._player.seek(_position * row._recording.duration);
            });

            row.connect('play', _row => {
                this._playRow(_row);
            });

            row.connect('pause', _row => {
                this._player.pause();
            });

            row.connect('seek-backward', _row => {
                let position = this._player.position - 10 * Gst.SECOND;
                position = position < 0 || position > _row._recording.duration ? 0 : position;
                this._player.seek(position);
            });
            row.connect('seek-forward', _row => {
                let position = this._player.position + 10 * Gst.SECOND;
                position = position < 0 || position > _row._recording.duration ? 0 : position;
                this._player.seek(position);
            });

            row.connect('transcribe', () => {
                this.emit('transcribe-requested', row._recording);
            });

            row.connect('deleted', () => {
                if (row === this.activeRow)
                    this.activeRow = null;

                if (row === this.activePlayingRow) {
                    this.activePlayingRow = null;
                    this._player.stop();
                }

                const index = row.get_index();
                this.isolateAt(index, false);
                this.emit('row-deleted', row._recording, index);
            });

            return row;
        });

        this.list.connect('row-activated', this.rowActivated.bind(this));
    }

    _playRow(row) {
        if (this.activePlayingRow) {
            if (this.activePlayingRow !== row) {
                this.activePlayingRow.state = RowState.PAUSED;
                this.activePlayingRow.waveform.position = 0.0;
                this._player.set_uri(row._recording.uri);
            }
        } else {
            this._player.set_uri(row._recording.uri);
        }

        this.activePlayingRow = row;
        this._player.play();
    }

    // Toca a gravação a partir de uma posição (ns) pelo mesmo caminho do botão de play
    // da linha, para que play/pausa e a forma de onda da linha continuem coerentes.
    playRecordingAt(recording, position) {
        for (let i = 0, row; (row = this.list.get_row_at_index(i)); i++) {
            if (row._recording === recording) {
                this._playRow(row);
                row.state = RowState.PLAYING;
                this._player.seek(position);
                return true;
            }
        }
        return false;
    }

    rowActivated(list, row) {
        if (row.editMode && row.expanded || this.activeRow && this.activeRow.editMode && this.activeRow.expanded)
            return;

        if (this.activeRow && this.activeRow !== row) {
            this.activeRow.expanded = false;
            this.isolateAt(this.activeRow.get_index(), false);
        }
        row.expanded = !row.expanded;
        this.isolateAt(row.get_index(), row.expanded);

        this.activeRow = row;
    }

    isolateAt(index, expanded) {
        const before = this.list.get_row_at_index(index - 1);
        const current = this.list.get_row_at_index(index);
        const after = this.list.get_row_at_index(index + 1);

        if (expanded) {
            if (current)
                current.add_css_class('expanded');
            if (before)
                before.add_css_class('expanded-before');
            if (after)
                after.add_css_class('expanded-after');
        } else {
            if (current)
                current.remove_css_class('expanded');
            if (before)
                before.remove_css_class('expanded-before');
            if (after)
                after.remove_css_class('expanded-after');
        }
    }
});
