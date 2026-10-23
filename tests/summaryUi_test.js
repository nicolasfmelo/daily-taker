const { test, assert, finish } = imports.harness;
const U = imports.summaryUi;
const { DEFAULT_SUMMARY_MODEL } = imports.summarizer;
const { TranscribeError } = imports.transcriber;
const t = { words: [], text: 'Texto da fixture', duration: NaN };
test('confirma custo textual sem depender da duração, privacidade e substituição', () => {
    const message = U.summaryConfirmMessage(t, DEFAULT_SUMMARY_MODEL, { regenerate: true });
    assert.equal(message.body.includes('US$'), true);
    assert.equal(message.body.includes('O texto da transcrição será enviado ao OpenRouter.'), true);
    assert.equal(message.body.includes('O resumo atual será substituído.'), true);
    assert.equal(message.body.includes('NaN'), false);
    const unknown = U.summaryConfirmMessage(t, 'outro/modelo', {});
    assert.equal(unknown.body.includes('Custo estimado indisponível para o modelo outro/modelo.'), true);
    assert.equal(unknown.body.includes('O texto da transcrição será enviado ao OpenRouter.'), true);
    const huge = U.summaryConfirmMessage({ words: [], text: 'x'.repeat(3000000) }, DEFAULT_SUMMARY_MODEL, {});
    assert.equal(huge.body.includes('US$'), true);
});
test('retry pago só salva; gravação ausente não retenta', () => {
    const e = new TranscribeError('saveFailed');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: true }), 'save');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: false }), 'summarize');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: true, recordingExists: false }), null);
    assert.equal(U.summaryRetryPlan(new TranscribeError('recordingGone'), { hasUnsaved: true }), null);
    assert.equal(U.summaryFailureMessage(e, 'save').includes('sem nova cobrança'), true);
});
finish();
