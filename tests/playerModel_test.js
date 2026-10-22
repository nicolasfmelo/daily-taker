const { test, assert, finish } = imports.harness;
const P = imports.playerModel;

test('formatShortClock', () => {
    assert.equal(P.formatShortClock(34), '00:34');
    assert.equal(P.formatShortClock(34.9), '00:34');
    assert.equal(P.formatShortClock(0), '00:00');
    assert.equal(P.formatShortClock(1148), '19:08');
    assert.equal(P.formatShortClock(3599), '59:59');
    assert.equal(P.formatShortClock(3723), '1:02:03');
    assert.equal(P.formatShortClock(36000), '10:00:00');
});

test('positionLabel', () => {
    assert.equal(P.positionLabel(34, 1148), '00:34 / 19:08');
    assert.equal(P.positionLabel(3723, 7200), '1:02:03 / 2:00:00');
});

test('RATES e rateLabel usam vírgula', () => {
    assert.deepEqual(P.RATES, [0.75, 1, 1.25, 1.5, 2]);
    assert.deepEqual(P.RATES.map(P.rateLabel), ['0,75x', '1x', '1,25x', '1,5x', '2x']);
});

test('clampVolume', () => {
    assert.equal(P.clampVolume(0.4), 0.4);
    assert.equal(P.clampVolume(-1), 0);
    assert.equal(P.clampVolume(3), 1);
    assert.equal(P.clampVolume(NaN), 1);
});

test('fractionFromX', () => {
    assert.equal(P.fractionFromX(50, 200), 0.25);
    assert.equal(P.fractionFromX(-10, 200), 0);
    assert.equal(P.fractionFromX(500, 200), 1);
    assert.equal(P.fractionFromX(10, 0), 0);
    assert.equal(P.fractionFromX(10, -5), 0);
});

const near = (actual, expected, what = '') => {
    if (Math.abs(actual - expected) > 1e-6)
        throw new Error(`${what} esperado ${expected}, recebido ${actual}`);
};
const nearAll = (actual, expected) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((v, i) => near(v, expected[i], `[${i}]`));
};

test('bucketPeaks: RMS (energia média) por balde, não o máximo', () => {
    nearAll(P.bucketPeaks([0.1, 0.9, 0.2, 0.3], 2), [Math.sqrt((0.01 + 0.81) / 2), Math.sqrt((0.04 + 0.09) / 2)]);
    nearAll(P.bucketPeaks([0.1, 0.9, 0.2, 0.3], 4), [0.1, 0.9, 0.2, 0.3]);
    nearAll(P.bucketPeaks([0.5, 0.2, 0.8], 1), [Math.sqrt((0.25 + 0.04 + 0.64) / 3)]);
});

test('bucketPeaks: um pico isolado não enche o balde (a fala longa não vira barras iguais)', () => {
    const quiet = new Array(99).fill(0.1);
    const [withSpike] = P.bucketPeaks([...quiet, 1], 1);
    assert.equal(withSpike < 0.2, true);
    assert.equal(withSpike > 0.1, true);
});

test('bucketPeaks: menos picos que barras repete em vez de deixar buracos', () => {
    const out = P.bucketPeaks([0.5, 1], 4);
    assert.equal(out.length, 4);
    assert.deepEqual(out, [0.5, 0.5, 1, 1]);
});

test('bucketPeaks: vazio e barras inválidas', () => {
    assert.deepEqual(P.bucketPeaks([], 3), [0, 0, 0]);
    assert.deepEqual(P.bucketPeaks([0.5], 0), []);
    assert.deepEqual(P.bucketPeaks([0.5], -2), []);
    assert.deepEqual(P.bucketPeaks([0.5], NaN), []);
});

// Fala de ~19 min com trechos mais altos e mais baixos e pausas: um pico por 100 ms.
const syntheticSpeech = () => {
    // Numa reunião o volume muda pouco de um trecho para outro.
    const levels = [0.7, 0.85, 0.6, 0.9, 0.75, 0.65, 0.8, 0.95, 0.7, 0.85];
    const peaks = [];
    for (let i = 0; i < 11480; i++) {
        const level = levels[Math.floor(i / 400) % levels.length];
        // Sílabas (variação rápida) e uma pausa curta a cada ~3 s.
        const syllable = 0.6 + 0.4 * Math.abs(Math.sin(i * 1.7));
        peaks.push(i % 30 < 4 ? 0.02 : level * syllable);
    }
    return peaks;
};

test('normalizeBars: estica entre os percentis 5 e 95, com piso para o que não é silêncio', () => {
    const values = [];
    for (let i = 0; i < 70; i++)
        values.push(0.6 + 0.35 * ((i * 37) % 70) / 69);
    const out = P.normalizeBars(values);
    assert.equal(out.length, 70);
    assert.equal(out.every(v => v >= P.BAR_FLOOR - 1e-9 && v <= 1), true);
    assert.equal(Math.max(...out), 1);
    near(Math.min(...out), P.BAR_FLOOR, 'mínimo');
    // Monotônico: um valor maior nunca fica com barra menor.
    for (let i = 0; i < values.length; i++) {
        for (let j = 0; j < values.length; j++) {
            if (values[i] < values[j])
                assert.equal(out[i] <= out[j], true);
        }
    }
    assert.equal(new Set(out.map(v => v.toFixed(3))).size > 50, true);
});

