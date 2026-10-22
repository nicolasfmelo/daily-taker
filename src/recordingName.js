/* exported defaultRecordingName */

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const pad2 = n => String(n).padStart(2, '0');

var defaultRecordingName = (date, exists) => {
    const valid = date instanceof Date && !Number.isNaN(date.getTime());
    const base = valid
        ? `Gravação ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
        : 'Gravação';
    const taken = typeof exists === 'function' ? exists : () => false;
    let name = base;
    for (let n = 2; taken(name); n++)
        name = `${base} (${n})`;
    return name;
};
