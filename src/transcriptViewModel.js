/* exported languageName blockTitle viewHeader */
// Textos da visão de transcrição, sem GTK: testáveis isoladamente.
const { buildBlocks } = imports.transcript;
const { formatClock, formatDateTime } = imports.transcriptFormat;

const DEFAULT_TITLE = 'Transcrição';
const PORTUGUESE = ['por', 'pt'];

// A API devolve códigos como 'por'; só português tem nome amigável.
var languageName = code => {
    if (typeof code !== 'string' || !code)
        return '';
    const base = code.toLowerCase().split(/[-_]/)[0];
    return PORTUGUESE.includes(base) ? 'Português' : code;
};

var blockTitle = block =>
    block.label ? `${block.label} · ${formatClock(block.start)}` : formatClock(block.start);

var viewHeader = t => {
    const names = [];
    for (const b of buildBlocks(t)) {
        if (b.label && !names.includes(b.label))
            names.push(b.label);
    }
    return {
        title: (t.title ?? '').trim() || DEFAULT_TITLE,
        dateTime: formatDateTime(t.recorded_at),
        duration: formatClock(t.duration),
        language: languageName(t.language),
        speakers: names.join(', '),
    };
};