test('normalizeBars: silêncio fica em zero; acima do p95 satura em 1', () => {
    const values = [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 5.0];
    const out = P.normalizeBars(values);
    assert.equal(out[0], 0);
    assert.equal(out[9], 1);
    assert.equal(out.slice(1).every(v => v >= P.BAR_FLOOR), true);
});

test('normalizeBars: sinal quase constante não é esticado (não inventa variação)', () => {
    const values = [0.98, 0.99, 1.0, 0.985, 0.995, 0.99, 0.98, 1.0];
    const out = P.normalizeBars(values);
    assert.equal(out.every(v => v > 0.95), true);
    assert.deepEqual(P.normalizeBars([0, 0, 0]), [0, 0, 0]);
    assert.deepEqual(P.normalizeBars([]), []);
});

test('waveformBars: gravação longa de fala sai com alturas variadas (não chapada)', () => {
    const peaks = syntheticSpeech();
    const bars = P.waveformBars(peaks, 70);
    assert.equal(bars.length, 70);
    const tall = bars.filter(v => v >= 0.95).length;
    const distinct = new Set(bars.map(v => Math.round(v * 20))).size;
    print(`     mínimo ${Math.min(...bars).toFixed(2)}, ${tall}/70 barras ≥ 0,95, ${distinct} alturas distintas`);
    assert.equal(Math.min(...bars) < 0.4, true);
    assert.equal(tall < 70 * 0.3, true);
    assert.equal(distinct >= 8, true);
    // O máximo por balde (o antigo) deixava quase tudo no topo.
    const oldMax = (() => {
        const out = [];
        for (let i = 0; i < 70; i++) {
            const a = Math.floor(i * peaks.length / 70);
            const b = Math.floor((i + 1) * peaks.length / 70);
            out.push(Math.max(...peaks.slice(a, b)));
        }
        const top = Math.max(...out);
        return out.map(v => v / top);
    })();
    assert.equal(Math.min(...oldMax) > 0.6, true);
});

test('waveformBars: barras inválidas e sem picos', () => {
    assert.deepEqual(P.waveformBars([0.5], 0), []);
    assert.deepEqual(P.waveformBars([], 3), [0, 0, 0]);
});

test('BarsCache: recalcula só quando os picos (mesmo array) ou o número de barras mudam', () => {
    let computed = 0;
    const cache = new P.BarsCache((peaks, count) => {
        computed++;
        return P.waveformBars(peaks, count);
    });
    const peaks = syntheticSpeech();
    const first = cache.get(peaks, 70);
    assert.equal(cache.get(peaks, 70), first);
    assert.equal(computed, 1);
    cache.get(peaks, 71);
    assert.equal(computed, 2);
    cache.get([...peaks], 71);
    assert.equal(computed, 3);
    cache.clear();
    cache.get(peaks, 71);
    assert.equal(computed, 4);
    // Sem função: usa waveformBars.
    assert.deepEqual(new P.BarsCache().get([], 2), [0, 0]);
});

test('shouldScroll', () => {
    assert.equal(P.shouldScroll({ follow: true, index: 3, previousIndex: 2 }), true);
    assert.equal(P.shouldScroll({ follow: true, index: 0, previousIndex: -1 }), true);
    assert.equal(P.shouldScroll({ follow: false, index: 3, previousIndex: 2 }), false);
    assert.equal(P.shouldScroll({ follow: true, index: 3, previousIndex: 3 }), false);
    assert.equal(P.shouldScroll({ follow: true, index: -1, previousIndex: 2 }), false);
});

test('playerModel: entradas ausentes ficam bem formadas', () => {
    for (const bad of [NaN, -5, null, undefined, Infinity])
        assert.equal(P.formatShortClock(bad), '00:00');
    assert.equal(P.positionLabel(NaN, undefined), '00:00 / 00:00');
    assert.equal(P.positionLabel(null, 60), '00:00 / 01:00');
    assert.equal(P.rateLabel(NaN), '1x');
    assert.equal(P.rateLabel(undefined), '1x');
    assert.equal(P.clampVolume(undefined), 1);
    assert.equal(P.fractionFromX(NaN, 100), 0);
    assert.equal(P.fractionFromX(10, NaN), 0);
    assert.deepEqual(P.bucketPeaks(null, 2), [0, 0]);
    nearAll(P.bucketPeaks([NaN, undefined, 0.5], 3), [0, 0, 0.5]);
    assert.deepEqual(P.normalizeBars(null), []);
    assert.deepEqual(P.normalizeBars([NaN, -1, undefined]), [0, 0, 0]);
    assert.equal(P.shouldScroll({}), false);
    assert.equal(P.shouldScroll({ follow: true, index: NaN, previousIndex: 1 }), false);
});

