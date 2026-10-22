const { test, assert, finish } = imports.harness;
const M = imports.transcriptsPageModel;

const W = (word, speaker, start, end) => ({ word, speaker, start, end, type: 'word' });

const makeTranscript = extra => Object.assign({
    version: 1,
    title: 'Daily',
    recorded_at: '2026-10-22T09:00:00-03:00',
    transcribed_at: '2026-10-22T09:05:00-03:00',
    duration: 125,
    language: 'por',
    model: 'elevenlabs/scribe-v2',
    cost_usd: 0.01,
    text: '',
    speakers: {},
    words: [],
}, extra);

const fakeFile = name => ({ name });
const entry = (name, extra) => ({ recordingFile: fakeFile(name), transcript: makeTranscript(extra) });
const names = entries => entries.map(e => e.recordingFile.name);
const noFilter = { query: '', from: null, to: null };

test('presentEntries: descarta transcrições cuja gravação não existe, mantendo a ordem', () => {
    const entries = [entry('c'), entry('orfa'), entry('a')];
    const exists = file => file.name !== 'orfa';
    assert.deepEqual(names(M.presentEntries(entries, exists)), ['c', 'a']);
});

test('visibleEntries: sem filtro mostra todas as presentes', () => {
    const entries = [entry('c'), entry('orfa'), entry('a')];
    const exists = file => file.name !== 'orfa';
    assert.deepEqual(names(M.visibleEntries(entries, noFilter, exists)), ['c', 'a']);
});

test('visibleEntries: "reuniao" acha "Reunião" e ignora órfãs que também casariam', () => {
    const entries = [
        entry('r', { title: 'Reunião de equipe' }),
        entry('orfa', { title: 'Reunião antiga' }),
        entry('o', { title: 'Outra' }),
    ];
    const exists = file => file.name !== 'orfa';
    assert.deepEqual(names(M.visibleEntries(entries, { query: 'reuniao' }, exists)), ['r']);
});

test('visibleEntries: datas restringem (dia "até" inclusivo)', () => {
    const entries = [
        entry('23', { recorded_at: '2026-10-23T08:00:00-03:00' }),
        entry('22', { recorded_at: '2026-10-22T23:50:00-03:00' }),
        entry('20', { recorded_at: '2026-10-20T10:00:00-03:00' }),
    ];
    const all = () => true;
    const d21 = new Date(2026, 9, 21);
    const d22 = new Date(2026, 9, 22);
    assert.deepEqual(names(M.visibleEntries(entries, { from: d21, to: d22 }, all)), ['22']);
    assert.deepEqual(names(M.visibleEntries(entries, { from: d21 }, all)), ['23', '22']);
    assert.deepEqual(names(M.visibleEntries(entries, { to: d21 }, all)), ['20']);
});

test('visibleEntries: sem existsFn considera todas presentes', () => {
    assert.equal(M.visibleEntries([entry('a'), entry('b')], noFilter).length, 2);
});

test('rowSummary: título, data e hora, duração, locutores e trecho', () => {
    const s = M.rowSummary(entry('a', {
        title: 'Reunião semanal',
        speakers: { 0: 'Ana' },
        words: [W('Bom', 0, 0, 1), W('dia', 0, 1, 2), W('oi', 1, 2, 3)],
    }));
    assert.deepEqual(s, {
        title: 'Reunião semanal',
        dateTime: '22/10/2026 · 09:00',
        duration: '00:02:05',
        speakers: 'Ana, Locutor 2',
        excerpt: 'Bom dia oi',
    });
});

test('rowSummary: campos ausentes viram textos vazios ou padrão, nunca undefined', () => {
    const s = M.rowSummary(entry('a', {
        title: '   ', recorded_at: undefined, duration: undefined, speakers: undefined, words: [], text: undefined,
    }));
    assert.deepEqual(s, {
        title: 'Transcrição',
        dateTime: '',
        duration: '00:00:00',
        speakers: '',
        excerpt: '',
    });
});

test('rowSummary: trecho longo é cortado com …', () => {
    const s = M.rowSummary(entry('a', { text: 'x'.repeat(300) }));
    assert.equal(s.excerpt.endsWith('…'), true);
    assert.equal(s.excerpt.length <= 141, true);
});

test('emptyState: nenhuma transcrição vs nada encontrado vs lista', () => {
    assert.equal(M.emptyState(0, 0).title, 'Nenhuma transcrição ainda');
    assert.equal(M.emptyState(3, 0).title, 'Nada encontrado para essa busca');
    assert.equal(M.emptyState(3, 2), null);
    assert.equal(typeof M.emptyState(0, 0).description, 'string');
    assert.equal(typeof M.emptyState(3, 0).description, 'string');
});

test('dateFromCalendar: ano, mês (1–12) e dia viram Date local à meia-noite', () => {
    const d = M.dateFromCalendar(2026, 10, 22);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 9);
    assert.equal(d.getDate(), 22);
    assert.equal(d.getHours(), 0);
});

test('dateButtonLabel: só o prefixo sem data; com data, dd/mm/aaaa', () => {
    assert.equal(M.dateButtonLabel('De', null), 'De');
    assert.equal(M.dateButtonLabel('Até', new Date(2026, 0, 5)), 'Até 05/01/2026');
});

finish();
