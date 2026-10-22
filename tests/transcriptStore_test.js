const { Gio, GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const S = imports.transcriptStore;

const makeTranscript = (recordedAt, extra) => Object.assign({
    version: 1,
    title: 'Daily',
    recorded_at: recordedAt || '2026-10-22T09:00:00-03:00',
    transcribed_at: '2026-10-22T09:05:00-03:00',
    duration: 3,
    language: 'por',
    model: 'elevenlabs/scribe-v2',
    cost_usd: 0.01,
    text: 'Oi tudo bem?',
    speakers: {},
    words: [{ word: 'Oi', speaker: 0, start: 0, end: 0.4, type: 'word' }],
}, extra);

const tmpDir = () => Gio.File.new_for_path(GLib.Dir.make_tmp('daily-taker-test-XXXXXX'));

const rmTree = dir => {
    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = en.next_file(null)))
        dir.get_child(info.get_name()).delete(null);
    dir.delete(null);
};

const touch = (dir, name) => {
    const f = dir.get_child(name);
    f.replace_contents('audio', null, false, Gio.FileCreateFlags.NONE, null);
    return f;
};

// Captura log() durante fn; devolve as mensagens (mantém a saída dos testes limpa).
const captureLog = fn => {
    const original = globalThis.log;
    const messages = [];
    globalThis.log = m => messages.push(String(m));
    try {
        fn();
    } finally {
        globalThis.log = original;
    }
    return messages;
};

const withDir = fn => {
    const dir = tmpDir();
    try {
        fn(dir);
    } finally {
        rmTree(dir);
    }
};

test('isTranscriptFileName reconhece *.transcript.json', () => {
    assert.equal(S.isTranscriptFileName('a.transcript.json'), true);
    assert.equal(S.isTranscriptFileName('Recording 1.transcript.json'), true);
    assert.equal(S.isTranscriptFileName('a.opus'), false);
    assert.equal(S.isTranscriptFileName('Recording 1'), false);
    assert.equal(S.isTranscriptFileName('a.json'), false);
});

test('transcriptFileFor acrescenta o sufixo ao nome inteiro', () => {
    const dir = Gio.File.new_for_path('/tmp/x');
    const n = name => S.transcriptFileFor(dir.get_child(name));
    assert.equal(n('Recording 1').get_basename(), 'Recording 1.transcript.json');
    assert.equal(n('Daily 22.10').get_basename(), 'Daily 22.10.transcript.json');
    assert.equal(n('x.opus').get_basename(), 'x.opus.transcript.json');
    assert.equal(n('x.opus').get_parent().get_path(), '/tmp/x');
});

test('saveTranscript e loadTranscript fazem round-trip', () => withDir(dir => {
    const rec = touch(dir, 'Recording 1');
    const t = makeTranscript();
    S.saveTranscript(rec, t);
    assert.equal(dir.get_child('Recording 1.transcript.json').query_exists(null), true);
    assert.deepEqual(S.loadTranscript(rec), t);
}));

test('loadTranscript devolve null quando não há transcrição', () => withDir(dir => {
    assert.equal(S.loadTranscript(touch(dir, 'Recording 1')), null);
}));

test('saveTranscript sobrescreve a anterior', () => withDir(dir => {
    const rec = touch(dir, 'Recording 1');
    S.saveTranscript(rec, makeTranscript(null, { title: 'A' }));
    S.saveTranscript(rec, makeTranscript(null, { title: 'B' }));
    assert.equal(S.loadTranscript(rec).title, 'B');
}));

test('JSON corrompido: loadTranscript null e listTranscripts pula só ele', () => withDir(dir => {
    const bad = touch(dir, 'Recording 1');
    const good = touch(dir, 'Recording 2');
    dir.get_child('Recording 1.transcript.json')
        .replace_contents('{"segredo', null, false, Gio.FileCreateFlags.NONE, null);
    S.saveTranscript(good, makeTranscript());
    let list;
    const logs = captureLog(() => {
        assert.equal(S.loadTranscript(bad), null);
        list = S.listTranscripts(dir);
    });
    assert.equal(list.length, 1);
    assert.equal(list[0].recordingFile.get_basename(), 'Recording 2');
    // loga só o nome do arquivo, nunca o conteúdo
    assert.equal(logs.length, 2);
    assert.equal(logs.every(m => m.includes('Recording 1.transcript.json') && !m.includes('segredo')), true);
}));

