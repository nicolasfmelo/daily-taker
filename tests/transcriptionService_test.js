const { test, testAsync, assert, finish } = imports.harness;
const { TranscribeError } = imports.transcriber;
const { TranscriptionService } = imports.transcriptionService;

const KEY = 'sk-test-secret-key-123';
const NOW = new Date('2026-10-22T12:00:00.000Z');
const RESPONSE = { text: 'oi', language: 'por', duration: 3, words: [] };

const fakeFile = uri => ({ get_uri: () => uri });

// Promessa que o teste resolve/rejeita manualmente.
const deferred = () => {
    const d = {};
    d.promise = new Promise((resolve, reject) => {
        d.resolve = resolve;
        d.reject = reject;
    });
    return d;
};

const rejection = async p => {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('esperava rejeição');
};

const setup = (overrides = {}) => {
    const calls = { transcribe: [], save: [] };
    const service = new TranscriptionService({
        getKey: () => ({ key: KEY, source: 'file' }),
        transcribe: opts => {
            calls.transcribe.push(opts);
            return Promise.resolve(RESPONSE);
        },
        save: (file, t) => calls.save.push({ file, t }),
        language: () => 'pt',
        now: () => NOW,
        ...overrides,
    });
    return { service, calls };
};

const args = (file, extra = {}) => ({ file, title: 'Reunião', recordedAt: '2026-10-22T10:00:00.000Z', ...extra });

testAsync('sem chave: rejeita noKey sem chamar transcribe nem save', async () => {
    const { service, calls } = setup({ getKey: () => null });
    const file = fakeFile('file:///a.ogg');
    const e = await rejection(service.run(args(file)));
    assert.equal(e instanceof TranscribeError, true);
    assert.equal(e.kind, 'noKey');
    assert.equal(e.message, 'Configure a chave da API do OpenRouter nas Preferências.');
    assert.equal(calls.transcribe.length, 0);
    assert.equal(calls.save.length, 0);
    assert.equal(service.status(file), 'error');
});

testAsync('sucesso: transcribe recebe chave, arquivo e idioma; save recebe o transcript', async () => {
    const { service, calls } = setup();
    const file = fakeFile('file:///a.ogg');
    const t = await service.run(args(file));
    assert.equal(calls.transcribe.length, 1);
    assert.equal(calls.transcribe[0].apiKey, KEY);
    assert.equal(calls.transcribe[0].file, file);
    assert.equal(calls.transcribe[0].language, 'pt');
    assert.equal(calls.save.length, 1);
    assert.equal(calls.save[0].file, file);
    assert.equal(calls.save[0].t, t);
    assert.equal(t.recorded_at, '2026-10-22T10:00:00.000Z');
    assert.equal(t.transcribed_at, NOW.toISOString());
    assert.equal(t.title, 'Reunião');
    assert.equal(t.text, 'oi');
    assert.equal(service.status(file), 'none');
});

testAsync('falha: status error, save não chamado, TranscribeError propaga igual', async () => {
    const original = new TranscribeError('auth', 401);
    const { service, calls } = setup({ transcribe: () => Promise.reject(original) });
    const file = fakeFile('file:///a.ogg');
    const e = await rejection(service.run(args(file)));
    assert.equal(e, original);
    assert.equal(calls.save.length, 0);
    assert.equal(service.status(file), 'error');
});

testAsync('falha que não é TranscribeError vira unknown em pt-BR, sem vazar a chave', async () => {
    const { service, calls } = setup({ transcribe: () => Promise.reject(new Error(`boom ${KEY}`)) });
    const file = fakeFile('file:///a.ogg');
    const e = await rejection(service.run(args(file)));
    assert.equal(e instanceof TranscribeError, true);
    assert.equal(e.kind, 'unknown');
    assert.equal(e.message, 'Erro inesperado ao transcrever.');
    assert.equal(e.message.includes(KEY), false);
    assert.equal(String(e.stack).includes(KEY), false);
    assert.equal(calls.save.length, 0);
    assert.equal(service.status(file), 'error');
});

testAsync('falha ao salvar também vira erro e não deixa a execução presa', async () => {
    let fail = true;
    const { service } = setup({
        save: () => {
            if (fail)
                throw new Error('disco cheio');
        },
    });
    const file = fakeFile('file:///a.ogg');
    const e = await rejection(service.run(args(file)));
    assert.equal(e.kind, 'unknown');
    assert.equal(service.status(file), 'error');
    fail = false;
    await service.run(args(file));
    assert.equal(service.status(file), 'none');
});

testAsync('status: running durante a execução, none depois do sucesso', async () => {
    const d = deferred();
    const { service } = setup({ transcribe: () => d.promise });
    const file = fakeFile('file:///a.ogg');
    assert.equal(service.status(file), 'none');
    const p = service.run(args(file));
    assert.equal(service.status(file), 'running');
    d.resolve(RESPONSE);
    await p;
    assert.equal(service.status(file), 'none');
});

testAsync('erro persiste até a próxima execução começar', async () => {
    let n = 0;
    const d = deferred();
    const { service } = setup({
        transcribe: () => ++n === 1 ? Promise.reject(new TranscribeError('rate', 429)) : d.promise,
    });
    const file = fakeFile('file:///a.ogg');
    await rejection(service.run(args(file)));
    assert.equal(service.status(file), 'error');
    const p = service.run(args(file));
    assert.equal(service.status(file), 'running');
    d.resolve(RESPONSE);
    await p;
    assert.equal(service.status(file), 'none');
});

