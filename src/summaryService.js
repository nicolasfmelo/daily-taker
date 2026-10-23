/* exported SummaryService */
const { TranscribeError } = imports.transcriber;

const unknownError = () => new TranscribeError('unknown', 0, 'Erro inesperado ao gerar o resumo.');

var SummaryService = class SummaryService {
    constructor({ getKey, getModel, summarize, save, now }) {
        this._getKey = getKey;
        this._getModel = getModel;
        this._summarize = summarize;
        this._save = save;
        this._now = now;
        this._running = new Map();
        this._failed = new Set();
        this._unsaved = new Map();
        this._listeners = [];
    }

    status(file) {
        const uri = file.get_uri();
        return this._running.has(uri) ? 'running' : this._failed.has(uri) ? 'error' : 'none';
    }

    connectChange(fn) {
        this._listeners.push(fn);
    }

    hasUnsaved(file) {
        return this._unsaved.has(file.get_uri());
    }

    discardUnsaved(file) {
        this._unsaved.delete(file.get_uri());
    }

    run({ file, transcript, model }) {
        const uri = file.get_uri();
        if (this._running.has(uri))
            return this._running.get(uri);
        if (this.hasUnsaved(file))
            return this.retrySave(file);
        return this._track(uri, () => this._execute({ file, transcript, model }));
    }

    retrySave(file) {
        const uri = file.get_uri();
        if (this._running.has(uri))
            return this._running.get(uri);
        if (!this.hasUnsaved(file))
            return Promise.reject(unknownError());
        return this._track(uri, () => this._saveOrKeep(file, this._unsaved.get(uri)));
    }

    _track(uri, execute) {
        // Instalar o single-flight antes de executar colaboradores ou listeners.
        const promise = Promise.resolve().then(execute).then(summary => {
            this._finish(uri, 'none');
            return summary;
        }, error => {
            this._finish(uri, 'error');
            throw error;
        });
        this._failed.delete(uri);
        this._running.set(uri, promise);
        this._emit(uri, 'running');
        return promise;
    }

    async _execute({ file, transcript, model }) {
        let summary;
        try {
            const key = this._getKey();
            if (!key?.key)
                throw new TranscribeError('noKey', 0, 'Configure a chave da API do OpenRouter nas Preferências.');
            summary = await this._summarize({ apiKey: key.key, transcript, model: model ?? this._getModel() });
            if (!summary.generated_at)
                summary = { ...summary, generated_at: this._now().toISOString() };
        } catch (e) {
            if (e instanceof TranscribeError)
                throw e;
            // Nunca logar o original: transportes externos podem ecoar a chave.
            const safe = unknownError();
            logError(safe, 'Resumo: erro inesperado');
            throw safe;
        }
        return this._saveOrKeep(file, summary);
    }

    _saveOrKeep(file, summary) {
        const uri = file.get_uri();
        try {
            this._save(file, summary);
        } catch (e) {
            if (e instanceof TranscribeError && e.kind === 'recordingGone') {
                this._unsaved.delete(uri);
                throw e;
            }
            this._unsaved.set(uri, summary);
            throw new TranscribeError('saveFailed', 0,
                'O resumo foi gerado, mas não foi possível salvá-lo no disco.');
        }
        this._unsaved.delete(uri);
        return summary;
    }

    _finish(uri, status) {
        this._running.delete(uri);
        if (status === 'error')
            this._failed.add(uri);
        this._emit(uri, status);
    }

    _emit(uri, status) {
        for (const fn of this._listeners) {
            try {
                fn(uri, status);
            } catch (e) {
                logError(unknownError(), 'SummaryService: listener falhou');
            }
        }
    }
};
