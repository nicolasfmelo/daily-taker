const { test, assert, finish } = imports.harness;
const S = imports.speakerColors;

test('SPEAKER_COLORS tem as seis cores na ordem', () => {
    assert.deepEqual(S.SPEAKER_COLORS, ['#3D9BFD', '#A655FD', '#3FCF70', '#22D3EE', '#F472B6', '#FACC15']);
});

test('speakerColor devolve a cor do locutor com rotação', () => {
    assert.equal(S.speakerColor(0), '#3D9BFD');
    assert.equal(S.speakerColor(5), '#FACC15');
    assert.equal(S.speakerColor(6), '#3D9BFD');
    assert.equal(S.speakerColor(7), '#A655FD');
});

test('speakerClass usa id % 6 ou speaker-none', () => {
    assert.equal(S.speakerClass(0), 'speaker-0');
    assert.equal(S.speakerClass(7), 'speaker-1');
    assert.equal(S.speakerClass(5), 'speaker-5');
});

test('speakerColors: entradas ausentes ou inválidas ficam neutras', () => {
    for (const bad of [null, undefined, NaN, -1, 1.5, Infinity, '1']) {
        assert.equal(S.speakerColor(bad), '#9CA4B8');
        assert.equal(S.speakerClass(bad), 'speaker-none');
    }
});

finish();
