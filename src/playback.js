/* exported Playback */
// Player único do app: envolve um GstPlayer.Player e expõe posição/duração em
// segundos, velocidade e volume. Não depende de imports.application.
const { GLib, GObject, Gst, GstPlayer } = imports.gi;

const { RATES, clampVolume } = imports.playerModel;

const toSeconds = ns => ns / Gst.SECOND;

const isNumber = v => typeof v === 'number' && Number.isFinite(v);

var Playback = GObject.registerClass({
    Properties: {
        'uri': GObject.ParamSpec.string('uri', 'uri', 'Loaded URI',
            GObject.ParamFlags.READABLE, null),
        'playing': GObject.ParamSpec.boolean('playing', 'playing', 'Is playing',
            GObject.ParamFlags.READABLE, false),
        'rate': GObject.ParamSpec.double('rate', 'rate', 'Playback rate',
            GObject.ParamFlags.READWRITE, 0.1, 4, 1),
        'volume': GObject.ParamSpec.double('volume', 'volume', 'Volume (0-1)',
            GObject.ParamFlags.READWRITE, 0, 1, 1),
        'position': GObject.ParamSpec.double('position', 'position', 'Position in seconds',
            GObject.ParamFlags.READABLE, 0, Number.MAX_VALUE, 0),
        'duration': GObject.ParamSpec.double('duration', 'duration', 'Duration in seconds',
            GObject.ParamFlags.READABLE, 0, Number.MAX_VALUE, 0),
    },
    Signals: {
        'state-changed': { param_types: [GObject.TYPE_BOOLEAN] },
        'position-updated': { param_types: [GObject.TYPE_DOUBLE] },
        'duration-changed': { param_types: [GObject.TYPE_DOUBLE] },
        'ended': {},
        'rate-failed': {},
    },
}, class Playback extends GObject.Object {

    // `audioSink` (opcional) é um Gst.Element que substitui a saída de áudio;
    // existe para testes sem som. Em produção fica indefinido (sink padrão).
    _init({ audioSink, ...params } = {}) {
        super._init(params);
        this._uri = null;
        this._playing = false;
        this._desired = false; // intenção do usuário (play/pause), para toggle()
        this._rate = 1;
        this._volume = 1;
        this._position = 0;
        this._duration = 0;
        this._gen = 0;
        this._accepting = true;

        const dispatcher = GstPlayer.PlayerGMainContextSignalDispatcher.new(null);
        this._player = GstPlayer.Player.new(null, dispatcher);
        if (audioSink)
            this._player.get_pipeline().set_property('audio-sink', audioSink);

        this._player.connect('state-changed', (_p, state) => this._onState(state));
        this._player.connect('position-updated', (_p, ns) => this._onPosition(toSeconds(ns)));
        this._player.connect('duration-changed', (_p, ns) => this._onDuration(toSeconds(ns)));
        this._player.connect('end-of-stream', () => this._onEnd());
    }

    get uri() {
        return this._uri;
    }

    get playing() {
        return this._playing;
    }

    get rate() {
        return this._rate;
    }

    set rate(value) {
        this.setRate(value);
    }

    get volume() {
        return this._volume;
    }

    set volume(value) {
        this.setVolume(value);
    }

    get position() {
        return this._position;
    }

    get duration() {
        return this._duration;
    }

    load(uri) {
        const next = typeof uri === 'string' && uri !== '' ? uri : null;
        if (next === this._uri)
            return;

        this._desired = false;
        this._player.stop();
        this._barrier();
        this._setPlaying(false);
        this._uri = next;
        this.notify('uri');
        this._setPosition(0);
        this._setDuration(0, true);
        if (next === null)
            return;

        this._player.set_uri(next);
        // Pré-carrega (pausado, sem som) para conhecer a duração.
        this._player.pause();
    }

    play() {
        if (this._uri === null)
            return;
        this._desired = true;
        this._player.play();
    }

    pause() {
        if (this._uri === null)
            return;
        this._desired = false;
        this._player.pause();
    }

    toggle() {
        if (this._desired)
            this.pause();
        else
            this.play();
    }

    seek(seconds) {
        if (this._uri === null || !isNumber(seconds))
            return;
        let target = Math.max(0, seconds);
        if (this._duration > 0)
            target = Math.min(target, this._duration);
        this._setPosition(target);
        this._player.seek(Math.round(target * Gst.SECOND));
    }

    stop() {
        this._desired = false;
        this._player.stop();
        this._barrier();
        this._setPlaying(false);
        this._setPosition(0);
    }

    setRate(rate) {
        if (!RATES.includes(rate))
            return;
        try {
            this._player.set_rate(rate);
        } catch (e) {
            this._rate = 1;
            this.notify('rate');
            try {
                this._player.set_rate(1);
            } catch (_e) {
                // nada a fazer: o rate já está registrado como 1
            }
            this.emit('rate-failed');
            return;
        }
        this._rate = rate;
        this.notify('rate');
    }

    setVolume(volume) {
        this._volume = clampVolume(volume);
        this._player.set_volume(this._volume);
        this.notify('volume');
    }

    _setPlaying(playing) {
        if (this._playing === playing)
            return;
        this._playing = playing;
        this.notify('playing');
        this.emit('state-changed', playing);
    }

    _setPosition(seconds) {
        if (this._position === seconds)
            return;
        this._position = seconds;
        this.notify('position');
        this.emit('position-updated', seconds);
    }

    // `force` emite mesmo sem mudança (reinício ao trocar de gravação).
    _setDuration(seconds, force = false) {
        if (this._duration === seconds && !force)
            return;
        this._duration = seconds;
        this.notify('duration');
        this.emit('duration-changed', seconds);
    }

    // Os sinais do GstPlayer chegam por uma fila do main loop e podem ser anteriores
    // a um stop()/load() (posição, estado ou duração da mídia antiga). A fila é FIFO
    // na mesma prioridade: um idle colocado agora roda depois de tudo que já estava
    // enfileirado, então só então voltamos a aceitar eventos.
    _barrier() {
        const gen = ++this._gen;
        this._accepting = false;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (gen === this._gen)
                this._accepting = true;
            return GLib.SOURCE_REMOVE;
        });
    }

    _onState(state) {
        if (this._uri === null || !this._accepting)
            return;
        if (state === GstPlayer.PlayerState.PLAYING)
            this._setPlaying(true);
        else if (state === GstPlayer.PlayerState.STOPPED ||
                 (state === GstPlayer.PlayerState.PAUSED && !this._desired))
            this._setPlaying(false);
        // BUFFERING (e PAUSED transitório com play pedido): mantém o estado.
    }

    _onPosition(seconds) {
        if (this._uri !== null && this._accepting)
            this._setPosition(seconds);
    }

    _onDuration(seconds) {
        if (this._uri !== null && this._accepting)
            this._setDuration(seconds);
    }

    _onEnd() {
        if (this._uri === null || !this._accepting)
            return;
        this._desired = false;
        this._player.stop();
        this._barrier();
        this._setPlaying(false);
        this._setPosition(0);
        this.emit('ended');
    }
});
