/* exported Window */
/*
* Copyright 2013 Meg Ford
* This library is free software; you can redistribute it and/or
* modify it under the terms of the GNU Library General Public
* License as published by the Free Software Foundation; either
* version 2 of the License, or (at your option) any later version.
*
* This library is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
* Library General Public License for more details.
*
* You should have received a copy of the GNU Library General Public
* License along with this library; if not, see <http://www.gnu.org/licenses/>.
*
* Author: Meg Ford <megford@gnome.org>
*
*/

const { Adw, Gio, GLib, GObject, Gst, GstPlayer, Gtk } = imports.gi;

const { Recorder } = imports.recorder;
const { RecordingList } = imports.recordingList;
const { RecordingsListWidget } = imports.recordingListWidget;
const { RecorderWidget } = imports.recorderWidget;
const { Settings } = imports.application;
const { defaultKeyStore } = imports.secrets;
const { TranscribeError, transcribeFile } = imports.transcriber;
const { saveTranscript } = imports.transcriptStore;
const { TranscriptionService } = imports.transcriptionService;
const { TranscriptView } = imports.transcriptView;
const { viewHeader } = imports.transcriptViewModel;
const { canRetry, confirmMessage, guardedSave, hasKey, hasNamedSpeakers } = imports.transcriptionUi;

var WindowState = {
    EMPTY: 0,
    LIST: 1,
    RECORDER: 2,
    TRANSCRIPT: 3,
};

