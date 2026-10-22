/* exported paneState recordingMatches statusBadge */

const { normalize, searchableText } = imports.transcriptSearch;

var recordingMatches = (query, name, transcript) => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0)
        return true;
    const haystack = Array.isArray(transcript?.words)
        ? `${normalize(name)}\n${searchableText(transcript)}`
        : normalize(name);
    return terms.every(term => haystack.includes(term));
};

const BADGES = {
    ready: { kind: 'ok', label: 'Transcrita' },
    running: { kind: 'running', label: 'Transcrevendo…' },
    error: { kind: 'error', label: 'Erro' },
};

var statusBadge = status => ({ ...(Object.hasOwn(BADGES, status) ? BADGES[status] : { kind: 'none', label: '' }) });

const STATUS_PANES = { running: 'running', error: 'error', ready: 'ready' };

// Painel central do DetailPane: sem gravações, sem seleção ou pelo status da transcrição
// (qualquer outro status = ainda não transcrita). Todo caso tem um painel com conteúdo.
var paneState = (recording, hasRecordings, status) => {
    if (!hasRecordings)
        return 'empty-library';
    if (!recording)
        return 'no-selection';
    return Object.hasOwn(STATUS_PANES, status) ? STATUS_PANES[status] : 'not-transcribed';
};
