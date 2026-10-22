/* exported generatePeaks cancelAllPeaks activePeakJobs */
// Picos da forma de onda de um arquivo: decodifica com uridecodebin → level e devolve um
// pico linear (0–1) por mensagem do level (intervalo padrão de 100 ms de áudio). O
// fakesink não sincroniza com o relógio, então o arquivo é lido o mais rápido que o
// decodificador consegue (antes, sync=true levava a duração inteira da gravação).
// Sem GTK nem imports.application, para poder ser testado com gjs puro.
const { Gst } = imports.gi;

const DESCRIPTION = 'uridecodebin name=uridecodebin ! audioconvert ! audio/x-raw,channels=1 ' +
    '! level name=level ! fakesink name=faked';

// Trabalhos em andamento (a função stop de cada um): fechar o app para todos de uma vez.
const active = new Set();

// Quantos trabalhos estão em andamento (verificação).
var activePeakJobs = () => active.size;

// Para todos os trabalhos em andamento (fechar o app): sem isso os pipelines ainda em
// PLAYING seriam finalizados na saída, com avisos GStreamer-CRITICAL. Nenhum callback é
// chamado depois. Devolve quantos foram parados.
var cancelAllPeaks = () => {
    let stopped = 0;
    for (const stop of [...active]) {
        if (stop())
            stopped++;
    }
    return stopped;
};

// onDone(peaks: number[]) no fim do arquivo; onError(Error) em falha. Devolve { cancel() }:
// depois de cancelar nenhum callback é chamado.
var generatePeaks = (uri, { onDone = () => {}, onError = () => {} } = {}) => {
    let pipeline = Gst.parse_launch(DESCRIPTION);
    pipeline.get_by_name('uridecodebin').set_property('uri', uri);
    const fakesink = pipeline.get_by_name('faked');
    fakesink.set_property('qos', false);
    fakesink.set_property('sync', false);

    const peaks = [];
    const bus = pipeline.get_bus();
    bus.add_signal_watch();

    const stop = () => {
        if (pipeline === null)
            return false;
        active.delete(stop);
        bus.disconnect(busId);
        bus.remove_signal_watch();
        pipeline.set_state(Gst.State.NULL);
        pipeline = null;
        return true;
    };

    const busId = bus.connect('message', (_bus, message) => {
        switch (message.type) {
        case Gst.MessageType.ELEMENT: {
            const s = message.get_structure();
            if (s && s.has_name('level')) {
                const peak = s.get_value('peak');
                if (peak)
                    peaks.push(Math.min(1, Math.pow(10, peak.get_nth(0) / 20)));
            }
            break;
        }
        case Gst.MessageType.EOS:
            if (stop())
                onDone(peaks);
            break;
        case Gst.MessageType.ERROR: {
            const [error] = message.parse_error();
            if (stop())
                onError(new Error(error?.message ?? 'falha ao gerar a forma de onda'));
            break;
        }
        }
    });

    active.add(stop);
    pipeline.set_state(Gst.State.PLAYING);
    return { cancel: stop };
};
