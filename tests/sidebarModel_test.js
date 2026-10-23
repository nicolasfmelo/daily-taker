const { test, assert, finish } = imports.harness;
const M = imports.sidebarModel;

const transcript = {
    version: 1,
    title: 'Planejamento do trimestre',
    recorded_at: '2026-10-22T14:30:00-03:00',
    speakers: { 0: 'Ana' },
    text: '',
    words: [
        { word: 'Orçamento', speaker: 0, start: 1, end: 1.4, type: 'word' },
        { word: 'aprovado', speaker: 1, start: 1.5, end: 2, type: 'word' },
    ],
};

test('recordingMatches pelo nome, sem acento nem caixa', () => {
    assert.equal(M.recordingMatches('reuniao', 'Reunião', null), true);
    assert.equal(M.recordingMatches('REUNIÃO', 'reuniao semanal', null), true);
    assert.equal(M.recordingMatches('daily', 'Reunião', null), false);
});

test('recordingMatches: termos em AND', () => {
    assert.equal(M.recordingMatches('reuniao semanal', 'Reunião semanal', null), true);
    assert.equal(M.recordingMatches('reuniao diaria', 'Reunião semanal', null), false);
});

test('recordingMatches: consulta vazia casa com tudo', () => {
    assert.equal(M.recordingMatches('', 'Reunião', null), true);
    assert.equal(M.recordingMatches('   ', 'Reunião', transcript), true);
});

test('recordingMatches busca na transcrição quando existe', () => {
    assert.equal(M.recordingMatches('orcamento', 'Gravação 22 out', transcript), true);
    assert.equal(M.recordingMatches('ana', 'Gravação 22 out', transcript), true);
    assert.equal(M.recordingMatches('trimestre', 'Gravação 22 out', transcript), true);
    assert.equal(M.recordingMatches('gravacao aprovado', 'Gravação 22 out', transcript), true);
    assert.equal(M.recordingMatches('orcamento rejeitado', 'Gravação 22 out', transcript), false);
});

test('recordingMatches sem transcrição só casa pelo nome', () => {
    assert.equal(M.recordingMatches('orcamento', 'Gravação 22 out', null), false);
});

test('statusBadge', () => {
    assert.deepEqual(M.statusBadge('ready'), { kind: 'ok', label: 'Transcrita' });
    assert.deepEqual(M.statusBadge('running'), { kind: 'running', label: 'Transcrevendo…' });
    assert.deepEqual(M.statusBadge('error'), { kind: 'error', label: 'Erro' });
    assert.deepEqual(M.statusBadge('none'), { kind: 'none', label: '' });
});

test('sidebarModel: entradas ausentes ficam bem formadas', () => {
    assert.deepEqual(M.statusBadge(undefined), { kind: 'none', label: '' });
    assert.deepEqual(M.statusBadge(null), { kind: 'none', label: '' });
    assert.deepEqual(M.statusBadge('whatever'), { kind: 'none', label: '' });
    assert.equal(M.recordingMatches(undefined, 'Reunião', null), true);
    assert.equal(M.recordingMatches(null, null, null), true);
    assert.equal(M.recordingMatches('x', null, null), false);
    assert.equal(M.recordingMatches('x', '', undefined), false);
    assert.equal(M.recordingMatches('null', null, null), false);
    assert.equal(M.recordingMatches('undefined', undefined, {}), false);
    assert.equal(M.recordingMatches('reuniao', 'Reunião', {}), true);
});

const PANE_STATES = ['empty-library', 'no-selection', 'not-transcribed', 'running', 'error', 'ready'];
const STATUSES = ['none', 'running', 'error', 'ready'];
const r = { name: 'Daily' };

test('paneState: sem gravações → empty-library (seleção, status e transcrição não importam)', () => {
    for (const status of STATUSES) {
        for (const has of [true, false]) {
            assert.equal(M.paneState(null, false, status, has), 'empty-library');
            assert.equal(M.paneState(r, false, status, has), 'empty-library');
        }
    }
});

