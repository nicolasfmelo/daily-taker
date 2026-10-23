const { GLib, Soup } = imports.gi;
const ByteArray = imports.byteArray;
const { test, testAsync, assert, finish } = imports.harness;
const S = imports.summarizer;
const { DEFAULT_SUMMARY_MODEL } = imports.modelDefaults;
const { TranscribeError } = imports.transcriber;
const transcript = { title: 'Fixture', recorded_at: '2026-10-22T12:00:00Z', duration: 60,
    speakers: { 0: 'Nicolas' }, words: [{ word: 'Decidimos testar.', speaker: 0, start: 34, end: 35 }] };
const body = (extra = {}) => JSON.stringify({ model: 'retornado', choices: [{ message: { content: '## Resumo\n\nDecidimos testar.' } }], usage: { cost: 0.012 }, ...extra });
const rejection = async p => {
    try { await p; } catch (e) { return e; }
    throw new Error('esperava rejeição');
};
const withServer = async (respond, fn) => {
    const server = new Soup.Server();
    const requests = [];
    const paused = [];
    server.add_handler(null, (_srv, msg, path) => {
        requests.push({ path, auth: msg.get_request_headers().get_one('Authorization'),
            body: JSON.parse(ByteArray.toString(ByteArray.fromGBytes(msg.get_request_body().flatten()))) });
        const response = respond(requests.length);
        if (!response) {
            msg.pause();
            paused.push(msg);
            return;
        }
        const [status, text] = response;
        if (Object.values(Soup.Status).includes(status)) {
            msg.set_status(status, null);
            msg.set_response('application/json', Soup.MemoryUse.COPY, text);
        } else {
            const io = msg.steal_connection();
            const out = io.get_output_stream();
            const bytes = ByteArray.fromString(text);
            out.write_all(ByteArray.fromString(`HTTP/1.1 ${status} Test\r\nContent-Type: application/json\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`), null);
            out.write_all(bytes, null);
            io.close(null);
        }
    });
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    try {
        await fn(`http://127.0.0.1:${server.get_uris()[0].get_port()}`, requests);
    } finally {
        for (const msg of paused) { msg.set_status(503, null); msg.unpause(); }
        server.disconnect();
    }
};
const run = (baseUrl, extra = {}) => S.summarizeTranscript({ apiKey: 'k', transcript, baseUrl, backoffMs: 1, ...extra });

testAsync('requisição JSON inclui locutores, prompt estável e limites; resposta tem custo e data', () =>
    withServer(() => [200, body()], async (url, requests) => {
        const summary = await run(url);
        const req = requests[0];
        assert.equal(req.path, '/chat/completions');
        assert.equal(req.auth, 'Bearer k');
        assert.equal(req.body.model, DEFAULT_SUMMARY_MODEL);
        assert.equal(req.body.max_tokens, 2000);
        assert.equal(req.body.temperature, 0.2);
        assert.equal(req.body.messages[0].role, 'system');
        for (const section of ['## Resumo', '## Decisões', '## Próximos passos', '## Pontos de atenção'])
            assert.equal(req.body.messages[0].content.includes(section), true);
        assert.equal(req.body.messages[1].content.includes('Nicolas · 00:34\nDecidimos testar.'), true);
        assert.equal(summary.text, '## Resumo\n\nDecidimos testar.');
        assert.equal(summary.model, 'retornado');
        assert.equal(summary.cost_usd, 0.012);
        assert.equal(Number.isFinite(Date.parse(summary.generated_at)), true);
    }));

testAsync('fallback por tokens só no modelo padrão; custo desconhecido é null', async () => {
    for (const [usage, expected] of [[{ prompt_tokens: 1000, completion_tokens: 200 }, 0.004], [undefined, null]])
        await withServer(() => [200, body({ usage, model: undefined })], async url => {
            const s = await run(url);
            assert.equal(s.cost_usd, expected);
            assert.equal(s.model, DEFAULT_SUMMARY_MODEL);
        });
});

testAsync('429,429,200 retenta só status transitório', () =>
    withServer(n => n < 3 ? [429, '{}'] : [200, body()], async (url, requests) => {
        await run(url);
        assert.equal(requests.length, 3);
    }));

