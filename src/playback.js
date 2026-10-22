/* exported Playback */
// Player único do app: envolve um GstPlayer.Player e expõe posição/duração em
// segundos, velocidade e volume. Não depende de imports.application.
const { GObject, Gst, GstPlayer } = imports.gi;

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
        'error': { param_types: [GObject.TYPE_STRING] },
    },
}, class Playback extends GObject.Object {

    // `audioSinkFactory` (opcional) devolve um Gst.Element novo de saída de áudio para
    // cada player; existe para testes sem som. Em produção fica indefinido (sink padrão).
    _init({ audioSinkFactory, ...params } = {}) {
        super._init(params);
        this._audioSinkFactory = audioSinkFactory ?? null;
        this._uri = null;
        this._playing = false;
        this._desired = false; // intenção do usuário (play/pause), para toggle()
        this._rate = 1;
        this._volume = 1;
        this._position = 0;
        this._duration = 0;
        // Um GstPlayer por mídia carregada (ver _attachPlayer); null sem uri.
        this._player = null;
        this._handlerIds = [];
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
        this._detachPlayer();
        this._setPlaying(false);
        this._uri = next;
        this.notify('uri');
        this._setPosition(0);
        this._setDuration(0, true);
        if (next !== null)
            this._attachPlayer();
    }

    play() {
        if (this._player === null)
            return;
        this._desired = true;
        this._player.play();
    }

    pause() {
        if (this._player === null)
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
        if (this._player === null || !isNumber(seconds))
            return;
        let target = Math.max(0, seconds);
        if (this._duration > 0)
            target = Math.min(target, this._duration);
        this._setPosition(target);
        this._player.seek(Math.round(target * Gst.SECOND));
    }

    stop() {
        this._desired = false;
        this._setPlaying(false);
        this._setPosition(0);
        this._reset();
    }

    // Desmonta o player atual (o que impede eventos atrasados dele de chegarem) e,
    // se há uri, prepara um novo, pausado e na posição 0.
    _reset() {
        if (this._uri === null)
            return;
        this._detachPlayer();
        this._attachPlayer();
    }

    setRate(rate) {
        if (!RATES.includes(rate))
            return;
        if (this._player !== null && !this._applyRate(rate))
            return;
        this._rate = rate;
        this.notify('rate');
    }

    // set_rate no player atual; em falha volta a 1 e avisa. Devolve se aplicou.
    _applyRate(rate) {
        try {
            this._player.set_rate(rate);
            return true;
        } catch (e) {
            this._rate = 1;
            this.notify('rate');
            try {
                this._player.set_rate(1);
            } catch (_e) {
                // nada a fazer: o rate já está registrado como 1
            }
            this.emit('rate-failed');
            return false;
        }
    }

    setVolume(volume) {
        this._volume = clampVolume(volume);
        this._player?.set_volume(this._volume);
        this.notify('volume');
    }

    // Cria um GstPlayer novo para a uri atual. Os sinais do GstPlayer chegam por
    // uma fila do main loop e um stop() é assíncrono, então eventos da mídia antiga
    // podem chegar depois da troca; por isso cada mídia tem seu player e tudo o que
    // vier de um player descartado é ignorado (closures comparam com this._player).
    _attachPlayer() {
        const dispatcher = GstPlayer.PlayerGMainContextSignalDispatcher.new(null);
        const player = GstPlayer.Player.new(null, dispatcher);
        this._player = player;
        if (this._audioSinkFactory)
            player.get_pipeline().set_property('audio-sink', this._audioSinkFactory());

        const current = fn => (p, ...args) => {
            if (p === this._player)
                fn(...args);
        };
        this._handlerIds = [
            player.connect('state-changed', current(state => this._onState(state))),
            player.connect('position-updated', current(ns => this._setPosition(toSeconds(ns)))),
            player.connect('duration-changed', current(ns => this._setDuration(toSeconds(ns)))),
            player.connect('end-of-stream', current(() => this._onEnd())),
            player.connect('error', current(() => this._onError())),
        ];

        player.set_volume(this._volume);
        player.set_uri(this._uri);
        if (this._rate !== 1)
            this._applyRate(this._rate);
        // Pré-carrega (pausado, sem som) para conhecer a duração.
        player.pause();
    }

    _detachPlayer() {
        const player = this._player;
        if (player === null)
            return;
        this._player = null;
        for (const id of this._handlerIds)
            player.disconnect(id);
        this._handlerIds = [];
        player.stop();
        try {
            player.get_pipeline().set_state(Gst.State.NULL);
        } catch (e) {
            // o stop() acima já derruba o pipeline
        }
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

    _onState(state) {
        if (state === GstPlayer.PlayerState.PLAYING)
            this._setPlaying(true);
        else if (state === GstPlayer.PlayerState.STOPPED ||
                 (state === GstPlayer.PlayerState.PAUSED && !this._desired))
            this._setPlaying(false);
        // BUFFERING (e PAUSED transitório com play pedido): mantém o estado.
    }

    _onEnd() {
        this._desired = false;
        this._setPlaying(false);
        this._setPosition(0);
        this._reset();
        this.emit('ended');
    }

    // Arquivo ausente/corrompido: não deixa o toggle() preso em "pausar".
    _onError() {
        this._desired = false;
        this._setPlaying(false);
        this.emit('error', 'falha ao reproduzir');
    }

    // Solta o player e os handlers; o objeto continua utilizável (load de novo).
    destroy() {
        this.load(null);
    }
});
