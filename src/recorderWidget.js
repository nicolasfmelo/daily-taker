/* exported RecorderState RecorderWidget */
const { Gio, GObject, Gtk } = imports.gi;
const { formatTime } = imports.utils;
const { WaveForm, WaveType } = imports.waveform;
const { NOTHING_RECORDED_MESSAGE, recorderFailureMessage } = imports.recorderPipeline;

// Pico abaixo do qual o áudio do sistema é considerado silêncio.
const SYSTEM_SILENCE_PEAK = 0.01;
// Tempo de gravação (ns) sem sinal do sistema antes de mostrar o aviso.
const SYSTEM_SILENCE_NOTICE = 10 * 1000000000;

var RecorderState = {
    RECORDING: 0,
    PAUSED: 1,
    STOPPED: 2,
};

var RecorderWidget = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/recorder.ui',
    InternalChildren: [
        'recorderBox', 'playbackStack', 'recorderTime',
        'pauseBtn', 'resumeBtn', 'micLevel', 'systemLevel', 'systemSilentLabel',
    ],
    Signals: {
        'canceled': {},
        'paused': {},
        'resumed': {},
        'started': {},
        'stopped': { param_types: [GObject.TYPE_OBJECT] },
        // Emitido depois de 'stopped'/'canceled' quando algo deu errado; texto para um toast.
        'failed': { param_types: [GObject.TYPE_STRING] },
    },
}, class RecorderWidget extends Gtk.Box {
    _init(recorder) {
        super._init({});
        this.recorder = recorder;
        this._state = RecorderState.STOPPED;
        this._cancelDialog = null;
        this.recorder.connect('error', () => this._onRecorderError());

        this.waveform = new WaveForm({
            vexpand: true,
            valign: Gtk.Align.FILL,
        }, WaveType.RECORDER);
        this._recorderBox.prepend(this.waveform);

        this.recorder.bind_property('current-peak', this.waveform, 'peak', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);
        this.recorder.connect('notify::duration', _recorder => {
            this._recorderTime.set_markup(formatTime(_recorder.duration));
            if (!this._systemHeard && _recorder.duration >= SYSTEM_SILENCE_NOTICE)
                this._systemSilentLabel.visible = true;
        });

        for (const levelBar of [this._micLevel, this._systemLevel]) {
            // Sem as faixas low/high/full padrão (pensadas para bateria).
            levelBar.remove_offset_value(Gtk.LEVEL_BAR_OFFSET_LOW);
            levelBar.remove_offset_value(Gtk.LEVEL_BAR_OFFSET_HIGH);
            levelBar.remove_offset_value(Gtk.LEVEL_BAR_OFFSET_FULL);
        }
        this.recorder.bind_property('mic-peak', this._micLevel, 'value', GObject.BindingFlags.SYNC_CREATE);
        this.recorder.bind_property('system-peak', this._systemLevel, 'value', GObject.BindingFlags.SYNC_CREATE);
        this._systemHeard = false;
        this.recorder.connect('notify::system-peak', _recorder => {
            if (_recorder.system_peak >= SYSTEM_SILENCE_PEAK) {
                this._systemHeard = true;
                this._systemSilentLabel.visible = false;
            }
        });


        const actions = [
            { name: 'start', callback: this.onStart.bind(this), enabled: true },
            { name: 'pause', callback: this.onPause.bind(this), enabled: false },
            { name: 'stop', callback: this.onStop.bind(this), enabled: false  },
            { name: 'resume', callback: this.onResume.bind(this), enabled: false },
            { name: 'cancel', callback: this.onCancel.bind(this), enabled: false },
        ];

        this.actionsGroup = new Gio.SimpleActionGroup();

        for (let { name, callback, enabled } of actions) {
            const action = new Gio.SimpleAction({ name, enabled });
            action.connect('activate', callback);
            this.actionsGroup.add_action(action);
        }

        const cancelAction = this.actionsGroup.lookup('cancel');
        const startAction = this.actionsGroup.lookup('start');
        startAction.bind_property('enabled', cancelAction, 'enabled', GObject.BindingFlags.INVERT_BOOLEAN);
    }

    onPause() {
        this._playbackStack.visible_child_name = 'recorder-start';
        this.state = RecorderState.PAUSED;

        this.recorder.pause();
        this.emit('paused');
    }

    onResume() {
        this._playbackStack.visible_child_name = 'recorder-pause';
        this.state = RecorderState.RECORDING;

        this.recorder.resume();
        this.emit('resumed');
    }

    onStart() {
        this._systemHeard = false;
        this._systemSilentLabel.visible = false;
        this._playbackStack.visible_child_name = 'recorder-pause';
        this.state = RecorderState.RECORDING;

        this.recorder.start();
        this.emit('started');
    }

    onCancel() {
        this.onPause();
        let dialog = new Gtk.MessageDialog({
            modal: true,
            destroy_with_parent: true,
            buttons: Gtk.ButtonsType.NONE,
            message_type: Gtk.MessageType.QUESTION,
            text: _('Excluir a gravação?'),
            secondary_text: _('Esta gravação não será salva.'),
        });

        dialog.set_default_response(Gtk.ResponseType.NO);
        dialog.add_button(_('Retomar'), Gtk.ResponseType.NO);
        dialog.add_button(_('Excluir'), Gtk.ResponseType.YES)
            .add_css_class('destructive-action');

        dialog.set_transient_for(Gio.Application.get_default().get_active_window());
        dialog.connect('response', (_, response) => {
            this._cancelDialog = null;
            dialog.close();
            // Um erro do gravador já encerrou a gravação enquanto o diálogo estava aberto.
            if (this._state === RecorderState.STOPPED)
                return;

            switch (response) {
            case Gtk.ResponseType.YES: {
                const recording = this.recorder.stop();
                this.state = RecorderState.STOPPED;
                this.waveform.destroy();

                recording?.delete();
                this.emit('canceled');
                break;
            }
            case Gtk.ResponseType.NO:
                this.onResume();
                break;
            }
        });

        this._cancelDialog = dialog;
        dialog.show();
    }

    onStop() {
        this.state = RecorderState.STOPPED;
        const recording = this.recorder.stop();
        this.waveform.destroy();
        if (recording) {
            this.emit('stopped', recording);
        } else {
            this.emit('canceled');
            this.emit('failed', NOTHING_RECORDED_MESSAGE);
        }
    }

    // O microfone ou a saída de áudio falhou (ao ligar ou no meio): encerra a gravação,
    // mantém o trecho já gravado, se houver, e devolve a janela à lista.
    _onRecorderError() {
        if (this._state === RecorderState.STOPPED)
            return;
        this.state = RecorderState.STOPPED;
        if (this._cancelDialog) {
            const dialog = this._cancelDialog;
            this._cancelDialog = null;
            dialog.close();
        }
        const recording = this.recorder.stop();
        this.waveform.destroy();
        if (recording)
            this.emit('stopped', recording);
        else
            this.emit('canceled');
        this.emit('failed', recorderFailureMessage(recording !== null));
    }

    set state(recorderState) {
        this._state = recorderState;
        switch (recorderState) {
        case RecorderState.PAUSED:
            this.actionsGroup.lookup('pause').enabled = false;
            this.actionsGroup.lookup('resume').enabled = true;
            this._resumeBtn.grab_focus();
            this._recorderTime.add_css_class('paused');
            break;
        case RecorderState.RECORDING:
            this.actionsGroup.lookup('start').enabled = false;
            this.actionsGroup.lookup('stop').enabled = true;
            this.actionsGroup.lookup('resume').enabled = false;
            this.actionsGroup.lookup('pause').enabled = true;
            this._pauseBtn.grab_focus();
            this._recorderTime.remove_css_class('paused');
            break;
        case RecorderState.STOPPED:
            this.actionsGroup.lookup('start').enabled = true;
            this.actionsGroup.lookup('stop').enabled = false;
            this.actionsGroup.lookup('pause').enabled = false;
            this.actionsGroup.lookup('resume').enabled = false;
            break;
        }
    }
});
