/* exported TranscriptionService */
// Orquestra chave -> transcrição -> Transcript -> gravação em disco, com estado por arquivo.
// Todos os colaboradores são injetados: sem GTK, rede ou disco aqui.
const { TranscribeError } = imports.transcriber;
const { createTranscript } = imports.transcript;

const NO_KEY_MESSAGE = 'Configure a chave da API do OpenRouter nas Preferências.';

var TranscriptionService = class TranscriptionService {
    constructor({ getKey, transcribe, save, language, now }) {
        this._getKey = getKey;
        this._transcribe = transcribe;
        this._save = save;
        this._language = language;
        this._now = now;
        this._running = new Map();   // uri -> Promise<Transcript> em andamento
        this._failed = new Set();    // uris cuja última execução falhou
        this._unsaved = new Map();   // uri -> Transcript já paga cujo save falhou
        this._listeners = [];
    }

    hasRunning() {
        return this._running.size > 0;
    }

    hasAnyUnsaved() {
        return this._unsaved.size > 0;
    }

    status(recordingFile) {
        const uri = recordingFile.get_uri();
        if (this._running.has(uri))
            return 'running';
        return this._failed.has(uri) ? 'error' : 'none';
    }

    connectChange(fn) {
        this._listeners.push(fn);
    }

    // Execuções simultâneas do mesmo arquivo compartilham a mesma promessa.
    run({ file, title, recordedAt }) {
        const uri = file.get_uri();
        const inFlight = this._running.get(uri);
        if (inFlight)
            return inFlight;
        return this._track(uri, this._execute({ file, title, recordedAt }));
    }

    // Há uma transcrição já paga que não pôde ser salva (ver retrySave).
    hasUnsaved(recordingFile) {
        return this._unsaved.has(recordingFile.get_uri());
    }

    discardUnsaved(recordingFile) {
        const uri = recordingFile.get_uri();
        this._unsaved.delete(uri);
        this._failed.delete(uri);
        this._emit(uri, 'none');
    }

    // Tenta de novo só a gravação em disco da última transcrição que falhou ao salvar:
    // nenhuma chamada à API (nada é cobrado de novo). Mesmo contrato de status que run().
    retrySave(recordingFile) {
        const uri = recordingFile.get_uri();
        const inFlight = this._running.get(uri);
        if (inFlight)
            return inFlight;
        if (!this._unsaved.has(uri))
            return Promise.reject(new TranscribeError('unknown'));
        return this._track(uri, Promise.resolve().then(() =>
            this._saveOrKeep(recordingFile, this._unsaved.get(uri))));
    }

    _track(uri, execution) {
        const promise = execution.then(
            transcript => {
                this._finish(uri, 'none');
                return transcript;
            },
            error => {
                this._finish(uri, 'error');
                throw error;
            });
        this._failed.delete(uri);
        this._running.set(uri, promise);
        this._emit(uri, 'running');
        return promise;
    }

    // Salva; se falhar, guarda a transcrição em memória para retrySave. Uma transcrição
    // guardada só é descartada depois de um save bem-sucedido.
    _saveOrKeep(file, transcript) {
        const uri = file.get_uri();
        try {
            this._save(file, transcript);
        } catch (e) {
            this._unsaved.set(uri, transcript);
            throw this._wrap(e);
        }
        this._unsaved.delete(uri);
        return transcript;
    }

    async _execute({ file, title, recordedAt }) {
        let transcript;
        try {
            const key = this._getKey();
            if (!key)
                throw new TranscribeError('noKey', 0, NO_KEY_MESSAGE);
            const apiResponse = await this._transcribe({
                apiKey: key.key,
                file,
                language: this._language(),
            });
            transcript = createTranscript({
                apiResponse,
                title,
                recordedAt,
                transcribedAt: this._now().toISOString(),
            });
        } catch (e) {
            throw this._wrap(e);
        }
        return this._saveOrKeep(file, transcript);
    }

    _wrap(e) {
        if (e instanceof TranscribeError)
            return e;
        // Na interface, mensagem fixa (o erro original pode carregar dados da requisição);
        // o original vai para o log para o defeito não sumir. Os erros que chegam aqui são
        // de programação ou de disco: a chave da API nunca entra neles.
        logError(e, 'Transcrição: erro inesperado');
        return new TranscribeError('unknown');
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
                logError(e, 'TranscriptionService: listener falhou');
            }
        }
    }
};
