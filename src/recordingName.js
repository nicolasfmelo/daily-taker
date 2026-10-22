/* exported defaultRecordingName recordingFileFor */

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

// Escolhe o arquivo (ainda não criado) de uma gravação nova em `dir`: nome por data/hora,
// com " (2)", " (3)"… se já existir.
var recordingFileFor = (dir, date) => {
    const name = defaultRecordingName(date, n => dir.get_child_for_display_name(n).query_exists(null));
    return dir.get_child_for_display_name(name);
};
