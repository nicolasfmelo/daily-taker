// Playback com GstPlayer real, mas saída de áudio = fakesink (sync=true, tempo real) e volume 0:
// nenhum teste emite som nem abre o microfone.
const { Gio, GLib, GObject, Gst } = imports.gi;
const { test, testAsync, assert, finish } = imports.harness;
const { Playback } = imports.playback;

Gst.init(null);

const tmp = GLib.Dir.make_tmp('daily-taker-playback-XXXXXX');
const media = GLib.build_filenamev([tmp, 'sine.ogg']);
const other = GLib.build_filenamev([tmp, 'other.ogg']);

const makeMedia = (path, seconds) => {
    const [ok, , err] = GLib.spawn_sync(null, [
        'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=d=${seconds}`,
        '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', path,
    ], null, GLib.SpawnFlags.SEARCH_PATH, null);
    if (!ok)
        throw new Error(`ffmpeg falhou: ${err}`);
};
makeMedia(media, 3);
makeMedia(other, 2);
const links = [];
for (let i = 0; i < 20; i++) {
    const link = GLib.build_filenamev([tmp, `link${i}.ogg`]);
    Gio.File.new_for_path(link).make_symbolic_link(media, null);
    links.push(link);
}
const missingUri = Gio.File.new_for_path(GLib.build_filenamev([tmp, 'nao-existe.ogg'])).get_uri();
const uri = Gio.File.new_for_path(media).get_uri();
const otherUri = Gio.File.new_for_path(other).get_uri();

const newPlayback = () => {
    const playback = new Playback({
        audioSinkFactory: () => {
            const sink = Gst.ElementFactory.make('fakesink', null);
            sink.sync = true; // consome em tempo real, como um sink de áudio
            return sink;
        },
    });
    playback.setVolume(0);
    return playback;
};

const sleep = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

// Resolve no primeiro `signal` cujo predicado (opcional) aceite os argumentos; rejeita no tempo.
const waitFor = (obj, signal, pred = () => true, ms = 4000) => new Promise((resolve, reject) => {
    let id = 0;
    const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        obj.disconnect(id);
        reject(new Error(`sem '${signal}' em ${ms} ms`));
        return GLib.SOURCE_REMOVE;
    });
    id = obj.connect(signal, (_o, ...args) => {
        if (!pred(...args))
            return;
        obj.disconnect(id);
        GLib.source_remove(timer);
        resolve(args);
    });
});

// Registra todos os valores emitidos por um sinal.
const record = (obj, signal) => {
    const values = [];
    obj.connect(signal, (_o, ...args) => values.push(args.length > 1 ? args : args[0]));
    return values;
};

const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('estado inicial', () => {
    const p = newPlayback();
    assert.equal(p.uri, null);
    assert.equal(p.playing, false);
    assert.equal(p.rate, 1);
    assert.equal(p.volume, 0);
    assert.equal(p.position, 0);
    assert.equal(p.duration, 0);
});

test('play/pause/toggle/seek sem uri são no-ops e stop duas vezes não lança', () => {
    const p = newPlayback();
    p.play();
    p.pause();
    p.toggle();
    p.seek(5);
    p.stop();
    p.stop();
    p.load(null);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
});

test('volume: clamp em [0, 1] e NaN vira 1', () => {
    const p = newPlayback();
    p.setVolume(7);
    assert.equal(p.volume, 1);
    p.setVolume(-1);
    assert.equal(p.volume, 0);
    p.setVolume(0.4);
    assert.equal(p.volume, 0.4);
    p.setVolume(NaN);
    assert.equal(p.volume, 1);
    p.volume = 0;
    assert.equal(p.volume, 0);
});

test('rate: só aceita valores de RATES', () => {
    const p = newPlayback();
    p.setRate(1.5);
    assert.equal(p.rate, 1.5);
    p.setRate(3);
    assert.equal(p.rate, 1.5);
    p.setRate('1.25');
    assert.equal(p.rate, 1.5);
    p.setRate(0.75);
    assert.equal(p.rate, 0.75);
    p.rate = 2;
    assert.equal(p.rate, 2);
});

test('rate: falha do GstPlayer volta a 1 e emite rate-failed', () => {
    const p = newPlayback();
    p.load(uri);
    p.setRate(1.5);
    let failed = 0;
    p.connect('rate-failed', () => failed++);
    p._player.set_rate = () => {
        throw new Error('recusado');
    };
    p.setRate(2);
    assert.equal(p.rate, 1);
    assert.equal(failed, 1);
    p.load(null);
});