test('JSON válido mas inválido como transcrição é ignorado', () => withDir(dir => {
    const rec = touch(dir, 'x');
    dir.get_child('x.transcript.json')
        .replace_contents('{}', null, false, Gio.FileCreateFlags.NONE, null);
    captureLog(() => {
        assert.equal(S.loadTranscript(rec), null);
        assert.equal(S.listTranscripts(dir).length, 0);
    });
}));

test('moveTranscript leva o arquivo para o novo nome', () => withDir(dir => {
    const oldRec = touch(dir, 'Recording 1');
    const t = makeTranscript();
    S.saveTranscript(oldRec, t);
    const newRec = dir.get_child('Reunião');
    S.moveTranscript(oldRec, newRec);
    assert.equal(dir.get_child('Recording 1.transcript.json').query_exists(null), false);
    assert.deepEqual(S.loadTranscript(newRec), t);
}));

test('moveTranscript atualiza o título que era o nome antigo da gravação', () => withDir(dir => {
    const oldRec = touch(dir, 'Gravação 3');
    const t = makeTranscript(null, { title: 'Gravação 3' });
    S.saveTranscript(oldRec, t);
    const newRec = dir.get_child('Daily 22/10'.replace('/', '-'));
    S.moveTranscript(oldRec, newRec);
    assert.equal(dir.get_child('Gravação 3.transcript.json').query_exists(null), false);
    const moved = S.loadTranscript(newRec);
    assert.equal(moved.title, 'Daily 22-10');
    assert.deepEqual(moved, Object.assign({}, t, { title: 'Daily 22-10' }));
}));

test('moveTranscript preserva um título personalizado', () => withDir(dir => {
    const oldRec = touch(dir, 'Gravação 3');
    const t = makeTranscript(null, { title: 'Planejamento do trimestre' });
    S.saveTranscript(oldRec, t);
    const newRec = dir.get_child('Daily');
    S.moveTranscript(oldRec, newRec);
    assert.deepEqual(S.loadTranscript(newRec), t);
}));

test('moveTranscript com transcrição ilegível só move, sem lançar', () => withDir(dir => {
    const oldRec = touch(dir, 'Gravação 3');
    dir.get_child('Gravação 3.transcript.json').replace_contents('{ quebrado', null, false,
        Gio.FileCreateFlags.NONE, null);
    const newRec = dir.get_child('Daily');
    captureLog(() => S.moveTranscript(oldRec, newRec));
    assert.equal(dir.get_child('Gravação 3.transcript.json').query_exists(null), false);
    assert.equal(dir.get_child('Daily.transcript.json').query_exists(null), true);
}));

test('moveTranscript sem transcrição não faz nada', () => withDir(dir => {
    const oldRec = touch(dir, 'Recording 1');
    S.moveTranscript(oldRec, dir.get_child('Outro'));
    assert.equal(dir.get_child('Outro.transcript.json').query_exists(null), false);
}));

test('listTranscripts ordena por recorded_at decrescente', () => withDir(dir => {
    S.saveTranscript(touch(dir, 'B'), makeTranscript('2026-10-21T09:00:00-03:00'));
    S.saveTranscript(touch(dir, 'C'), makeTranscript('2026-10-23T09:00:00-03:00'));
    S.saveTranscript(touch(dir, 'A'), makeTranscript('2026-10-22T09:00:00-03:00'));
    touch(dir, 'D'); // gravação sem transcrição
    const names = S.listTranscripts(dir).map(i => i.recordingFile.get_basename());
    assert.deepEqual(names, ['C', 'A', 'B']);
    assert.equal(S.listTranscripts(dir)[0].transcript.recorded_at, '2026-10-23T09:00:00-03:00');
}));

finish();
