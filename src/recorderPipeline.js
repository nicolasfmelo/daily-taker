/* exported buildPipelineDescription quoteValue RECORDER_ERROR_MESSAGE NOTHING_RECORDED_MESSAGE
            recorderFailureMessage keepRecording RecordingPipeline */
// Descrição gst-launch do pipeline de gravação: microfone + áudio do sistema
// mixados em mono 16 kHz e gravados continuamente em Ogg/Opus.
// Não importa imports.application para poder ser carregado em gjs puro (testes).
const { Gst } = imports.gi;

// Texto para a interface: nunca o texto bruto do GStreamer (pode conter caminhos).
var RECORDER_ERROR_MESSAGE = 'Não foi possível gravar: verifique o microfone e a saída de áudio.';
var NOTHING_RECORDED_MESSAGE = 'Nada foi gravado.';

// kept: o erro chegou no meio da gravação e o trecho já captado foi mantido na lista.
var recorderFailureMessage = kept => kept
    ? 'A gravação foi interrompida por uma falha de áudio. O trecho gravado foi mantido.'
    : RECORDER_ERROR_MESSAGE;

// Arquivo com dados e ao menos um pico do `level` da mixagem; senão "nada foi gravado"
// (fonte que não abriu, ou gravação de menos de 100 ms só com cabeçalhos Ogg).
var keepRecording = ({ exists, size, peakCount }) => exists && size > 0 && peakCount > 0;

// Aspas no estilo gst-launch: envolve em aspas duplas e escapa `\` e `"`.
function quoteValue(value) {
    return `"${String(value).replace(/[\\"]/g, c => `\\${c}`)}"`;
}

function _branch(source, levelName) {
    return `${source} ! audioconvert ! audioresample ! ` +
        `audio/x-raw,rate=16000,channels=1 ! level name=${levelName} ! mixer.`;
}

function buildPipelineDescription({
    micSource = 'pulsesrc device=@DEFAULT_SOURCE@',
    systemSource = 'pulsesrc device=@DEFAULT_MONITOR@',
    location,
} = {}) {
    return [
        'audiomixer name=mixer ! audioconvert ! level name=mix ! ' +
            'opusenc bitrate=32000 ! oggmux ! ' +
            // Sem buffer em espaço de usuário: cada página Ogg (≤ 0,5 s) vai
            // direto ao disco, então um crash deixa um arquivo parcial tocável.
            'filesink name=filesink buffer-mode=unbuffered ' +
            `location=${quoteValue(location)}`,
        _branch(micSource, 'mic'),
        _branch(systemSource, 'system'),
    ].join(' ');
}

// Ciclo de vida de um pipeline de gravação, sem GTK: criar, ligar, pausar, parar.
// Qualquer falha (descrição inválida, set_state FAILURE, ERROR no barramento, inclusive
// no meio da gravação) chama onError uma única vez com a mensagem para a interface; os
// detalhes do GStreamer só vão para o log.
var RecordingPipeline = class RecordingPipeline {
    constructor({ location, micSource, systemSource, onError = () => {}, onMessage = () => {} }) {
        this._description = { location, micSource, systemSource };
        this._onError = onError;
        this._onMessage = onMessage;
        this.pipeline = null;
        this.errored = false;
        this.reachedEos = false;
        this._state = Gst.State.NULL;
        this._bus = null;
        this._busHandlerId = 0;
    }

    // true se o pipeline foi ligado; false se falhou (onError já foi chamado).
    start() {
        try {
            this.pipeline = Gst.parse_launch(buildPipelineDescription(this._description));
            // Define o caminho também como propriedade, sem depender de aspas na descrição.
            this.pipeline.get_by_name('filesink').set_property('location', this._description.location);
        } catch (e) {
            this.pipeline = null;
            this._fail(`Unable to create the recorder pipeline: ${e.message}`);
            return false;
        }

        this._bus = this.pipeline.get_bus();
        this._bus.add_signal_watch();
        this._busHandlerId = this._bus.connect('message', (_bus, message) => {
            if (message !== null)
                this._onBusMessage(message);
        });
        return this.setState(Gst.State.PLAYING);
    }

    get state() {
        return this._state;
    }

    setState(state) {
        this._state = state;
        if (!this.pipeline)
            return false;
        if (this.pipeline.set_state(state) === Gst.StateChangeReturn.FAILURE) {
            // O motivo vem como ERROR no barramento; só para o log.
            const msg = this.pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR);
            const reason = msg ? `: ${msg.parse_error()[0].message}` : '';
            this._fail(`Unable to update the recorder pipeline state${reason}`);
            return false;
        }
        return true;
    }

    // Posição (ns) do `level` da mixagem; a do pipeline vem do filesink e atrasa ~1 s.
    position() {
        if (!this.pipeline)
            return -1;
        return this.pipeline.get_by_name('mix').query_position(Gst.Format.TIME)[1];
    }

    // Fecha o arquivo e libera o pipeline. Depois de um erro não espera EOS: o elemento
    // que falhou não deixa o EOS chegar ao filesink e a janela travaria 2 s à toa.
    stop() {
        this._removeWatch();
        if (!this.pipeline)
            return;
        if (!this.errored && !this.reachedEos)
            this._finishStream();
        this.pipeline.set_state(Gst.State.NULL);
        this._state = Gst.State.NULL;
        this.pipeline = null;
    }

    _removeWatch() {
        if (!this._bus)
            return;
        // add_signal_watch() só sai com remove_signal_watch() (remove_watch() não o remove).
        this._bus.disconnect(this._busHandlerId);
        this._bus.remove_signal_watch();
        this._bus = null;
        this._busHandlerId = 0;
    }

    // Envia EOS e espera (no máximo 2 s) o opusenc/oggmux escoarem e fecharem o arquivo.
    // Pausado, as fontes ao vivo não fluem: volta a PLAYING só para o EOS passar.
    _finishStream() {
        if (this._state === Gst.State.PAUSED)
            this.pipeline.set_state(Gst.State.PLAYING);
        this.pipeline.send_event(Gst.Event.new_eos());
        const msg = this.pipeline.get_bus().timed_pop_filtered(2 * Gst.SECOND,
            Gst.MessageType.EOS | Gst.MessageType.ERROR);
        if (!msg || msg.type !== Gst.MessageType.EOS)
            log('Recorder pipeline did not reach EOS cleanly');
    }

    _onBusMessage(message) {
        switch (message.type) {
        case Gst.MessageType.ERROR: {
            const [error, debug] = message.parse_error();
            this._fail(`Recorder pipeline error from ${message.src?.name}: ${error.message}\n${debug ?? ''}`);
            return;
        }
        case Gst.MessageType.WARNING:
            log(`Recorder pipeline warning: ${message.parse_warning()[0].message}`);
            return;
        case Gst.MessageType.EOS:
            this.reachedEos = true;
            break;
        }
        this._onMessage(message);
    }

    _fail(detail) {
        log(detail);
        if (this.errored)
            return;
        this.errored = true;
        this._onError(RECORDER_ERROR_MESSAGE);
    }
};
