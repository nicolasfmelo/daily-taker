const { testAsync, assert, finish } = imports.harness;
const { TranscribeError } = imports.transcriber;
const { TranscriptionService } = imports.transcriptionService;
const { SummaryService } = imports.summaryService;

for (const Service of [TranscriptionService, SummaryService]) {
    testAsync(`${Service.name}: fechamento detecta qualquer resultado retido até salvar ou descartar todos`, async () => {
        let fail = true;
        let paid = 0;
        const service = new Service({
            getKey: () => ({ key: 'fixture' }), getModel: () => 'fixture/model', language: () => 'pt',
            now: () => new Date('2026-10-23T12:00:00Z'),
            transcribe: async () => { paid++; return { text: 'oi', words: [] }; },
            summarize: async () => { paid++; return { text: 'resumo' }; },
            save: () => { if (fail) throw new TranscribeError('saveFailed'); },
        });
        const files = ['a', 'b'].map(n => ({ get_uri: () => `file:///${n}` }));
        assert.equal(service.hasAnyUnsaved(), false);
        for (const file of files) {
            try { await service.run({ file, transcript: {}, title: 'Teste' }); } catch (e) {
                assert.equal(e.kind, 'saveFailed');
            }
        }
        assert.equal(service.hasRunning(), false);
        assert.equal(service.hasAnyUnsaved(), true);
        service.discardUnsaved(files[0]);
        assert.equal(service.hasAnyUnsaved(), true);
        fail = false;
        await service.retrySave(files[1]);
        assert.equal(service.hasAnyUnsaved(), false);
        assert.equal(paid, 2);
    });
}
finish();
