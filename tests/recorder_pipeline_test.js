const { Gio, GLib, Gst, GstPbutils } = imports.gi;
const { test, testAsync, assert, finish } = imports.harness;
const P = imports.recorderPipeline;

Gst.init(null);

const tmpDir = () => GLib.Dir.make_tmp('daily-taker-test-XXXXXX');

// Roda o pipeline até EOS; resolve com os nomes dos elementos `level` que emitiram mensagens.
const runToEos = pipeline => new Promise((resolve, reject) => {
    const levels = new Set();
    const bus = pipeline.get_bus();
    bus.add_signal_watch();
    const id = bus.connect('message', (_, message) => {
        const done = result => {
            bus.disconnect(id);
            bus.remove_signal_watch();
            pipeline.set_state(Gst.State.NULL);
            result();
        };
        switch (message.type) {
        case Gst.MessageType.ELEMENT: {
            const s = message.get_structure();
            if (s && s.has_name('level'))
                levels.add(message.src.name);
            break;
        }
        case Gst.MessageType.EOS:
            done(() => resolve(levels));
            break;
        case Gst.MessageType.ERROR:
            done(() => reject(new Error(message.parse_error()[0].message)));
            break;
        }
    });
    pipeline.set_state(Gst.State.PLAYING);
});

test('descrição padrão usa as fontes do pulse e a cadeia fixa', () => {
    const d = P.buildPipelineDescription({ location: '/tmp/x' });
    assert.equal(d.includes('pulsesrc device=@DEFAULT_SOURCE@'), true);
    assert.equal(d.includes('pulsesrc device=@DEFAULT_MONITOR@'), true);
    assert.equal(d.includes('audio/x-raw,rate=16000,channels=1'), true);
    assert.equal(d.includes('level name=mic'), true);
    assert.equal(d.includes('level name=system'), true);
    assert.equal(d.includes('level name=mix ! opusenc bitrate=32000 ! oggmux ! filesink'), true);
});

test('descrição padrão parseia com Gst.parse_launch', () => {
    const pipeline = Gst.parse_launch(P.buildPipelineDescription({ location: '/tmp/x' }));
    assert.equal(pipeline instanceof Gst.Pipeline, true);
    for (const name of ['mic', 'system', 'mix', 'mixer', 'filesink'])
        assert.equal(pipeline.get_by_name(name) !== null, true);
    assert.equal(pipeline.get_by_name('filesink').location, '/tmp/x');
    // sem buffer em espaço de usuário (arquivo parcial tocável após crash)
    assert.equal(pipeline.get_by_name('filesink').buffer_mode, 2);
});

test('location com espaços e aspas é preservada', () => {
    const location = '/tmp/dir "a"/Recording 1';
    const pipeline = Gst.parse_launch(P.buildPipelineDescription({ location }));
    assert.equal(pipeline.get_by_name('filesink').location, location);
});

testAsync('grava Opus mono ≥ 1 s com duas audiotestsrc', async () => {
    const dir = tmpDir();
    const location = GLib.build_filenamev([dir, 'Recording 1']);
    const pipeline = Gst.parse_launch(P.buildPipelineDescription({
        micSource: 'audiotestsrc num-buffers=100 freq=440',
        systemSource: 'audiotestsrc num-buffers=100 freq=880',
        location,
    }));
    const levels = await runToEos(pipeline);
    assert.deepEqual([...levels].sort(), ['mic', 'mix', 'system']);

    const file = Gio.File.new_for_path(location);
    assert.equal(file.query_exists(null), true);

    const discoverer = GstPbutils.Discoverer.new(5 * Gst.SECOND);
    const info = discoverer.discover_uri(file.get_uri());
    assert.equal(info.get_duration() >= Gst.SECOND, true);
    const audio = info.get_audio_streams();
    assert.equal(audio.length, 1);
    assert.equal(audio[0].get_channels(), 1);
    assert.equal(audio[0].get_caps().to_string().startsWith('audio/x-opus'), true);
    assert.equal(/^(audio|application)\/ogg/.test(info.get_stream_info().get_caps().to_string()), true);
    file.delete(null);
    Gio.File.new_for_path(dir).delete(null);
}, 20000);

// ---- falhas do pipeline (nada toca nem grava do microfone: fontes de teste/arquivos) ----

// Silencia log() (detalhes do GStreamer vão para o log, não para a tela).
const quietLog = async fn => {
    const original = globalThis.log;
    const messages = [];
    globalThis.log = m => messages.push(String(m));
    try {
        await fn(messages);
    } finally {
        globalThis.log = original;
    }
    return messages;
};

const waitFor = (cond, ms = 5000) => new Promise((resolve, reject) => {
    const start = Date.now();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
        if (cond()) {
            resolve();
            return GLib.SOURCE_REMOVE;
        }
        if (Date.now() - start > ms) {
            reject(new Error('condição não atingida'));
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });
});

const sizeOf = location => {
    const file = Gio.File.new_for_path(location);
    if (!file.query_exists(null))
        return -1;
    return file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size();
};

const removeTree = path => {
    const dir = Gio.File.new_for_path(path);
    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = en.next_file(null)))
        dir.get_child(info.get_name()).delete(null);
    dir.delete(null);
};

