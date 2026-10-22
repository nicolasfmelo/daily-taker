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
