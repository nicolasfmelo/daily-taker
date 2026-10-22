const { test, assert, finish } = imports.harness;
const { TranscribeError } = imports.transcriber;
const U = imports.transcriptionUi;

// rowStatus: execução em andamento > última execução falhou > transcrição salva > nada.
test('rowStatus: nada', () => {
    assert.equal(U.rowStatus({ hasTranscript: false, serviceStatus: 'none' }), 'none');
});

test('rowStatus: transcrição salva -> ready', () => {
    assert.equal(U.rowStatus({ hasTranscript: true, serviceStatus: 'none' }), 'ready');
});

test('rowStatus: running vence tudo', () => {
    assert.equal(U.rowStatus({ hasTranscript: true, serviceStatus: 'running' }), 'running');
    assert.equal(U.rowStatus({ hasTranscript: false, serviceStatus: 'running' }), 'running');
});

test('rowStatus: última execução falhou vence a transcrição antiga', () => {
    assert.equal(U.rowStatus({ hasTranscript: true, serviceStatus: 'error' }), 'error');
    assert.equal(U.rowStatus({ hasTranscript: false, serviceStatus: 'error' }), 'error');
});

test('formatUsd: duas casas com vírgula', () => {
    assert.equal(U.formatUsd(0.0837), 'US$ 0,08');
    assert.equal(U.formatUsd(1.5), 'US$ 1,50');
    assert.equal(U.formatUsd(0), 'US$ 0,00');
});

test('formatUsd: valores abaixo de um centavo usam até 4 casas', () => {
    assert.equal(U.formatUsd(0.001116), 'US$ 0,0011');
    assert.equal(U.formatUsd(0.005), 'US$ 0,005');
});

test('formatUsd: valor positivo minúsculo não vira zero', () => {
    assert.equal(U.formatUsd(0.000031), 'menos de US$ 0,0001');
});

test('formatDuration: segundos', () => {
    assert.equal(U.formatDuration(36), '36 s');
    assert.equal(U.formatDuration(0), '0 s');
    assert.equal(U.formatDuration(59.4), '59 s');
});

test('formatDuration: minutos', () => {
    assert.equal(U.formatDuration(2700), '45 min');
    assert.equal(U.formatDuration(60), '1 min');
    assert.equal(U.formatDuration(90), '2 min');
});

test('formatDuration: horas', () => {
    assert.equal(U.formatDuration(3600), '1 h');
    assert.equal(U.formatDuration(4320), '1 h 12 min');
    assert.equal(U.formatDuration(3590), '1 h');
});

test('confirmMessage: 45 min', () => {
    assert.deepEqual(U.confirmMessage(2700), {
        heading: 'Transcrever 45 min?',
        body: 'Custo estimado: US$ 0,08',
    });
});

test('hasKey: só com chave não vazia', () => {
    assert.equal(U.hasKey(null), false);
    assert.equal(U.hasKey(undefined), false);
    assert.equal(U.hasKey({ key: '', source: 'env' }), false);
    assert.equal(U.hasKey({ key: 'k', source: 'secret' }), true);
});

test('statusInfo: ícone e dica por estado', () => {
    assert.equal(U.statusInfo('none').icon, null);
    assert.equal(U.statusInfo('ready').icon, 'emblem-ok-symbolic');
    assert.equal(U.statusInfo('ready').tooltip, 'Transcrição pronta');
    assert.equal(U.statusInfo('error').icon, 'dialog-warning-symbolic');
    assert.equal(U.statusInfo('error').tooltip, 'A última transcrição falhou');
    assert.equal(U.statusInfo('running').tooltip, 'Transcrevendo…');
});

const fakeFile = exists => ({ query_exists: () => exists });

test('guardedSave: repassa para save quando a gravação existe', () => {
    const saved = [];
    const save = U.guardedSave((file, t) => saved.push([file, t]));
    const file = fakeFile(true);
    save(file, { x: 1 });
    assert.equal(saved.length, 1);
    assert.equal(saved[0][0], file);
});

test('guardedSave: falha de disco vira TranscribeError saveFailed com mensagem clara', () => {
    const save = U.guardedSave(() => {
        throw new Error('/home/x: permission denied');
    });
    let err = null;
    try {
        save(fakeFile(true), {});
    } catch (e) {
        err = e;
    }
    assert.equal(err instanceof TranscribeError, true);
    assert.equal(err.kind, 'saveFailed');
    assert.equal(err.message, 'A transcrição foi feita, mas não foi possível salvá-la no disco.');
    assert.equal(err.retryable, false);
});

test('guardedSave: gravação excluída durante a transcrição não salva', () => {
    const saved = [];
    const save = U.guardedSave(() => saved.push(1));
    let err = null;
    try {
        save(fakeFile(false), {});
    } catch (e) {
        err = e;
    }
    assert.equal(saved.length, 0);
    assert.equal(err instanceof TranscribeError, true);
    assert.equal(err.kind, 'recordingGone');
    assert.equal(err.message, 'A gravação foi excluída antes de a transcrição terminar.');
});

