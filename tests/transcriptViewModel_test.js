const { test, assert, finish } = imports.harness;
const VM = imports.transcriptViewModel;

const W = (word, speaker, start, end) => ({ word, speaker, start, end, type: 'word' });

const makeTranscript = (extra, words) => Object.assign({
    version: 1,
    title: 'Daily 22/10',
    recorded_at: '2026-10-22T14:30:00-03:00',
    transcribed_at: '2026-10-22T14:40:00-03:00',
    duration: 2712.5,
    language: 'por',
    model: 'elevenlabs/scribe-v2',
    cost_usd: 0.01,
    text: '',
    speakers: { 0: 'Ana' },
    words: words || [
        W('Bom', 0, 1, 1.3),
        W('dia', 0, 1.4, 1.7),
        W('oi', 1, 3, 3.2),
        W('pessoal', 0, 5, 5.5),
        W('tchau', 2, 7, 7.5),
    ],
}, extra);

const { Gio, GLib } = imports.gi;
const Store = imports.transcriptStore;

test('exportação relê resumo pago salvo depois da abertura da visão; txt continua só transcrição', () => {
    const root = Gio.File.new_for_path(GLib.Dir.make_tmp('daily-taker-export-test-XXXXXX'));
    const file = root.get_child('fixture');
    try {
        Store.saveTranscript(file, makeTranscript());
        const staleView = Store.loadTranscript(file);
        Store.saveSummary(file, { text: 'Decisão posterior', model: 'fixture',
            generated_at: '2026-10-22T18:00:00Z', cost_usd: 0.02 });
        const md = VM.exportContent(file, 'md');
        assert.equal(staleView.summary, undefined);
        assert.equal(md.includes('## Resumo\n\nDecisão posterior'), true);
        assert.equal(md.indexOf('## Resumo') < md.indexOf('### Ana'), true);
        const txt = VM.exportContent(file, 'txt');
        assert.equal(txt.includes('Decisão posterior'), false);
        assert.equal(txt.includes('Ana · 00:00:01\nBom dia'), true);
        assert.throws(() => VM.exportContent(file, 'pdf'));
        Store.transcriptFileFor(file).delete(null);
        assert.throws(() => VM.exportContent(file, 'md'));
    } finally {
        if (Store.transcriptFileFor(file).query_exists(null))
            Store.transcriptFileFor(file).delete(null);
        root.delete(null);
    }
});

test('exportExtension: a extensão do nome escolhido vence a do menu', () => {
    assert.equal(VM.exportExtension('notas.txt', 'md'), 'txt');
    assert.equal(VM.exportExtension('notas.MD', 'txt'), 'md');
    assert.equal(VM.exportExtension('notas', 'md'), 'md');
    assert.equal(VM.exportExtension('notas.odt', 'txt'), 'txt');
    assert.equal(VM.exportExtension(null, 'md'), 'md');
});

test('speakerEntry: locutor com nome vem preenchido', () => {
    assert.deepEqual(VM.speakerEntry(makeTranscript(), 0), { text: 'Ana', placeholder: 'Locutor 1' });
});

test('speakerEntry: locutor padrão vem vazio com o nome padrão de dica', () => {
    assert.deepEqual(VM.speakerEntry(makeTranscript(), 1), { text: '', placeholder: 'Locutor 2' });
    assert.deepEqual(VM.speakerEntry(makeTranscript({ speakers: undefined }), 2),
        { text: '', placeholder: 'Locutor 3' });
});

test('currentBlockIndex: converte nanossegundos em segundos', () => {
    const blocks = imports.transcript.buildBlocks(makeTranscript());
    assert.equal(VM.currentBlockIndex(blocks, 0), -1);
    assert.equal(VM.currentBlockIndex(blocks, 1.5e9), 0);
    assert.equal(VM.currentBlockIndex(blocks, 3.1e9), 1);
    assert.equal(VM.currentBlockIndex(blocks, 4e9), 1);
    assert.equal(VM.currentBlockIndex(blocks, 7.2e9), 3);
    assert.equal(VM.currentBlockIndex(blocks, 9e9), -1);
});

test('currentBlockIndex: posição inválida não destaca nada', () => {
    const blocks = imports.transcript.buildBlocks(makeTranscript());
    assert.equal(VM.currentBlockIndex(blocks, -1), -1);
    assert.equal(VM.currentBlockIndex(blocks, NaN), -1);
    assert.equal(VM.currentBlockIndex(blocks, undefined), -1);
    assert.equal(VM.currentBlockIndex([], 1e9), -1);
});

