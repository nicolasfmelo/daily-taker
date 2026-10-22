imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const { COMPONENTS, silencePlayback, snapshotParams, stateError } = imports.devSnapshot;

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

test('componente playerbar registrado', () => {
    assert.equal(typeof COMPONENTS.playerbar, 'function');
});

finish();
