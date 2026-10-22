const { test, testAsync, assert, finish } = imports.harness;

test('assert.equal aceita valores iguais', () => {
    assert.equal(1, 1);
});

test('assert.equal rejeita valores diferentes', () => {
    assert.throws(() => assert.equal(1, 2));
});

test('assert.deepEqual compara estruturas', () => {
    assert.deepEqual({ a: [1, 2] }, { a: [1, 2] });
    assert.throws(() => assert.deepEqual({ a: 1 }, { a: 2 }));
});

test('assert.throws detecta exceções', () => {
    assert.throws(() => { throw new Error('x'); });
});

testAsync('testAsync espera a Promise resolver', async () => {
    await new Promise(resolve => imports.gi.GLib.timeout_add(0, 5, () => {
        resolve();
        return imports.gi.GLib.SOURCE_REMOVE;
    }));
});

finish();
