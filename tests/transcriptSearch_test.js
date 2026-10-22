const { test, assert, finish } = imports.harness;
const S = imports.transcriptSearch;

const W = (word, speaker, start, end) => ({ word, speaker, start, end, type: 'word' });

const makeTranscript = (extra) => Object.assign({
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
    words: [],
}, extra);

const entry = (extra) => ({ recordingFile: null, transcript: makeTranscript(extra) });

const titles = (entries) => entries.map(e => e.transcript.title);
const q = (query, from, to) => ({ query, from: from ?? null, to: to ?? null });

test('normalize passa para minúsculas e remove diacríticos', () => {
    assert.equal(S.normalize('Reunião Orçamento ÁÉÍÓÚ çÇ'), 'reuniao orcamento aeiou cc');
});

test('"reuniao" acha o título "Reunião semanal"', () => {
    const entries = [entry({ title: 'Reunião semanal' }), entry({ title: 'Outra' })];
    assert.deepEqual(titles(S.filterTranscripts(entries, q('reuniao'))), ['Reunião semanal']);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('REUNIÃO'))), ['Reunião semanal']);
});

test('"ANA" acha locutor renomeado "Ana"', () => {
    const entries = [
        entry({ title: 'A', speakers: { 1: 'Ana' }, words: [W('oi', 0, 0, 1), W('tchau', 1, 1, 2)] }),
        entry({ title: 'B', words: [W('oi', 0, 0, 1)] }),
    ];
    assert.deepEqual(titles(S.filterTranscripts(entries, q('ANA'))), ['A']);
});

test('rótulo padrão "Locutor 2" também é pesquisável', () => {
    const entries = [
        entry({ title: 'A', words: [W('oi', 0, 0, 1), W('tchau', 1, 1, 2)] }),
        entry({ title: 'B', words: [W('oi', 0, 0, 1)] }),
    ];
    assert.deepEqual(titles(S.filterTranscripts(entries, q('locutor 2'))), ['A']);
});

test('"orçamento aprovado" exige os dois termos, mesmo separados', () => {
    const entries = [
        entry({ title: 'ambos', words: [W('o', 0, 0, 1), W('orçamento', 0, 1, 2), W('foi', 0, 2, 3), W('aprovado', 0, 3, 4)] }),
        entry({ title: 'só um', words: [W('orçamento', 0, 0, 1), W('negado', 0, 1, 2)] }),
        entry({ title: 'só outro', text: 'projeto aprovado' }),
        entry({ title: 'título com orçamento', text: 'tudo aprovado' }),
    ];
    assert.deepEqual(titles(S.filterTranscripts(entries, q('orçamento aprovado'))), ['ambos', 'título com orçamento']);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('  ORCAMENTO   aprovado '))), ['ambos', 'título com orçamento']);
});

test('sem words, busca em text', () => {
    const entries = [entry({ title: 'A', text: 'falamos do cronograma' })];
    assert.equal(S.filterTranscripts(entries, q('cronograma')).length, 1);
    assert.equal(S.filterTranscripts(entries, q('inexistente')).length, 0);
});

test('consulta vazia ou em branco sem datas devolve tudo na mesma ordem', () => {
    const entries = [entry({ title: 'C' }), entry({ title: 'A' }), entry({ title: 'B' })];
    assert.deepEqual(titles(S.filterTranscripts(entries, q(''))), ['C', 'A', 'B']);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('   '))), ['C', 'A', 'B']);
});

test('ordem é preservada no resultado filtrado', () => {
    const entries = [entry({ title: 'z foo' }), entry({ title: 'bar' }), entry({ title: 'a foo' })];
    assert.deepEqual(titles(S.filterTranscripts(entries, q('foo'))), ['z foo', 'a foo']);
});

test('from/to filtram por recorded_at em horário local', () => {
    const entries = [
        entry({ title: '21', recorded_at: '2026-10-21T10:00:00-03:00' }),
        entry({ title: '22', recorded_at: '2026-10-22T09:00:00-03:00' }),
        entry({ title: '23', recorded_at: '2026-10-23T00:00:00-03:00' }),
    ];
    const d22 = new Date(2026, 9, 22);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('', d22, null))), ['22', '23']);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('', null, d22))), ['21', '22']);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('', d22, d22))), ['22']);
});

test('to = 22/10 inclui gravação de 22/10 23:50 local e exclui 23/10 00:00', () => {
    const entries = [
        entry({ title: 'tarde', recorded_at: '2026-10-22T23:50:00-03:00' }),
        entry({ title: 'meia-noite', recorded_at: '2026-10-23T00:00:00-03:00' }),
    ];
    const to = new Date(2026, 9, 22);
    assert.deepEqual(titles(S.filterTranscripts(entries, q('', null, to))), ['tarde']);
});

test('datas combinam com a consulta (AND)', () => {
    const entries = [
        entry({ title: 'reunião', recorded_at: '2026-10-21T10:00:00-03:00' }),
        entry({ title: 'reunião', recorded_at: '2026-10-22T10:00:00-03:00' }),
        entry({ title: 'outra', recorded_at: '2026-10-22T10:00:00-03:00' }),
    ];
    const r = S.filterTranscripts(entries, q('reuniao', new Date(2026, 9, 22), null));
    assert.equal(r.length, 1);
    assert.equal(r[0], entries[1]);
});

test('excerpt corta em 140 e acrescenta … só quando cortou', () => {
    const long = entry({ text: 'a'.repeat(200) }).transcript;
    assert.equal(S.excerpt(long), 'a'.repeat(140) + '…');
    assert.equal(S.excerpt(long, 10), 'a'.repeat(10) + '…');
    const exact = entry({ text: 'b'.repeat(140) }).transcript;
    assert.equal(S.excerpt(exact), 'b'.repeat(140));
    assert.equal(S.excerpt(entry({ text: 'curto' }).transcript), 'curto');
    assert.equal(S.excerpt(entry({}).transcript), '');
});

test('excerpt usa words quando existem e colapsa espaços', () => {
    const t = makeTranscript({ text: 'ignorado', words: [W('Oi', 0, 0, 1), W('tudo', 0, 1, 2)] });
    assert.equal(S.excerpt(t), 'Oi tudo');
    assert.equal(S.excerpt(makeTranscript({ text: 'a  b\n c' })), 'a b c');
});

finish();
