/* exported groupLabel groupRecordings formatDurationShort itemSubtitle detailSubtitle itemTimestamp itemDate
   msUntilNextDay */

const MONTHS_UPPER = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO',
    'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const SEP = ' • ';

const validDate = d => d instanceof Date && !Number.isNaN(d.getTime());

const pad2 = n => String(n).padStart(2, '0');

// Diferença em dias de calendário (now - date); UTC evita surpresas de horário de verão.
const dayDiff = (date, now) =>
    Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);

var groupLabel = (date, now) => {
    if (!validDate(date) || !validDate(now))
        return '';
    const diff = dayDiff(date, now);
    if (diff <= 0)
        return 'HOJE';
    if (diff === 1)
        return 'ONTEM';
    if (diff <= 7)
        return 'ESTA SEMANA';
    if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth())
        return 'ESTE MÊS';
    return `${MONTHS_UPPER[date.getMonth()]} DE ${date.getFullYear()}`;
};

var groupRecordings = (items, now, createdOf) => {
    const groups = [];
    for (const item of items ?? []) {
        const label = groupLabel(createdOf(item), now);
        const last = groups[groups.length - 1];
        if (last && last.label === label)
            last.items.push(item);
        else
            groups.push({ label, items: [item] });
    }
    return groups;
};

var formatDurationShort = sec => {
    if (typeof sec !== 'number' || !Number.isFinite(sec))
        return '';
    const total = Math.floor(sec);
    if (total <= 0)
        return '';
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours > 0)
        return `${hours}h${pad2(minutes)}min`;
    return `${pad2(minutes)}min${pad2(total % 60)}s`;
};

const join = parts => parts.filter(Boolean).join(SEP);

var itemSubtitle = ({ created, durationSec } = {}, now) => {
    const duration = formatDurationShort(durationSec);
    if (!validDate(created))
        return duration;
    const diff = validDate(now) ? dayDiff(created, now) : null;
    let when;
    if (diff !== null && diff <= 0)
        when = `${pad2(created.getHours())}:${pad2(created.getMinutes())}`;
    else if (diff === 1)
        when = 'Ontem';
    else
        when = `${pad2(created.getDate())}/${pad2(created.getMonth() + 1)}`;
    return join([when, duration]);
};

var detailSubtitle = ({ created, durationSec, speakerCount } = {}) => {
    const date = validDate(created)
        ? `${created.getDate()} ${MONTHS_SHORT[created.getMonth()]} ${created.getFullYear()}`
        : '';
    const speakers = Number.isInteger(speakerCount) && speakerCount > 0
        ? `${speakerCount} ${speakerCount === 1 ? 'locutor' : 'locutores'}`
        : '';
    return join([date, formatDurationShort(durationSec), speakers]);
};

// Horário de uma gravação (segundos Unix): o menor válido entre criação e modificação.
// Numa gravação a criação é o início; numa cópia (restauração, fixtures) a "criação" é a
// hora da cópia, depois da modificação, que então vale. null sem nenhum dos dois. Regra
// única da sidebar (grupos, subtítulo) e do painel de detalhe (data do subtítulo).
var itemTimestamp = (createdUnix, modifiedUnix) => {
    const valid = [createdUnix, modifiedUnix].filter(t => Number.isFinite(t) && t > 0);
    return valid.length ? Math.min(...valid) : null;
};

// O mesmo horário como Date (null sem data válida).
var itemDate = (createdUnix, modifiedUnix) => {
    const seconds = itemTimestamp(createdUnix, modifiedUnix);
    return seconds === null ? null : new Date(seconds * 1000);
};

const HOUR_MS = 3600 * 1000;

// Milissegundos até a próxima meia-noite local (quando "Hoje"/"Ontem" mudam); 1 h para
// uma data inválida.
var msUntilNextDay = now => {
    if (!validDate(now))
        return HOUR_MS;
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = midnight.getTime() - now.getTime();
    return ms > 0 ? ms : HOUR_MS;
};