testAsync('auth/créditos/recusa/conteúdo vazio não retentam nem ecoam chave', async () => {
    const key = 'segredo-fixture';
    for (const [status, response, kind] of [
        [401, JSON.stringify({ error: { message: key } }), 'auth'], [402, '{}', 'credits'],
        [400, '{}', 'badRequest'], [200, body({ choices: [{ finish_reason: 'length', message: { content: '' } }] }), 'unknown'],
        [200, '{', 'unknown'],
    ])
        await withServer(() => [status, response], async (url, requests) => {
            const e = await rejection(run(url, { apiKey: key }));
            assert.equal(e instanceof TranscribeError, true);
            assert.equal(e.kind, kind);
            assert.equal(requests.length, 1);
            assert.equal(`${e.message}${e.stack}${JSON.stringify(e)}`.includes(key), false);
        });
});

testAsync('timeout não retenta requisição possivelmente paga', () =>
    withServer(() => null, async (url, requests) => {
        const e = await rejection(run(url, { timeoutSec: 1 }));
        assert.equal(e.kind, 'network');
        assert.equal(requests.length, 1);
    }), 10000);

testAsync('transcrição vazia rejeita empty sem rede', () =>
    withServer(() => [200, body()], async (url, requests) => {
        const e = await rejection(run(url, { transcript: { words: [], text: '  ' } }));
        assert.equal(e.kind, 'empty');
        assert.equal(requests.length, 0);
    }));

test('estimativa por caracteres e modelo; texto sem palavras é suportado', () => {
    const t = { words: [], text: 'a'.repeat(3000) };
    const cost = S.estimateSummaryCostUsd(t, DEFAULT_SUMMARY_MODEL);
    assert.equal(Math.abs(cost - 0.0215) < 0.001, true);
    assert.equal(S.estimateSummaryCostUsd(t, 'outro/modelo'), null);
    assert.equal(S.summaryInput(t).includes(t.text), true);
});

testAsync('modelos alternativos não herdam preço Sonnet e modelo solicitado chega à API', async () => {
    for (const model of ['outro/modelo', DEFAULT_SUMMARY_MODEL])
        await withServer(() => [200, body({ model: 'outro/modelo', usage: { prompt_tokens: 1000, completion_tokens: 200 } })],
            async (url, requests) => {
                const summary = await run(url, { model });
                assert.equal(summary.cost_usd, null);
                assert.equal(requests[0].body.model, model);
            });
});

testAsync('length preserva texto parcial e sinaliza truncamento', () =>
    withServer(() => [200, body({ choices: [{ finish_reason: 'length', message: { content: 'Texto parcial' } }] })],
        async url => {
            const summary = await run(url);
            assert.equal(summary.text, 'Texto parcial');
            assert.equal(summary.truncated, true);
        }));

test('sem locutor não atribui fala à pessoa 1', () => {
    assert.equal(S.summaryInput({ words: [], text: 'Fala sem diarização' }).includes('Trecho · 00:00\nFala sem diarização'), true);
    assert.equal(S.summaryInput({ words: [], text: 'Fala' }).includes('Locutor 1'), false);
});

testAsync('502/503/504 retentam até sucesso, sem extrapolar três chamadas', async () => {
    for (const status of [502, 503, 504])
        await withServer(n => n < 3 ? [status, '{}'] : [200, body()], async (url, requests) => {
            const summary = await run(url);
            assert.equal(summary.text, '## Resumo\n\nDecidimos testar.');
            assert.equal(requests.length, 3);
        });
});

testAsync('conexão recusada não agenda retentativa de requisição paga', async () => {
    const server = new Soup.Server();
    server.listen_local(0, Soup.ServerListenOptions.IPV4_ONLY);
    const port = server.get_uris()[0].get_port();
    server.disconnect();
    let timers = 0;
    const timeout = GLib.timeout_add;
    GLib.timeout_add = (...args) => { timers++; return timeout(...args); };
    try {
        const error = await rejection(run(`http://127.0.0.1:${port}`));
        assert.equal(error.kind, 'network');
        assert.equal(timers, 0);
    } finally { GLib.timeout_add = timeout; }
});

finish();
