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
    const location = GLib.build_filenamev([tmpDir(), 'Recording 1']);
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
}, 20000);

finish();
