const System = imports.system;
const { GLib } = imports.gi;

var _results = { passed: 0, failed: 0 };

function _fmt(v) {
    try {
        return JSON.stringify(v);
    } catch (e) {
        return String(v);
    }
}

function _deepEq(a, b) {
    if (a === b)
        return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => k in b && _deepEq(a[k], b[k]));
}

var assert = {
    equal(a, b) {
        if (a !== b)
            throw new Error(`esperado ${_fmt(b)}, recebido ${_fmt(a)}`);
    },

    deepEqual(a, b) {
        if (!_deepEq(a, b))
            throw new Error(`esperado ${_fmt(b)}, recebido ${_fmt(a)}`);
    },

    throws(fn) {
        try {
            fn();
        } catch (e) {
            return;
        }
        throw new Error('esperava uma exceção, nada foi lançado');
    },
};

function test(name, fn) {
    try {
        fn();
        _results.passed++;
        print(`PASS ${name}`);
    } catch (e) {
        _results.failed++;
        print(`FAIL ${name}\n     ${e.message}`);
    }
}

// Roda fn (que devolve uma Promise) num MainLoop aninhado; falha se rejeitar ou estourar o tempo.
function testAsync(name, fn, timeoutMs = 10000) {
    test(name, () => {
        const loop = GLib.MainLoop.new(null, false);
        let done = false;
        let failure = null;
        const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, timeoutMs, () => {
            failure = new Error(`tempo esgotado (${timeoutMs} ms)`);
            done = true;
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
        Promise.resolve().then(fn).catch(e => {
            failure = e;
        }).then(() => {
            if (done)
                return;
            done = true;
            GLib.source_remove(timer);
            loop.quit();
        });
        loop.run();
        if (failure)
            throw failure;
    });
}

function finish() {
    print(`${_results.passed} passou, ${_results.failed} falhou`);
    if (_results.failed > 0)
        System.exit(1);
}
