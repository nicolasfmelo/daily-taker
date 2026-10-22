const { Gio, GLib, Soup } = imports.gi;
const ByteArray = imports.byteArray;
const { test, testAsync, assert, finish } = imports.harness;
const T = imports.transcriber;

const KEY = 'sk-test-secret-key-123';

// ---- puros ----

test('estimateCostUsd: 1 hora custa cerca de US$ 0,1116', () => {
    assert.equal(Math.abs(T.estimateCostUsd(3600) - 0.1116) < 1e-9, true);
    assert.equal(T.estimateCostUsd(0), 0);
});

test('constantes', () => {
    assert.equal(T.MODEL, 'elevenlabs/scribe-v2');
    assert.equal(T.MAX_UPLOAD_BYTES, 25 * 1024 * 1024);
    assert.equal(T.API_BASE, 'https://openrouter.ai/api/v1');
    // inatividade do socket: o servidor pode levar minutos para responder áudio longo
    assert.equal(T.UPLOAD_TIMEOUT_SEC, 600);
    assert.equal(T.CHECK_TIMEOUT_SEC, 30);
});

test('tooLarge: mensagem diz o limite, a duração aproximada e o que fazer', () => {
    const e = new T.TranscribeError('tooLarge');
    assert.equal(e.message, 'A gravação passa de 25 MB, o limite de envio do OpenRouter. ' +
        'Gravações de até cerca de 1h45 podem ser transcritas; divida o áudio e tente de novo.');
});

test('formFields inclui os campos fixos e o idioma', () => {
    const f = T.formFields({ language: 'pt' });
    assert.deepEqual(f.find(p => p[0] === 'model'), ['model', 'elevenlabs/scribe-v2']);
    assert.deepEqual(f.find(p => p[0] === 'response_format'), ['response_format', 'verbose_json']);
    assert.deepEqual(f.find(p => p[0] === 'diarize'), ['diarize', 'true']);
    assert.deepEqual(f.find(p => p[0] === 'timestamp_granularities[]'), ['timestamp_granularities[]', 'word']);
    assert.deepEqual(f.find(p => p[0] === 'language'), ['language', 'pt']);
});

test('formFields com language auto omite o campo language', () => {
    const f = T.formFields({ language: 'auto' });
    assert.equal(f.some(p => p[0] === 'language'), false);
    assert.equal(f.some(p => p[0] === 'model'), true);
});

test('classifyError: mapeamento de status', () => {
    assert.equal(T.classifyError(400, 'diarize not supported').kind, 'diarize');
    assert.equal(T.classifyError(400, '{"error":{"code":400,"message":"Bad Diarize flag"}}').kind, 'diarize');
    assert.equal(T.classifyError(400, 'invalid file').kind, 'badRequest');
    assert.equal(T.classifyError(401, '').kind, 'auth');
    assert.equal(T.classifyError(403, '').kind, 'auth');
    assert.equal(T.classifyError(402, '').kind, 'credits');
    assert.equal(T.classifyError(429, '').kind, 'rate');
    assert.equal(T.classifyError(502, '').kind, 'upstream');
    assert.equal(T.classifyError(418, '').kind, 'unknown');
});

test('classifyError: retryable e status', () => {
    assert.equal(T.classifyError(429, '').retryable, true);
    assert.equal(T.classifyError(502, '').retryable, true);
    assert.equal(T.classifyError(401, '').retryable, false);
    assert.equal(T.classifyError(402, '').retryable, false);
    assert.equal(T.classifyError(400, 'x').retryable, false);
    assert.equal(T.classifyError(429, '').status, 429);
});

test('TranscribeError é um Error com mensagem em pt-BR', () => {
    const e = T.classifyError(401, '');
    assert.equal(e instanceof Error, true);
    assert.equal(e instanceof T.TranscribeError, true);
    assert.equal(e.message, 'Chave da API inválida ou sem permissão.');
});

test('classifyError não vaza o corpo da resposta na mensagem', () => {
    const e = T.classifyError(500, `{"error":{"message":"boom ${KEY}"}}`);
    assert.equal(e.message.includes(KEY), false);
});

// ---- servidor local ----

const tmpDir = () => Gio.File.new_for_path(GLib.Dir.make_tmp('daily-taker-test-XXXXXX'));

// libsoup 3 não tem constante para 429: responde direto no socket.
const rawResponse = (msg, status, body) => {
    const io = msg.steal_connection();
    const out = io.get_output_stream();
    const bytes = ByteArray.fromString(body);
    const head = `HTTP/1.1 ${status} Test\r\nContent-Type: application/json\r\n` +
        `Content-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`;
    out.write_all(ByteArray.fromString(head), null);
    out.write_all(bytes, null);
    io.close(null);
};