const FIND_BLOCKS = [
    { speaker: 0, label: 'Nicolas', start: 0, end: 5, text: 'Bom dia, a Reunião começa agora.' },
    { speaker: 1, label: 'Locutor 2', start: 6, end: 9, text: 'Finalizei a captura de áudio.' },
    { speaker: 0, label: 'Nicolas', start: 10, end: 12, text: 'Depois da reuniao revisamos o áudio.' },
    { speaker: null, label: '', start: 13, end: 15, text: 'Sem locutor nenhum.' },
];

test('findMatches: sem acento e sem caixa', () => {
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'reuniao'), [0, 2]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'REUNIÃO'), [0, 2]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'audio'), [1, 2]);
});

test('findMatches: todos os termos precisam aparecer (E)', () => {
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'reuniao audio'), [2]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, '  captura   finalizei '), [1]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'reuniao inexistente'), []);
});

test('findMatches: consulta vazia ou só espaços não acha nada', () => {
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, ''), []);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, '   '), []);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, null), []);
    assert.deepEqual(VM.findMatches([], 'reuniao'), []);
});

test('findMatches: o nome do locutor entra na busca', () => {
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'locutor 2'), [1]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'nicolas audio'), [2]);
    assert.deepEqual(VM.findMatches(FIND_BLOCKS, 'locutor'), [1, 3]);
});

test('nextIndex: avança e volta dando a volta', () => {
    assert.equal(VM.nextIndex([2, 5, 9], -1, 1), 0);
    assert.equal(VM.nextIndex([2, 5, 9], 0, 1), 1);
    assert.equal(VM.nextIndex([2, 5, 9], 2, 1), 0);
    assert.equal(VM.nextIndex([2, 5, 9], 0, -1), 2);
    assert.equal(VM.nextIndex([2, 5, 9], 2, -1), 1);
    assert.equal(VM.nextIndex([2, 5, 9], -1, -1), 2);
});

test('nextIndex: sem resultados devolve -1', () => {
    assert.equal(VM.nextIndex([], -1, 1), -1);
    assert.equal(VM.nextIndex([], 0, -1), -1);
});

const CLICK = { pressed: true, sameSurface: true, insideButton: false, hasSelection: false };

test('shouldSeekOnClick: clique simples no bloco pula o áudio', () => {
    assert.equal(VM.shouldSeekOnClick(CLICK), true);
});

test('shouldSeekOnClick: botões, popover, seleção ou sem press não pulam', () => {
    assert.equal(VM.shouldSeekOnClick({ ...CLICK, pressed: false }), false);
    assert.equal(VM.shouldSeekOnClick({ ...CLICK, sameSurface: false }), false);
    assert.equal(VM.shouldSeekOnClick({ ...CLICK, insideButton: true }), false);
    assert.equal(VM.shouldSeekOnClick({ ...CLICK, hasSelection: true }), false);
    assert.equal(VM.shouldSeekOnClick({}), false);
    assert.equal(VM.shouldSeekOnClick(), false);
});

test('findCounterText: "n de m" com o ativo a partir de 1', () => {
    assert.equal(VM.findCounterText(5, 1), '2 de 5');
    assert.equal(VM.findCounterText(5, 0), '1 de 5');
    assert.equal(VM.findCounterText(1, 0), '1 de 1');
    assert.equal(VM.findCounterText(5, 4), '5 de 5');
});

test('findCounterText: sem resultados', () => {
    assert.equal(VM.findCounterText(0, -1), 'Nenhum resultado');
    assert.equal(VM.findCounterText(0, 0), 'Nenhum resultado');
});

test('findCounterText: entradas inválidas ficam bem formadas', () => {
    assert.equal(VM.findCounterText(undefined, undefined), 'Nenhum resultado');
    assert.equal(VM.findCounterText(NaN, 0), 'Nenhum resultado');
    assert.equal(VM.findCounterText(-3, 0), 'Nenhum resultado');
    assert.equal(VM.findCounterText(3, -1), '3 resultados');
    assert.equal(VM.findCounterText(1, 7), '1 resultado');
    assert.equal(VM.findCounterText(3, 1.5), '3 resultados');
});

finish();