test('volumeIcon: mudo, baixo, médio e alto', () => {
    assert.equal(P.volumeIcon(0.8, true), 'audio-volume-muted-symbolic');
    assert.equal(P.volumeIcon(0, false), 'audio-volume-muted-symbolic');
    assert.equal(P.volumeIcon(0.2, false), 'audio-volume-low-symbolic');
    assert.equal(P.volumeIcon(0.33, false), 'audio-volume-low-symbolic');
    assert.equal(P.volumeIcon(0.5, false), 'audio-volume-medium-symbolic');
    assert.equal(P.volumeIcon(0.66, false), 'audio-volume-medium-symbolic');
    assert.equal(P.volumeIcon(0.67, false), 'audio-volume-high-symbolic');
    assert.equal(P.volumeIcon(1, false), 'audio-volume-high-symbolic');
    assert.equal(P.volumeIcon(NaN, false), 'audio-volume-high-symbolic');
});

test('toggleMute: muta lembrando o volume e desmuta restaurando', () => {
    assert.deepEqual(P.toggleMute({ volume: 0.6, muted: false, previous: 1 }),
        { volume: 0, muted: true, previous: 0.6 });
    assert.deepEqual(P.toggleMute({ volume: 0, muted: true, previous: 0.6 }),
        { volume: 0.6, muted: false, previous: 0.6 });
    // Volume já em 0 (arrastado até o fim): clicar volta ao anterior, ou a 100 %.
    assert.deepEqual(P.toggleMute({ volume: 0, muted: false, previous: 0.3 }),
        { volume: 0.3, muted: false, previous: 0.3 });
    assert.deepEqual(P.toggleMute({ volume: 0, muted: false, previous: 0 }),
        { volume: 1, muted: false, previous: 1 });
    assert.deepEqual(P.toggleMute({}), { volume: 0, muted: true, previous: 1 });
});

// Relógio e temporizadores falsos para o SeekCoalescer.
const fakeClock = () => {
    const clock = { now: 0, timers: [], sent: [] };
    clock.schedule = (ms, fn) => {
        const timer = { at: clock.now + ms, fn };
        clock.timers.push(timer);
        return timer;
    };
    clock.cancel = timer => {
        clock.timers = clock.timers.filter(t => t !== timer);
    };
    clock.advance = ms => {
        clock.now += ms;
        const due = clock.timers.filter(t => t.at <= clock.now);
        clock.timers = clock.timers.filter(t => t.at > clock.now);
        due.forEach(t => t.fn());
    };
    return clock;
};

const coalescer = clock => new P.SeekCoalescer({
    interval: 60,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    send: v => clock.sent.push(v),
});

test('SeekCoalescer: o primeiro pedido sai já; os seguintes no máximo um a cada 60 ms', () => {
    const clock = fakeClock();
    const c = coalescer(clock);
    c.request(0.1);
    assert.deepEqual(clock.sent, [0.1]);
    clock.advance(10);
    c.request(0.2);
    clock.advance(10);
    c.request(0.3);
    assert.deepEqual(clock.sent, [0.1]);
    assert.equal(clock.timers.length, 1);
    clock.advance(40);
    // Só o último pedido pendente sai, no fim do intervalo.
    assert.deepEqual(clock.sent, [0.1, 0.3]);
    clock.advance(100);
    assert.deepEqual(clock.sent, [0.1, 0.3]);
    c.request(0.4);
    assert.deepEqual(clock.sent, [0.1, 0.3, 0.4]);
});

test('SeekCoalescer: flush (soltar) manda o pendente já e cancela o temporizador', () => {
    const clock = fakeClock();
    const c = coalescer(clock);
    c.request(0.1);
    clock.advance(5);
    c.request(0.5);
    c.flush();
    assert.deepEqual(clock.sent, [0.1, 0.5]);
    assert.equal(clock.timers.length, 0);
    // Nada pendente: flush não repete o último.
    c.flush();
    assert.deepEqual(clock.sent, [0.1, 0.5]);
});

test('SeekCoalescer: cancel descarta o pendente', () => {
    const clock = fakeClock();
    const c = coalescer(clock);
    c.request(0.1);
    c.request(0.2);
    c.cancel();
    clock.advance(100);
    c.flush();
    assert.deepEqual(clock.sent, [0.1]);
});

test('positionHeld: ignora a posição do player logo depois de soltar o arraste', () => {
    assert.equal(P.positionHeld(1000, 900, 200), true);
    assert.equal(P.positionHeld(1100, 900, 200), false);
    assert.equal(P.positionHeld(1000, null, 200), false);
    assert.equal(P.positionHeld(1000, undefined, 200), false);
});

finish();
