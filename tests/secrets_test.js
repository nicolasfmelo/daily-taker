const { Gio, GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const K = imports.secrets;

const FAKE_KEY = 'sk-or-FAKE-recognisable-9f3a1c';

// Backend em memória; `failWrite` simula um keyring indisponível.
const fakeBackend = (initial = null, failWrite = false) => {
    const b = {
        value: initial,
        writes: 0,
        clears: 0,
        read: () => b.value,
        write(k) {
            if (failWrite)
                throw new Error('keyring indisponível');
            b.writes++;
            b.value = k;
        },
        clear() {
            b.clears++;
            b.value = null;
        },
    };
    return b;
};

const makeStore = ({ secret, file, env } = {}) => new K.KeyStore({
    secret: secret || fakeBackend(),
    file: file || fakeBackend(),
    env: env || (() => null),
});

const tmpDir = () => Gio.File.new_for_path(GLib.Dir.make_tmp('daily-taker-test-XXXXXX'));

const rmTree = dir => {
    const en = dir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = en.next_file(null))) {
        const child = dir.get_child(info.get_name());
        if (info.get_file_type() === Gio.FileType.DIRECTORY)
            rmTree(child);
        else
            child.delete(null);
    }
    dir.delete(null);
};

const withDir = fn => {
    const dir = tmpDir();
    try {
        fn(dir);
    } finally {
        rmTree(dir);
    }
};

const captureLog = fn => {
    const original = globalThis.log;
    const messages = [];
    globalThis.log = m => messages.push(String(m));
    try {
        fn();
    } finally {
        globalThis.log = original;
    }
    return messages;
};

const modeOf = file => file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
    .get_attribute_uint32('unix::mode') & 0o777;

test('ordem de prioridade: secret > file > env', () => {
    const store = makeStore({
        secret: fakeBackend('do-secret'),
        file: fakeBackend('do-arquivo'),
        env: () => 'do-env',
    });
    assert.deepEqual(store.get(), { key: 'do-secret', source: 'secret' });
    store._secret.value = null;
    assert.deepEqual(store.get(), { key: 'do-arquivo', source: 'file' });
    store._file.value = null;
    assert.deepEqual(store.get(), { key: 'do-env', source: 'env' });
});

test('sem nada configurado: get devolve null', () => {
    assert.equal(makeStore().get(), null);
});

test('valores em branco nos backends são ignorados', () => {
    const store = makeStore({
        secret: fakeBackend('   '),
        file: fakeBackend(''),
        env: () => '  \n',
    });
    assert.equal(store.get(), null);
});

test('save grava no secret, apara espaços e não toca no file', () => {
    const secret = fakeBackend();
    const file = fakeBackend();
    const store = makeStore({ secret, file });
    store.save(`  ${FAKE_KEY}\n`);
    assert.equal(secret.value, FAKE_KEY);
    assert.equal(file.writes, 0);
    assert.deepEqual(store.get(), { key: FAKE_KEY, source: 'secret' });
});

test('save cai para o file quando secret.write lança', () => {
    const secret = fakeBackend(null, true);
    const file = fakeBackend();
    const store = makeStore({ secret, file });
    store.save(FAKE_KEY);
    assert.equal(file.value, FAKE_KEY);
    assert.deepEqual(store.get(), { key: FAKE_KEY, source: 'file' });
});

test('save propaga o erro quando secret e file falham, sem vazar a chave', () => {
    const store = makeStore({ secret: fakeBackend(null, true), file: fakeBackend(null, true) });
    let message = null;
    const logs = captureLog(() => {
        try {
            store.save(FAKE_KEY);
        } catch (e) {
            message = `${e.message}\n${e.stack}\n${e}`;
        }
    });
    assert.equal(message !== null, true);
    assert.equal(message.includes(FAKE_KEY), false);
    assert.equal(logs.join('\n').includes(FAKE_KEY), false);
});

test('chave vazia ou só com espaços é rejeitada e nada é gravado', () => {
    const secret = fakeBackend();
    const file = fakeBackend();
    const store = makeStore({ secret, file });
    assert.throws(() => store.save(''));
    assert.throws(() => store.save('   \n\t'));
    assert.throws(() => store.save(null));
    assert.throws(() => store.save(undefined));
    assert.equal(secret.writes + file.writes, 0);
});

test('clear limpa ambos os backends e get volta a cair no env', () => {
    const secret = fakeBackend('do-secret');
    const file = fakeBackend('do-arquivo');
    const store = makeStore({ secret, file, env: () => 'do-env' });
    store.clear();
    assert.equal(secret.clears, 1);
    assert.equal(file.clears, 1);
    assert.deepEqual(store.get(), { key: 'do-env', source: 'env' });
});

