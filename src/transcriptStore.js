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

// Manda a transcrição para a lixeira; true se foi (ou não havia nada). Nunca apaga de
// vez: sem lixeira nesse volume (ou outro erro) ela fica onde está e devolve false.
// `trash` é injetável nos testes.
var trashTranscript = (recordingFile, { trash = f => f.trash(null) } = {}) => {
    const file = transcriptFileFor(recordingFile);
    if (!file.query_exists(null))
        return true;
    try {
        trash(file);
        return true;
    } catch (e) {
        // Só o nome: o conteúdo é uma transcrição privada.
        log(`Não foi possível mover para a lixeira: ${file.get_basename()} (${e.message})`);
        return false;
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
