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

finish();
