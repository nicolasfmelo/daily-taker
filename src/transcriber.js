/* exported API_BASE, MODEL, MAX_UPLOAD_BYTES, PRICE_PER_SECOND_USD, estimateCostUsd,
            formFields, TranscribeError, classifyError, transcribeFile, checkApiKey */
// Cliente do endpoint de transcrição do OpenRouter (elevenlabs/scribe-v2).
// A chave da API só aparece no header Authorization: nunca em mensagens de erro nem em logs.
const { Gio, GLib, Soup } = imports.gi;

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

var API_BASE = 'https://openrouter.ai/api/v1';
var MODEL = 'elevenlabs/scribe-v2';
var MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
var PRICE_PER_SECOND_USD = 0.000031;

var estimateCostUsd = seconds => seconds * PRICE_PER_SECOND_USD;

var formFields = ({ language }) => {
    const fields = [
        ['model', MODEL],
        ['response_format', 'verbose_json'],
        ['diarize', 'true'],
        ['timestamp_granularities[]', 'word'],
    ];
    if (language && language !== 'auto')
        fields.push(['language', language]);
    return fields;
};

const MESSAGES = {
    noKey: 'Nenhuma chave da API do OpenRouter configurada.',
    auth: 'Chave da API inválida ou sem permissão.',
    credits: 'Sem créditos no OpenRouter.',
    rate: 'Muitas requisições; tente de novo em instantes.',
    upstream: 'O serviço de transcrição está indisponível no momento.',
    diarize: 'O modelo não aceitou a separação de locutores.',
    badRequest: 'O OpenRouter recusou a requisição (dados inválidos).',
    tooLarge: 'O arquivo de áudio passa de 25 MB, o limite do OpenRouter.',
    empty: 'O arquivo de áudio está vazio.',
    network: 'Falha de conexão com o OpenRouter. Verifique a internet.',
    unknown: 'Erro inesperado ao transcrever.',
};

const RETRYABLE = new Set(['rate', 'upstream', 'network']);

var TranscribeError = class TranscribeError extends Error {
    constructor(kind, status = 0, message = MESSAGES[kind] ?? MESSAGES.unknown) {
        super(message);
        this.name = 'TranscribeError';
        this.kind = kind;
        this.status = status;
        this.retryable = RETRYABLE.has(kind);
    }
};

// bodyText só é inspecionado, nunca copiado para a mensagem (pode ecoar dados da requisição).
var classifyError = (status, bodyText) => {
    let kind = 'unknown';
    if (status === 401 || status === 403)
        kind = 'auth';
    else if (status === 402)
        kind = 'credits';
    else if (status === 429)
        kind = 'rate';
    else if (status === 502 || status === 503 || status === 504)
        kind = 'upstream';
    else if (status === 400)
        kind = /diariz/i.test(bodyText ?? '') ? 'diarize' : 'badRequest';
    return new TranscribeError(kind, status);
};

const sleep = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

const decode = bytes => new TextDecoder().decode(bytes.get_data());

// Uma tentativa; resolve com {status, text} ou rejeita com TranscribeError('network').
const send = async (session, msg) => {
    try {
        const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        // status_code (propriedade) em vez de get_status(): o enum Soup.Status não conhece 429.
        return { status: msg.status_code, text: decode(bytes) };
    } catch (e) {
        if (e instanceof GLib.Error)
            throw new TranscribeError('network');
        throw e;
    }
};

const newSession = () => {
    const session = new Soup.Session();
    session.user_agent = 'DailyTaker/1 ';
    return session;
};

const newMessage = (method, url, apiKey) => {
    const msg = Soup.Message.new(method, url);
    if (!msg)
        throw new TranscribeError('unknown');
    msg.get_request_headers().append('Authorization', `Bearer ${apiKey}`);
    return msg;
};

const readAudio = file => {
    let size;
    try {
        size = file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
    } catch (e) {
        throw new TranscribeError('unknown', 0, 'Não foi possível ler o arquivo de áudio.');
    }
    if (size === 0)
        throw new TranscribeError('empty');
    if (size > MAX_UPLOAD_BYTES)
        throw new TranscribeError('tooLarge');
    try {
        const [, contents] = file.load_contents(null);
        return new GLib.Bytes(contents);
    } catch (e) {
        throw new TranscribeError('unknown', 0, 'Não foi possível ler o arquivo de áudio.');
    }
};

var transcribeFile = async ({ apiKey, file, language, baseUrl = API_BASE, retries = 2, backoffMs = 2000 }) => {
    if (!apiKey)
        throw new TranscribeError('noKey');
    const audio = readAudio(file);
    const session = newSession();

    for (let attempt = 0; ; attempt++) {
        const form = Soup.Multipart.new('multipart/form-data');
        for (const [name, value] of formFields({ language }))
            form.append_form_string(name, value);
        form.append_form_file('file', 'recording.ogg', 'audio/ogg', audio);
        const msg = Soup.Message.new_from_multipart(`${baseUrl}/audio/transcriptions`, form);
        if (!msg)
            throw new TranscribeError('unknown');
        msg.get_request_headers().append('Authorization', `Bearer ${apiKey}`);

        let error;
        try {
            const { status, text } = await send(session, msg);
            if (status >= 200 && status < 300) {
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new TranscribeError('unknown', status, 'Resposta inválida do OpenRouter.');
                }
            }
            error = classifyError(status, text);
        } catch (e) {
            if (!(e instanceof TranscribeError))
                throw e;
            error = e;
        }

        if (!error.retryable || attempt >= retries)
            throw error;
        await sleep(backoffMs * 2 ** attempt);
    }
};

var checkApiKey = async ({ apiKey, baseUrl = API_BASE }) => {
    if (!apiKey)
        return { ok: false, error: new TranscribeError('noKey') };
    try {
        const msg = newMessage('GET', `${baseUrl}/key`, apiKey);
        const { status, text } = await send(newSession(), msg);
        if (status >= 200 && status < 300)
            return { ok: true };
        return { ok: false, error: classifyError(status, text) };
    } catch (e) {
        if (e instanceof TranscribeError)
            return { ok: false, error: e };
        throw e;
    }
};
