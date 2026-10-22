/* exported RecorderState RecorderWidget */
const { Gio, GObject, Gtk } = imports.gi;
const { formatTime } = imports.utils;
const { WaveForm, WaveType } = imports.waveform;

var RecorderState = {
    RECORDING: 0,
    PAUSED: 1,
    STOPPED: 2,
};

var RecorderWidget = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/recorder.ui',
    InternalChildren: [
        'recorderBox', 'playbackStack', 'recorderTime',
        'pauseBtn', 'resumeBtn',
    ],
    Signals: {
        'canceled': {},
        'paused': {},
        'resumed': {},
        'started': {},
        'stopped': { param_types: [GObject.TYPE_OBJECT] },
    },
}, class RecorderWidget extends Gtk.Box {
    _init(recorder) {
        super._init({});
        this.recorder = recorder;

        this.waveform = new WaveForm({
            vexpand: true,
            valign: Gtk.Align.FILL,
        }, WaveType.RECORDER);
        this._recorderBox.prepend(this.waveform);

        this.recorder.bind_property('current-peak', this.waveform, 'peak', GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);
        this.recorder.connect('notify::duration', _recorder => {
            this._recorderTime.set_markup(formatTime(_recorder.duration));
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
            text: _('Delete recording?'),
            secondary_text: _('This recording will not be saved.'),
        });

        dialog.set_default_response(Gtk.ResponseType.NO);
        dialog.add_button(_('Resume'), Gtk.ResponseType.NO);
        dialog.add_button(_('Delete'), Gtk.ResponseType.YES)
            .add_css_class('destructive-action');

        dialog.set_transient_for(Gio.Application.get_default().get_active_window());
        dialog.connect('response', (_, response) => {
            switch (response) {
            case Gtk.ResponseType.YES: {
                const recording = this.recorder.stop();
                this.state = RecorderState.STOPPED;
                this.waveform.destroy();

                recording.delete();
                this.emit('canceled');
                break;
            }
            case Gtk.ResponseType.NO:
                this.onResume();
                break;
            }

            dialog.close();
        });

        dialog.show();
    }

    onStop() {
        this.state = RecorderState.STOPPED;
        const recording = this.recorder.stop();
        this.waveform.destroy();
        this.emit('stopped', recording);
    }

    set state(recorderState) {
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