testAsync('load → duration-changed ≈ 3 e uri', async () => {
    const p = newPlayback();
    const [dur] = await Promise.all([
        waitFor(p, 'duration-changed', d => d > 0),
        Promise.resolve().then(() => p.load(uri)),
    ]).then(r => r[0]);
    assert.equal(near(dur, 3, 0.3), true);
    assert.equal(p.uri, uri);
    assert.equal(near(p.duration, 3, 0.3), true);
    assert.equal(p.playing, false);
    p.load(null);
});

testAsync('play → state-changed(true) e position-updated crescente; pause → false; toggle alterna', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    const positions = record(p, 'position-updated');
    const states = record(p, 'state-changed');

    p.play();
    await waitFor(p, 'state-changed', s => s === true);
    assert.equal(p.playing, true);
    await sleep(900);
    assert.equal(positions.length >= 3, true);
    for (let i = 1; i < positions.length; i++)
        assert.equal(positions[i] >= positions[i - 1], true);
    assert.equal(positions[positions.length - 1] > 0.3, true);

    p.pause();
    await waitFor(p, 'state-changed', s => s === false);
    assert.equal(p.playing, false);
    const frozen = p.position;
    await sleep(300);
    assert.equal(near(p.position, frozen, 0.15), true);

    p.toggle();
    await waitFor(p, 'state-changed', s => s === true);
    p.toggle();
    await waitFor(p, 'state-changed', s => s === false);
    assert.deepEqual(states, [true, false, true, false]);
    p.load(null);
});

testAsync('seek(2) → posição ≥ 2; seek(99) limita à duração; seek(-5) limita a 0', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);

    p.seek(2);
    assert.equal(p.position, 2);
    await sleep(400);
    assert.equal(p.position >= 2, true);
    assert.equal(p.position < 2.5, true);

    p.seek(-5);
    assert.equal(p.position, 0);
    p.seek(NaN);
    assert.equal(p.position, 0);

    p.seek(99);
    assert.equal(p.position, p.duration);
    p.load(null);
});

testAsync('load(null) zera uri/playing/position/duration; depois os métodos não lançam', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    p.play();
    await waitFor(p, 'position-updated', pos => pos > 0.2);
    const states = record(p, 'state-changed');
    p.load(null);
    assert.equal(p.uri, null);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
    assert.equal(p.duration, 0);
    assert.deepEqual(states, [false]);

    // callbacks tardios do GstPlayer não podem reviver o estado nem lançar
    await sleep(400);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
    assert.equal(p.duration, 0);
    p.play();
    p.pause();
    p.toggle();
    p.seek(1);
    p.stop();
    p.stop();
    p.setRate(1.25);
    p.setVolume(0.5);
    p.load(null);
    assert.equal(p.uri, null);
    assert.equal(p.playing, false);
});

testAsync('load de outro uri para o anterior e zera posição/duração (uma vez)', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    p.play();
    await waitFor(p, 'position-updated', pos => pos > 0.2);

    const positions = record(p, 'position-updated');
    const durations = record(p, 'duration-changed');
    const states = record(p, 'state-changed');
    p.load(otherUri);
    assert.equal(p.uri, otherUri);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
    assert.equal(p.duration, 0);
    assert.deepEqual(positions, [0]);
    assert.deepEqual(durations, [0]);
    assert.deepEqual(states, [false]);

    await waitFor(p, 'duration-changed', d => d > 0);
    assert.equal(near(p.duration, 2, 0.3), true);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);

    // mesmo uri: nada muda
    positions.length = 0;
    p.load(otherUri);
    assert.deepEqual(positions, []);
    p.load(null);
});

testAsync('trocar de uri: posição e duração já zeradas quando notify::uri chega', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    p.seek(2); // a posição muda na hora
    assert.equal(p.position, 2);

    const seen = [];
    const id = p.connect('notify::uri', () => seen.push([p.uri, p.position, p.duration]));
    p.load(otherUri);
    p.disconnect(id);
    assert.deepEqual(seen, [[otherUri, 0, 0]]);
    p.load(null);
});

testAsync('fim da mídia → ended, position 0, playing false (state-changed(false) uma vez); toca de novo', async () => {
    const p = newPlayback();
    p.load(otherUri); // 2 s
    await waitFor(p, 'duration-changed', d => d > 0);
    p.play();
    await waitFor(p, 'state-changed', s => s === true);
    const states = record(p, 'state-changed');
    const ended = record(p, 'ended');
    p.seek(1.5);
    await waitFor(p, 'ended', () => true, 4000);
    assert.equal(ended.length, 1);
    assert.equal(p.position, 0);
    assert.equal(p.playing, false);
    await sleep(300);
    assert.deepEqual(states, [false]);
    assert.equal(p.position, 0);
    assert.equal(p.uri, otherUri);

    p.play();
    await waitFor(p, 'position-updated', pos => pos > 0.2);
    assert.equal(p.playing, true);
    p.load(null);
});

