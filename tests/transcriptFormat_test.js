const { test, assert, finish } = imports.harness;
const F = imports.transcriptFormat;

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
    ],
}, extra);

const contains = (s, part) => {
    if (!s.includes(part))
        throw new Error(`esperava conter ${JSON.stringify(part)} em ${JSON.stringify(s)}`);
};

const notContains = (s, part) => {
    if (s.includes(part))
        throw new Error(`não esperava conter ${JSON.stringify(part)} em ${JSON.stringify(s)}`);
};

test('formatClock trunca e preenche com zeros', () => {
    assert.equal(F.formatClock(3792.9), '01:03:12');
    assert.equal(F.formatClock(0), '00:00:00');
    assert.equal(F.formatClock(192), '00:03:12');
    assert.equal(F.formatClock(0.99), '00:00:00');
});

test('formatClock tolera valores inválidos', () => {
    assert.equal(F.formatClock(-5), '00:00:00');
    assert.equal(F.formatClock(NaN), '00:00:00');
    assert.equal(F.formatClock(undefined), '00:00:00');
});

test('formatDateTime usa o fuso local', () => {
    assert.equal(F.formatDateTime('2026-10-22T14:30:00-03:00'), '22/10/2026 · 14:30');
    assert.equal(F.formatDateTime('2026-10-22T17:30:00Z'), '22/10/2026 · 14:30');
});

test('formatDateTime devolve vazio para data inválida', () => {
    assert.equal(F.formatDateTime('lixo'), '');
    assert.equal(F.formatDateTime(undefined), '');
});

test('formatHeader: título, data, duração e locutores', () => {
    assert.equal(F.formatHeader(makeTranscript()),
        'Daily 22/10\n22/10/2026 · 14:30\nDuração: 00:45:12\nLocutores: Ana, Locutor 2');
});

test('formatHeader omite Locutores quando nenhum bloco tem rótulo', () => {
    const t = makeTranscript({}, [{ word: 'oi', speaker: null, start: 0, end: 1, type: 'word' }]);
    assert.equal(F.formatHeader(t), 'Daily 22/10\n22/10/2026 · 14:30\nDuração: 00:45:12');
});

test('formatHeader com título vazio e data inválida não imprime undefined', () => {
    const t = makeTranscript({ title: '', recorded_at: 'x', duration: undefined, speakers: undefined });
    const header = F.formatHeader(t);
    notContains(header, 'undefined');
    notContains(header, 'NaN');
    assert.equal(header.split('\n')[0], 'Transcrição');
});

test('copyBlock com e sem rótulo', () => {
    assert.equal(F.copyBlock({ speaker: 0, label: 'Ana', start: 192, end: 200, text: 'texto' }),
        'Ana · 00:03:12\ntexto');
    assert.equal(F.copyBlock({ speaker: null, label: '', start: 192, end: 200, text: 'texto' }),
        '00:03:12\ntexto');
});

test('copyText com locutores: cabeçalho, linha em branco e blocos', () => {
    const out = F.copyText(makeTranscript(), { withSpeakers: true });
    assert.equal(out, [
        'Daily 22/10',
        '22/10/2026 · 14:30',
        'Duração: 00:45:12',
        'Locutores: Ana, Locutor 2',
        '',
        'Ana · 00:00:01',
        'Bom dia',
        '',
        'Locutor 2 · 00:00:03',
        'oi',
        '',
        'Ana · 00:00:05',
        'pessoal',
    ].join('\n'));
    contains(out, 'Ana · 00:00:01');
});

test('copyText sem locutores: texto corrido e sem marcadores de bloco', () => {
    const out = F.copyText(makeTranscript(), { withSpeakers: false });
    contains(out, '22/10/2026 · 14:30');
    notContains(out, 'Locutor 2 ·');
    notContains(out, 'Ana ·');
    assert.equal(out.split('\n\n')[1], 'Bom dia oi pessoal');
});

test('copyText sem opções copia com locutores', () => {
    contains(F.copyText(makeTranscript()), 'Ana · 00:00:01');
});

