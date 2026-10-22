const { test, assert, finish } = imports.harness;
const G = imports.recordingGroups;

const now = new Date(2026, 9, 22, 14, 30);
const d = (y, m, day, h = 12, mi = 0) => new Date(y, m, day, h, mi);

test('groupLabel: hoje, ontem, semana, mês, mês antigo', () => {
    assert.equal(G.groupLabel(d(2026, 9, 22, 9, 30), now), 'HOJE');
    assert.equal(G.groupLabel(d(2026, 9, 21), now), 'ONTEM');
    assert.equal(G.groupLabel(d(2026, 9, 18), now), 'ESTA SEMANA');
    assert.equal(G.groupLabel(d(2026, 9, 3), now), 'ESTE MÊS');
    assert.equal(G.groupLabel(d(2026, 8, 15), now), 'SETEMBRO DE 2026');
});

test('groupLabel: fronteiras de meia-noite usam dias de calendário', () => {
    const late = new Date(2026, 9, 22, 0, 5);
    assert.equal(G.groupLabel(new Date(2026, 9, 21, 23, 59), late), 'ONTEM');
    assert.equal(G.groupLabel(new Date(2026, 9, 22, 0, 0), new Date(2026, 9, 22, 23, 59)), 'HOJE');
    // 7 dias atrás ainda é a semana; 8 dias atrás é o mês
    assert.equal(G.groupLabel(d(2026, 9, 15, 0, 1), now), 'ESTA SEMANA');
    assert.equal(G.groupLabel(d(2026, 9, 14, 23, 59), now), 'ESTE MÊS');
    assert.equal(G.groupLabel(d(2026, 9, 20), now), 'ESTA SEMANA');
});

test('groupLabel: virada de mês e de ano', () => {
    const first = new Date(2026, 10, 1, 10, 0);
    assert.equal(G.groupLabel(d(2026, 9, 31), first), 'ONTEM');
    assert.equal(G.groupLabel(d(2026, 9, 28), first), 'ESTA SEMANA');
    assert.equal(G.groupLabel(d(2026, 9, 20), first), 'OUTUBRO DE 2026');
    const jan = new Date(2027, 0, 2, 10, 0);
    assert.equal(G.groupLabel(d(2026, 11, 31), jan), 'ESTA SEMANA');
    assert.equal(G.groupLabel(d(2026, 11, 10), jan), 'DEZEMBRO DE 2026');
    assert.equal(G.groupLabel(d(2025, 9, 22), now), 'OUTUBRO DE 2025');
});

test('groupLabel: mesmo mês de outro ano não é ESTE MÊS; acentos em MARÇO', () => {
    assert.equal(G.groupLabel(d(2025, 9, 3), now), 'OUTUBRO DE 2025');
    assert.equal(G.groupLabel(d(2026, 2, 5), now), 'MARÇO DE 2026');
});

test('groupLabel: data no futuro conta como hoje', () => {
    assert.equal(G.groupLabel(d(2026, 9, 23), now), 'HOJE');
});

test('formatDurationShort', () => {
    assert.equal(G.formatDurationShort(1148), '19min08s');
    assert.equal(G.formatDurationShort(272), '04min32s');
    assert.equal(G.formatDurationShort(59), '00min59s');
    assert.equal(G.formatDurationShort(3600), '1h00min');
    assert.equal(G.formatDurationShort(3900), '1h05min');
    assert.equal(G.formatDurationShort(7384), '2h03min');
    assert.equal(G.formatDurationShort(1148.9), '19min08s');
    assert.equal(G.formatDurationShort(3599.9), '59min59s');
});

test('formatDurationShort: inválidos viram vazio', () => {
    for (const bad of [0, -5, NaN, Infinity, null, undefined])
        assert.equal(G.formatDurationShort(bad), '');
});

test('itemSubtitle: hoje, ontem, antigo', () => {
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 22, 9, 30), durationSec: 1148 }, now), '09:30 • 19min08s');
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 21, 18, 0), durationSec: 760 }, now), 'Ontem • 12min40s');
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 3, 8, 0), durationSec: 272 }, now), '03/10 • 04min32s');
    assert.equal(G.itemSubtitle({ created: d(2026, 0, 9, 8, 0), durationSec: 272 }, now), '09/01 • 04min32s');
});

test('itemSubtitle: sem duração omite o trecho', () => {
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 22, 9, 5), durationSec: 0 }, now), '09:05');
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 21), durationSec: NaN }, now), 'Ontem');
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 3), durationSec: undefined }, now), '03/10');
});

test('itemSubtitle: data futura mostra a hora', () => {
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 23, 7, 5), durationSec: 59 }, now), '07:05 • 00min59s');
});

