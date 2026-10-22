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

test('bucketPeaks pega o máximo por balde', () => {
    assert.deepEqual(P.bucketPeaks([0.1, 0.9, 0.2, 0.3], 2), [0.9, 0.3]);
    assert.deepEqual(P.bucketPeaks([0.1, 0.9, 0.2, 0.3], 4), [0.1, 0.9, 0.2, 0.3]);
    assert.deepEqual(P.bucketPeaks([0.5, 0.2, 0.8], 1), [0.8]);
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
    assert.deepEqual(P.bucketPeaks([NaN, undefined, 0.5], 3), [0, 0, 0.5]);
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
