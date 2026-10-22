const { test, assert, finish } = imports.harness;
const { SHORTCUTS, shortcutFor, shouldHandleShortcut, deletedToastTitle } = imports.shortcuts;

const base = { focusIsEditable: false, focusIsButton: false, inDialog: false, recorderState: false };

test('tabela: as seis teclas do app', () => {
    assert.deepEqual(SHORTCUTS.map(s => `${s.ctrl ? 'Ctrl+' : ''}${s.key}=${s.action}`), [
        'space=play-pause',
        'b=seek-backward',
        'n=seek-forward',
        'F2=rename',
        'Delete=delete',
        'Ctrl+s=export-audio',
    ]);
});

test('shortcutFor: tecla sem modificador', () => {
    assert.equal(shortcutFor({ key: 'space' }), 'play-pause');
    assert.equal(shortcutFor({ key: 'b' }), 'seek-backward');
    assert.equal(shortcutFor({ key: 'n' }), 'seek-forward');
    assert.equal(shortcutFor({ key: 'F2' }), 'rename');
    assert.equal(shortcutFor({ key: 'Delete' }), 'delete');
});

test('shortcutFor: Ctrl+S exporta; S sozinho não', () => {
    assert.equal(shortcutFor({ key: 's', ctrl: true }), 'export-audio');
    assert.equal(shortcutFor({ key: 's' }), null);
});

test('shortcutFor: modificador a mais não casa', () => {
    assert.equal(shortcutFor({ key: 'b', ctrl: true }), null);
    assert.equal(shortcutFor({ key: 'b', shift: true }), null);
    assert.equal(shortcutFor({ key: 'space', alt: true }), null);
    assert.equal(shortcutFor({ key: 's', ctrl: true, shift: true }), null);
    assert.equal(shortcutFor({ key: 'x' }), null);
    assert.equal(shortcutFor({}), null);
});

test('guarda: foco em lugar neutro → trata', () => {
    for (const { action } of SHORTCUTS)
        assert.equal(shouldHandleShortcut({ ...base, action }), true);
});

test('guarda: estado RECORDER → nunca (o gravador tem os próprios atalhos)', () => {
    for (const { action } of SHORTCUTS)
        assert.equal(shouldHandleShortcut({ ...base, action, recorderState: true }), false);
});

test('guarda: digitando (busca, renomear, texto) → teclas simples ignoradas', () => {
    for (const action of ['play-pause', 'seek-backward', 'seek-forward', 'rename', 'delete'])
        assert.equal(shouldHandleShortcut({ ...base, action, focusIsEditable: true }), false);
});

test('guarda: Ctrl+S vale mesmo com o foco num campo de texto', () => {
    assert.equal(shouldHandleShortcut({ ...base, action: 'export-audio', focusIsEditable: true }), true);
});

test('guarda: popover ou diálogo → nada', () => {
    for (const { action } of SHORTCUTS)
        assert.equal(shouldHandleShortcut({ ...base, action, inDialog: true }), false);
});

test('guarda: espaço num botão focado é do botão; as demais teclas valem', () => {
    assert.equal(shouldHandleShortcut({ ...base, action: 'play-pause', focusIsButton: true }), false);
    assert.equal(shouldHandleShortcut({ ...base, action: 'seek-forward', focusIsButton: true }), true);
    assert.equal(shouldHandleShortcut({ ...base, action: 'delete', focusIsButton: true }), true);
});

test('guarda: ação desconhecida → nada', () => {
    assert.equal(shouldHandleShortcut({ ...base, action: 'xyz' }), false);
    assert.equal(shouldHandleShortcut({ ...base }), false);
});

test('deletedToastTitle: nome entre aspas', () => {
    assert.equal(deletedToastTitle('Reunião P&D <1>'), '"Reunião P&D <1>" excluída');
});

test('deletedToastTitle: nome muito longo é cortado com reticências', () => {
    const title = deletedToastTitle('x'.repeat(200));
    assert.equal(title, `"${'x'.repeat(39)}…" excluída`);
    assert.equal(deletedToastTitle('y'.repeat(40)), `"${'y'.repeat(40)}" excluída`);
});

test('deletedToastTitle: sem nome', () => {
    assert.equal(deletedToastTitle(''), '"" excluída');
    assert.equal(deletedToastTitle(null), '"" excluída');
});

finish();