test('clear limpa o file mesmo se o secret lançar', () => {
    const file = fakeBackend('do-arquivo');
    const secret = fakeBackend('x');
    secret.clear = () => {
        throw new Error('keyring indisponível');
    };
    const store = makeStore({ secret, file });
    store.clear();
    assert.equal(file.value, null);
});

test('get ignora um backend que lança na leitura', () => {
    const secret = fakeBackend();
    secret.read = () => {
        throw new Error('keyring indisponível');
    };
    const store = makeStore({ secret, file: fakeBackend('do-arquivo') });
    assert.deepEqual(store.get(), { key: 'do-arquivo', source: 'file' });
});

test('toString e JSON do KeyStore não expõem a chave', () => {
    const store = makeStore({ secret: fakeBackend(FAKE_KEY), file: fakeBackend(FAKE_KEY) });
    assert.equal(String(store).includes(FAKE_KEY), false);
    assert.equal(JSON.stringify(store).includes(FAKE_KEY), false);
});

test('file backend real: arquivo criado com modo 0600 e diretório 0700', () => withDir(tmp => {
    const base = tmp.get_child('config').get_child('daily-taker');
    const backend = K.createFileBackend(base.get_path());
    assert.equal(backend.read(), null);
    backend.write(FAKE_KEY);
    const file = base.get_child('api-key');
    assert.equal(file.query_exists(null), true);
    assert.equal(modeOf(file), 0o600);
    assert.equal(modeOf(base), 0o700);
    assert.equal(backend.read(), FAKE_KEY);
}));

test('file backend real: sobrescrever mantém 0600 e não deixa temporários', () => withDir(tmp => {
    const backend = K.createFileBackend(tmp.get_path());
    backend.write('primeira');
    backend.write(FAKE_KEY);
    assert.equal(backend.read(), FAKE_KEY);
    assert.equal(modeOf(tmp.get_child('api-key')), 0o600);
    const en = tmp.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const names = [];
    let info;
    while ((info = en.next_file(null)))
        names.push(info.get_name());
    assert.deepEqual(names, ['api-key']);
}));

test('file backend real: arquivo pré-existente com modo frouxo passa a 0600', () => withDir(tmp => {
    const f = tmp.get_child('api-key');
    f.replace_contents('antiga', null, false, Gio.FileCreateFlags.NONE, null);
    f.set_attribute_uint32('unix::mode', 0o644, Gio.FileQueryInfoFlags.NONE, null);
    const backend = K.createFileBackend(tmp.get_path());
    backend.write(FAKE_KEY);
    assert.equal(modeOf(f), 0o600);
    assert.equal(backend.read(), FAKE_KEY);
}));

test('file backend real: clear remove o arquivo e é idempotente', () => withDir(tmp => {
    const backend = K.createFileBackend(tmp.get_path());
    backend.clear(); // sem arquivo: não lança
    backend.write(FAKE_KEY);
    backend.clear();
    assert.equal(tmp.get_child('api-key').query_exists(null), false);
    assert.equal(backend.read(), null);
    backend.clear();
}));

test('file backend real: conteúdo em branco lê como null', () => withDir(tmp => {
    tmp.get_child('api-key').replace_contents('  \n', null, false, Gio.FileCreateFlags.NONE, null);
    assert.equal(K.createFileBackend(tmp.get_path()).read(), null);
}));

test('file backend real: falha de escrita não vaza a chave', () => withDir(tmp => {
    // um arquivo no lugar do diretório faz a criação do diretório/arquivo falhar
    const blocker = tmp.get_child('bloqueio');
    blocker.replace_contents('x', null, false, Gio.FileCreateFlags.NONE, null);
    const backend = K.createFileBackend(blocker.get_child('sub').get_path());
    let message = null;
    const logs = captureLog(() => {
        try {
            backend.write(FAKE_KEY);
        } catch (e) {
            message = `${e.message}\n${e.stack}\n${e}`;
        }
    });
    assert.equal(message !== null, true);
    assert.equal(message.includes(FAKE_KEY), false);
    assert.equal(logs.join('\n').includes(FAKE_KEY), false);
}));

test('defaultKeyStore sem chave em lugar nenhum: get devolve null; env é usado', () => withDir(tmp => {
    const opts = { configDir: tmp.get_path(), purpose: 'daily-taker-test-lookup-only', env: () => null };
    assert.equal(K.defaultKeyStore(opts).get(), null);
    opts.env = () => 'do-env';
    assert.deepEqual(K.defaultKeyStore(opts).get(), { key: 'do-env', source: 'env' });
}));

finish();