testAsync('duas execuções simultâneas do mesmo arquivo chamam transcribe uma vez', async () => {
    const d = deferred();
    const { service, calls } = setup({
        transcribe: opts => {
            calls.transcribe.push(opts);
            return d.promise;
        },
    });
    const file = fakeFile('file:///a.ogg');
    const p1 = service.run(args(file));
    const p2 = service.run(args(file));
    d.resolve(RESPONSE);
    const [t1, t2] = await Promise.all([p1, p2]);
    assert.equal(calls.transcribe.length, 1);
    assert.equal(calls.save.length, 1);
    assert.equal(t1, t2);
});

testAsync('execuções simultâneas compartilham o mesmo erro', async () => {
    const d = deferred();
    const { service, calls } = setup({
        transcribe: opts => {
            calls.transcribe.push(opts);
            return d.promise;
        },
    });
    const file = fakeFile('file:///a.ogg');
    const p1 = service.run(args(file));
    const p2 = service.run(args(file));
    const err = new TranscribeError('upstream', 503);
    d.reject(err);
    const [e1, e2] = await Promise.all([rejection(p1), rejection(p2)]);
    assert.equal(calls.transcribe.length, 1);
    assert.equal(e1, err);
    assert.equal(e2, err);
});

testAsync('arquivos com a mesma URI compartilham a execução, mesmo em objetos distintos', async () => {
    const d = deferred();
    const { service, calls } = setup({
        transcribe: opts => {
            calls.transcribe.push(opts);
            return d.promise;
        },
    });
    const p1 = service.run(args(fakeFile('file:///a.ogg')));
    const p2 = service.run(args(fakeFile('file:///a.ogg')));
    d.resolve(RESPONSE);
    await Promise.all([p1, p2]);
    assert.equal(calls.transcribe.length, 1);
});

testAsync('depois de terminar, nova execução roda de novo (regenerar)', async () => {
    const { service, calls } = setup();
    const file = fakeFile('file:///a.ogg');
    await service.run(args(file));
    await service.run(args(file));
    assert.equal(calls.transcribe.length, 2);
    assert.equal(calls.save.length, 2);
});

testAsync('arquivos diferentes são independentes', async () => {
    const d1 = deferred();
    const d2 = deferred();
    const queue = [d1, d2];
    const { service, calls } = setup({
        transcribe: opts => {
            calls.transcribe.push(opts);
            return queue.shift().promise;
        },
    });
    const a = fakeFile('file:///a.ogg');
    const b = fakeFile('file:///b.ogg');
    const pa = service.run(args(a));
    const pb = service.run(args(b));
    assert.equal(calls.transcribe.length, 2);
    assert.equal(service.status(a), 'running');
    assert.equal(service.status(b), 'running');
    d1.reject(new TranscribeError('auth', 401));
    await rejection(pa);
    assert.equal(service.status(a), 'error');
    assert.equal(service.status(b), 'running');
    d2.resolve(RESPONSE);
    await pb;
    assert.equal(service.status(b), 'none');
    assert.equal(service.status(a), 'error');
});

testAsync('connectChange: running e depois none no sucesso', async () => {
    const { service } = setup();
    const events = [];
    service.connectChange((uri, status) => events.push([uri, status]));
    await service.run(args(fakeFile('file:///a.ogg')));
    assert.deepEqual(events, [['file:///a.ogg', 'running'], ['file:///a.ogg', 'none']]);
});

testAsync('connectChange: running e depois error na falha', async () => {
    const { service } = setup({ transcribe: () => Promise.reject(new TranscribeError('credits', 402)) });
    const events = [];
    service.connectChange((uri, status) => events.push([uri, status]));
    await rejection(service.run(args(fakeFile('file:///a.ogg'))));
    assert.deepEqual(events, [['file:///a.ogg', 'running'], ['file:///a.ogg', 'error']]);
});

testAsync('connectChange: execução deduplicada notifica uma vez só', async () => {
    const d = deferred();
    const { service } = setup({ transcribe: () => d.promise });
    const events = [];
    service.connectChange((uri, status) => events.push(status));
    const file = fakeFile('file:///a.ogg');
    const p1 = service.run(args(file));
    const p2 = service.run(args(file));
    d.resolve(RESPONSE);
    await Promise.all([p1, p2]);
    assert.deepEqual(events, ['running', 'none']);
});

testAsync('connectChange: listener que lança não quebra a execução nem os outros listeners', async () => {
    const { service, calls } = setup();
    const events = [];
    service.connectChange(() => {
        throw new Error('listener ruim');
    });
    service.connectChange((uri, status) => events.push(status));
    // O serviço registra a falha do listener com logError; silencia aqui para a saída ficar limpa.
    const realLogError = globalThis.logError;
    const logged = [];
    globalThis.logError = e => logged.push(e);
    let t;
    try {
        t = await service.run(args(fakeFile('file:///a.ogg')));
    } finally {
        globalThis.logError = realLogError;
    }
    assert.equal(t.text, 'oi');
    assert.equal(calls.save.length, 1);
    assert.deepEqual(events, ['running', 'none']);
    assert.equal(logged.length, 2);
});

test('construtor não exige GTK: módulo carrega em gjs puro', () => {
    assert.equal(typeof TranscriptionService, 'function');
});

finish();