const withServer = async (respond, fn) => {
    const server = new Soup.Server();
    const requests = [];
    server.add_handler(null, (srv, msg, path) => {
        const headers = msg.get_request_headers();
        const rec = { path, method: msg.get_method(), auth: headers.get_one('Authorization'), parts: {} };
        const [ctype] = headers.get_content_type();
        if (ctype === 'multipart/form-data') {
            const mp = Soup.Multipart.new_from_message(headers, msg.get_request_body().flatten());
            for (let i = 0; i < mp.get_length(); i++) {
                const [, partHeaders, body] = mp.get_part(i);
                const [, , params] = partHeaders.get_content_disposition();
                rec.parts[params.name] = {
                    filename: params.filename,
                    contentType: partHeaders.get_content_type()[0],
                    size: body.get_size(),
                    text: params.filename ? null : ByteArray.toString(ByteArray.fromGBytes(body)),
                };
            }
        }
        requests.push(rec);
        const response = respond(requests.length, rec);
        // null: servidor travado, nunca responde.
        if (response === null) {
            msg.pause();
            return;
        }
        const [status, body] = response;
        if (Object.values(Soup.Status).includes(status)) {
            msg.set_status(status, null);
            msg.set_response('application/json', Soup.MemoryUse.COPY, body);
        } else {
            rawResponse(msg, status, body);
        }
    });
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const baseUrl = `http://127.0.0.1:${server.get_uris()[0].get_port()}`;
    try {
        await fn(baseUrl, requests);
    } finally {
        server.disconnect();
    }
};

const writeFile = (dir, name, size) => {
    const f = dir.get_child(name);
    const data = new Uint8Array(size);
    for (let i = 0; i < size; i++)
        data[i] = i % 251;
    f.replace_contents(size ? data : '', null, false, Gio.FileCreateFlags.NONE, null);
    return f;
};

const rmTree = dir => {
    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = en.next_file(null)))
        dir.get_child(info.get_name()).delete(null);
    dir.delete(null);
};

const withDir = async fn => {
    const dir = tmpDir();
    try {
        await fn(dir);
    } finally {
        rmTree(dir);
    }
};

const rejection = async p => {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('esperava rejeição');
};

const OK_BODY = JSON.stringify({ text: 'oi', language: 'por', duration: 3, words: [], segments: [] });

testAsync('transcribeFile: 429, 429, 200 resolve com 3 requisições e multipart correto', () =>
    withDir(dir => withServer((n) => n < 3 ? [429, '{"error":{"code":429,"message":"slow"}}'] : [200, OK_BODY],
        async (baseUrl, requests) => {
            const file = writeFile(dir, 'a.ogg', 1000);
            const res = await T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 });
            assert.equal(res.text, 'oi');
            assert.equal(requests.length, 3);
            const r = requests[2];
            assert.equal(r.method, 'POST');
            assert.equal(r.path, '/audio/transcriptions');
            assert.equal(r.auth, 'Bearer k');
            assert.equal(r.parts.model.text, 'elevenlabs/scribe-v2');
            assert.equal(r.parts.diarize.text, 'true');
            assert.equal(r.parts.language.text, 'pt');
            assert.equal(r.parts.response_format.text, 'verbose_json');
            assert.equal(r.parts['timestamp_granularities[]'].text, 'word');
            assert.equal(r.parts.file.filename, 'recording.ogg');
            assert.equal(r.parts.file.contentType, 'audio/ogg');
            assert.equal(r.parts.file.size, 1000);
        })));

testAsync('transcribeFile: language auto não envia a parte language', () =>
    withDir(dir => withServer(() => [200, OK_BODY], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        await T.transcribeFile({ apiKey: 'k', file, language: 'auto', baseUrl, backoffMs: 1 });
        assert.equal('language' in requests[0].parts, false);
    })));

testAsync('transcribeFile: 401 rejeita auth com 1 requisição', () =>
    withDir(dir => withServer(() => [401, '{"error":{"code":401,"message":"No auth"}}'], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e instanceof T.TranscribeError, true);
        assert.equal(e.kind, 'auth');
        assert.equal(e.retryable, false);
        assert.equal(e.status, 401);
        assert.equal(requests.length, 1);
    })));

testAsync('transcribeFile: 400 com diarize rejeita diarize sem repetir', () =>
    withDir(dir => withServer(() => [400, '{"error":{"code":400,"message":"diarize is not supported"}}'], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.kind, 'diarize');
        assert.equal(requests.length, 1);
    })));

testAsync('transcribeFile: 429 persistente esgota as tentativas (1 + 2 retries)', () =>
    withDir(dir => withServer(() => [429, '{"error":{"code":429,"message":"slow"}}'], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.kind, 'rate');
        assert.equal(requests.length, 3);
    })));

testAsync('transcribeFile: retries configurável', () =>
    withDir(dir => withServer(() => [502, '{}'], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1, retries: 0 }));
        assert.equal(e.kind, 'upstream');
        assert.equal(requests.length, 1);
    })));

testAsync('transcribeFile: erro não contém a chave da API', () =>
    withDir(dir => withServer(() => [401, `{"error":{"code":401,"message":"bad key ${KEY}"}}`], async (baseUrl) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: KEY, file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.message.includes(KEY), false);
        assert.equal(String(e.stack).includes(KEY), false);
        assert.equal(JSON.stringify(e).includes(KEY), false);
    })));

