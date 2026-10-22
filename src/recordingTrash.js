/* exported trashRecordingFiles trashRecordingFilesSync */
// Exclusão de uma gravação = mover para a lixeira do sistema, nunca apagar de vez. Ordem:
// o áudio primeiro; só se ele foi para a lixeira vão a transcrição e a forma de onda. Se
// o áudio não puder ir (volume sem lixeira, permissão…), nada é tocado e o chamador avisa
// e devolve a gravação à lista. Sem GTK (testável em gjs puro); `trash`/`trashAsync`
// injetáveis nos testes. Os logs levam só o nome do arquivo, nunca o conteúdo.
const { GLib } = imports.gi;

const describe = e => e?.message ?? String(e);

const logFailure = (file, e) =>
    log(`Não foi possível mover para a lixeira: ${file.get_basename()} (${describe(e)})`);

const defaultTrash = file => file.trash(null);

const defaultTrashAsync = file => new Promise((resolve, reject) => {
    file.trash_async(GLib.PRIORITY_DEFAULT, null, (obj, res) => {
        try {
            obj.trash_finish(res);
            resolve();
        } catch (e) {
            reject(e);
        }
    });
});

// O que existe depois do áudio (transcrição, forma de onda).
const extras = ({ sidecar, waveform }) => [sidecar, waveform].filter(f => f?.query_exists(null));

// Síncrono (fechar o app). true se o áudio foi para a lixeira.
var trashRecordingFilesSync = (files, { trash = defaultTrash } = {}) => {
    try {
        trash(files.audio);
    } catch (e) {
        logFailure(files.audio, e);
        return false;
    }
    for (const file of extras(files)) {
        try {
            trash(file);
        } catch (e) {
            logFailure(file, e);
        }
    }
    return true;
};

// Assíncrono. Promise<boolean>: true se o áudio foi para a lixeira. Nunca rejeita.
var trashRecordingFiles = async (files, { trashAsync = defaultTrashAsync } = {}) => {
    try {
        await trashAsync(files.audio);
    } catch (e) {
        logFailure(files.audio, e);
        return false;
    }
    for (const file of extras(files)) {
        try {
            await trashAsync(file);
        } catch (e) {
            logFailure(file, e);
        }
    }
    return true;
};
