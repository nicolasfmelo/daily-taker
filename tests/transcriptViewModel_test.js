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

const noUndefined = obj => {
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string')
            throw new Error(`${k} não é string: ${JSON.stringify(v)}`);
        if (v.includes('undefined') || v.includes('NaN') || v.includes('null'))
            throw new Error(`${k} contém lixo: ${JSON.stringify(v)}`);
    }
};

test('languageName: português por código ISO 639-3 ou 639-1', () => {
    assert.equal(VM.languageName('por'), 'Português');
    assert.equal(VM.languageName('pt'), 'Português');
    assert.equal(VM.languageName('PT'), 'Português');
    assert.equal(VM.languageName('pt-BR'), 'Português');
});

test('languageName: outros códigos aparecem crus; ausente vira vazio', () => {
    assert.equal(VM.languageName('eng'), 'eng');
    assert.equal(VM.languageName(''), '');
    assert.equal(VM.languageName(undefined), '');
    assert.equal(VM.languageName(null), '');
});

test('blockTitle com e sem rótulo', () => {
    assert.equal(VM.blockTitle({ speaker: 0, label: 'Locutor 1', start: 192, end: 200, text: 'x' }),
        'Locutor 1 · 00:03:12');
    assert.equal(VM.blockTitle({ speaker: null, label: '', start: 192, end: 200, text: 'x' }),
        '00:03:12');
});

test('viewHeader: título, data e hora, duração, idioma e locutores', () => {
    assert.deepEqual(VM.viewHeader(makeTranscript()), {
        title: 'Daily 22/10',
        dateTime: '22/10/2026 · 14:30',
        duration: '00:45:12',
        language: 'Português',
        speakers: 'Ana, Locutor 2, Locutor 3',
    });
});

test('viewHeader só com texto (sem palavras): sem locutores', () => {
    const h = VM.viewHeader(makeTranscript({ text: 'Olá mundo' }, []));
    assert.equal(h.speakers, '');
    noUndefined(h);
});

test('viewHeader com campos ausentes nunca imprime undefined', () => {
    const h = VM.viewHeader(makeTranscript({
        title: '', recorded_at: undefined, duration: undefined, language: undefined, speakers: undefined,
    }));
    noUndefined(h);
    assert.equal(h.title, 'Transcrição');
    assert.equal(h.dateTime, '');
    assert.equal(h.duration, '00:00:00');
    assert.equal(h.language, '');
});

const { toMarkdown, copyText } = imports.transcriptFormat;

test('exportContent: md usa o Markdown e txt o texto com locutores', () => {
    const t = makeTranscript();
    assert.equal(VM.exportContent(t, 'md'), toMarkdown(t));
    assert.equal(VM.exportContent(t, 'txt'), copyText(t, { withSpeakers: true }));
});

test('exportContent: ambos começam pelo cabeçalho com data e hora', () => {
    const t = makeTranscript();
    assert.equal(VM.exportContent(t, 'md').startsWith('# Daily 22/10\n\n- 22/10/2026 · 14:30'), true);
    assert.equal(VM.exportContent(t, 'txt').startsWith('Daily 22/10\n22/10/2026 · 14:30'), true);
});

test('exportContent: extensão desconhecida é erro', () => {
    assert.throws(() => VM.exportContent(makeTranscript(), 'pdf'));
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

finish();
