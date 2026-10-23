/* exported formatClock formatDateTime formatHeader copyBlock copyText toMarkdown
   exportFileName */

const { GLib } = imports.gi;
const { buildBlocks, getSummary } = imports.transcript;

const DEFAULT_TITLE = 'Transcrição';
const MAX_SLUG = 60;

const pad = n => String(n).padStart(2, '0');

var formatClock = seconds => {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
};

// null quando o ISO é ausente ou inválido.
const toLocal = iso => {
    if (typeof iso !== 'string' || !iso)
        return null;
    return GLib.DateTime.new_from_iso8601(iso, null)?.to_local() ?? null;
};

var formatDateTime = iso => toLocal(iso)?.format('%d/%m/%Y · %H:%M') ?? '';

const titleOf = t => (t.title ?? '').trim() || DEFAULT_TITLE;

// Locutores na ordem da primeira aparição.
const speakerNames = blocks => {
    const names = [];
    for (const b of blocks) {
        if (b.label && !names.includes(b.label))
            names.push(b.label);
    }
    return names;
};

// [título, data/hora, duração, locutores]; linhas sem conteúdo são omitidas.
const headerLines = (t, blocks) => {
    const lines = [titleOf(t)];
    const when = formatDateTime(t.recorded_at);
    if (when)
        lines.push(when);
    lines.push(`Duração: ${formatClock(t.duration)}`);
    const names = speakerNames(blocks);
    if (names.length > 0)
        lines.push(`Locutores: ${names.join(', ')}`);
    return lines;
};

var formatHeader = t => headerLines(t, buildBlocks(t)).join('\n');

const blockTitle = block =>
    block.label ? `${block.label} · ${formatClock(block.start)}` : formatClock(block.start);

var copyBlock = block => `${blockTitle(block)}\n${block.text}`;

var copyText = (t, { withSpeakers = true } = {}) => {
    const blocks = buildBlocks(t);
    const header = headerLines(t, blocks).join('\n');
    const body = withSpeakers
        ? blocks.map(copyBlock).join('\n\n')
        : blocks.map(b => b.text).join(' ');
    return body ? `${header}\n\n${body}` : header;
};

var toMarkdown = t => {
    const blocks = buildBlocks(t);
    const [title, ...meta] = headerLines(t, blocks);
    const parts = [`# ${title}`, meta.map(l => `- ${l}`).join('\n')];
    const summary = getSummary(t);
    if (summary)
        parts.push('## Resumo', summary.text,
            `Gerado por ${summary.model} em ${formatDateTime(summary.generated_at)}`);
    for (const b of blocks)
        parts.push(`### ${blockTitle(b)}`, b.text);
    return `${parts.join('\n\n')}\n`;
};

const slugify = text => {
    const slug = (text ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_SLUG)
        .replace(/-+$/, '');
    return slug || 'transcricao';
};

var exportFileName = (t, ext) => {
    const date = toLocal(t.recorded_at) ?? toLocal(t.transcribed_at);
    const stamp = date?.format('%Y-%m-%d_%H%M') ?? 'sem-data';
    return `${stamp}_${slugify(t.title)}.${ext}`;
};