test('paneState: há gravações e nenhuma selecionada → no-selection', () => {
    for (const status of STATUSES) {
        assert.equal(M.paneState(null, true, status, true), 'no-selection');
        assert.equal(M.paneState(undefined, true, status, false), 'no-selection');
    }
});

test('paneState: com transcrição a visão fica sempre (ready, error, running, none)', () => {
    assert.equal(M.paneState(r, true, 'ready', true), 'ready');
    assert.equal(M.paneState(r, true, 'error', true), 'ready');
    assert.equal(M.paneState(r, true, 'running', true), 'ready');
    assert.equal(M.paneState(r, true, 'none', true), 'ready');
});

test('paneState: sem transcrição → cartão do status', () => {
    assert.equal(M.paneState(r, true, 'none', false), 'not-transcribed');
    assert.equal(M.paneState(r, true, 'running', false), 'running');
    assert.equal(M.paneState(r, true, 'error', false), 'error');
    // "Pronta" sem transcrição carregada: cartão de gerar (generateCard diz o motivo).
    assert.equal(M.paneState(r, true, 'ready', false), 'not-transcribed');
});

test('paneState: status desconhecido ou ausente → not-transcribed / ready', () => {
    for (const status of [undefined, null, 'whatever', 'toString']) {
        assert.equal(M.paneState(r, true, status, false), 'not-transcribed');
        assert.equal(M.paneState(r, true, status, true), 'ready');
    }
    assert.equal(M.paneState(r, true, 'ready'), 'not-transcribed');
});

test('paneState: toda combinação cai num estado com painel definido', () => {
    for (const recording of [null, undefined, {}, { name: 'a' }]) {
        for (const has of [true, false, undefined]) {
            for (const status of [...STATUSES, undefined, 'x']) {
                for (const hasTranscript of [true, false, undefined]) {
                    const s = M.paneState(recording, has, status, hasTranscript);
                    if (!PANE_STATES.includes(s))
                        throw new Error(`estado sem painel: ${s}`);
                }
            }
        }
    }
});

test('paneBanner: só com transcrição e status running/error', () => {
    assert.equal(M.paneBanner('running', true), 'running');
    assert.equal(M.paneBanner('error', true), 'error');
    assert.equal(M.paneBanner('ready', true), 'none');
    assert.equal(M.paneBanner('none', true), 'none');
    for (const status of STATUSES)
        assert.equal(M.paneBanner(status, false), 'none');
    assert.equal(M.paneBanner(undefined, true), 'none');
    assert.equal(M.paneBanner('toString', true), 'none');
    assert.equal(M.paneBanner('error'), 'none');
});

test('paneActions: permissões literais por transição e argumentos ausentes', () => {
    const none = { search: false, copy: false, export: false, regenerate: false, summaryRegenerate: false, history: false };
    assert.deepEqual(M.paneActions(), none);
    assert.deepEqual(M.paneActions({}), none);
    for (const state of ['empty-library', 'no-selection', 'not-transcribed', 'running', 'error'])
        assert.deepEqual(M.paneActions({ state, status: 'none', tab: 'transcricao' }), none);
    for (const [input, expected] of [
        [{ state: 'ready', status: 'none', tab: 'transcricao' },
            { search: true, copy: true, export: true, regenerate: true, summaryRegenerate: false, history: false }],
        [{ state: 'ready', status: 'running', tab: 'transcricao', summary: 'ready', hasHistory: true },
            { search: true, copy: true, export: true, regenerate: false, summaryRegenerate: false, history: false }],
        [{ state: 'ready', status: 'error', tab: 'resumo', summary: 'ready', hasHistory: true },
            { search: false, copy: true, export: true, regenerate: true, summaryRegenerate: true, history: true }],
        [{ state: 'ready', status: 'none', tab: 'resumo', summary: 'running', hasHistory: true },
            { search: false, copy: false, export: true, regenerate: false, summaryRegenerate: false, history: false }],
        [{ state: 'ready', status: 'none', tab: 'resumo', summary: 'error', hasHistory: true },
            { search: false, copy: false, export: true, regenerate: true, summaryRegenerate: false, history: true }],
        [{ state: 'ready', status: 'none', tab: 'resumo', summary: 'none' },
            { search: false, copy: false, export: true, regenerate: true, summaryRegenerate: false, history: false }],
    ])
        assert.deepEqual(M.paneActions(input), expected);
});

