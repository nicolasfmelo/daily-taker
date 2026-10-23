const { test, assert, finish } = imports.harness;
const U = imports.summaryUi;
const { DEFAULT_SUMMARY_MODEL } = imports.modelDefaults;
const { TranscribeError } = imports.transcriber;
const t = { words: [], text: 'Texto da fixture', duration: NaN };

test('confirma teto de custo, privacidade e arquivamento com texto exato', () => {
    assert.deepEqual(U.summaryConfirmMessage(t, DEFAULT_SUMMARY_MODEL, { regenerate: true }), {
        heading: 'Gerar resumo com anthropic/claude-sonnet-5.5?',
        body: 'Custo estimado: até US$ 0,02. O texto da transcrição será enviado ao OpenRouter. O resumo atual irá para o histórico.',
    });
    assert.deepEqual(U.summaryConfirmMessage(t, 'outro/modelo'), {
        heading: 'Gerar resumo com outro/modelo?',
        body: 'Custo estimado indisponível para o modelo outro/modelo. O texto da transcrição será enviado ao OpenRouter.',
    });
});

test('retry pago só salva; transcrição ilegível oferece descarte, gravação ausente não retenta', () => {
    const e = new TranscribeError('saveFailed', 0, 'O resumo foi gerado, mas não foi possível salvá-lo no disco.');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: true }), 'save');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: false }), 'summarize');
    assert.equal(U.summaryRetryPlan(e, { hasUnsaved: true, recordingExists: false }), null);
    assert.equal(U.summaryRetryPlan(new TranscribeError('recordingGone'), { hasUnsaved: true }), null);
    assert.equal(U.summaryRetryPlan(new TranscribeError('transcriptUnavailable'), { hasUnsaved: true }), 'discard');
    assert.equal(U.summaryFailureMessage(e, 'save'),
        'O resumo foi gerado, mas não foi possível salvá-lo no disco. Tentar de novo só salva, sem nova cobrança.');
    assert.equal(U.summaryFailureMessage(new TranscribeError('recordingGone'), null),
        'A gravação foi excluída antes de o resumo terminar.');
});

test('transcrição ausente, vazia ou curta é recusada antes da confirmação', () => {
    assert.equal(U.summaryInputProblem(null), 'Gere a transcrição primeiro.');
    for (const text of ['', '   ', 'x'.repeat(19)])
        assert.equal(U.summaryInputProblem({ words: [], text }),
            'A transcrição está vazia ou é curta demais para gerar um resumo.');
    assert.equal(U.summaryInputProblem({ words: [], text: 'x'.repeat(20) }), null);
    assert.equal(U.summaryInputProblem({ words: [{ word: 'x'.repeat(20), speaker: null, start: 0, end: 1 }] }), null);
});
finish();
