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
        this._listeners = [];
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

        const promise = this._execute({ file, title, recordedAt }).then(
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

    async _execute({ file, title, recordedAt }) {
        try {
            const key = this._getKey();
            if (!key)
                throw new TranscribeError('noKey', 0, NO_KEY_MESSAGE);
            const apiResponse = await this._transcribe({
                apiKey: key.key,
                file,
                language: this._language(),
            });
            const transcript = createTranscript({
                apiResponse,
                title,
                recordedAt,
                transcribedAt: this._now().toISOString(),
            });
            this._save(file, transcript);
            return transcript;
        } catch (e) {
            if (e instanceof TranscribeError)
                throw e;
            // Mensagem fixa: o erro original pode carregar dados da requisição.
            throw new TranscribeError('unknown');
        }
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
