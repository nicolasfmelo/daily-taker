// Confere data/style.css (tokens da mockup, classes da UI nova, GTK consegue ler) e o registro
// do tema nos gresources.
imports.gi.versions.Gtk = '4.0';
const { GLib, Gtk } = imports.gi;
const ByteArray = imports.byteArray;
const { test, assert, finish } = imports.harness;

const read = path => ByteArray.toString(GLib.file_get_contents(path)[1]);
const CSS = read('data/style.css');
const DATA_GRESOURCE = read('data/dev.nicolas.DailyTaker.data.gresource.xml');
const SRC_GRESOURCE = read('src/dev.nicolas.DailyTaker.src.gresource.xml.in');
const lower = CSS.toLowerCase();
// Sem comentários, para as buscas não casarem com texto explicativo.
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

const TOKENS = [
    '#1A1D22', '#1B1D22', '#25272E', '#26292F', '#FA841E', '#F28416', '#F88712',
    '#3FCF70', '#9CA4B8', '#2F333B',
    '#3D9BFD', '#A655FD', '#22D3EE', '#F472B6', '#FACC15',
];

const CLASSES = [
    'bg-window', 'bg-detail', 'accent-pill', 'sidebar-item', 'badge-ok', 'badge-error',
    'speaker-dot', 'speaker-0', 'speaker-1', 'speaker-2', 'speaker-3', 'speaker-4', 'speaker-5',
    'speaker-none', 'transcript-block', 'player-bar', 'group-label',
    // Ainda usadas pela UI atual.
    'recorder-time-label', 'paused', 'recording-row', 'speaker-button',
];

// Seletor que termina na classe (ex.: ".sidebar-item {", ".speaker-0,") ou num composto.
const definesClass = name => new RegExp(`\\.${name}(?![\\w-])[^{}]*\\{`).test(RULES);

test('todos os tokens do tema aparecem em style.css', () => {
    const missing = TOKENS.filter(t => !lower.includes(t.toLowerCase()));
    assert.deepEqual(missing, []);
});

test('fundo do bloco atual usa alpha(#F88712, .12)', () => {
    assert.equal(/alpha\(#f88712,\s*0?\.12\)/.test(lower), true);
});

test('todas as classes da UI estão definidas', () => {
    const missing = CLASSES.filter(c => !definesClass(c));
    assert.deepEqual(missing, []);
});

test('compostos: item selecionado e bloco atual', () => {
    assert.equal(/\.sidebar-item\.selected[^{}]*\{/.test(RULES), true);
    assert.equal(/\.transcript-block\.current[^{}]*\{/.test(RULES), true);
});

test('cores nomeadas usadas pela forma de onda e pelo acento da libadwaita', () => {
    for (const name of ['dimmed_color', 'accent_color', 'accent_bg_color', 'accent_fg_color'])
        assert.equal(new RegExp(`@define-color ${name}\\s`).test(RULES), true);
});

test('alto contraste só por media query, sem style-hc.css', () => {
    assert.equal(RULES.includes('@media (prefers-contrast: more)'), true);
    assert.equal(DATA_GRESOURCE.includes('style-hc'), false);
    assert.equal(GLib.file_test('data/style-hc.css', GLib.FileTest.EXISTS), false);
});

test('sem texto branco fixo fora da pílula "Nova gravação"', () => {
    // Remove os blocos da pílula; o resto não pode fixar color: #fff/white.
    const rest = RULES.replace(/[^{}]*\.accent-pill[^{}]*\{[^}]*\}/g, '');
    const hardWhite = rest.match(/(?:^|[;{\s])color:\s*(#fff(?:fff)?|white)\b/gi) || [];
    assert.deepEqual(hardWhite, []);
});

test('appTheme.js registrado no gresource do código', () => {
    assert.equal(SRC_GRESOURCE.includes('<file>appTheme.js</file>'), true);
});

test('o GTK lê style.css sem erro de sintaxe', () => {
    const provider = new Gtk.CssProvider();
    const errors = [];
    provider.connect('parsing-error', (_p, section, error) => {
        errors.push(`${section.to_string()}: ${error.message}`);
    });
    provider.load_from_string(CSS);
    assert.deepEqual(errors, []);
});

finish();
