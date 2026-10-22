const { test, assert, finish } = imports.harness;
const { DeleteQueue } = imports.deleteQueue;

// Gravações de mentira: a fila só guarda referências.
const rec = name => ({ name });

test('dois add seguidos devolvem ids distintos', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const b = rec('B');
    const id1 = q.add(a, 0);
    const id2 = q.add(b, 3);
    assert.equal(typeof id1, 'number');
    assert.equal(id1 !== id2, true);
});

test('undo(id1) devolve a primeira e mantém a segunda pendente', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const b = rec('B');
    const id1 = q.add(a, 0);
    q.add(b, 3);
    const item = q.undo(id1);
    assert.equal(item.recording, a);
    assert.equal(item.index, 0);
    assert.equal(q.has(a), false);
    assert.equal(q.has(b), true);
});

test('commit(id2) devolve a segunda', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const b = rec('B');
    const id1 = q.add(a, 0);
    const id2 = q.add(b, 3);
    q.undo(id1);
    assert.equal(q.commit(id2), b);
    assert.equal(q.has(b), false);
    assert.deepEqual(q.pending(), []);
});

test('commitAll com uma pendente devolve só ela e esvazia a fila', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const b = rec('B');
    const id1 = q.add(a, 0);
    q.add(b, 1);
    q.undo(id1);
    const all = q.commitAll();
    assert.equal(all.length, 1);
    assert.equal(all[0], b);
    assert.deepEqual(q.commitAll(), []);
    assert.equal(q.has(b), false);
});

test('commitAll devolve na ordem de inserção', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const b = rec('B');
    const c = rec('C');
    q.add(a, 0);
    q.add(b, 0);
    q.add(c, 0);
    const all = q.commitAll();
    assert.equal(all.length, 3);
    assert.equal(all[0] === a && all[1] === b && all[2] === c, true);
});

test('undo de id já confirmado → null', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const id = q.add(a, 0);
    assert.equal(q.commit(id), a);
    assert.equal(q.undo(id), null);
});

test('commit depois de undo → null', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    const id = q.add(a, 0);
    assert.equal(q.undo(id).recording, a);
    assert.equal(q.commit(id), null);
    assert.equal(q.undo(id), null);
});

test('undo/commit de id desconhecido → null', () => {
    const q = new DeleteQueue();
    assert.equal(q.undo(42), null);
    assert.equal(q.commit(42), null);
    assert.equal(q.undo(undefined), null);
});

test('commit de id já confirmado por commitAll → null', () => {
    const q = new DeleteQueue();
    const id = q.add(rec('A'), 0);
    q.commitAll();
    assert.equal(q.commit(id), null);
    assert.equal(q.undo(id), null);
});

test('has() acompanha o estado', () => {
    const q = new DeleteQueue();
    const a = rec('A');
    assert.equal(q.has(a), false);
    const id = q.add(a, 0);
    assert.equal(q.has(a), true);
    q.undo(id);
    assert.equal(q.has(a), false);
    const id2 = q.add(a, 0);
    assert.equal(q.has(a), true);
    q.commit(id2);
    assert.equal(q.has(a), false);
});

test('ids nunca são reutilizados', () => {
    const q = new DeleteQueue();
    const seen = new Set();
    for (let i = 0; i < 5; i++) {
        const id = q.add(rec(`R${i}`), i);
        assert.equal(seen.has(id), false);
        seen.add(id);
        if (i % 2)
            q.undo(id);
        else
            q.commit(id);
    }
    q.commitAll();
    const id = q.add(rec('depois'), 0);
    assert.equal(seen.has(id), false);
});

test('ids cabem num int32 (parâmetro da ação win.undo-delete)', () => {
    const q = new DeleteQueue();
    const id = q.add(rec('A'), 0);
    assert.equal(Number.isInteger(id) && id > 0 && id <= 2 ** 31 - 1, true);
});

test('índice negativo ou inválido vira 0', () => {
    const q = new DeleteQueue();
    const id = q.add(rec('A'), -1);
    assert.equal(q.undo(id).index, 0);
    const id2 = q.add(rec('B'), NaN);
    assert.equal(q.undo(id2).index, 0);
});

finish();
