/* exported normalize searchableText filterTranscripts excerpt */

const { buildBlocks, getSummary } = imports.transcript;

var normalize = s => (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const transcriptText = t => {
    if (t.words?.length > 0)
        return t.words.map(w => w.word).join(' ');
    return t.text ?? '';
};

var searchableText = t => {
    const names = new Set(Object.values(t.speakers ?? {}));
    for (const block of buildBlocks(t)) {
        if (block.label)
            names.add(block.label);
    }
    return normalize([t.title ?? '', ...names, transcriptText(t), getSummary(t)?.text ?? ''].join('\n'));
};

// Dia local inteiro: [00:00:00.000 de from, 23:59:59.999 de to].
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const endOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1;

var filterTranscripts = (entries, { query = '', from = null, to = null } = {}) => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    const min = from ? startOfDay(from) : null;
    const max = to ? endOfDay(to) : null;

    return entries.filter(({ transcript: t }) => {
        if (min !== null || max !== null) {
            const recorded = new Date(t.recorded_at).getTime();
            if (Number.isNaN(recorded) || (min !== null && recorded < min) || (max !== null && recorded > max))
                return false;
        }
        if (terms.length === 0)
            return true;
        const haystack = searchableText(t);
        return terms.every(term => haystack.includes(term));
    });
};

var excerpt = (t, maxChars = 140) => {
    const text = transcriptText(t).replace(/\s+/g, ' ').trim();
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
};
