const { test, assert, finish } = imports.harness;
const T = imports.transcript;

const W = (word, speaker, start, end, type) => ({ word, speaker, start, end, type: type || 'word' });

const makeTranscript = (words, extra) => Object.assign({
    version: 1,
    title: 'Daily',
    recorded_at: '2026-10-22T09:00:00-03:00',
    transcribed_at: '2026-10-22T09:05:00-03:00',
    duration: 3,
    language: 'por',
    model: 'elevenlabs/scribe-v2',
    cost_usd: 0.01,
    text: '',
    speakers: {},
    words,
}, extra);

const baseWords = () => [
    W('Oi', 0, 0, 0.4),
    W('tudo', 0, 0.5, 0.9),
    W('bem?', 1, 1.2, 1.6),
    W('sim', 0, 2, 2.3),
];

test('buildBlocks agrupa palavras de locutores consecutivos', () => {
    const blocks = T.buildBlocks(makeTranscript(baseWords()));
    assert.equal(blocks.length, 3);
    assert.deepEqual(blocks[0], { speaker: 0, label: 'Locutor 1', start: 0, end: 0.9, text: 'Oi tudo' });
    assert.equal(blocks[1].label, 'Locutor 2');
    assert.equal(blocks[1].text, 'bem?');
    assert.equal(blocks[2].label, 'Locutor 1');
    assert.equal(blocks[2].text, 'sim');
});

test('renameSpeaker troca o rótulo sem mutar o original', () => {
    const t = makeTranscript(baseWords());
    const renamed = T.renameSpeaker(t, 1, 'Ana');
    assert.equal(T.buildBlocks(renamed)[1].label, 'Ana');
    assert.equal(renamed.speakers['1'], 'Ana');
    assert.deepEqual(t.speakers, {});
    assert.equal(T.buildBlocks(t)[1].label, 'Locutor 2');
});

test('renameSpeaker com nome vazio remove a chave', () => {
    const t = T.renameSpeaker(makeTranscript(baseWords()), 1, 'Ana');
    const reverted = T.renameSpeaker(t, 1, '  ');
    assert.deepEqual(reverted.speakers, {});
    assert.equal(T.buildBlocks(reverted)[1].label, 'Locutor 2');
    assert.equal(t.speakers['1'], 'Ana');
});

test('palavras sem locutor geram blocos com label vazio, nunca "undefined"', () => {
    const words = [
        { word: 'Oi', start: 0, end: 0.4, type: 'word' },
        W('tudo', null, 0.5, 0.9),
    ];
    const blocks = T.buildBlocks(makeTranscript(words));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].speaker, null);
    assert.equal(blocks[0].label, '');
    assert.equal(blocks[0].text, 'Oi tudo');
    assert.equal(JSON.stringify(blocks).includes('undefined'), false);
});

test('words vazio com text gera um único bloco de texto corrido', () => {
    const t = makeTranscript([], { text: 'só texto', duration: 12.5 });
    assert.deepEqual(T.buildBlocks(t), [
        { speaker: null, label: '', start: 0, end: 12.5, text: 'só texto' },
    ]);
});

test('words vazio e text vazio não geram blocos', () => {
    assert.deepEqual(T.buildBlocks(makeTranscript([])), []);
});

test('audio_event aparece no texto na ordem', () => {
    const words = [
        W('Oi', 0, 0, 0.4),
        W('(risos)', 0, 0.5, 0.9, 'audio_event'),
        W('tudo', 0, 1, 1.4),
    ];
    const blocks = T.buildBlocks(makeTranscript(words));
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].text, 'Oi (risos) tudo');
});

test('blockIndexAt devolve o bloco do tempo e -1 fora do intervalo', () => {
    const blocks = T.buildBlocks(makeTranscript(baseWords()));
    assert.equal(T.blockIndexAt(blocks, 0), 0);
    assert.equal(T.blockIndexAt(blocks, 0.7), 0);
    assert.equal(T.blockIndexAt(blocks, 1.3), 1);
    assert.equal(T.blockIndexAt(blocks, 2.1), 2);
    assert.equal(T.blockIndexAt(blocks, 2.3), 2);
    assert.equal(T.blockIndexAt(blocks, 2.4), -1);
    assert.equal(T.blockIndexAt([], 1), -1);
    assert.equal(T.blockIndexAt(blocks, -0.1), -1);
});

