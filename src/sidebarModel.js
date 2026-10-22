/* exported generateCard paneActions paneBanner paneState recordingMatches statusBadge */

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

const CARD_STATUSES = ['running', 'error'];

// Painel central do DetailPane: sem gravações, sem seleção; com transcrição carregada a
// visão fica sempre (erro/geração de uma nova vão para o banner, paneBanner); sem ela,
// o cartão do status (qualquer outro status = ainda não transcrita). Todo caso tem painel.
var paneState = (recording, hasRecordings, status, hasTranscript) => {
    if (!hasRecordings)
        return 'empty-library';
    if (!recording)
        return 'no-selection';
    if (hasTranscript)
        return 'ready';
    return CARD_STATUSES.includes(status) ? status : 'not-transcribed';
};

// Banner sobre a transcrição: só quando ela existe e há uma geração em curso ou falhou.
var paneBanner = (status, hasTranscript) =>
    hasTranscript && CARD_STATUSES.includes(status) ? status : 'none';

// Botões do cabeçalho: tudo depende de a transcrição estar visível (state ready); Buscar
// só na aba Transcrição; Gerar novamente bloqueado durante uma geração.
var paneActions = ({ state, status, tab } = {}) => {
    const ready = state === 'ready';
    return {
        search: ready && tab === 'transcricao',
        copy: ready,
        export: ready,
        regenerate: ready && status !== 'running',
    };
};

// Cartão "gerar": status ready sem transcrição = o arquivo sumiu ou não pôde ser lido;
// gerar de novo passa pela confirmação de sobrescrever (regenerate).
var generateCard = status => status === 'ready'
    ? { title: 'Não foi possível carregar a transcrição', regenerate: true }
    : { title: 'Esta gravação ainda não foi transcrita', regenerate: false };
