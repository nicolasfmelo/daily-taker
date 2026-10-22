const { test, assert, finish } = imports.harness;
const R = imports.recordingName;

const date = new Date(2026, 9, 22, 14, 30);

test('defaultRecordingName', () => {
    assert.equal(R.defaultRecordingName(date, () => false), 'Gravação 22 out 14:30');
    assert.equal(R.defaultRecordingName(new Date(2026, 0, 5, 7, 5), () => false), 'Gravação 5 jan 07:05');
    assert.equal(R.defaultRecordingName(new Date(2026, 2, 9, 0, 0), () => false), 'Gravação 9 mar 00:00');
    assert.equal(R.defaultRecordingName(new Date(2026, 11, 31, 23, 59), () => false), 'Gravação 31 dez 23:59');
});

test('defaultRecordingName: abreviações dos doze meses', () => {
    const names = [];
    for (let m = 0; m < 12; m++)
        names.push(R.defaultRecordingName(new Date(2026, m, 1, 10, 0), () => false).split(' ')[2]);
    assert.deepEqual(names, ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']);
});

test('defaultRecordingName: colisão acrescenta (2), (3)…', () => {
    const taken = new Set(['Gravação 22 out 14:30']);
    assert.equal(R.defaultRecordingName(date, n => taken.has(n)), 'Gravação 22 out 14:30 (2)');
    taken.add('Gravação 22 out 14:30 (2)');
    taken.add('Gravação 22 out 14:30 (3)');
    assert.equal(R.defaultRecordingName(date, n => taken.has(n)), 'Gravação 22 out 14:30 (4)');
});

test('recordingName: data inválida ou exists ausente não geram undefined/NaN', () => {
    assert.equal(R.defaultRecordingName(new Date(NaN), () => false), 'Gravação');
    assert.equal(R.defaultRecordingName(null, () => false), 'Gravação');
    assert.equal(R.defaultRecordingName(undefined, n => n === 'Gravação'), 'Gravação (2)');
    assert.equal(R.defaultRecordingName(date), 'Gravação 22 out 14:30');
    assert.equal(R.defaultRecordingName(date, null), 'Gravação 22 out 14:30');
});

finish();