testAsync('transcribeFile: arquivo vazio rejeita empty sem requisição', () =>
    withDir(dir => withServer(() => [200, OK_BODY], async (baseUrl, requests) => {
        const file = writeFile(dir, 'empty.ogg', 0);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.kind, 'empty');
        assert.equal(requests.length, 0);
    })));

testAsync('transcribeFile: arquivo > 25 MiB rejeita tooLarge sem requisição', () =>
    withDir(dir => withServer(() => [200, OK_BODY], async (baseUrl, requests) => {
        const file = dir.get_child('big.ogg');
        // Arquivo esparso: só o tamanho importa para a checagem.
        const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
        stream.seek(T.MAX_UPLOAD_BYTES, GLib.SeekType.SET, null);
        stream.write_bytes(new GLib.Bytes([1]), null);
        stream.close(null);
        assert.equal(file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size(), T.MAX_UPLOAD_BYTES + 1);
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.kind, 'tooLarge');
        assert.equal(requests.length, 0);
    })), 30000);

testAsync('transcribeFile: arquivo inexistente rejeita sem requisição', () =>
    withDir(dir => withServer(() => [200, OK_BODY], async (baseUrl, requests) => {
        const file = dir.get_child('missing.ogg');
        const e = await rejection(T.transcribeFile({ apiKey: 'k', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e instanceof T.TranscribeError, true);
        assert.equal(e.kind, 'unknown');
        assert.equal(requests.length, 0);
    })));

testAsync('transcribeFile: sem chave rejeita noKey sem requisição', () =>
    withDir(dir => withServer(() => [200, OK_BODY], async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: '', file, language: 'pt', baseUrl, backoffMs: 1 }));
        assert.equal(e.kind, 'noKey');
        assert.equal(requests.length, 0);
    })));

testAsync('transcribeFile: conexão recusada vira network (retryable)', () =>
    withDir(async dir => {
        // Abre e fecha um servidor para obter uma porta que ninguém escuta.
        let deadUrl;
        await withServer(() => [200, '{}'], baseUrl => {
            deadUrl = baseUrl;
        });
        const file = writeFile(dir, 'a.ogg', 10);
        const e = await rejection(T.transcribeFile({ apiKey: KEY, file, language: 'pt', baseUrl: deadUrl, backoffMs: 1, retries: 1 }));
        assert.equal(e.kind, 'network');
        assert.equal(e.retryable, true);
        assert.equal(e.message.includes(KEY), false);
    }));

testAsync('transcribeFile: servidor que nunca responde estoura o timeout e vira network', () =>
    withDir(dir => withServer(() => null, async (baseUrl, requests) => {
        const file = writeFile(dir, 'a.ogg', 10);
        const t0 = Date.now();
        const e = await rejection(T.transcribeFile({ apiKey: KEY, file, language: 'pt', baseUrl, backoffMs: 1, timeoutSec: 1 }));
        assert.equal(e instanceof T.TranscribeError, true);
        assert.equal(e.kind, 'network');
        assert.equal(e.retryable, true);
        assert.equal(e.message.includes(KEY), false);
        // 1 + 2 tentativas, cada uma desistindo após ~1 s sem resposta
        assert.equal(requests.length, 3);
        assert.equal(Date.now() - t0 < 8000, true);
    })), 15000);

testAsync('checkApiKey: servidor que nunca responde estoura o timeout e vira network', () =>
    withServer(() => null, async (baseUrl) => {
        const r = await T.checkApiKey({ apiKey: KEY, baseUrl, timeoutSec: 1 });
        assert.equal(r.ok, false);
        assert.equal(r.error.kind, 'network');
    }), 10000);

testAsync('checkApiKey: 200 -> ok, com Authorization e GET /key', () =>
    withServer(() => [200, '{"data":{}}'], async (baseUrl, requests) => {
        const r = await T.checkApiKey({ apiKey: 'k', baseUrl });
        assert.equal(r.ok, true);
        assert.equal(requests[0].method, 'GET');
        assert.equal(requests[0].path, '/key');
        assert.equal(requests[0].auth, 'Bearer k');
    }));

testAsync('checkApiKey: 401 -> ok false, kind auth', () =>
    withServer(() => [401, '{"error":{"code":401,"message":"nope"}}'], async (baseUrl) => {
        const r = await T.checkApiKey({ apiKey: KEY, baseUrl });
        assert.equal(r.ok, false);
        assert.equal(r.error.kind, 'auth');
        assert.equal(r.error.message.includes(KEY), false);
    }));

testAsync('checkApiKey: sem chave -> noKey sem requisição', () =>
    withServer(() => [200, '{}'], async (baseUrl, requests) => {
        const r = await T.checkApiKey({ apiKey: '', baseUrl });
        assert.equal(r.ok, false);
        assert.equal(r.error.kind, 'noKey');
        assert.equal(requests.length, 0);
    }));

finish();
