imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { GLib } = imports.gi;
const { test, assert, finish } = imports.harness;
const { silencePlayback, snapshotParams } = imports.devSnapshot;

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

finish();