test('mensagens de erro do gravador em pt-BR, sem detalhes técnicos', () => {
    assert.equal(P.RECORDER_ERROR_MESSAGE, 'Não foi possível gravar: verifique o microfone e a saída de áudio.');
    assert.equal(P.recorderFailureMessage(false), P.RECORDER_ERROR_MESSAGE);
    assert.equal(P.recorderFailureMessage(true).includes('trecho gravado foi mantido'), true);
    assert.equal(P.NOTHING_RECORDED_MESSAGE, 'Nada foi gravado.');
});

test('keepRecording: só mantém arquivo com dados e áudio captado', () => {
    assert.equal(P.keepRecording({ exists: true, size: 4000, peakCount: 30 }), true);
    assert.equal(P.keepRecording({ exists: false, size: 0, peakCount: 30 }), false);
    assert.equal(P.keepRecording({ exists: true, size: 0, peakCount: 30 }), false);
    // < 100 ms: nenhum pico do `level`, só cabeçalhos Ogg
    assert.equal(P.keepRecording({ exists: true, size: 120, peakCount: 0 }), false);
});

testAsync('fonte que não abre ao ligar: start falha e o erro é avisado (não só logado)', () => quietLog(async () => {
    const dir = tmpDir();
    const location = GLib.build_filenamev([dir, 'Gravação 1']);
    const errors = [];
    const run = new P.RecordingPipeline({
        location,
        micSource: 'filesrc location=/nonexistent-device-xyz/mic.wav ! wavparse',
        systemSource: 'audiotestsrc is-live=true wave=silence',
        onError: message => errors.push(message),
    });
    assert.equal(run.start(), false);
    assert.equal(run.errored, true);
    assert.deepEqual(errors, [P.RECORDER_ERROR_MESSAGE]);
    // parar depois do erro não espera o EOS (2 s)
    const t0 = Date.now();
    run.stop();
    assert.equal(Date.now() - t0 < 500, true);
    assert.equal(run.pipeline, null);
    // um único aviso, mesmo com o ERROR que também foi para o barramento
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => r() ?? GLib.SOURCE_REMOVE));
    assert.equal(errors.length, 1);
    if (sizeOf(location) >= 0)
        Gio.File.new_for_path(location).delete(null);
    Gio.File.new_for_path(dir).delete(null);
}));

testAsync('descrição inválida (elemento inexistente) também vira erro avisado', () => quietLog(async () => {
    const errors = [];
    const run = new P.RecordingPipeline({
        location: '/nonexistent-dir-xyz/x',
        micSource: 'elemento-que-nao-existe-xyz',
        onError: message => errors.push(message),
    });
    assert.equal(run.start(), false);
    assert.deepEqual(errors, [P.RECORDER_ERROR_MESSAGE]);
    run.stop();
}));

testAsync('erro no meio da gravação: avisado pelo barramento, parada rápida e o trecho gravado fica', () => quietLog(async () => {
    const dir = tmpDir();
    const location = GLib.build_filenamev([dir, 'Gravação 1']);
    const errors = [];
    const levels = [];
    const run = new P.RecordingPipeline({
        location,
        // Fonte ao vivo que quebra depois de ~1,5 s (150 buffers de 10 ms).
        micSource: 'audiotestsrc is-live=true samplesperbuffer=160 ! audio/x-raw,rate=16000 ! identity error-after=150',
        systemSource: 'audiotestsrc is-live=true wave=silence',
        onError: message => errors.push(message),
        onMessage: message => {
            if (message.type === Gst.MessageType.ELEMENT && message.get_structure()?.has_name('level'))
                levels.push(message.src.name);
        },
    });
    assert.equal(run.start(), true);
    await waitFor(() => errors.length > 0);
    assert.deepEqual(errors, [P.RECORDER_ERROR_MESSAGE]);
    assert.equal(levels.includes('mix'), true);
    const t0 = Date.now();
    run.stop();
    assert.equal(Date.now() - t0 < 500, true);
    assert.equal(sizeOf(location) > 0, true);
    removeTree(dir);
}), 15000);

testAsync('parada normal (sem erro) fecha o arquivo com EOS e não avisa erro', () => quietLog(async () => {
    const dir = tmpDir();
    const location = GLib.build_filenamev([dir, 'Gravação 1']);
    const errors = [];
    const run = new P.RecordingPipeline({
        location,
        micSource: 'audiotestsrc is-live=true wave=silence',
        systemSource: 'audiotestsrc is-live=true wave=silence',
        onError: message => errors.push(message),
    });
    assert.equal(run.start(), true);
    await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => r() ?? GLib.SOURCE_REMOVE));
    const bus = run.pipeline.get_bus();
    run.stop();
    assert.deepEqual(errors, []);
    // O signal watch saiu de fato: o barramento aceita outro watch (com ele ainda lá, 0).
    const watchId = bus.add_watch(GLib.PRIORITY_DEFAULT, () => GLib.SOURCE_CONTINUE);
    assert.equal(watchId > 0, true);
    GLib.source_remove(watchId);
    const info = GstPbutils.Discoverer.new(5 * Gst.SECOND).discover_uri(Gio.File.new_for_path(location).get_uri());
    assert.equal(info.get_audio_streams().length, 1);
    removeTree(dir);
}), 15000);

finish();
