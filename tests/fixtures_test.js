// Roda tools/make-fixtures.sh num diretório temporário (modo rápido) e confere o resultado.
const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const { test, assert, finish } = imports.harness;
const T = imports.transcript;

const SCRIPT = GLib.build_filenamev([GLib.get_current_dir(), 'tools', 'make-fixtures.sh']);
const NAMES = ['Daily · Projeto Atlas', 'Ideias para o app', 'Notas da reunião'];
const UNTRANSCRIBED = 'Sem transcrição';

const run = (dir, extraEnv = {}) => {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
    });
    launcher.setenv('FIXTURE_FAST', '1', true);
    for (const [k, v] of Object.entries(extraEnv))
        launcher.setenv(k, v, true);
    const proc = launcher.spawnv(['bash', SCRIPT, dir]);
    const [, out] = proc.communicate_utf8(null, null);
    return { status: proc.get_exit_status(), out };
};

const rmTree = path => {
    GLib.spawn_sync(null, ['rm', '-rf', '--', path], null, GLib.SpawnFlags.SEARCH_PATH, null);
};

const loadJson = path => {
    const [, bytes] = GLib.file_get_contents(path);
    return ByteArray.toString(bytes);
};

const tmp = GLib.Dir.make_tmp('daily-taker-fixtures-XXXXXX');
const data = GLib.build_filenamev([tmp, 'daily-taker']);
const first = run(tmp);

test('make-fixtures.sh termina com sucesso', () => {
    assert.equal(first.status, 0);
});

test('cria 4 gravações (sem extensão) e 3 transcrições', () => {
    for (const name of [...NAMES, UNTRANSCRIBED])
        assert.equal(GLib.file_test(GLib.build_filenamev([data, name]), GLib.FileTest.IS_REGULAR), true);
    for (const name of NAMES)
        assert.equal(GLib.file_test(GLib.build_filenamev([data, `${name}.transcript.json`]), GLib.FileTest.IS_REGULAR), true);
    assert.equal(GLib.file_test(GLib.build_filenamev([data, `${UNTRANSCRIBED}.transcript.json`]), GLib.FileTest.EXISTS), false);
});

test('as gravações são Ogg', () => {
    for (const name of [...NAMES, UNTRANSCRIBED]) {
        const [, bytes] = GLib.file_get_contents(GLib.build_filenamev([data, name]));
        assert.equal(ByteArray.toString(bytes.slice(0, 4)), 'OggS');
    }
});

test('transcrições v1 legíveis por parseTranscript, com Nicolas e Locutor 2', () => {
    for (const name of NAMES) {
        const t = T.parseTranscript(loadJson(GLib.build_filenamev([data, `${name}.transcript.json`])));
        assert.equal(t.title, name);
        assert.equal(t.speakers['0'], 'Nicolas');
        const labels = new Set(T.buildBlocks(t).map(b => b.label));
        assert.equal(labels.has('Nicolas'), true);
        assert.equal(labels.has('Locutor 2'), true);
    }
});

test('blocos da mockup começam em 0, 18, 34 e 47 s e a lista rola', () => {
    const t = T.parseTranscript(loadJson(GLib.build_filenamev([data, `${NAMES[0]}.transcript.json`])));
    const blocks = T.buildBlocks(t);
    assert.deepEqual(blocks.slice(0, 4).map(b => b.start), [0, 18, 34, 47]);
    assert.equal(blocks[0].text, 'Bom dia, pessoal. Vamos começar pelo que avançou ontem e pelo que precisamos resolver hoje.');
    assert.equal(blocks[3].text, 'Vou deixar os horários clicáveis para voltar direto ao trecho da gravação.');
    assert.equal(blocks.length >= 8, true);
});

test('durações nominais 1148, 272 e 760 s', () => {
    const d = NAMES.map(n => T.parseTranscript(loadJson(GLib.build_filenamev([data, `${n}.transcript.json`]))).duration);
    assert.deepEqual(d, [1148, 272, 760]);
});

test('ordem por data de modificação: Daily, Ideias, Notas, Sem transcrição', () => {
    const mtime = name => Gio.File.new_for_path(GLib.build_filenamev([data, name]))
        .query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null)
        .get_attribute_uint64('time::modified');
    const times = [...NAMES, UNTRANSCRIBED].map(mtime);
    for (let i = 1; i < times.length; i++)
        assert.equal(times[i - 1] > times[i], true);
    const today = GLib.DateTime.new_now_local().format('%F');
    assert.equal(GLib.DateTime.new_from_unix_local(times[0]).format('%F %H:%M'), `${today} 09:30`);
    assert.equal(GLib.DateTime.new_from_unix_local(times[1]).format('%F %H:%M'), `${today} 08:12`);
});

test('roda de novo no mesmo diretório (idempotente)', () => {
    const again = run(tmp);
    assert.equal(again.status, 0);
});

test('recusa diretório com arquivos que não são fixtures', () => {
    const other = GLib.Dir.make_tmp('daily-taker-fixtures-XXXXXX');
    try {
        GLib.mkdir_with_parents(GLib.build_filenamev([other, 'daily-taker']), 0o755);
        GLib.file_set_contents(GLib.build_filenamev([other, 'daily-taker', 'Gravação real']), 'x');
        assert.equal(run(other).status !== 0, true);
        assert.equal(GLib.file_test(GLib.build_filenamev([other, 'daily-taker', NAMES[0]]), GLib.FileTest.EXISTS), false);
    } finally {
        rmTree(other);
    }
});

test('recusa diretório dentro de ~/.local/share e ~/.config reais', () => {
    for (const base of [GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share']),
        GLib.build_filenamev([GLib.get_home_dir(), '.config'])]) {
        const target = GLib.build_filenamev([base, 'daily-taker-fixtures-test-never']);
        assert.equal(run(target).status !== 0, true);
        assert.equal(GLib.file_test(target, GLib.FileTest.EXISTS), false);
    }
    // Também com HOME trocado: a checagem usa o home real do usuário.
    const target = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share']);
    assert.equal(run(target, { HOME: '/nonexistent' }).status !== 0, true);
});

rmTree(tmp);
finish();
