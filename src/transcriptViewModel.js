/* exported exportContent exportExtension speakerEntry
   currentBlockIndex findMatches nextIndex findCounterText shouldSeekOnClick */
// Textos da visão de transcrição, sem GTK: testáveis isoladamente.
const { blockIndexAt } = imports.transcript;
const { copyText, toMarkdown } = imports.transcriptFormat;
const { normalize } = imports.transcriptSearch;

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

// Busca dentro da transcrição: índices dos blocos cujo "nome + texto" contém todos os
// termos da consulta, sem acento e sem caixa. Consulta vazia não acha nada.
var findMatches = (blocks, query) => {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0)
        return [];
    const matches = [];
    blocks.forEach((block, i) => {
        const haystack = normalize(`${block.label ?? ''} ${block.text ?? ''}`);
        if (terms.every(term => haystack.includes(term)))
            matches.push(i);
    });
    return matches;
};

// Próxima posição dentro de `matches` (dir 1 ou -1), dando a volta; -1 sem resultados.
// `current` -1 (nenhum ativo) vai para o primeiro (dir 1) ou o último (dir -1).
var nextIndex = (matches, current, dir) => {
    const count = matches.length;
    if (count === 0)
        return -1;
    if (current < 0 || current >= count)
        return dir < 0 ? count - 1 : 0;
    return (current + (dir < 0 ? -1 : 1) + count) % count;
};

// Clique num bloco pula o áudio só se o botão primário foi pressionado no próprio bloco
// (mesma superfície: nada de cliques no popover do menu), fora dos botões (nome, menu)
// e sem texto selecionado.
var shouldSeekOnClick = ({ pressed, sameSurface, insideButton, hasSelection } = {}) =>
    pressed === true && sameSurface === true && insideButton !== true && hasSelection !== true;

// Contador da barra de busca do painel: "2 de 5" (ativo a partir de 1) ou "Nenhum resultado".
var findCounterText = (count, index) => {
    if (!Number.isInteger(count) || count <= 0)
        return 'Nenhum resultado';
    if (Number.isInteger(index) && index >= 0 && index < count)
        return `${index + 1} de ${count}`;
    return `${count} ${count === 1 ? 'resultado' : 'resultados'}`;
};