var Window = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/window.ui',
    InternalChildren: [
        'mainStack', 'emptyPage', 'column', 'headerRevealer', 'toastOverlay',
        'windowTitle', 'backButton', 'recordButton',
    ],
}, class Window extends Adw.ApplicationWindow {

    _init(params) {
        super._init(Object.assign({
            icon_name: pkg.name,
        }, params));
        // Título restaurado ao sair da transcrição.
        this._defaultTitle = this._windowTitle.title;

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, 'recorder');

        const dispatcher = GstPlayer.PlayerGMainContextSignalDispatcher.new(null);
        this.player = GstPlayer.Player.new(null, dispatcher);
        this.player.connect('end-of-stream', _p => this.player.stop());
        this._playerState = GstPlayer.PlayerState.STOPPED;
        this.player.connect('state-changed', (_p, state) => {
            this._playerState = state;
        });


        this._recordingList = new RecordingList();
        this.itemsSignalId = this._recordingList.connect('items-changed', _ => {
            // Gravando ou lendo uma transcrição: a página atual não muda.
            if (this.state !== WindowState.RECORDER && this.state !== WindowState.TRANSCRIPT) {
                if (this._recordingList.get_n_items() === 0)
                    this.state = WindowState.EMPTY;
                else
                    this.state = WindowState.LIST;
            }
        });

        this._closed = false;
        this.transcriptionService = new TranscriptionService({
            getKey: () => defaultKeyStore().get(),
            transcribe: transcribeFile,
            save: guardedSave(saveTranscript),
            language: () => Settings.get_string('language'),
            now: () => new Date(),
        });

        this._recordingListWidget = new RecordingsListWidget(this._recordingList, this.player, this.transcriptionService);
        this._recordingListWidget.connect('transcribe-requested', (_widget, recording) => {
            this._requestTranscription(recording);
        });
        this.transcriptionService.connectChange(uri => {
            const file = this._transcriptView?.recordingFile;
            if (file && file.get_uri() === uri)
                this._transcriptView.running = this.transcriptionService.status(file) === 'running';
        });

        this._recordingListWidget.connect('row-deleted', (_listBox, recording, index) => {
            this._recordingList.remove(index);
            this.sendNotification(_('"%s" deleted').format(recording.name), recording, index);
        });

        const builder = Gtk.Builder.new_from_resource('/dev/nicolas/DailyTaker/gtk/help-overlay.ui');
        const dialog = builder.get_object('help_overlay');
        this.set_help_overlay(dialog);

        this.toastUndo = false;
        this.undoSignalID = null;
        this.undoAction = new Gio.SimpleAction({ name: 'undo' });
        this.add_action(this.undoAction);

        let openMenuAction = new Gio.SimpleAction({ name: 'open-primary-menu', state: new GLib.Variant('b', true) });
        openMenuAction.connect('activate', action => {
            const state = action.get_state().get_boolean();
            action.state = new GLib.Variant('b', !state);
        });
        this.add_action(openMenuAction);
        this._column.set_child(this._recordingListWidget);

        this.recorderWidget.connect('started', this.onRecorderStarted.bind(this));
        this.recorderWidget.connect('canceled', this.onRecorderCanceled.bind(this));
        this.recorderWidget.connect('stopped', this.onRecorderStopped.bind(this));
        this.insert_action_group('recorder', this.recorderWidget.actionsGroup);
        this._emptyPage.icon_name = `${pkg.name}-symbolic`;

        this._transcriptView = null;
        this._backButton.connect('clicked', () => this.closeTranscript());
    }

    _createTranscriptView() {
        const view = new TranscriptView();
        view.attachPlayer(this.player, this._playerState);
        view.connect('seek-requested', (_view, seconds) => {
            const recording = this._findRecording(view.recordingFile);
            if (!recording || !this._recordingListWidget.playRecordingAt(recording, Math.round(seconds * Gst.SECOND)))
                this.addToast('A gravação não está mais disponível');
        });
        view.connect('transcript-changed', (_view, t) => {
            this._windowTitle.title = viewHeader(t).title;
        });
        view.connect('regenerate-requested', () => {
            const recording = this._findRecording(view.recordingFile);
            if (recording)
                this._requestTranscription(recording, {
                    regenerate: true,
                    namedSpeakers: hasNamedSpeakers(view.transcript),
                });
            else
                this.addToast('A gravação não está mais disponível');
        });
        this._mainStack.add_named(view, 'transcript');
        return view;
    }

    showTranscript(recordingFile, t) {
        if (!this._transcriptView)
            this._transcriptView = this._createTranscriptView();
        this._transcriptView.setTranscript(t, recordingFile);
        this._transcriptView.running = this.transcriptionService.status(recordingFile) === 'running';
        this._windowTitle.title = viewHeader(t).title;
        if (this.state !== WindowState.TRANSCRIPT)
            this._stateBeforeTranscript = this.state;
        this.state = WindowState.TRANSCRIPT;
    }

    closeTranscript() {
        if (this.state !== WindowState.TRANSCRIPT)
            return;
        // Volta para a página anterior; lista e vazio são recalculados porque a lista
        // pode ter mudado enquanto a transcrição estava aberta.
        this._transcriptView.release();
        const previous = this._stateBeforeTranscript;
        if (previous === WindowState.LIST || previous === WindowState.EMPTY || previous === undefined)
            this.state = this._recordingList.get_n_items() === 0 ? WindowState.EMPTY : WindowState.LIST;
        else
            this.state = previous;
    }

    addToast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({ title, use_markup: false }));
    }

    vfunc_close_request() {
        // Uma transcrição em andamento não segura o fechamento: é simplesmente abandonada.
        this._closed = true;
        this._recordingList.cancellable.cancel();
        if (this.itemsSignalId)
            this._recordingList.disconnect(this.itemsSignalId);

        for (let i = 0; i < this._recordingList.get_n_items(); i++) {
            const recording = this._recordingList.get_item(i);
            if (recording.pipeline)
                recording.pipeline.set_state(Gst.State.NULL);
        }

        this.recorder.stop();
        this.application.quit();
    }

    onRecorderStarted() {
        this.player.stop();

        const activeRow = this._recordingListWidget.activeRow;
        if (activeRow && activeRow.editMode)
            activeRow.editMode = false;

        this.state = WindowState.RECORDER;
    }

    onRecorderCanceled() {
        if (this._recordingList.get_n_items() === 0)
            this.state = WindowState.EMPTY;
        else
            this.state = WindowState.LIST;
    }

    onRecorderStopped(widget, recording) {
        this._recordingList.insert(0, recording);
        this._recordingListWidget.list.get_row_at_index(0).editMode = true;
        this.state = WindowState.LIST;
    }

    _findRecording(file) {
        if (!file)
            return null;
        const uri = file.get_uri();
        for (let i = 0; i < this._recordingList.get_n_items(); i++) {
            const recording = this._recordingList.get_item(i);
            if (recording.uri === uri)
                return recording;
        }
        return null;
    }

    // regenerate: "Gerar novamente" na visão de transcrição (mesmas guardas, outro texto).
    _requestTranscription(recording, options = {}) {
        const { regenerate = false } = options;
        // A chave é verificada antes de tocar no serviço: sem chave a linha não entra em erro.
        let key = null;
        try {
            key = defaultKeyStore().get();
        } catch (e) {
            key = null;
        }
        if (!hasKey(key)) {
            this.application.activate_action('preferences', null);
            return;
        }

        if (this.transcriptionService.status(recording.file) === 'running')
            return;

        const { heading, body } = confirmMessage(recording.duration / 1e9, options);
        const dialog = new Adw.MessageDialog({
            transient_for: this,
            modal: true,
            heading,
            body,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('transcribe', regenerate ? 'Gerar novamente' : 'Transcrever');
        dialog.set_response_appearance('transcribe', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'transcribe';
        dialog.close_response = 'cancel';
        dialog.connect('response', (_dialog, response) => {
            if (response === 'transcribe' && !this._closed)
                this._runTranscription(recording, options);
        });
        dialog.present();
    }

    _runTranscription(recording, options) {
        const file = recording.file;
        const created = recording.timeCreated;
        const recordedAt = created && created.to_unix() > 0 ? created : recording.timeModified;
        this.transcriptionService.run({
            file,
            title: recording.name,
            recordedAt: recordedAt.format_iso8601(),
        }).then(
            transcript => this._onTranscriptionDone(file, transcript),
            error => this._onTranscriptionFailed(recording, error, options));
    }

    // A visão aberta nesta gravação passa a mostrar a transcrição nova.
    _onTranscriptionDone(file, transcript) {
        if (this._closed || this.state !== WindowState.TRANSCRIPT)
            return;
        if (this._transcriptView.recordingFile?.equal(file))
            this.showTranscript(file, transcript);
    }

    _onTranscriptionFailed(recording, error, options) {
        if (this._closed)
            return;

        // Só a mensagem fixa do TranscribeError chega à tela (nunca chave nem resposta bruta).
        const message = error instanceof TranscribeError
            ? error.message : new TranscribeError('unknown').message;
        const toast = new Adw.Toast({ title: message, use_markup: false, timeout: 10 });
        if (canRetry(error, this._hasRecording(recording) && recording.file.query_exists(null))) {
            toast.button_label = 'Tentar de novo';
            toast.connect('button-clicked', () => {
                if (!this._closed)
                    this._requestTranscription(recording, options);
            });
        }
        this._toastOverlay.add_toast(toast);
    }

    _hasRecording(recording) {
        for (let i = 0; i < this._recordingList.get_n_items(); i++) {
            if (this._recordingList.get_item(i) === recording)
                return true;
        }
        return false;
    }

    sendNotification(message, recording, index) {
        const toast = Adw.Toast.new(message);
        toast.connect('dismissed', () => {
            if (!this.toastUndo)
                recording.delete();

            this.toastUndo = false;
        });

        if (this.undoSignalID !== null)
            this.undoAction.disconnect(this.undoSignalID);

        this.undoSignalID = this.undoAction.connect('activate', () => {
            this._recordingList.insert(index, recording);
            this.toastUndo = true;
        });

        toast.set_action_name('win.undo');
        toast.set_button_label(_('Undo'));
        this._toastOverlay.add_toast(toast);
    }

    set state(state) {
        let visibleChild;
        let isHeaderVisible;

        switch (state) {
        case WindowState.RECORDER:
            visibleChild = 'recorder';
            isHeaderVisible = false;
            break;
        case WindowState.LIST:
            visibleChild = 'recordings';
            isHeaderVisible = true;
            break;
        case WindowState.EMPTY:
            visibleChild = 'empty';
            isHeaderVisible = true;
            break;
        case WindowState.TRANSCRIPT:
            visibleChild = 'transcript';
            isHeaderVisible = true;
            break;
        }

        const inTranscript = state === WindowState.TRANSCRIPT;
        this._backButton.visible = inTranscript;
        this._recordButton.visible = !inTranscript;
        if (!inTranscript)
            this._windowTitle.title = this._defaultTitle;

        this._mainStack.visible_child_name = visibleChild;
        this._headerRevealer.reveal_child = isHeaderVisible;
        this._state = state;
    }

    get state() {
        return this._state;
    }
});