test('generateCard: "pronta" sem transcrição pede para gerar de novo (com confirmação)', () => {
    assert.deepEqual(M.generateCard('ready'),
        { title: 'Não foi possível carregar a transcrição', regenerate: true });
    for (const status of ['none', 'running', 'error', undefined, 'x'])
        assert.deepEqual(M.generateCard(status),
            { title: 'Esta gravação ainda não foi transcrita', regenerate: false });
});

test('nextSelection: mesma posição se existe, senão a última; -1 sem itens', () => {
    const table = [
        // [itens depois da remoção, índice removido, esperado]
        [['b', 'c'], 0, 0],
        [['a', 'c'], 1, 1],
        [['a', 'b'], 2, 1],
        [['a'], 0, 0],
        [['a'], 1, 0],
        [['a'], 5, 0],
        [[], 0, -1],
        [[], 3, -1],
        [['a', 'b'], -1, -1],
        [['a', 'b'], 1.5, -1],
        [['a', 'b'], NaN, -1],
        [['a', 'b'], undefined, -1],
        [null, 0, -1],
        [undefined, 0, -1],
    ];
    for (const [items, removed, expected] of table)
        assert.equal(M.nextSelection(items, removed), expected);
});

test('emptyListMessage: biblioteca vazia, busca sem resultado ou nada', () => {
    const table = [
        // [total, visíveis, consulta, esperado]
        [0, 0, '', 'no-recordings'],
        [0, 0, 'reuniao', 'no-recordings'],
        [0, 0, null, 'no-recordings'],
        [4, 0, 'zzzz', 'no-results'],
        [4, 0, '  zz ', 'no-results'],
        [4, 4, '', 'none'],
        [4, 1, 'reuniao', 'none'],
        [1, 1, 'x', 'none'],
        // Sem consulta todas casam: nunca "nada encontrado" sem busca.
        [4, 0, '', 'none'],
        [4, 0, '   ', 'none'],
        [4, 0, undefined, 'none'],
    ];
    for (const [total, visible, query, expected] of table)
        assert.equal(M.emptyListMessage(total, visible, query), expected);
});

test('recordingMatchesHaystack: texto já normalizado da transcrição', () => {
    const hay = 'planejamento do trimestre\nana\norcamento aprovado';
    const table = [
        // [consulta, nome, haystack, esperado]
        ['reuniao', 'Reunião', null, true],             // acento e caixa no nome
        ['REUNIÃO', 'reuniao semanal', null, true],
        ['orcamento', 'Gravação 22 out', null, false],   // sem haystack: só o nome
        ['ORÇAMENTO', 'Gravação 22 out', hay, true],     // acento e caixa na consulta
        ['gravacao aprovado', 'Gravação 22 out', hay, true],  // termos em AND: nome + texto
        ['orcamento rejeitado', 'Gravação 22 out', hay, false],
        ['', 'Reunião', null, true],                     // consulta vazia casa com tudo
        ['   ', 'x', hay, true],
        [null, null, null, true],
        ['x', null, null, false],
        ['trimestre', '', '', false],                    // haystack vazio = nada a achar
    ];
    for (const [query, name, haystack, expected] of table)
        assert.equal(M.recordingMatchesHaystack(query, name, haystack), expected);
});

test('recordingMatches = recordingMatchesHaystack com searchableText', () => {
    for (const q of ['orcamento', 'ana', 'gravacao aprovado', 'nada', ''])
        assert.equal(M.recordingMatches(q, 'Gravação 22 out', transcript),
            M.recordingMatchesHaystack(q, 'Gravação 22 out', imports.transcriptSearch.searchableText(transcript)));
});

finish();