test('blockIndexAt mantém o bloco anterior durante pausas', () => {
    const blocks = T.buildBlocks(makeTranscript(baseWords()));
    assert.equal(T.blockIndexAt(blocks, 1.0), 0);
});

test('wordIndexAt devolve a palavra do tempo e -1 fora do intervalo', () => {
    const words = baseWords();
    assert.equal(T.wordIndexAt(words, 0), 0);
    assert.equal(T.wordIndexAt(words, 0.55), 1);
    assert.equal(T.wordIndexAt(words, 1.0), 1);
    assert.equal(T.wordIndexAt(words, 1.3), 2);
    assert.equal(T.wordIndexAt(words, 2.3), 3);
    assert.equal(T.wordIndexAt(words, 2.31), -1);
    assert.equal(T.wordIndexAt(words, -1), -1);
    assert.equal(T.wordIndexAt([], 1), -1);
});

test('stringify/parse fazem ida e volta', () => {
    const t = T.renameSpeaker(makeTranscript(baseWords(), { text: 'Oi tudo bem? sim' }), 0, 'Nicolas');
    assert.deepEqual(T.parseTranscript(T.stringifyTranscript(t)), t);
});

test('parseTranscript rejeita entradas inválidas', () => {
    assert.throws(() => T.parseTranscript('{'));
    assert.throws(() => T.parseTranscript(JSON.stringify(makeTranscript([], { version: 2 }))));
    assert.throws(() => T.parseTranscript(JSON.stringify(makeTranscript('x'))));
    assert.throws(() => T.parseTranscript('null'));
});

// Formato real da resposta do OpenRouter (spike): sem `type`, com confidence e speaker_label.
const realResponse = (diarized) => ({
    text: 'Bom dia. Tudo bem?',
    language: 'por',
    duration: 3.2,
    usage: { seconds: 3.2, cost: 0.000213 },
    segments: [],
    words: [
        { word: 'Bom', start: 0.02, end: 0.26, speaker: 0, confidence: 0.99, speaker_label: 'speaker_0' },
        { word: 'dia.', start: 0.3, end: 0.7, speaker: 0, confidence: 0.98, speaker_label: 'speaker_0' },
        { word: 'Tudo', start: 1.1, end: 1.4, speaker: 1, confidence: 0.97, speaker_label: 'speaker_1' },
        { word: 'bem?', start: 1.5, end: 1.9, speaker: 1, confidence: 0.96, speaker_label: 'speaker_1' },
    ].map(w => {
        if (diarized)
            return w;
        const { speaker, speaker_label, ...rest } = w;
        return rest;
    }),
});

test('createTranscript copia só os campos de Word e normaliza type/speaker', () => {
    const t = T.createTranscript({
        apiResponse: realResponse(true),
        title: 'Daily 22/10',
        recordedAt: '2026-10-22T09:00:00-03:00',
        transcribedAt: '2026-10-22T09:05:00-03:00',
    });
    assert.equal(t.version, 1);
    assert.equal(t.title, 'Daily 22/10');
    assert.equal(t.recorded_at, '2026-10-22T09:00:00-03:00');
    assert.equal(t.transcribed_at, '2026-10-22T09:05:00-03:00');
    assert.equal(t.duration, 3.2);
    assert.equal(t.language, 'por');
    assert.equal(t.model, 'elevenlabs/scribe-v2');
    assert.equal(t.cost_usd, 0.000213);
    assert.equal(t.text, 'Bom dia. Tudo bem?');
    assert.deepEqual(t.speakers, {});
    assert.deepEqual(t.words[0], { word: 'Bom', start: 0.02, end: 0.26, speaker: 0, type: 'word' });
    assert.deepEqual(Object.keys(t.words[2]).sort(), ['end', 'speaker', 'start', 'type', 'word']);
    const blocks = T.buildBlocks(t);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].label, 'Locutor 1');
    assert.equal(blocks[0].text, 'Bom dia.');
    assert.equal(blocks[1].label, 'Locutor 2');
});