test('detailSubtitle', () => {
    const created = d(2026, 9, 22, 14, 30);
    assert.equal(G.detailSubtitle({ created, durationSec: 1148, speakerCount: 2 }), '22 out 2026 • 19min08s • 2 locutores');
    assert.equal(G.detailSubtitle({ created, durationSec: 1148, speakerCount: 1 }), '22 out 2026 • 19min08s • 1 locutor');
    assert.equal(G.detailSubtitle({ created: d(2026, 0, 5), durationSec: 60, speakerCount: 3 }), '5 jan 2026 • 01min00s • 3 locutores');
    assert.equal(G.detailSubtitle({ created, durationSec: 0, speakerCount: 0 }), '22 out 2026');
    assert.equal(G.detailSubtitle({ created, durationSec: 90 }), '22 out 2026 • 01min30s');
    assert.equal(G.detailSubtitle({ created, speakerCount: 2 }), '22 out 2026 • 2 locutores');
});

test('groupRecordings agrupa consecutivos preservando a ordem', () => {
    const items = [
        { id: 'a', at: d(2026, 9, 22, 9) },
        { id: 'b', at: d(2026, 9, 22, 8) },
        { id: 'c', at: d(2026, 9, 21) },
        { id: 'd', at: d(2026, 9, 3) },
        { id: 'e', at: d(2026, 9, 2) },
        { id: 'f', at: d(2026, 8, 15) },
    ];
    const groups = G.groupRecordings(items, now, i => i.at);
    assert.deepEqual(groups.map(g => g.label), ['HOJE', 'ONTEM', 'ESTE MÊS', 'SETEMBRO DE 2026']);
    assert.deepEqual(groups.map(g => g.items.map(i => i.id)), [['a', 'b'], ['c'], ['d', 'e'], ['f']]);
});

test('groupRecordings: só agrupa consecutivos e aceita lista vazia', () => {
    const items = [
        { id: 'a', at: d(2026, 9, 22) },
        { id: 'b', at: d(2026, 9, 21) },
        { id: 'c', at: d(2026, 9, 22) },
    ];
    const groups = G.groupRecordings(items, now, i => i.at);
    assert.deepEqual(groups.map(g => g.label), ['HOJE', 'ONTEM', 'HOJE']);
    assert.deepEqual(G.groupRecordings([], now, i => i.at), []);
});

test('recordingGroups: entradas inválidas nunca geram undefined/NaN/null', () => {
    const bad = new Date(NaN);
    assert.equal(G.groupLabel(bad, now), '');
    assert.equal(G.groupLabel(null, now), '');
    assert.equal(G.groupLabel(d(2026, 9, 22), bad), '');
    assert.equal(G.itemSubtitle({ created: bad, durationSec: 60 }, now), '01min00s');
    assert.equal(G.itemSubtitle({ created: null, durationSec: NaN }, now), '');
    assert.equal(G.itemSubtitle({ created: d(2026, 9, 22), durationSec: 60 }, null), '22/10 • 01min00s');
    assert.equal(G.itemSubtitle({}, now), '');
    assert.equal(G.detailSubtitle({}), '');
    assert.equal(G.detailSubtitle({ created: bad, durationSec: NaN, speakerCount: NaN }), '');
    assert.equal(G.detailSubtitle({ created: null, durationSec: 60, speakerCount: -1 }), '01min00s');
    const groups = G.groupRecordings([{ at: null }], now, i => i.at);
    assert.deepEqual(groups.map(g => g.label), ['']);
});

test('itemTimestamp: o menor horário válido entre criação e modificação', () => {
    const table = [
        // [criação, modificação, esperado] (segundos Unix)
        [100, 200, 100],     // gravação: criada no início, modificada no fim
        [300, 200, 200],     // cópia: criação = hora da cópia, depois da modificação
        [0, 200, 200],       // sistema de arquivos sem data de criação
        [200, 0, 200],
        [-5, 200, 200],
        [NaN, 200, 200],
        [undefined, 200, 200],
        [0, 0, null],
        [null, undefined, null],
    ];
    for (const [created, modified, expected] of table)
        assert.equal(G.itemTimestamp(created, modified), expected);
});

test('itemDate: Date da regra itemTimestamp, ou null', () => {
    assert.equal(G.itemDate(300, 200).getTime(), 200 * 1000);
    assert.equal(G.itemDate(100, 200).getTime(), 100 * 1000);
    assert.equal(G.itemDate(0, NaN), null);
    assert.equal(G.itemDate(undefined, undefined), null);
});

test('msUntilNextDay: até a próxima meia-noite local, sempre > 0', () => {
    assert.equal(G.msUntilNextDay(new Date(2026, 9, 22, 23, 59, 0)), 60 * 1000);
    assert.equal(G.msUntilNextDay(new Date(2026, 9, 22, 0, 0, 0)), 24 * 3600 * 1000);
    assert.equal(G.msUntilNextDay(new Date(2026, 9, 22, 14, 30)), (9 * 60 + 30) * 60 * 1000);
    // Dia com mudança de horário (fuso dos testes sem horário de verão: só não pode ser ≤ 0).
    assert.equal(G.msUntilNextDay(new Date(2026, 10, 1, 12, 0)) > 0, true);
    // Data inválida: um valor seguro (1 h) em vez de NaN.
    assert.equal(G.msUntilNextDay(new Date(NaN)), 3600 * 1000);
    assert.equal(G.msUntilNextDay(null), 3600 * 1000);
});

finish();
