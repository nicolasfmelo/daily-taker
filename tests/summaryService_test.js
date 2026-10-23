const { testAsync, assert, finish } = imports.harness;
const { TranscribeError } = imports.transcriber;
const { SummaryService } = imports.summaryService;
const file = { get_uri: () => 'file:///fixture' };
const summary = { text: 'Resumo', model: 'm', cost_usd: 0.02, generated_at: '2026-10-22T12:00:00Z' };
const reject = async p => { try { await p; } catch (e) { return e; } throw new Error('esperava rejeição'); };
const setup = (extra = {}) => {
    const calls = { api: 0, save: 0 };
    const service = new SummaryService({
        getKey: () => ({ key: 'fixture' }), getModel: () => 'm', now: () => new Date(),
        summarize: async () => { calls.api++; return summary; },
        save: () => { calls.save++; }, ...extra,
    });
    return { service, calls };
};

testAsync('sem chave não envia; falha não salva; estados finais definidos', async () => {
    const { service, calls } = setup({ getKey: () => null });
    assert.equal((await reject(service.run({ file, transcript: {} }))).kind, 'noKey');
    assert.equal(calls.api, 0);
    assert.equal(calls.save, 0);
    assert.equal(service.status(file), 'error');
    const failed = setup({ summarize: async () => { throw new TranscribeError('network'); } });
    assert.equal((await reject(failed.service.run({ file, transcript: {} }))).kind, 'network');
    assert.equal(failed.calls.save, 0);
});

testAsync('duplo clique compartilha promessa e uma cobrança; listeners isolados', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    let count = 0;
    const events = [];
    const saved = [];
    const { service } = setup({ summarize: () => { count++; return pending; }, save: (_f, s) => saved.push(s) });
    const log = globalThis.logError;
    globalThis.logError = () => {};
    try {
        service.connectChange(() => { throw new Error('listener'); });
        service.connectChange((uri, state) => events.push([uri, state]));
        const a = service.run({ file, transcript: {} });
        const b = service.run({ file, transcript: {} });
        assert.equal(a, b);
        assert.equal(service.status(file), 'running');
        release(summary);
        assert.equal(await a, summary);
        assert.equal(await b, summary);
        assert.equal(count, 1);
        assert.deepEqual(saved, [summary]);
        assert.deepEqual(events, [['file:///fixture', 'running'], ['file:///fixture', 'none']]);
    } finally { globalThis.logError = log; }
});

testAsync('resumo pago retido: retrySave e run subsequente não cobram outra vez', async () => {
    let fail = true;
    let calls = 0;
    let saved;
    const { service } = setup({
        summarize: async () => { calls++; return summary; },
        save: (_f, s) => { if (fail) throw new Error('disco cheio'); saved = s; },
    });
    const log = globalThis.logError;
    globalThis.logError = () => {};
    try {
        assert.equal((await reject(service.run({ file, transcript: {} }))).kind, 'saveFailed');
        assert.equal(service.hasUnsaved(file), true);
        assert.equal(service.status(file), 'error');
        await reject(service.retrySave(file));
        assert.equal(service.hasUnsaved(file), true);
        fail = false;
        assert.equal(await service.run({ file, transcript: {} }), summary);
        assert.equal(saved, summary);
        assert.equal(calls, 1);
        assert.equal(service.hasUnsaved(file), false);
        assert.equal(service.status(file), 'none');
    } finally { globalThis.logError = log; }
});

testAsync('erro inesperado é sanitizado também no log', async () => {
    const secret = 'segredo-teste';
    const { service } = setup({ summarize: async () => { throw new Error(secret); } });
    const logged = [];
    const log = globalThis.logError;
    globalThis.logError = e => logged.push(String(e));
    try {
        const e = await reject(service.run({ file, transcript: {} }));
        assert.equal(e.kind, 'unknown');
        assert.equal(`${e}${e.stack}${logged.join()}`.includes(secret), false);
        assert.equal(logged.length, 1);
    } finally { globalThis.logError = log; }
});
finish();
