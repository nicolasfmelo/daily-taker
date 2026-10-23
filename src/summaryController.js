/* exported SummaryController */
const { Adw } = imports.gi;
const { defaultKeyStore } = imports.secrets;
const { hasKey } = imports.transcriptionUi;
const { summaryConfirmMessage, summaryFailureMessage, summaryRetryPlan, summaryInputProblem } = imports.summaryUi;

var SummaryController = class SummaryController {
    constructor({ parent, service, getModel, showToast, openPreferences, getTranscript, showDiscard,
        onDone, onFailed, hasRecording, canRequest = () => true,
        getKey = () => defaultKeyStore().get() }) {
        if (typeof hasRecording !== 'function')
            throw new TypeError('hasRecording é obrigatório.');
        Object.assign(this, { _parent: parent, _service: service, _getModel: getModel,
            _showToast: showToast, _openPreferences: openPreferences, _getTranscript: getTranscript,
            _onDone: onDone, _onFailed: onFailed, _hasRecording: hasRecording,
            _canRequest: canRequest, _getKey: getKey, _showDiscard: showDiscard });
        this._closed = false;
        this._failures = new Map();
        this._dialogs = new Map();
    }

    close() {
        this._closed = true;
        for (const dialog of this._dialogs.values())
            dialog.destroy();
        this._dialogs.clear();
    }

    failureMessage(recording) {
        return this._failures.get(recording.uri)?.message ?? '';
    }

    _toast(message) {
        this._showToast(new Adw.Toast({ title: message, use_markup: false }));
    }

    _gone(recording) {
        if (recording && this._hasRecording(recording))
            return false;
        if (!this._closed)
            this._toast('A gravação não está mais na lista.');
        return true;
    }

    request(recording, options = {}) {
        if (this._closed || this._gone(recording))
            return;
        let key = null;
        try { key = this._getKey(); } catch (e) { /* Sem chave disponível. */ }
        if (!hasKey(key)) {
            this._openPreferences();
            return;
        }
        const file = recording.file;
        const uri = file.get_uri();
        if (this._service.status(file) === 'running' || this._dialogs.has(uri) || !this._canRequest(recording))
            return;
        if (this._service.hasUnsaved(file)) {
            this.retry(recording);
            return;
        }
        const transcript = this._getTranscript(recording);
        const problem = summaryInputProblem(transcript);
        if (problem) {
            this._toast(problem);
            return;
        }
        const model = this._getModel();
        const { heading, body } = summaryConfirmMessage(transcript, model, options);
        const dialog = new Adw.MessageDialog({ transient_for: this._parent, modal: true,
            heading, body, heading_use_markup: false, body_use_markup: false });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('summarize', options.regenerate ? 'Gerar novamente' : 'Gerar resumo');
        dialog.set_response_appearance('summarize', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'summarize';
        dialog.close_response = 'cancel';
        this._dialogs.set(uri, dialog);
        dialog.connect('response', (_dialog, response) => {
            this._dialogs.delete(uri);
            if (response === 'summarize' && !this._closed && recording.file.equal(file))
                this._run(recording, options, transcript, model);
        });
        dialog.present();
    }

    discardUnsaved(recording) {
        this._failures.delete(recording.uri);
        this._service.discardUnsaved(recording.file);
        this._onDone(recording.file);
    }

    retry(recording) {
        if (this._closed || this._gone(recording))
            return;
        if (this._failures.get(recording.uri)?.plan === 'discard') {
            this._showDiscard(recording);
            return;
        }
        if (this._service.hasUnsaved(recording.file))
            this._retrySave(recording);
        else
            this.request(recording, this._failures.get(recording.uri)?.options ?? {});
    }

    _run(recording, options = {}, transcript = null, model = null) {
        if (this._closed || this._gone(recording))
            return;
        if (!this._canRequest(recording)) {
            this._toast('Aguarde a transcrição terminar para gerar o resumo.');
            return;
        }
        const file = recording.file;
        if (this._service.status(file) === 'running')
            return;
        transcript ??= this._getTranscript(recording);
        if (!transcript) {
            this._toast('Gere a transcrição primeiro.');
            return;
        }
        this._failures.delete(recording.uri);
        this._service.run({ file, transcript, model: model ?? this._getModel() }).then(
            summary => this._done(file, summary), error => this._failed(recording, error, options));
    }

    _retrySave(recording) {
        if (this._closed || this._gone(recording) || this._service.status(recording.file) === 'running')
            return;
        const options = this._failures.get(recording.uri)?.options ?? {};
        this._failures.delete(recording.uri);
        this._service.retrySave(recording.file).then(
            summary => this._done(recording.file, summary), error => this._failed(recording, error, options));
    }

    _done(file, summary) {
        if (!this._closed) {
            this._failures.delete(file.get_uri());
            this._onDone(file, summary);
        }
    }

    _failed(recording, error, options) {
        if (this._closed)
            return;
        const file = recording.file;
        const plan = summaryRetryPlan(error, { hasUnsaved: this._service.hasUnsaved(file),
            recordingExists: this._hasRecording(recording) && file.query_exists(null) });
        if (!plan && !this._service.hasUnsaved(file))
            this._service.discardUnsaved(file);
        const message = summaryFailureMessage(error, plan);
        if (plan)
            this._failures.set(recording.uri, { plan, message, options });
        else
            this._failures.delete(recording.uri);
        const toast = new Adw.Toast({ title: message, use_markup: false, timeout: 10 });
        if (plan) {
            toast.button_label = plan === 'discard' ? 'Descartar…' : 'Tentar de novo';
            toast.connect('button-clicked', () => this.retry(recording));
        }
        this._showToast(toast);
        this._onFailed(recording, message);
    }
};
