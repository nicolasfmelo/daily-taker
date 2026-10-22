/* exported isTranscriptFileName, transcriptFileFor, saveTranscript, loadTranscript,
            moveTranscript, trashTranscript, listTranscripts */
// Persistência das transcrições ao lado das gravações. Gio/GLib síncronos,
// sem dependência de GTK ou do módulo application (carregável em gjs puro).
const { Gio, GLib } = imports.gi;
const ByteArray = imports.byteArray;
const Transcript = imports.transcript;

const SUFFIX = '.transcript.json';

var isTranscriptFileName = name => name.endsWith(SUFFIX);

var transcriptFileFor = recordingFile =>
    recordingFile.get_parent().get_child(`${recordingFile.get_basename()}${SUFFIX}`);

var saveTranscript = (recordingFile, t) => {
    transcriptFileFor(recordingFile).replace_contents(
        Transcript.stringifyTranscript(t), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
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
    src.move(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
};

var trashTranscript = recordingFile => {
    const file = transcriptFileFor(recordingFile);
    if (!file.query_exists(null))
        return;
    try {
        file.trash(null);
    } catch (e) {
        // Sem lixeira nesse volume: remove de vez em vez de deixar órfão.
        file.delete(null);
    }
};

var listTranscripts = dir => {
    const items = [];
    const enumerator = dir.enumerate_children('standard::name',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let info;
    while ((info = enumerator.next_file(null))) {
        const name = info.get_name();
        if (!isTranscriptFileName(name))
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
