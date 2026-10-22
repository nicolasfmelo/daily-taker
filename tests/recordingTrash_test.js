const { Gio, GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const { trashRecordingFiles, trashRecordingFilesSync } = imports.recordingTrash;

const rmTree = file => {
    if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null) === Gio.FileType.DIRECTORY) {
        const en = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        for (let info = en.next_file(null); info; info = en.next_file(null))
            rmTree(file.get_child(info.get_name()));
        en.close(null);
    }
    file.delete(null);
};

// Diretório temporário com gravação, transcrição e forma de onda; removido no fim.
const withFiles = fn => {
    const dir = Gio.File.new_for_path(GLib.Dir.make_tmp('daily-taker-trash-XXXXXX'));
    const make = name => {
        const f = dir.get_child(name);
        f.replace_contents('x', null, false, Gio.FileCreateFlags.NONE, null);
        return f;
    };
    const files = { audio: make('Rec'), sidecar: make('Rec.transcript.json'), waveform: make('Rec_data') };
    try {
        return fn(files, dir);
    } finally {
        rmTree(dir);
    }
};

const ioError = () => new Gio.IOErrorEnum({ code: Gio.IOErrorEnum.NOT_SUPPORTED, message: 'sem lixeira' });

// Lixeira de mentira: registra a ordem e tira o arquivo do lugar (nada vai para a real).
const okTrash = calls => f => {
    calls.push(f.get_basename());
    f.delete(null);
};

const quiet = fn => {
    const original = globalThis.log;
    const messages = [];
    globalThis.log = m => messages.push(String(m));
    try {
        return [fn(), messages];
    } finally {
        globalThis.log = original;
    }
};

const runAsync = promise => {
    const loop = GLib.MainLoop.new(null, false);
    let value;
    let error = null;
    promise.then(v => {
        value = v;
    }, e => {
        error = e;
    }).finally(() => loop.quit());
    loop.run();
    if (error)
        throw error;
    return value;
};

test('sync: áudio primeiro, depois transcrição e forma de onda', () => withFiles(files => {
    const calls = [];
    assert.equal(trashRecordingFilesSync(files, { trash: okTrash(calls) }), true);
    assert.deepEqual(calls, ['Rec', 'Rec.transcript.json', 'Rec_data']);
}));

test('sync: lixeira do áudio falhou → nada mais é tocado, false, log sem conteúdo', () => withFiles(files => {
    const calls = [];
    const [ok, messages] = quiet(() => trashRecordingFilesSync(files, {
        trash: f => {
            calls.push(f.get_basename());
            throw ioError();
        },
    }));
    assert.equal(ok, false);
    assert.deepEqual(calls, ['Rec']);
    assert.equal(files.audio.query_exists(null) && files.sidecar.query_exists(null) &&
        files.waveform.query_exists(null), true);
    assert.equal(messages.length, 1);
}));

test('sync: erro que não é GLib também não derruba (devolve false)', () => withFiles(files => {
    const [ok] = quiet(() => trashRecordingFilesSync(files, {
        trash: () => {
            throw new TypeError('x');
        },
    }));
    assert.equal(ok, false);
    assert.equal(files.sidecar.query_exists(null), true);
}));

test('sync: sem transcrição nem forma de onda, só o áudio', () => withFiles(files => {
    files.sidecar.delete(null);
    files.waveform.delete(null);
    const calls = [];
    assert.equal(trashRecordingFilesSync(files, { trash: okTrash(calls) }), true);
    assert.deepEqual(calls, ['Rec']);
}));

test('sync: falha na transcrição depois do áudio: true, transcrição fica (nunca apagada de vez)', () => withFiles(files => {
    const calls = [];
    const [ok] = quiet(() => trashRecordingFilesSync(files, {
        trash: f => {
            calls.push(f.get_basename());
            if (f.get_basename().endsWith('.json'))
                throw ioError();
            f.delete(null);
        },
    }));
    assert.equal(ok, true);
    assert.deepEqual(calls, ['Rec', 'Rec.transcript.json', 'Rec_data']);
    assert.equal(files.sidecar.query_exists(null), true);
}));

test('async: áudio primeiro e só depois do sucesso dele os demais', () => withFiles(files => {
    const calls = [];
    const trashAsync = f => new Promise(resolve => {
        calls.push(`start ${f.get_basename()}`);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            f.delete(null);
            calls.push(`done ${f.get_basename()}`);
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
    assert.equal(runAsync(trashRecordingFiles(files, { trashAsync })), true);
    assert.equal(calls.slice(0, 2).join('|'), 'start Rec|done Rec');
    assert.equal(calls.filter(c => c.startsWith('done')).length, 3);
}));

test('async: áudio falhou → false, transcrição e forma de onda intactas', () => withFiles(files => {
    const calls = [];
    const [ok] = quiet(() => runAsync(trashRecordingFiles(files, {
        trashAsync: f => {
            calls.push(f.get_basename());
            return Promise.reject(ioError());
        },
    })));
    assert.equal(ok, false);
    assert.deepEqual(calls, ['Rec']);
    assert.equal(files.audio.query_exists(null) && files.sidecar.query_exists(null) &&
        files.waveform.query_exists(null), true);
}));

test('async padrão (Gio.File.trash_async) num arquivo que não existe: false, sem lançar', () => {
    const missing = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_tmp_dir(), 'daily-taker-nao-existe-xyz']));
    const [ok] = quiet(() => runAsync(trashRecordingFiles({ audio: missing, sidecar: null, waveform: null })));
    assert.equal(ok, false);
});

finish();
