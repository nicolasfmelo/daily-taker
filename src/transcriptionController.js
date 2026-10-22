/* exported TranscriptionController */
// Fluxo de "Gerar transcrição" da janela (migrado da janela antiga, mesma lógica e textos):
// chave primeiro (sem chave abre as Preferências), diálogo de custo, execução pelo
// TranscriptionService, toast de falha com "Tentar de novo" conforme retryPlan ('save' só
// salva de novo a transcrição já paga, sem diálogo nem cobrança; 'transcribe' passa pelo
// diálogo de custo de novo). Guarda a última falha por gravação para o painel mostrar a
// mensagem e o "Tentar de novo" dele seguir o mesmo plano.
const { Adw } = imports.gi;

const { defaultKeyStore } = imports.secrets;
const { confirmMessage, failureMessage, hasKey, retryPlan } = imports.transcriptionUi;

var TranscriptionController = class TranscriptionController {
    // parent: janela dos diálogos; service: TranscriptionService; showToast(Adw.Toast);
    // openPreferences(); hasRecording(recording): ainda está na biblioteca?;
    // onDone(file, transcript) e onFailed(recording, message): avisos para a janela.
    constructor({ parent, service, showToast, openPreferences, hasRecording, onDone, onFailed }) {
        this._parent = parent;
        this._service = service;
        this._showToast = showToast;
        this._openPreferences = openPreferences;
        this._hasRecording = hasRecording;
        this._onDone = onDone;
        this._onFailed = onFailed;
        this._closed = false;
        // uri → { plan, message, options } da última falha (some ao tentar de novo).
        this._failures = new Map();
    }

    // A janela fechou: nada de diálogos nem toasts depois disso.
    close() {
        this._closed = true;
    }

    // Mensagem da última falha da gravação (para o painel), ou ''.
    failureMessage(recording) {
        return this._failures.get(recording.uri)?.message ?? '';
    }

    // regenerate: a gravação já tem transcrição (mesmas guardas, outro texto);
    // namedSpeakers: os nomes dados aos locutores serão perdidos.
    request(recording, options = {}) {
        const { regenerate = false } = options;
        // A chave é verificada antes de tocar no serviço: sem chave a gravação não entra em erro.
        let key = null;
        try {
            key = defaultKeyStore().get();
        } catch (e) {
            key = null;
        }
        if (!hasKey(key)) {
            this._openPreferences();
            return;
        }

        if (this._service.status(recording.file) === 'running')
            return;

        const { heading, body } = confirmMessage(recording.duration / 1e9, options);
        const dialog = new Adw.MessageDialog({
            transient_for: this._parent,
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
                this._run(recording, options);
        });
        dialog.present();
    }

    // "Tentar de novo" do painel: o plano da última falha desta gravação ('save' sem custo);
    // sem falha registrada, o fluxo normal com `options`.
    retry(recording, options = {}) {
        const failure = this._failures.get(recording.uri);
        if (failure?.plan === 'save')
            this._retrySave(recording, recording.file, failure.options);
        else
            this.request(recording, failure?.options ?? options);
    }

    _run(recording, options) {
        const file = recording.file;
        const created = recording.timeCreated;
        const recordedAt = created && created.to_unix() > 0 ? created : recording.timeModified;
        this._failures.delete(recording.uri);
        this._service.run({
            file,
            title: recording.name,
            recordedAt: recordedAt.format_iso8601(),
        }).then(
            transcript => this._done(file, transcript),
            error => this._failed(recording, error, options));
    }

    // A transcrição já foi paga: só salva de novo, sem diálogo de custo nem chamada à API.
    _retrySave(recording, file, options) {
        this._failures.delete(recording.uri);
        this._service.retrySave(file).then(
            transcript => this._done(file, transcript),
            error => this._failed(recording, error, options));
    }

    _done(file, transcript) {
        if (this._closed)
            return;
        this._failures.delete(file.get_uri());
        this._onDone(file, transcript);
    }

    _failed(recording, error, options) {
        if (this._closed)
            return;

        const file = recording.file;
        const plan = retryPlan(error, {
            recordingExists: this._hasRecording(recording) && file.query_exists(null),
            hasUnsaved: this._service.hasUnsaved(file),
        });
        // Sem como tentar de novo (gravação sumiu), a transcrição guardada só ocuparia memória.
        if (plan === null)
            this._service.discardUnsaved(file);
        const message = failureMessage(error, plan);
        if (plan)
            this._failures.set(recording.uri, { plan, message, options });
        else
            this._failures.delete(recording.uri);

        // Sem markup: a mensagem é fixa, mas o Adw.Toast interpreta markup por padrão.
        const toast = new Adw.Toast({ title: message, use_markup: false, timeout: 10 });
        if (plan) {
            toast.button_label = 'Tentar de novo';
            toast.connect('button-clicked', () => {
                if (this._closed)
                    return;
                if (plan === 'save')
                    this._retrySave(recording, file, options);
                else
                    this.request(recording, options);
            });
        }
        this._showToast(toast);
        this._onFailed(recording, message);
    }
};
