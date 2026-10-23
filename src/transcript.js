/* exported createTranscript buildBlocks renameSpeaker blockIndexAt wordIndexAt
   parseTranscript stringifyTranscript HISTORY_LIMIT withSummary clearSummary restoreSummary
   getSummary getSummaryHistory */

var MODEL = 'elevenlabs/scribe-v2';

var createTranscript = ({ apiResponse, title, recordedAt, transcribedAt }) => {
    // Só estes campos entram em Word: a API ainda manda confidence e speaker_label.
    const words = (apiResponse.words || []).map(w => ({
        word: w.word,
        start: w.start,
        end: w.end,
        speaker: w.speaker ?? null,
        type: w.type ?? 'word',
    }));
    const lastEnd = words.length > 0 ? words[words.length - 1].end : 0;

    return {
        version: 1,
        title,
        recorded_at: recordedAt,
        transcribed_at: transcribedAt,
        duration: apiResponse.duration ?? lastEnd,
        language: apiResponse.language ?? '',
        model: MODEL,
        cost_usd: apiResponse.usage?.cost ?? 0,
        text: apiResponse.text ?? '',
        speakers: {},
        words,
    };
};

const speakerLabel = (t, speaker) => {
    if (speaker === null)
        return '';
    return t.speakers?.[String(speaker)] || `Locutor ${speaker + 1}`;
};

var buildBlocks = t => {
    const blocks = [];
    for (const w of t.words) {
        const speaker = w.speaker ?? null;
        const last = blocks[blocks.length - 1];
        if (last && last.speaker === speaker) {
            last.text += ` ${w.word}`;
            last.end = w.end;
        } else {
            blocks.push({
                speaker,
                label: speakerLabel(t, speaker),
                start: w.start,
                end: w.end,
                text: w.word,
            });
        }
    }

    if (blocks.length === 0 && t.text)
        blocks.push({ speaker: null, label: '', start: 0, end: t.duration, text: t.text });

    return blocks;
};

var renameSpeaker = (t, id, name) => {
    const speakers = Object.assign({}, t.speakers);
    const trimmed = (name ?? '').trim();
    if (trimmed)
        speakers[String(id)] = trimmed;
    else
        delete speakers[String(id)];
    return Object.assign({}, t, { speakers });
};

// Último item com start <= seconds; mantém o anterior durante pausas.
// -1 antes do primeiro start ou depois do último end.
const indexAt = (items, seconds) => {
    if (items.length === 0 || seconds < items[0].start || seconds > items[items.length - 1].end)
        return -1;
    let found = -1;
    for (let i = 0; i < items.length && items[i].start <= seconds; i++)
        found = i;
    return found;
};

var blockIndexAt = (blocks, seconds) => indexAt(blocks, seconds);

var wordIndexAt = (words, seconds) => indexAt(words, seconds);

var parseTranscript = jsonText => {
    const t = JSON.parse(jsonText);
    if (t === null || typeof t !== 'object')
        throw new Error('Transcrição inválida');
    if (t.version !== 1)
        throw new Error(`Versão de transcrição não suportada: ${t.version}`);
    if (!Array.isArray(t.words))
        throw new Error('Transcrição inválida: words não é uma lista');
    return t;
};

var stringifyTranscript = t => JSON.stringify(t, null, 2);

var HISTORY_LIMIT = 20;
const validSummary = s => s && typeof s.text === 'string' && s.text.trim().length > 0;

var getSummary = t => validSummary(t?.summary) ? t.summary : null;

var getSummaryHistory = t => Array.isArray(t?.summary_history)
    ? t.summary_history.filter(validSummary).slice(0, HISTORY_LIMIT) : [];

var withSummary = (t, summary) => {
    const current = getSummary(t);
    const history = getSummaryHistory(t);
    return {
        ...t,
        summary,
        summary_history: (current ? [current, ...history] : history).slice(0, HISTORY_LIMIT),
    };
};

var clearSummary = t => {
    const { summary, ...rest } = t;
    return rest;
};

var restoreSummary = (t, index) => {
    const history = getSummaryHistory(t);
    if (!Number.isInteger(index) || index < 0 || index >= history.length)
        return t;
    const current = getSummary(t);
    const restored = history[index];
    const remaining = history.filter((_, i) => i !== index);
    return {
        ...t,
        summary: restored,
        summary_history: (current ? [current, ...remaining] : remaining).slice(0, HISTORY_LIMIT),
    };
};