test('canRetry: não oferece de novo se a gravação sumiu', () => {
    assert.equal(U.canRetry(new TranscribeError('network'), true), true);
    assert.equal(U.canRetry(new TranscribeError('saveFailed', 0, 'x'), true), true);
    assert.equal(U.canRetry(new TranscribeError('recordingGone', 0, 'x'), true), false);
    assert.equal(U.canRetry(new TranscribeError('network'), false), false);
});

test('confirmMessage: duração desconhecida não promete custo', () => {
    const expected = {
        heading: 'Transcrever esta gravação?',
        body: 'A duração ainda não é conhecida, então não é possível estimar o custo.',
    };
    assert.deepEqual(U.confirmMessage(0), expected);
    assert.deepEqual(U.confirmMessage(-1), expected);
    assert.deepEqual(U.confirmMessage(NaN), expected);
    assert.deepEqual(U.confirmMessage(Infinity), expected);
});

test('confirmMessage regenerate: avisa que cobra de novo, com duração e estimativa', () => {
    assert.deepEqual(U.confirmMessage(2700, { regenerate: true }), {
        heading: 'Gerar novamente?',
        body: 'Isto cobra de novo: 45 min, custo estimado US$ 0,08.',
    });
});

test('confirmMessage regenerate: duração desconhecida não promete custo', () => {
    const expected = {
        heading: 'Gerar novamente?',
        body: 'Isto cobra de novo. A duração ainda não é conhecida, então não é possível estimar o custo.',
    };
    assert.deepEqual(U.confirmMessage(0, { regenerate: true }), expected);
    assert.deepEqual(U.confirmMessage(NaN, { regenerate: true }), expected);
});

test('confirmMessage regenerate: avisa que os nomes dos locutores serão perdidos', () => {
    assert.deepEqual(U.confirmMessage(2700, { regenerate: true, namedSpeakers: true }), {
        heading: 'Gerar novamente?',
        body: 'Isto cobra de novo: 45 min, custo estimado US$ 0,08. Os nomes dados aos locutores serão perdidos.',
    });
    assert.deepEqual(U.confirmMessage(0, { regenerate: true, namedSpeakers: true }), {
        heading: 'Gerar novamente?',
        body: 'Isto cobra de novo. A duração ainda não é conhecida, então não é possível estimar o custo. Os nomes dados aos locutores serão perdidos.',
    });
});

test('confirmMessage regenerate: sem nomes dados, sem aviso de perda', () => {
    const body = U.confirmMessage(2700, { regenerate: true, namedSpeakers: false }).body;
    assert.equal(body.includes('locutores'), false);
});

test('hasNamedSpeakers: só nomes não vazios contam', () => {
    assert.equal(U.hasNamedSpeakers({ speakers: { 1: 'Ana' } }), true);
    assert.equal(U.hasNamedSpeakers({ speakers: { 1: '' } }), false);
    assert.equal(U.hasNamedSpeakers({ speakers: {} }), false);
    assert.equal(U.hasNamedSpeakers({}), false);
    assert.equal(U.hasNamedSpeakers(null), false);
});

test('rowActions: transcrever exige duração conhecida e nada em andamento', () => {
    assert.deepEqual(U.rowActions({ status: 'none', seconds: 60, editMode: false }), { transcribe: true, rename: true, open: false });
    assert.deepEqual(U.rowActions({ status: 'none', seconds: 0, editMode: false }), { transcribe: false, rename: true, open: false });
    assert.deepEqual(U.rowActions({ status: 'ready', seconds: 60, editMode: false }), { transcribe: true, rename: true, open: true });
    assert.deepEqual(U.rowActions({ status: 'error', seconds: 60, editMode: false }), { transcribe: true, rename: true, open: false });
});

test('rowActions: em andamento bloqueia transcrever, renomear e abrir', () => {
    assert.deepEqual(U.rowActions({ status: 'running', seconds: 60, editMode: false }), { transcribe: false, rename: false, open: false });
});

test('rowActions: em edição nada fica ativo', () => {
    assert.deepEqual(U.rowActions({ status: 'none', seconds: 60, editMode: true }), { transcribe: false, rename: false, open: false });
    assert.deepEqual(U.rowActions({ status: 'ready', seconds: 60, editMode: true }), { transcribe: false, rename: false, open: false });
});

test('rowActions: abrir só com transcrição pronta, mesmo sem duração', () => {
    assert.equal(U.rowActions({ status: 'ready', seconds: 0, editMode: false }).open, true);
});

test('rowActions: abrir com transcrição no disco mesmo se a nova execução falhou', () => {
    assert.equal(U.rowActions({ status: 'error', seconds: 60, editMode: false, hasTranscript: true }).open, true);
    assert.equal(U.rowActions({ status: 'error', seconds: 60, editMode: false, hasTranscript: false }).open, false);
});

test('rowActions: transcrição no disco não abre durante execução nem em edição', () => {
    assert.equal(U.rowActions({ status: 'running', seconds: 60, editMode: false, hasTranscript: true }).open, false);
    assert.equal(U.rowActions({ status: 'error', seconds: 60, editMode: true, hasTranscript: true }).open, false);
});

finish();
