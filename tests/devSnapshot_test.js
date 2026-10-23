imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const { COMPONENTS, MUTATING_COMPONENTS, isSandboxed, playbackOptions, silencePlayback, snapshotParams, stateError } =
    imports.devSnapshot;

const player = () => ({ volume: 1, mute: false });

test('sem DAILY_TAKER_SNAPSHOT: snapshotParams é null e silencePlayback não mexe', () => {
    GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    assert.equal(snapshotParams(), null);
    const p = player();
    silencePlayback(p);
    assert.deepEqual(p, { volume: 1, mute: false });
});

test('com DAILY_TAKER_SNAPSHOT: silencePlayback zera volume e silencia', () => {
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        const p = player();
        silencePlayback(p);
        assert.deepEqual(p, { volume: 0, mute: true });
        silencePlayback({});
        silencePlayback(null);
        assert.equal(snapshotParams().component, 'window');
        assert.equal(snapshotParams().width, 1536);
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('--state: lido de DAILY_TAKER_SNAPSHOT_STATE; só "recorder" e só com a janela', () => {
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_STATE');
        assert.equal(snapshotParams().state, null);
        assert.equal(stateError(snapshotParams()), null);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_STATE', 'recorder', true);
        assert.equal(snapshotParams().state, 'recorder');
        assert.equal(stateError(snapshotParams()), null);
        assert.equal(typeof stateError({ component: 'window', state: 'gravando' }), 'string');
        assert.equal(typeof stateError({ component: 'playerbar', state: 'recorder' }), 'string');
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_STATE');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('componentes window e windowcheck registrados; playbackOptions só com captura', () => {
    assert.equal(typeof COMPONENTS.window, 'function');
    assert.equal(typeof COMPONENTS.windowcheck, 'function');
    GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    assert.deepEqual(playbackOptions(), {});
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        assert.equal(typeof playbackOptions().audioSinkFactory, 'function');
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('componente playerbar registrado', () => {
    assert.equal(typeof COMPONENTS.playerbar, 'function');
});

test('componente transcriptview registrado; --find lido do ambiente', () => {
    assert.equal(typeof COMPONENTS.transcriptview, 'function');
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_FIND');
        assert.equal(snapshotParams().find, null);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_FIND', 'reunião', true);
        assert.equal(snapshotParams().find, 'reunião');
        assert.equal('embedded' in snapshotParams(), false);
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_FIND');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('componente detailpane registrado; --state none|running|error|ready só com ele', () => {
    assert.equal(typeof COMPONENTS.detailpane, 'function');
    assert.equal(typeof COMPONENTS.detailpanecheck, 'function');
    for (const state of ['none', 'running', 'error', 'ready'])
        assert.equal(stateError({ component: 'detailpane', state }), null);
    assert.equal(typeof stateError({ component: 'detailpane', state: 'recorder' }), 'string');
    assert.equal(typeof stateError({ component: 'window', state: 'running' }), 'string');
    assert.equal(typeof stateError({ component: 'transcriptview', state: 'ready' }), 'string');
});

test('--empty e --select 0 lidos do ambiente', () => {
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_EMPTY');
        assert.equal(snapshotParams().empty, false);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_EMPTY', '1', true);
        assert.equal(snapshotParams().empty, true);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_EMPTY', '0', true);
        assert.equal(snapshotParams().empty, false);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_SELECT', '0', true);
        assert.equal(snapshotParams().select, 0);
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_EMPTY');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_SELECT');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('isSandboxed: só com a marca do snapshot.sh e a pasta de dados dentro da raiz', () => {
    const env = { DAILY_TAKER_SNAPSHOT_SANDBOX: '1', DAILY_TAKER_SNAPSHOT_ROOT: '/tmp/daily-taker-snapshot-abc' };
    const table = [
        [env, '/tmp/daily-taker-snapshot-abc/data', true],
        [env, '/tmp/daily-taker-snapshot-abc/data/', true],
        [{ ...env, DAILY_TAKER_SNAPSHOT_ROOT: '/tmp/daily-taker-snapshot-abc/' }, '/tmp/daily-taker-snapshot-abc/data', true],
        // Fora da raiz, prefixo enganoso, subida com "..", caminhos relativos.
        [env, '/home/nicolas/.local/share', false],
        [env, '/tmp/daily-taker-snapshot-abcdef/data', false],
        [env, '/tmp/daily-taker-snapshot-abc/../../home/nicolas/.local/share', false],
        [env, '/tmp/daily-taker-snapshot-abc/./data', false],
        [env, 'data', false],
        [env, '', false],
        [env, null, false],
        // A própria raiz não é a pasta de dados isolada.
        [env, '/tmp/daily-taker-snapshot-abc', false],
        // Sem a marca, marca errada ou raiz inválida.
        [{ DAILY_TAKER_SNAPSHOT_ROOT: env.DAILY_TAKER_SNAPSHOT_ROOT }, '/tmp/daily-taker-snapshot-abc/data', false],
        [{ ...env, DAILY_TAKER_SNAPSHOT_SANDBOX: '0' }, '/tmp/daily-taker-snapshot-abc/data', false],
        [{ ...env, DAILY_TAKER_SNAPSHOT_SANDBOX: 'true' }, '/tmp/daily-taker-snapshot-abc/data', false],
        [{ DAILY_TAKER_SNAPSHOT_SANDBOX: '1' }, '/tmp/daily-taker-snapshot-abc/data', false],
        [{ ...env, DAILY_TAKER_SNAPSHOT_ROOT: '/' }, '/tmp/x/data', false],
        [{ ...env, DAILY_TAKER_SNAPSHOT_ROOT: 'tmp/x' }, 'tmp/x/data', false],
        [{ ...env, DAILY_TAKER_SNAPSHOT_ROOT: '/tmp/x/../y' }, '/tmp/y/data', false],
        [{}, '/tmp/daily-taker-snapshot-abc/data', false],
        [null, '/tmp/daily-taker-snapshot-abc/data', false],
    ];
    for (const [e, dataDir, expected] of table)
        assert.equal(isSandboxed(e, dataDir), expected);
});

test('componentes que alteram dados são marcados e registrados', () => {
    assert.equal(MUTATING_COMPONENTS.includes('detailpanecheck'), true);
    assert.equal(MUTATING_COMPONENTS.includes('sidebarcheck'), true);
    assert.equal(MUTATING_COMPONENTS.includes('windowcheck'), true);
    assert.equal(MUTATING_COMPONENTS.includes('window'), false);
    assert.equal(MUTATING_COMPONENTS.includes('sidebar'), false);
    for (const name of MUTATING_COMPONENTS)
        assert.equal(typeof COMPONENTS[name], 'function');
});

test('componente sidebar registrado; --query lido do ambiente', () => {
    assert.equal(typeof COMPONENTS.sidebar, 'function');
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    try {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_QUERY');
        assert.equal(snapshotParams().query, null);
        GLib.setenv('DAILY_TAKER_SNAPSHOT_QUERY', 'reunião', true);
        assert.equal(snapshotParams().query, 'reunião');
        assert.equal(stateError({ component: 'sidebar', state: 'running' }), null);
        assert.equal(typeof stateError({ component: 'sidebar', state: 'ready' }), 'string');
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_QUERY');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
    }
});

test('estado e versão do resumo são lidos e validados', () => {
    GLib.setenv('DAILY_TAKER_SNAPSHOT', '/nonexistent/out.png', true);
    GLib.setenv('DAILY_TAKER_SNAPSHOT_SUMMARY', 'ready', true);
    GLib.setenv('DAILY_TAKER_SNAPSHOT_SUMMARY_VERSION', '1', true);
    try {
        assert.equal(snapshotParams().summaryState, 'ready');
        assert.equal(snapshotParams().summaryVersion, 1);
        assert.equal(stateError({ component: 'detailpane', summaryState: 'ready' }), null);
        assert.equal(typeof stateError({ component: 'detailpane', summaryState: 'x' }), 'string');
        assert.equal(typeof stateError({ component: 'detailpane', summaryVersion: -1 }), 'string');
        assert.equal(typeof stateError({ component: 'detailpane', summaryVersion: 0.5 }), 'string');
    } finally {
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_SUMMARY');
        GLib.unsetenv('DAILY_TAKER_SNAPSHOT_SUMMARY_VERSION');
    }
});

finish();
