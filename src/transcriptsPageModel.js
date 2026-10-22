/* exported presentEntries visibleEntries rowSummary emptyState dateFromCalendar dateButtonLabel
   isDayChoice */
// Decisões da aba "Transcrições", sem GTK: testáveis isoladamente e reaproveitáveis
// por outra navegação (a página só desenha o que sai daqui).
const { excerpt, filterTranscripts } = imports.transcriptSearch;
const { viewHeader } = imports.transcriptViewModel;

const EXCERPT_CHARS = 140;

const pad = n => String(n).padStart(2, '0');

// listTranscripts também devolve transcrições cuja gravação já não existe (órfãs).
var presentEntries = (entries, existsFn = () => true) =>
    entries.filter(e => existsFn(e.recordingFile));

var visibleEntries = (entries, filters = {}, existsFn = () => true) =>
    filterTranscripts(presentEntries(entries, existsFn), filters);

var rowSummary = ({ transcript: t }) => {
    const header = viewHeader(t);
    return {
        title: header.title,
        dateTime: header.dateTime,
        duration: header.duration,
        speakers: header.speakers,
        excerpt: excerpt(t, EXCERPT_CHARS),
    };
};

const EMPTY = {
    title: 'Nenhuma transcrição ainda',
    description: 'Transcreva uma gravação na aba Gravações para vê-la aqui.',
};

const NO_RESULTS = {
    title: 'Nada encontrado para essa busca',
    description: 'Tente outras palavras ou mude as datas.',
};

// total: transcrições presentes; visible: as que passam pelos filtros.
var emptyState = (total, visible) => {
    if (total === 0)
        return EMPTY;
    return visible === 0 ? NO_RESULTS : null;
};

// Gtk.Calendar entrega ano, mês 1–12 e dia; o filtro usa o dia local inteiro.
var dateFromCalendar = (year, month, day) => new Date(year, month - 1, day);

var dateButtonLabel = (prefix, date) =>
    date ? `${prefix} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}` : prefix;

// Gtk.Calendar emite 'day-selected' também ao trocar de mês/ano: só é escolha de dia
// se o [ano, mês] continua o que estava sendo mostrado.
var isDayChoice = ([shownYear, shownMonth], [year, month]) =>
    shownYear === year && shownMonth === month;