testAsync('stop zera a posição e não deixa tocando', async () => {
    const p = newPlayback();
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    p.play();
    await waitFor(p, 'position-updated', pos => pos > 0.2);
    p.stop();
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
    p.stop();
    p.load(null);
});

testAsync('troca perto do fim da mídia antiga: sem ended espúrio e com duração/posição da nova', async () => {
    const p = newPlayback();
    p.load(otherUri); // 2 s
    await waitFor(p, 'duration-changed', d => d > 0);
    p.play();
    await waitFor(p, 'position-updated', pos => pos >= 1.85, 5000);
    const ended = record(p, 'ended');
    const positions = record(p, 'position-updated');
    p.load(uri); // 3 s; o EOS da antiga (≈2 s) estaria a caminho
    await waitFor(p, 'duration-changed', d => d > 0);
    await sleep(900);
    assert.equal(ended.length, 0);
    assert.equal(p.uri, uri);
    assert.equal(near(p.duration, 3, 0.3), true);
    assert.equal(p.position, 0);
    assert.equal(p.playing, false);
    assert.equal(positions.every(v => v === 0), true);
    p.load(null);
}, 15000);

testAsync('rate e volume escolhidos antes do load valem no player novo (≈2x)', async () => {
    const p = newPlayback();
    p.setRate(2);
    p.load(uri);
    await waitFor(p, 'duration-changed', d => d > 0);
    assert.equal(p.rate, 2);
    p.play();
    let first = null;
    let last = null;
    p.connect('position-updated', (_p, pos) => {
        const sample = { pos, t: GLib.get_monotonic_time() / 1e6 };
        if (first === null && pos > 0.3)
            first = sample;
        if (first !== null)
            last = sample;
    });
    await waitFor(p, 'position-updated', pos => pos > 0.3);
    await sleep(600);
    const speed = (last.pos - first.pos) / (last.t - first.t);
    assert.equal(speed > 1.5 && speed < 2.6, true);
    assert.equal(p.rate, 2);
    p.load(null);
}, 15000);

testAsync('arquivo inexistente → error, playing false e o toggle seguinte chama play', async () => {
    const p = newPlayback();
    const errors = record(p, 'error');
    const failed = waitFor(p, 'error');
    p.load(missingUri);
    await failed;
    assert.equal(errors.length >= 1, true);
    assert.equal(errors[0], 'falha ao reproduzir');
    assert.equal(p.playing, false);
    let calls = [];
    const play = p.play.bind(p);
    const pause = p.pause.bind(p);
    p.play = () => {
        calls.push('play');
        play();
    };
    p.pause = () => {
        calls.push('pause');
        pause();
    };
    p.toggle();
    assert.deepEqual(calls, ['play']);
    // o play pedido também falha; o toggle seguinte continua tentando tocar
    await sleep(500);
    calls = [];
    p.toggle();
    assert.deepEqual(calls, ['play']);
    p.load(null);
});

testAsync('20 loads seguidos descartam os players antigos (handlers desconectados)', async () => {
    const p = newPlayback();
    let previous = null;
    let previousIds = [];
    for (let i = 0; i < 20; i++) {
        p.load(Gio.File.new_for_path(links[i]).get_uri());
        if (previous) {
            assert.equal(previous !== p._player, true);
            for (const id of previousIds)
                assert.equal(GObject.signal_handler_is_connected(previous, id), false);
        }
        previous = p._player;
        previousIds = p._handlerIds.slice();
        assert.equal(previousIds.length >= 5, true);
        if (i % 5 === 0)
            p.play();
        await sleep(30);
    }
    if (!(p.duration > 0))
        await waitFor(p, 'duration-changed', d => d > 0);
    assert.equal(near(p.duration, 3, 0.3), true);
    p.load(null);
    assert.equal(p._player, null);
    await sleep(200);
    assert.equal(p.playing, false);
    assert.equal(p.position, 0);
}, 15000);

testAsync('limpeza do diretório temporário', async () => {
    for (const name of ['sine.ogg', 'other.ogg'])
        Gio.File.new_for_path(GLib.build_filenamev([tmp, name])).delete(null);
    for (const link of links)
        Gio.File.new_for_path(link).delete(null);
    Gio.File.new_for_path(tmp).delete(null);
});

finish();
