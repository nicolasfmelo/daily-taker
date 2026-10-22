/* exported PlayerBar */
// Barra inferior do player: play/pausa, onda clicável com a posição, velocidade, volume e
// "Acompanhar áudio". Não tem estado do app além do Playback injetado por bind() e da
// gravação passada a setRecording(); a janela carrega a mídia (playback.load).
const { Gio, GLib, GObject, Gtk } = imports.gi;

const { RATES, positionLabel, rateLabel, toggleMute, volumeIcon } = imports.playerModel;
// Registra o tipo Gjs_SeekWaveform usado no template.
imports.seekWaveform;

var PlayerBar = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/player-bar.ui',
    InternalChildren: [
        'playButton', 'waveform', 'positionLabel', 'rateButton',
        'volumeButton', 'volumeScale', 'followSwitch',
    ],
    Properties: {
        'follow-audio': GObject.ParamSpec.boolean('follow-audio', 'follow-audio',
            'Scroll the transcript along with the audio',
            GObject.ParamFlags.READWRITE, true),
    },
}, class PlayerBar extends Gtk.Box {
    // `settings`: Gio.Settings do schema do app (chaves playback-rate, playback-volume e
    // follow-audio). Sem ele usa o Settings do app (importado só aqui, sob demanda).
    _init({ settings, ...params } = {}) {
        this._followAudio = true;
        this._playback = null;
        this._playbackIds = [];
        this._recording = null;
        this._recordingIds = [];
        this._muted = false;
        this._previousVolume = 1;
        this._syncing = false;
        super._init(params);
        this._settings = settings ?? imports.application.Settings;

        this._settings.bind('follow-audio', this, 'follow-audio', Gio.SettingsBindFlags.DEFAULT);
        this.bind_property('follow-audio', this._followSwitch, 'active',
            GObject.BindingFlags.BIDIRECTIONAL | GObject.BindingFlags.SYNC_CREATE);

        this._playButton.connect('clicked', () => this._playback?.toggle());
        this._waveform.connect('seek-requested', (_w, fraction) => this._seek(fraction));
        this._volumeButton.connect('clicked', () => this._toggleMute());
        this._volumeScale.connect('value-changed', () => {
            if (!this._syncing)
                this._userVolume(this._volumeScale.get_value() / 100);
        });
        this._buildRateMenu();

        this.setRecording(null);
    }

    get followAudio() {
        return this._followAudio;
    }

    set followAudio(value) {
        const next = Boolean(value);
        if (next === this._followAudio)
            return;
        this._followAudio = next;
        this.notify('follow-audio');
    }

    // Liga a barra a um Playback (desliga o anterior). Aplica a velocidade e o volume
    // salvos nas configurações.
    bind(playback) {
        for (const id of this._playbackIds)
            this._playback.disconnect(id);
        this._playbackIds = [];
        this._playback = playback ?? null;
        if (this._playback === null)
            return;

        this._muted = false;
        playback.setRate(this._settings.get_double('playback-rate'));
        playback.setVolume(this._settings.get_double('playback-volume'));
        this._previousVolume = playback.volume;

        this._playbackIds = [
            playback.connect('notify::playing', () => this._syncPlaying()),
            playback.connect('position-updated', () => this._syncPosition()),
            playback.connect('duration-changed', () => this._syncPosition()),
            playback.connect('notify::rate', () => this._syncRate()),
            playback.connect('notify::volume', () => this._syncVolume()),
        ];
        this._syncPlaying();
        this._syncPosition();
        this._syncRate();
        this._syncVolume();
    }

    // Gravação mostrada na onda; null desabilita os controles.
    setRecording(recording) {
        for (const id of this._recordingIds)
            this._recording.disconnect(id);
        this._recordingIds = [];
        this._recording = recording ?? null;
        this._waveform.setPeaks([]);

        const enabled = this._recording !== null;
        for (const widget of [this._playButton, this._waveform, this._rateButton,
            this._volumeButton, this._volumeScale, this._followSwitch])
            widget.sensitive = enabled;
        if (!enabled) {
            this._waveform.position = 0;
            this._positionLabel.label = positionLabel(0, 0);
            return;
        }

        const current = this._recording;
        this._recordingIds = [
            current.connect('peaks-updated', () => {
                if (this._recording === current)
                    this._waveform.setPeaks(current.peaks);
            }),
        ];
        if (current.peaks.length > 0)
            this._waveform.setPeaks(current.peaks);
        else
            current.loadPeaks();
        this._syncPosition();
    }

    _buildRateMenu() {
        this._rateAction = Gio.SimpleAction.new_stateful('rate',
            new GLib.VariantType('d'), new GLib.Variant('d', 1));
        this._rateAction.connect('activate', (_action, parameter) => {
            if (this._playback === null)
                return;
            this._playback.setRate(parameter.get_double());
            this._settings.set_double('playback-rate', this._playback.rate);
        });
        const group = new Gio.SimpleActionGroup();
        group.add_action(this._rateAction);
        this.insert_action_group('player', group);

        const menu = new Gio.Menu();
        for (const rate of RATES) {
            const item = Gio.MenuItem.new(rateLabel(rate), null);
            item.set_action_and_target_value('player.rate', new GLib.Variant('d', rate));
            menu.append_item(item);
        }
        this._rateButton.set_menu_model(menu);
    }

    _seek(fraction) {
        const playback = this._playback;
        if (playback === null || playback.duration <= 0)
            return;
        playback.seek(fraction * playback.duration);
    }

    _syncPlaying() {
        const playing = this._playback?.playing ?? false;
        this._playButton.icon_name = playing
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._playButton.tooltip_text = playing ? 'Pausar' : 'Reproduzir';
    }

    _syncPosition() {
        if (this._recording === null)
            return;
        const position = this._playback?.position ?? 0;
        const duration = this._playback?.duration ?? 0;
        this._positionLabel.label = positionLabel(position, duration);
        // Durante o arraste a onda segue o dedo, não o player.
        if (!this._waveform.dragging)
            this._waveform.position = duration > 0 ? position / duration : 0;
    }

    _syncRate() {
        const rate = this._playback?.rate ?? 1;
        this._rateButton.label = rateLabel(rate);
        this._rateAction.set_state(new GLib.Variant('d', rate));
    }

    _syncVolume() {
        const volume = this._playback?.volume ?? 1;
        if (this._muted && volume > 0)
            this._muted = false;
        this._syncing = true;
        this._volumeScale.set_value(volume * 100);
        this._syncing = false;
        this._volumeButton.icon_name = volumeIcon(volume, this._muted);
        this._volumeButton.tooltip_text = this._muted || volume <= 0 ? 'Ativar som' : 'Silenciar';
    }

    // Slider movido pelo usuário: aplica e grava.
    _userVolume(volume) {
        if (this._playback === null)
            return;
        this._muted = false;
        this._playback.setVolume(volume);
        this._settings.set_double('playback-volume', this._playback.volume);
    }

    // Clique no ícone: mudo/desmudo. O mudo não é gravado (ao abrir de novo, volta o
    // volume de antes); desmudar grava o volume restaurado.
    _toggleMute() {
        if (this._playback === null)
            return;
        const next = toggleMute({
            volume: this._playback.volume,
            muted: this._muted,
            previous: this._previousVolume,
        });
        this._muted = next.muted;
        this._previousVolume = next.previous;
        this._playback.setVolume(next.volume);
        this._syncVolume();
        if (!next.muted)
            this._settings.set_double('playback-volume', next.volume);
    }
});
