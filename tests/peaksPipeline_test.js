// Picos da forma de onda: o pipeline decodifica o mais rápido possível (sem sincronizar
// com o relógio) e entrega um pico por mensagem do `level` (a cada 100 ms de áudio).
const { Gio, GLib, Gst } = imports.gi;
const { testAsync, assert, finish } = imports.harness;
const { activePeakJobs, cancelAllPeaks, generatePeaks } = imports.peaksPipeline;

Gst.init(null);

const tmp = GLib.Dir.make_tmp('daily-taker-peaks-XXXXXX');
const media = GLib.build_filenamev([tmp, 'sine.ogg']);
const [ok, , , status] = GLib.spawn_sync(null, [
    'ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=d=30',
    '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', media,
], null, GLib.SpawnFlags.SEARCH_PATH, null);
if (!ok || status !== 0)
    throw new Error('ffmpeg falhou');
const uri = Gio.File.new_for_path(media).get_uri();

const run = target => new Promise((resolve, reject) => {
    generatePeaks(target, { onDone: resolve, onError: reject });
});

testAsync('30 s de áudio viram ~300 picos bem antes de 30 s', async () => {
    const start = GLib.get_monotonic_time();
    const peaks = await run(uri);
    const seconds = (GLib.get_monotonic_time() - start) / 1e6;
    print(`     ${peaks.length} picos em ${seconds.toFixed(2)} s`);
    assert.equal(seconds < 5, true);
    assert.equal(Math.abs(peaks.length - 300) <= 3, true);
    assert.equal(peaks.every(p => p >= 0 && p <= 1), true);
    assert.equal(peaks.slice(5, -5).every(p => p > 0.1), true);
}, 20000);

testAsync('arquivo inexistente chama onError', async () => {
    const missing = Gio.File.new_for_path(GLib.build_filenamev([tmp, 'nao-existe.ogg'])).get_uri();
    let failed = false;
    try {
        await run(missing);
    } catch (e) {
        failed = true;
    }
    assert.equal(failed, true);
});

testAsync('cancel() interrompe sem chamar os callbacks', async () => {
    let called = false;
    const handle = generatePeaks(uri, {
        onDone: () => (called = true),
        onError: () => (called = true),
    });
    handle.cancel();
    handle.cancel();
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
    assert.equal(called, false);
});

// Fechar o app com picos ainda sendo gerados: tudo para (pipelines em NULL, sem avisos do
// GStreamer ao finalizar) e nenhum callback chega depois.
testAsync('cancelAllPeaks() interrompe todos os trabalhos em andamento', async () => {
    let called = 0;
    const handles = [1, 2, 3].map(() => generatePeaks(uri, {
        onDone: () => called++,
        onError: () => called++,
    }));
    assert.equal(activePeakJobs(), 3);
    assert.equal(cancelAllPeaks(), 3);
    assert.equal(activePeakJobs(), 0);
    // cancel() individual depois do cancelAll: nada a fazer, sem lançar.
    assert.equal(handles[0].cancel(), false);
    assert.equal(cancelAllPeaks(), 0);
    await new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
    assert.equal(called, 0);
});

testAsync('um trabalho que terminou sai da lista de ativos', async () => {
    await run(uri);
    assert.equal(activePeakJobs(), 0);
}, 20000);

GLib.spawn_sync(null, ['rm', '-rf', tmp], null, GLib.SpawnFlags.SEARCH_PATH, null);
finish();