test('toMarkdown: título H1, metadados em lista e blocos H3', () => {
    const md = F.toMarkdown(makeTranscript());
    assert.equal(md, [
        '# Daily 22/10',
        '',
        '- 22/10/2026 · 14:30',
        '- Duração: 00:45:12',
        '- Locutores: Ana, Locutor 2',
        '',
        '### Ana · 00:00:01',
        '',
        'Bom dia',
        '',
        '### Locutor 2 · 00:00:03',
        '',
        'oi',
        '',
        '### Ana · 00:00:05',
        '',
        'pessoal',
        '',
    ].join('\n'));
    assert.equal(md.startsWith('# Daily 22/10'), true);
    contains(md, '### Ana · 00:00:01');
});

test('toMarkdown de bloco sem rótulo usa só o tempo e nunca imprime undefined', () => {
    const t = makeTranscript({ speakers: undefined }, [{ word: 'oi', speaker: null, start: 4, end: 5, type: 'word' }]);
    const md = F.toMarkdown(t);
    contains(md, '### 00:00:04\n\noi');
    notContains(md, 'undefined');
});

test('toMarkdown sem palavras nem texto não quebra', () => {
    const md = F.toMarkdown(makeTranscript({}, []));
    notContains(md, 'undefined');
    assert.equal(md.startsWith('# Daily 22/10'), true);
});

test('exportFileName: data/hora locais e slug', () => {
    assert.equal(F.exportFileName(makeTranscript(), 'md'), '2026-10-22_1430_daily-22-10.md');
    assert.equal(F.exportFileName(makeTranscript(), 'txt'), '2026-10-22_1430_daily-22-10.txt');
});

test('exportFileName remove acentos, barras, dois-pontos e espaços duplos', () => {
    const t = makeTranscript({ title: 'Reunião: Q3/Planejamento  ' });
    assert.equal(F.exportFileName(t, 'md'), '2026-10-22_1430_reuniao-q3-planejamento.md');
});

test('exportFileName com título vazio ou só símbolos usa "transcricao"', () => {
    assert.equal(F.exportFileName(makeTranscript({ title: '' }), 'md'), '2026-10-22_1430_transcricao.md');
    assert.equal(F.exportFileName(makeTranscript({ title: '  //..  ' }), 'md'), '2026-10-22_1430_transcricao.md');
    assert.equal(F.exportFileName(makeTranscript({ title: undefined }), 'md'), '2026-10-22_1430_transcricao.md');
});

test('exportFileName limita o slug a 60 caracteres sem hífen final', () => {
    const long = F.exportFileName(makeTranscript({ title: 'a'.repeat(200) }), 'md');
    assert.equal(long, `2026-10-22_1430_${'a'.repeat(60)}.md`);
    const slug = F.exportFileName(makeTranscript({ title: `${'a'.repeat(59)} bbbb` }), 'md')
        .replace('2026-10-22_1430_', '').replace('.md', '');
    assert.equal(slug, 'a'.repeat(59));
});

test('exportFileName nunca contém separadores de caminho', () => {
    const name = F.exportFileName(makeTranscript({ title: '../../etc/passwd\\x' }), 'md');
    notContains(name, '/');
    notContains(name, '\\');
    assert.equal(name, '2026-10-22_1430_etc-passwd-x.md');
});

test('exportFileName com recorded_at inválido não imprime undefined', () => {
    const name = F.exportFileName(makeTranscript({ recorded_at: undefined, transcribed_at: undefined }), 'md');
    notContains(name, 'undefined');
    assert.equal(name, 'sem-data_daily-22-10.md');
});

test('Markdown inclui resumo antes dos blocos; cópia da transcrição não muda', () => {
    const t = makeTranscript();
    const summary = { text: 'Decisão exclusiva.', model: 'modelo', generated_at: t.recorded_at, cost_usd: 0.02 };
    const withSummary = { ...t, summary };
    const md = F.toMarkdown(withSummary);
    contains(md, '## Resumo\n\nDecisão exclusiva.');
    contains(md, 'Gerado por modelo em 22/10/2026 · 14:30');
    assert.equal(md.indexOf('## Resumo') < md.indexOf('### Ana'), true);
    assert.equal(F.copyText(withSummary), F.copyText(t));
});

finish();
