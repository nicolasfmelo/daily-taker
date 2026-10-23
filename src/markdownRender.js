/* exported escapeMarkup parseMarkdown */

var escapeMarkup = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}[c]));

const MAX_BLOCKS = 400;
const MAX_CHARS = 2000;
const truncate = s => s.length > MAX_CHARS ? s.slice(0, MAX_CHARS) + '…' : s;

const inline = text => {
    let out = '';
    for (let i = 0; i < text.length;) {
        const marker = text[i] === '`' ? '`' : text.startsWith('**', i) ? '**' : null;
        const end = marker ? text.indexOf(marker, i + marker.length) : -1;
        if (marker && end > i + marker.length) {
            const tag = marker === '`' ? 'tt' : 'b';
            out += `<${tag}>${escapeMarkup(text.slice(i + marker.length, end))}</${tag}>`;
            i = end + marker.length;
        } else {
            out += escapeMarkup(text[i]);
            i++;
        }
    }
    return out;
};

var parseMarkdown = text => {
    if (typeof text === 'string')
        text = text.replace(/[\x00-\x08\x0b-\x1f]/g, '');
    if (typeof text !== 'string' || !text.trim())
        return [];
    const blocks = [];
    let paragraph = '';
    const add = (kind, value, extra = {}) => {
        if (blocks.length < MAX_BLOCKS)
            blocks.push({ kind, markup: inline(truncate(value)), ...extra });
    };
    const flush = () => {
        if (paragraph)
            add('p', paragraph);
        paragraph = '';
    };
    // Iterar por linha evita criar um array proporcional à saída inteira do modelo.
    for (const match of text.matchAll(/([^\n]*)(?:\n|$)/g)) {
        if (blocks.length >= MAX_BLOCKS)
            break;
        const line = match[1].trim();
        if (!line) {
            flush();
            continue;
        }
        const heading = /^(#{2,3})(?:\s+(.*)|$)$/.exec(line);
        const item = /^(?:[-*]\s+(.*)|(\d+)\.\s+(.*))$/.exec(line);
        if (heading || item) {
            flush();
            if (heading && heading[2])
                add(heading[1].length === 2 ? 'h2' : 'h3', heading[2]);
            else if (item)
                add(item[2] ? 'oli' : 'li', item[1] ?? item[3], item[2] ? { index: Number(item[2]) } : {});
        } else {
            // Reter apenas o suficiente para indicar truncamento, inclusive em parágrafos longos.
            paragraph = (paragraph ? `${paragraph} ${line}` : line).slice(0, MAX_CHARS + 1);
        }
    }
    flush();
    return blocks;
};
