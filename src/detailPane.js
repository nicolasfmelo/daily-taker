/* exported DetailPane */
// Painel de conteúdo (à direita da lista): cabeçalho com título, subtítulo, abas
// Transcrição/Resumo e os botões Buscar/Copiar/Exportar; abaixo, o painel do estado
// atual (sem gravações, sem seleção, sem transcrição, gerando, erro ou a transcrição).
// Não chama a API nem abre diálogos de arquivo: pede ao dono (a janela) por sinais.
const { Gdk, Gio, GLib, GObject, Gtk } = imports.gi;

const { detailSubtitle, itemDate } = imports.recordingGroups;
const { generateCard, paneActions, paneBanner, paneState } = imports.sidebarModel;
const { buildBlocks } = imports.transcript;
const { findCounterText } = imports.transcriptViewModel;
const { TranscriptView } = imports.transcriptView;

const TABS = ['transcricao', 'resumo'];
const STATUSES = ['none', 'running', 'error', 'ready'];

// Locutores distintos na transcrição (blocos sem locutor não contam).
const speakerCount = t => {
    if (!t)
        return 0;
    return new Set(buildBlocks(t).map(b => b.speaker).filter(s => s !== null)).size;
};

// Data da gravação: a mesma regra da sidebar (itemTimestamp em recordingGroups.js).
const recordingDate = recording =>
    itemDate(recording.timeCreated?.to_unix(), recording.timeModified?.to_unix());

