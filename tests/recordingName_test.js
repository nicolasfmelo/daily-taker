const { test, assert, finish } = imports.harness;
const { Gio, GLib } = imports.gi;
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

// recordingFileFor: escolhe o arquivo de uma gravação nova numa pasta real (temporária).
const withTmpDir = fn => {
    const path = GLib.Dir.make_tmp('daily-taker-name-XXXXXX');
    try {
        fn(Gio.File.new_for_path(path));
    } finally {
        const dir = Gio.File.new_for_path(path);
        const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)))
            dir.get_child(info.get_name()).delete(null);
        en.close(null);
        dir.delete(null);
    }
};
const touch = (dir, name) => dir.get_child_for_display_name(name).create(Gio.FileCreateFlags.NONE, null).close(null);
const listing = dir => {
    const names = [];
    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = en.next_file(null)))
        names.push(info.get_name());
    en.close(null);
    return names.sort();
};

test('recordingFileFor: nome por data/hora, (2), (3) e minuto diferente', () => {
    withTmpDir(dir => {
        const f1 = R.recordingFileFor(dir, date);
        assert.equal(f1.get_basename(), 'Gravação 22 out 14:30');
        assert.equal(f1.get_parent().get_path(), dir.get_path());
        assert.equal(f1.query_exists(null), false);
        touch(dir, f1.get_basename());

        const f2 = R.recordingFileFor(dir, new Date(2026, 9, 22, 14, 30, 59));
        assert.equal(f2.get_basename(), 'Gravação 22 out 14:30 (2)');
        touch(dir, f2.get_basename());

        assert.equal(R.recordingFileFor(dir, date).get_basename(), 'Gravação 22 out 14:30 (3)');
        assert.equal(R.recordingFileFor(dir, new Date(2026, 9, 22, 14, 31)).get_basename(), 'Gravação 22 out 14:31');
    });
});

test('recordingFileFor: gravações antigas não interferem nem são tocadas', () => {
    withTmpDir(dir => {
        touch(dir, 'Recording 1');
        touch(dir, 'Gravação 3');
        const before = listing(dir);
        assert.equal(R.recordingFileFor(dir, date).get_basename(), 'Gravação 22 out 14:30');
        assert.deepEqual(listing(dir), before);
    });
});

test('recordingFileFor: nome sem "/" e nunca termina em .transcript.json', () => {
    withTmpDir(dir => {
        for (let i = 0; i < 4; i++) {
            const f = R.recordingFileFor(dir, date);
            const name = f.get_basename();
            assert.equal(name.includes('/'), false);
            assert.equal(name.endsWith('.transcript.json'), false);
            assert.equal(f.get_parent().get_path(), dir.get_path());
            touch(dir, name);
        }
        assert.equal(listing(dir).length, 4);
    });
});

finish();
