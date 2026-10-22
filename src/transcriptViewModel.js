/* exported languageName blockTitle viewHeader exportContent exportExtension speakerEntry
   currentBlockIndex */
// Textos da visão de transcrição, sem GTK: testáveis isoladamente.
const { blockIndexAt, buildBlocks } = imports.transcript;
const { copyText, formatClock, formatDateTime, toMarkdown } = imports.transcriptFormat;

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

const EXPORTERS = {
    md: t => toMarkdown(t),
    txt: t => copyText(t, { withSpeakers: true }),
};

var exportContent = (t, ext) => {
    const exporter = EXPORTERS[ext];
    if (!exporter)
        throw new Error(`Formato de exportação desconhecido: ${ext}`);
    return exporter(t);
};

// O nome escolhido no diálogo manda quando termina em .md/.txt; senão vale o item do menu.
var exportExtension = (fileName, fallback) => {
    const match = /\.([^./]+)$/.exec(fileName ?? '');
    const ext = match ? match[1].toLowerCase() : '';
    return ext in EXPORTERS ? ext : fallback;
};

// Campo do diálogo "Renomear locutor": nome atual preenchido; o padrão fica só de dica.
var speakerEntry = (t, id) => ({
    text: t.speakers?.[String(id)] ?? '',
    placeholder: `Locutor ${id + 1}`,
});

// Posição do player (ns) -> índice do bloco falado; -1 quando não há o que destacar.
var currentBlockIndex = (blocks, positionNs) => {
    if (!Number.isFinite(positionNs) || positionNs < 0)
        return -1;
    return blockIndexAt(blocks, positionNs / 1e9);
};
