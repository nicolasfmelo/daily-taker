/* exported recordingMatches statusBadge */

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