var DetailPane = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/detail-pane.ui',
    InternalChildren: [
        'mainStack', 'newRecordingButton', 'titleLabel', 'moreButton', 'subtitleLabel',
        'transcriptTab', 'summaryTab', 'searchButton', 'copyButton', 'exportButton',
        'searchRevealer', 'searchEntry', 'counterLabel', 'previousButton', 'nextButton',
        'closeSearchButton', 'tabStack', 'stateStack', 'costLabel', 'generateButton',
        'spinner', 'errorLabel', 'retryButton', 'summaryStack', 'banner', 'generateTitleLabel',
    ],
    Properties: {
        'tab': GObject.ParamSpec.string('tab', 'tab', 'Visible tab (transcricao or resumo)',
            GObject.ParamFlags.READWRITE, 'transcricao'),
    },
    Signals: {
        'generate-requested': { param_types: [GObject.TYPE_BOOLEAN] },
        'export-requested': { param_types: [GObject.TYPE_STRING] },
        'copy-requested': { param_types: [GObject.TYPE_BOOLEAN] },
        'retry-requested': {},
        'new-recording-requested': {},
    },
}, class DetailPane extends Gtk.Box {
    _init(params) {
        this._tab = 'transcricao';
        super._init(params);

        this._recording = null;
        this._recordingIds = [];
        this._transcript = null;
        this._status = 'none';
        this._hasRecordings = true;
        this._syncingTabs = false;
        this._errorMessage = '';
        this._state = 'no-selection';

        // Margens laterais: os blocos alinham com o divisor sob as abas (como na mockup).
        this._view = new TranscriptView({ embedded: true, vexpand: true, margin_start: 22, margin_end: 22 });
        this._stateStack.add_named(this._view, 'ready');
        // Renomear um locutor troca a transcrição dentro da visão.
        this._view.connect('transcript-changed', (_view, t) => {
            this._transcript = t;
            this._syncSubtitle();
        });

        this._buildActions();

        this._newRecordingButton.connect('clicked', () => this.emit('new-recording-requested'));
        this._generateButton.connect('clicked',
            () => this.emit('generate-requested', generateCard(this._status).regenerate));
        this._retryButton.connect('clicked', () => this.emit('retry-requested'));
        this._banner.connect('button-clicked', () => this.emit('retry-requested'));

        for (const [button, tab] of [[this._transcriptTab, 'transcricao'], [this._summaryTab, 'resumo']]) {
            button.connect('toggled', () => {
                if (button.active && !this._syncingTabs)
                    this.tab = tab;
            });
        }

        this._buildSearch();
        this._initialized = true;
        this._sync();
    }

    get view() {
        return this._view;
    }

    get tab() {
        return this._tab;
    }

    set tab(value) {
        if (!TABS.includes(value) || value === this._tab)
            return;
        this._tab = value;
        if (this._initialized)
            this._syncTabs();
        this.notify('tab');
    }

    bindPlayback(playback) {
        this._view.bindPlayback(playback);
    }

    setHasRecordings(hasRecordings) {
        this._hasRecordings = Boolean(hasRecordings);
        this._sync();
    }

    // Ordem esperada: setRecording → setTranscript → setState. Trocar de gravação (inclusive
    // para null) zera transcrição, status e a visão: nada da gravação anterior aparece sob o
    // título da nova. Exceção: uma transcrição dada com nenhuma gravação selecionada (ordem
    // invertida) fica e passa a usar o arquivo da gravação definida agora.
    setRecording(recording) {
        const next = recording ?? null;
        if (next !== this._recording) {
            for (const id of this._recordingIds)
                this._recording.disconnect(id);
            this._recordingIds = [];
            const pending = this._recording === null && this._transcript !== null;
            this._recording = next;
            if (next) {
                this._recordingIds = [
                    next.connect('notify::name', () => this._renamed()),
                    next.connect('notify::duration', () => this._syncSubtitle()),
                ];
            }
            if (pending && next) {
                this._view.setRecordingFile(next.file);
            } else {
                this._transcript = null;
                this._status = 'none';
                this._view.clear();
                this._view.running = false;
            }
        }
        this._closeSearch();
        this._syncTitle();
        this._syncSubtitle();
        this._sync();
    }

    setTranscript(t) {
        this._transcript = t ?? null;
        this._closeSearch();
        // Sem gravação o arquivo fica null até setRecording (nunca o de outra gravação).
        if (this._transcript)
            this._view.setTranscript(this._transcript, this._recording?.file ?? null);
        else
            this._view.clear();
        this._syncSubtitle();
        this._sync();
    }

    setState(state) {
        this._status = STATUSES.includes(state) ? state : 'none';
        this._view.running = this._status === 'running';
        this._sync();
    }

    setErrorMessage(message) {
        this._errorMessage = message ?? '';
        this._errorLabel.label = this._errorMessage;
        this._syncBanner();
    }

    setCostText(text) {
        this._costLabel.label = text ?? '';
        this._costLabel.visible = Boolean(text);
    }

    // Abre a busca com `query` e aplica já (sem esperar o atraso do campo de busca).
    // Devolve { count, index } como TranscriptView.setFindQuery; null sem transcrição pronta.
    search(query) {
        if (!this._searchButton.sensitive)
            return null;
        this._searchButton.active = true;
        this._searchEntry.text = query ?? '';
        return this._runFind();
    }

    _buildActions() {
        const group = new Gio.SimpleActionGroup();

        this._copyAction = new Gio.SimpleAction({ name: 'copy', parameter_type: new GLib.VariantType('b') });
        this._copyAction.connect('activate', (_action, param) => {
            const withSpeakers = param.get_boolean();
            // A visão copia e mostra o próprio aviso "Copiado"; o sinal é só informativo.
            this._view.copyAll(withSpeakers);
            this.emit('copy-requested', withSpeakers);
        });
        group.add_action(this._copyAction);

        this._exportAction = new Gio.SimpleAction({ name: 'export', parameter_type: new GLib.VariantType('s') });
        this._exportAction.connect('activate', (_action, param) => {
            const ext = param.get_string()[0];
            if (ext === 'md' || ext === 'txt')
                this.emit('export-requested', ext);
        });
        group.add_action(this._exportAction);

        this._regenerateAction = new Gio.SimpleAction({ name: 'regenerate' });
        this._regenerateAction.connect('activate', () => this.emit('generate-requested', true));
        group.add_action(this._regenerateAction);

        this.insert_action_group('pane', group);
    }

    _buildSearch() {
        this._searchButton.bind_property('active', this._searchRevealer, 'reveal-child',
            GObject.BindingFlags.SYNC_CREATE);
        this._searchButton.connect('toggled', () => {
            if (this._searchButton.active) {
                this._searchEntry.grab_focus();
            } else {
                this._searchEntry.text = '';
                this._runFind();
            }
        });
        this._searchEntry.connect('search-changed', () => this._runFind());
        // Esc: fecha e limpa a busca.
        this._searchEntry.connect('stop-search', () => this._closeSearch());
        // Enter / Shift+Enter: próximo / anterior (antes do "activate" do campo).
        const keys = new Gtk.EventControllerKey({ propagation_phase: Gtk.PropagationPhase.CAPTURE });
        keys.connect('key-pressed', (_controller, keyval, _keycode, modifiers) => {
            if (keyval !== Gdk.KEY_Return && keyval !== Gdk.KEY_KP_Enter && keyval !== Gdk.KEY_ISO_Enter)
                return Gdk.EVENT_PROPAGATE;
            this._step((modifiers & Gdk.ModifierType.SHIFT_MASK) ? -1 : 1);
            return Gdk.EVENT_STOP;
        });
        this._searchEntry.add_controller(keys);
        this._nextButton.connect('clicked', () => this._step(1));
        this._previousButton.connect('clicked', () => this._step(-1));
        this._closeSearchButton.connect('clicked', () => this._closeSearch());
    }

    _runFind() {
        const query = this._searchEntry.text;
        const result = this._view.setFindQuery(query);
        this._showFindResult(result, query);
        return result;
    }

    _step(dir) {
        const query = this._searchEntry.text;
        if (!query.trim())
            return;
        this._showFindResult(dir < 0 ? this._view.findPrevious() : this._view.findNext(), query);
    }

    _showFindResult({ count, index }, query) {
        const active = query.trim() !== '';
        this._counterLabel.visible = active;
        this._counterLabel.label = active ? findCounterText(count, index) : '';
        this._nextButton.sensitive = active && count > 0;
        this._previousButton.sensitive = active && count > 0;
    }

    _closeSearch() {
        const hadQuery = this._searchEntry.text !== '';
        if (this._searchButton.active)
            this._searchButton.active = false; // o handler de toggled limpa
        else if (hadQuery)
            this._searchEntry.text = '';
        if (hadQuery || this._counterLabel.visible)
            this._runFind();
    }

    // Renomear troca o arquivo da gravação (e move a transcrição): a visão passa a usá-lo.
    _renamed() {
        this._syncTitle();
        if (this._view.transcript)
            this._view.setRecordingFile(this._recording.file);
    }

    _syncTitle() {
        this._titleLabel.label = this._recording?.name ?? '';
        this._titleLabel.tooltip_text = this._titleLabel.label;
    }

    _syncSubtitle() {
        const recording = this._recording;
        this._subtitleLabel.label = recording
            ? detailSubtitle({
                created: recordingDate(recording),
                durationSec: recording.duration / 1e9,
                speakerCount: speakerCount(this._transcript),
            })
            : '';
    }

    _syncTabs() {
        this._syncingTabs = true;
        const transcript = this._tab === 'transcricao';
        this._transcriptTab.active = transcript;
        this._summaryTab.active = !transcript;
        this._syncingTabs = false;
        for (const [button, on] of [[this._transcriptTab, transcript], [this._summaryTab, !transcript]]) {
            if (on)
                button.add_css_class('active');
            else
                button.remove_css_class('active');
        }
        this._tabStack.visible_child_name = this._tab;
        this._syncToolbar();
    }

    _sync() {
        const state = paneState(this._recording, this._hasRecordings, this._status,
            this._transcript !== null);
        if (state === 'empty-library' || state === 'no-selection') {
            this._mainStack.visible_child_name = state;
        } else {
            this._mainStack.visible_child_name = 'detail';
            this._stateStack.visible_child_name = state;
        }
        this._spinner.spinning = state === 'running';
        this._generateTitleLabel.label = generateCard(this._status).title;
        this._summaryStack.visible_child_name = this._transcript ? 'coming-soon' : 'no-transcript';
        this._state = state;
        this._syncBanner();
        this._syncTabs();
    }

    _syncBanner() {
        const banner = this._state === 'ready' ? paneBanner(this._status, this._transcript !== null) : 'none';
        if (banner === 'running') {
            this._banner.title = 'Gerando novamente…';
            this._banner.button_label = null;
        } else if (banner === 'error') {
            this._banner.title = this._errorMessage
                ? `Não foi possível gerar novamente: ${this._errorMessage}`
                : 'Não foi possível gerar novamente.';
            this._banner.button_label = 'Tentar de novo';
        }
        this._banner.revealed = banner !== 'none';
    }

    _syncToolbar() {
        const actions = paneActions({ state: this._state, status: this._status, tab: this._tab });
        if (!actions.search)
            this._closeSearch();
        this._searchButton.sensitive = actions.search;
        this._copyButton.sensitive = actions.copy;
        this._copyAction.enabled = actions.copy;
        this._exportButton.sensitive = actions.export;
        this._exportAction.enabled = actions.export;
        this._regenerateAction.enabled = actions.regenerate;
        this._moreButton.sensitive = actions.regenerate;
    }
});
