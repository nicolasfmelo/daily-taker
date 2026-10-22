/* exported emptyListMessage generateCard nextSelection paneActions paneBanner paneState
   recordingMatches recordingMatchesHaystack statusBadge */

const { normalize, searchableText } = imports.transcriptSearch;

// `haystack`: searchableText da transcrição (já normalizado), calculado uma vez por quem
// guarda o cache; null = sem transcrição (só o nome conta).
var recordingMatchesHaystack = (query, name, haystack) => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0)
        return true;
    const text = typeof haystack === 'string'
        ? `${normalize(name)}\n${haystack}`
        : normalize(name);
    return terms.every(term => text.includes(term));
};

var recordingMatches = (query, name, transcript) => recordingMatchesHaystack(query, name,
    Array.isArray(transcript?.words) ? searchableText(transcript) : null);

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

// Item a selecionar depois que o selecionado saiu da lista: o que ocupou a mesma posição,
// ou o último se ele era o último; -1 sem itens (ou sem posição válida antes).
var nextSelection = (items, removedIndex) => {
    const length = Array.isArray(items) ? items.length : 0;
    if (length === 0 || !Number.isInteger(removedIndex) || removedIndex < 0)
        return -1;
    return Math.min(removedIndex, length - 1);
};

// O que mostrar no lugar da lista: nada (há itens visíveis), biblioteca vazia ou busca
// sem resultado. Sem consulta tudo casa, então "sem resultado" só existe com busca.
var emptyListMessage = (total, visible, query) => {
    if (visible > 0)
        return 'none';
    if (!(total > 0))
        return 'no-recordings';
    return (query ?? '').trim() ? 'no-results' : 'none';
};
