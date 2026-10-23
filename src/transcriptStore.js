/* exported isTranscriptFileName, transcriptFileFor, saveTranscript, loadTranscript,
            moveTranscript, listTranscripts, saveSummary, restoreSummaryAt, saveSpeakers,
            saveTranscriptKeepingSummary, TranscriptReadError */
// Persistência das transcrições ao lado das gravações. Gio/GLib síncronos,
// sem dependência de GTK ou do módulo application (carregável em gjs puro).
const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const Transcript = imports.transcript;

const SUFFIX = '.transcript.json';

var isTranscriptFileName = name => name.endsWith(SUFFIX) || name.includes(`${SUFFIX}.unreadable-`);

var TranscriptReadError = class TranscriptReadError extends Error {};

var transcriptFileFor = recordingFile =>
    recordingFile.get_parent().get_child(`${recordingFile.get_basename()}${SUFFIX}`);

var saveTranscript = (recordingFile, t) => {
    transcriptFileFor(recordingFile).replace_contents(
        Transcript.stringifyTranscript(t), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
};

// Uma leitura parcial não pode tratar erro de disco/JSON como arquivo ausente:
// isso permitiria sobrescrever dados que não conseguimos ler.
const readForUpdate = recordingFile => {
    let contents;
    try {
        [, contents] = transcriptFileFor(recordingFile).load_contents(null);
    } catch (e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw e;
    }
    try {
        return Transcript.parseTranscript(ByteArray.toString(contents));
    } catch (e) {
        throw new TranscriptReadError('Transcrição ilegível ou com versão inválida.');
    }
};

const updateTranscript = (recordingFile, update) => {
    const current = readForUpdate(recordingFile);
    if (!current)
        return null;
    const next = update(current);
    if (next !== current)
        saveTranscript(recordingFile, next);
    return next;
};

var saveSummary = (file, summary) =>
    updateTranscript(file, t => Transcript.withSummary(t, summary));

var restoreSummaryAt = (file, version) =>
    updateTranscript(file, t => Transcript.restoreSummary(t, version));

var saveSpeakers = (file, speakers) =>
    updateTranscript(file, t => ({ ...t, speakers: { ...speakers } }));

var saveTranscriptKeepingSummary = (file, t) => {
    let current;
    try {
        current = readForUpdate(file);
    } catch (e) {
        if (!(e instanceof TranscriptReadError))
            throw e;
        // Só JSON/versão inválidos: erros de I/O nunca autorizam substituir.
        // Sem OVERWRITE: uma colisão do relógio preserva o backup anterior.
        const sidecar = transcriptFileFor(file);
        const backup = sidecar.get_parent().get_child(`${sidecar.get_basename()}.unreadable-${GLib.get_real_time()}`);
        sidecar.move(backup, Gio.FileCopyFlags.NONE, null, null);
    }
    const next = Transcript.clearSummary(t);
    delete next.summary_history;
    for (const field of ['summary', 'summary_history']) {
        if (current && Object.prototype.hasOwnProperty.call(current, field))
            next[field] = current[field];
    }
    saveTranscript(file, next);
};

var loadTranscript = recordingFile => {
    const file = transcriptFileFor(recordingFile);
    try {
        const [, contents] = file.load_contents(null);
        return Transcript.parseTranscript(ByteArray.toString(contents));
    } catch (e) {
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        // Só o nome: o conteúdo é uma transcrição privada.
        log(`Transcrição ilegível ou inválida: ${file.get_basename()}`);
        return null;
    }
};

var moveTranscript = (oldRecordingFile, newRecordingFile) => {
    const src = transcriptFileFor(oldRecordingFile);
    const dest = transcriptFileFor(newRecordingFile);
    if (src.equal(dest) || !src.query_exists(null))
        return;
    src.move(dest, Gio.FileCopyFlags.NONE, null, null);

    // O título nasce do nome da gravação: acompanha o novo nome, salvo se o usuário o
    // personalizou. Falhar aqui não desfaz a mudança de nome (só fica o título antigo).
    const oldName = oldRecordingFile.get_basename();
    const newName = newRecordingFile.get_basename();
    try {
        const t = loadTranscript(newRecordingFile);
        if (t && t.title === oldName)
            saveTranscript(newRecordingFile, Object.assign({}, t, { title: newName }));
    } catch (e) {
        log(`Não foi possível atualizar o título da transcrição: ${dest.get_basename()}`);
    }
};

var listTranscripts = dir => {
    const items = [];
    const enumerator = dir.enumerate_children('standard::name',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = enumerator.next_file(null))) {
        const name = info.get_name();
        if (!name.endsWith(SUFFIX))
            continue;
        const recordingFile = dir.get_child(name.slice(0, -SUFFIX.length));
        const transcript = loadTranscript(recordingFile);
        if (transcript)
            items.push({ recordingFile, transcript });
    }
    enumerator.close(null);
    const time = i => Date.parse(i.transcript.recorded_at) || 0;
    items.sort((a, b) => time(b) - time(a));
    return items;
};