test('createTranscript sem diarização usa speaker null e label vazio', () => {
    const t = T.createTranscript({
        apiResponse: realResponse(false),
        title: 'Sem locutores',
        recordedAt: '2026-10-22T09:00:00-03:00',
        transcribedAt: '2026-10-22T09:05:00-03:00',
    });
    assert.equal(t.words.every(w => w.speaker === null && w.type === 'word'), true);
    const blocks = T.buildBlocks(t);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].label, '');
    assert.equal(blocks[0].text, 'Bom dia. Tudo bem?');
    assert.equal(JSON.stringify(blocks).includes('undefined'), false);
});

test('createTranscript preserva type audio_event e tolera resposta mínima', () => {
    const t = T.createTranscript({
        apiResponse: {
            text: '(risos)',
            words: [{ word: '(risos)', start: 0, end: 1, type: 'audio_event' }],
        },
        title: 'x',
        recordedAt: 'a',
        transcribedAt: 'b',
    });
    assert.equal(t.words[0].type, 'audio_event');
    assert.equal(t.cost_usd, 0);
    assert.equal(t.language, '');
    assert.equal(t.duration, 1);
});

const summary = text => ({ text, model: 'm', generated_at: '2026-10-22T12:00:00Z', cost_usd: 0.02 });

test('substituir resumo arquiva sem mutar e limita às vinte versões recentes', () => {
    const original = makeTranscript([]);
    const a = T.withSummary(original, summary('0'));
    const b = T.withSummary(a, summary('1'));
    const c = T.withSummary(b, summary('2'));
    assert.equal(original.summary, undefined);
    assert.deepEqual(T.getSummaryHistory(a), []);
    assert.deepEqual(T.getSummaryHistory(c).map(s => s.text), ['1', '0']);
    let t = original;
    for (let i = 0; i <= 25; i++)
        t = T.withSummary(t, summary(String(i)));
    assert.equal(T.getSummary(t).text, '25');
    assert.deepEqual(T.getSummaryHistory(t).map(s => s.text),
        Array.from({ length: 20 }, (_, i) => String(24 - i)));
});

test('restaurar troca versão sem perda; limpar mantém histórico; índices inválidos são inertes', () => {
    const t = { ...makeTranscript([]), summary: summary('C'), summary_history: [summary('B'), summary('A')] };
    const restored = T.restoreSummary(t, { index: 1, generated_at: summary('A').generated_at });
    assert.equal(T.getSummary(restored).text, 'A');
    assert.deepEqual(T.getSummaryHistory(restored).map(s => s.text), ['C', 'B']);
    assert.equal(T.getSummary(t).text, 'C');
    for (const index of [-1, 2, 0.5, NaN, '0'])
        assert.equal(T.restoreSummary(t, { index, generated_at: summary('A').generated_at }), t);
    const cleared = T.clearSummary(t);
    assert.equal(T.getSummary(cleared), null);
    assert.deepEqual(T.getSummaryHistory(cleared), t.summary_history);
    assert.equal(T.getSummary(T.restoreSummary(cleared, { index: 0, generated_at: summary('B').generated_at })).text, 'B');
});

test('leitores de resumo ignoram lixo e texto vazio', () => {
    for (const value of [undefined, null, {}, { text: '' }, { text: '  ' }, { text: 5 }])
        assert.equal(T.getSummary({ summary: value }), null);
    assert.equal(T.getSummary(null), null);
    assert.deepEqual(T.getSummaryHistory({ summary_history: {} }), []);
    assert.deepEqual(T.getSummaryHistory({ summary_history: [null, {}, summary('válido')] }), [summary('válido')]);
});

test('restaurar exige índice e timestamp: duplicados, removida e legado', () => {
    const t = { ...makeTranscript([]), summary: summary('C'), summary_history: [summary('B'), summary('A')] };
    const ref = { index: 1, generated_at: summary('A').generated_at };
    assert.equal(T.restoreSummary(t, ref).summary.text, 'A');
    assert.equal(T.restoreSummary(t, { index: 1, generated_at: 'mudou' }), t);
    const removed = { ...t, summary_history: [summary('B')] };
    assert.equal(T.restoreSummary(removed, ref), removed);
    const legacy = { ...t, summary_history: [{ text: 'Legado' }] };
    assert.equal(T.restoreSummary(legacy, { index: 0, generated_at: '' }).summary.text, 'Legado');
});

finish();
