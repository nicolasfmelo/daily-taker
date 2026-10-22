/* exported TranscriptView */
const { Adw, Gio, GLib, GObject, Gtk, Pango } = imports.gi;
const { buildBlocks } = imports.transcript;
const { copyBlock, copyText } = imports.transcriptFormat;
const { blockTitle, viewHeader } = imports.transcriptViewModel;

// Blocos criados por iteração ociosa: milhares de blocos não travam a interface.
const CHUNK_SIZE = 100;

var TranscriptView = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/transcript-view.ui',
    InternalChildren: [
        'toastOverlay', 'scroller', 'titleLabel', 'dateTimeLabel', 'detailsLabel',
        'speakersLabel', 'blocksBox',
    ],
    Signals: {
        'seek-requested': { param_types: [GObject.TYPE_DOUBLE] },
        'transcript-changed': { param_types: [GObject.TYPE_JSOBJECT] },
    },
}, class TranscriptView extends Gtk.Box {
    _init(params) {
        super._init(params);

        this._transcript = null;
        this._recordingFile = null;
        this._blocks = [];
        this._fillSourceId = 0;

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
        this.insert_action_group('transcript', actions);
    }

    setTranscript(t, recordingFile) {
        this._transcript = t;
        this._recordingFile = recordingFile;
        this._blocks = buildBlocks(t);

        const header = viewHeader(t);
        this._titleLabel.label = header.title;
        this._dateTimeLabel.label = header.dateTime;
        this._dateTimeLabel.visible = header.dateTime !== '';
        const details = [`Duração: ${header.duration}`];
        if (header.language)
            details.push(`Idioma: ${header.language}`);
        this._detailsLabel.label = details.join(' · ');
        this._speakersLabel.label = header.speakers ? `Locutores: ${header.speakers}` : '';
        this._speakersLabel.visible = header.speakers !== '';

        this._fillBlocks();
        this._scroller.vadjustment.value = 0;
    }

    _fillBlocks() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        for (let child; (child = this._blocksBox.get_first_child());)
            this._blocksBox.remove(child);

        const blocks = this._blocks;
        let next = 0;
        const addChunk = () => {
            const end = Math.min(next + CHUNK_SIZE, blocks.length);
            for (; next < end; next++)
                this._blocksBox.append(this._createBlock(blocks[next]));
            return next < blocks.length;
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

    _createBlock(block) {
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 4 });

        const top = new Gtk.Box({ spacing: 6 });
        const title = new Gtk.Label({
            label: blockTitle(block),
            xalign: 0,
            hexpand: true,
            ellipsize: Pango.EllipsizeMode.END,
            css_classes: ['heading', 'dim-label'],
        });
        const copyButton = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: 'Copiar bloco',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
        });
        copyButton.update_property([Gtk.AccessibleProperty.LABEL], ['Copiar bloco']);
        copyButton.connect('clicked', () => this._copy(copyBlock(block)));
        top.append(title);
        top.append(copyButton);

        const text = new Gtk.Label({
            label: block.text,
            selectable: true,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            xalign: 0,
        });

        box.append(top);
        box.append(text);
        return box;
    }

    _copy(text) {
        this.get_clipboard().set(text);
        this._toastOverlay.add_toast(new Adw.Toast({ title: 'Copiado', timeout: 2 }));
    }
});
