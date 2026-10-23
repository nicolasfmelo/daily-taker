/* exported DetailPane */
// Painel de conteúdo (à direita da lista): cabeçalho com título, subtítulo, abas
// Transcrição/Resumo e os botões Buscar/Copiar/Exportar; abaixo, o painel do estado
// atual (sem gravações, sem seleção, sem transcrição, gerando, erro ou a transcrição).
// Não chama a API nem abre diálogos de arquivo: pede ao dono (a janela) por sinais.
const { Adw, Gdk, Gio, GLib, GObject, Gtk } = imports.gi;

const { detailSubtitle, itemDate } = imports.recordingGroups;
const { generateCard, paneActions, paneBanner, paneState } = imports.sidebarModel;
const { buildBlocks } = imports.transcript;
const { findCounterText } = imports.transcriptViewModel;
const { TranscriptView } = imports.transcriptView;
const { SummaryView } = imports.summaryView;
const { getSummaryHistory } = imports.transcript;
const { formatDateTime } = imports.transcriptFormat;
const { formatUsd } = imports.transcriptionUi;

const summaryMetadata = summary => ({
    model: typeof summary.model === 'string' && summary.model ? summary.model : 'modelo desconhecido',
    date: formatDateTime(summary.generated_at) || 'data desconhecida',
    cost: Number.isFinite(summary.cost_usd) && summary.cost_usd >= 0
        ? formatUsd(summary.cost_usd) : 'custo desconhecido',
});

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
        // Janela média/estreita: margens menores (classe CSS .compact) para caber ao lado
        // da sidebar.
        'compact': GObject.ParamSpec.boolean('compact', 'compact', 'Narrow layout',
            GObject.ParamFlags.READWRITE, false),
    },
    Signals: {
        'generate-requested': { param_types: [GObject.TYPE_BOOLEAN] },
        'export-requested': { param_types: [GObject.TYPE_STRING] },
        'copy-requested': { param_types: [GObject.TYPE_BOOLEAN] },
        'retry-requested': {},
        'new-recording-requested': {},
        'summary-requested': { param_types: [GObject.TYPE_BOOLEAN] },
        'summary-retry-requested': {},
        'summary-copy-requested': {},
        'summary-restore-requested': { param_types: [GObject.TYPE_STRING] },
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
        this._summary = null;
        this._summaryHistory = [];
        this._summaryStatus = 'none';
        this._summaryError = '';
        this._summaryVersion = null;
        this._summaryRendered = null;
        this._buildSummary();

        // Margens laterais (+ 8 px dos blocos): a borda do bloco alinha com o título e o
        // divisor à esquerda e fica mais perto da borda à direita (como na mockup).
        this._view = new TranscriptView({ vexpand: true, margin_start: 16, margin_end: 8 });
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

    get compact() {
        return this.has_css_class('compact');
    }

    set compact(value) {
        const next = Boolean(value);
        if (next === this.compact)
            return;
        if (next)
            this.add_css_class('compact');
        else
            this.remove_css_class('compact');
        this._view.margin_start = next ? 8 : 16;
        this._view.margin_end = 8;
        this.notify('compact');
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
                    next.connect('notify::duration', () => {
                        this._syncSubtitle();
                        this._syncGenerate();
                    }),
                ];
            }
            if (pending && next) {
                this._view.setRecordingFile(next.file);
            } else {
                this._transcript = null;
                this._summary = null;
                this._summaryHistory = [];
                this._summaryStatus = 'none';
                this._summaryError = '';
                this._summaryVersion = null;
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

    setSummary(summary) {
        this._summary = summary;
        this._summaryVersion = null;
        this._syncSummary();
        this._syncToolbar();
    }

    setSummaryHistory(list) {
        this._summaryHistoryPopover?.popdown();
        this._summaryHistory = getSummaryHistory({ summary_history: list });
        this._summaryVersion = null;
        this._syncSummary();
        this._syncToolbar();
    }

    setSummaryState(state) {
        if (state === 'running')
            this._summaryHistoryPopover?.popdown();
        this._summaryStatus = ['none', 'running', 'error'].includes(state) ? state : 'none';
        this._syncSummary();
        this._syncToolbar();
    }

    setSummaryError(message) {
        this._summaryError = message ?? '';
        this._summaryErrorLabel.label = this._summaryError;
        this._syncSummary();
    }

    setSummaryCost(text) {
        this._summaryCostLabel.label = text ?? '';
    }

    get displayedSummary() {
        return this._summaryVersion === null ? this._summary : this._summaryHistory[this._summaryVersion] ?? null;
    }

    showSummaryVersion(index) {
        if (!Number.isInteger(index) || !this._summaryHistory[index] ||
            this._summaryStatus === 'running' || this._status === 'running')
            return;
        this._summaryVersion = index;
        this.tab = 'resumo';
        this._syncSummary();
        this._syncToolbar();
    }

    _buildSummary() {
        const column = () => new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 14 });
        const label = text => new Gtk.Label({ label: text, use_markup: false, wrap: true, xalign: 0.5 });
        const button = (text, fn) => {
            const b = new Gtk.Button({ label: text, halign: Gtk.Align.CENTER });
            b.connect('clicked', fn);
            return b;
        };
        const card = (title, content) => {
            const page = new Adw.StatusPage({ title, icon_name: 'view-list-bullet-symbolic', child: content });
            return page;
        };
        const empty = column();
        this._summaryCostLabel = label('');
        this._summaryCostLabel.add_css_class('dim-label');
        empty.append(this._summaryCostLabel);
        this._summaryGenerateButton = button('Gerar resumo', () => this.emit('summary-requested', false));
        this._summaryGenerateButton.add_css_class('suggested-action');
        this._summaryGenerateButton.add_css_class('pill');
        empty.append(this._summaryGenerateButton);
        this._summaryStack.add_named(card('Ainda não há resumo', empty), 'none');

        this._summarySpinner = new Gtk.Spinner({ halign: Gtk.Align.CENTER, width_request: 32, height_request: 32 });
        this._summaryStack.add_named(card('Gerando resumo…', this._summarySpinner), 'running');
        const failed = column();
        this._summaryErrorLabel = label('');
        failed.append(this._summaryErrorLabel);
        this._summaryRetryButton = button('Tentar de novo', () => this.emit('summary-retry-requested'));
        failed.append(this._summaryRetryButton);
        this._summaryStack.add_named(card('Não foi possível gerar o resumo', failed), 'error');

        const ready = column();
        ready.spacing = 0;
        this._summaryBanner = new Adw.Banner({ use_markup: false });
        this._summaryBanner.connect('button-clicked', () => this.emit('summary-retry-requested'));
        ready.append(this._summaryBanner);
        this._summaryHistoryBanner = new Adw.Banner({ use_markup: false, button_label: 'Restaurar esta versão' });
        this._summaryHistoryBanner.margin_start = 28;
        this._summaryHistoryBanner.margin_end = 28;
        this._summaryHistoryBanner.connect('button-clicked', () => {
            const generatedAt = this.displayedSummary?.generated_at;
            if (this._summaryVersion !== null && typeof generatedAt === 'string' && generatedAt &&
                this._summaryStatus !== 'running' && this._status !== 'running')
                this.emit('summary-restore-requested', generatedAt);
        });
        ready.append(this._summaryHistoryBanner);
        this._summaryBackButton = button('Voltar à atual', () => {
            this._summaryVersion = null;
            this._syncSummary();
            this._syncToolbar();
        });
        ready.append(this._summaryBackButton);
        this._summaryView = new SummaryView();
        ready.append(this._summaryView);
        this._summaryFooter = label('');
        this._summaryFooter.margin_top = 12;
        this._summaryFooter.margin_bottom = 12;
        this._summaryFooter.add_css_class('dim-label');
        ready.append(this._summaryFooter);
        this._summaryToastOverlay = new Adw.ToastOverlay({ child: ready });
        this._summaryStack.add_named(this._summaryToastOverlay, 'ready');
    }

    _syncSummary() {
        const shown = this.displayedSummary;
        const state = !this._transcript ? 'no-transcript'
            : shown ? 'ready' : this._summaryStatus;
        this._summaryStack.visible_child_name = state;
        const busy = this._summaryStatus === 'running' || this._status === 'running';
        this._syncGenerate();
        this._summaryGenerateButton.sensitive = Boolean(this._transcript) && !busy;
        this._summaryRetryButton.sensitive = !busy;
        this._summarySpinner.spinning = state === 'running';
        this._summaryBanner.revealed = Boolean(shown) && this._summaryStatus !== 'none';
        this._summaryBanner.title = this._summaryStatus === 'running' ? 'Gerando novamente…' : this._summaryError;
        this._summaryBanner.button_label = this._summaryStatus === 'error' ? 'Tentar de novo' : null;
        this._summaryBanner.sensitive = !busy;
        this._summaryHistoryBanner.revealed = this._summaryVersion !== null;
        this._summaryHistoryBanner.sensitive = !busy && Boolean(shown?.generated_at);
        this._summaryBackButton.visible = this._summaryVersion !== null;
        if (shown) {
            const meta = summaryMetadata(shown);
            this._summaryHistoryBanner.title = `Versão de ${meta.date}`;
            this._summaryFooter.label = `Gerado por ${meta.model} em ${meta.date} · ${meta.cost}` +
                (shown.truncated ? ' (resumo cortado)' : '');
        }
        if (shown?.text !== this._summaryRendered) {
            this._summaryRendered = shown?.text ?? null;
            this._summaryView.setText(shown?.text ?? '');
        }
    }

    _showSummaryHistory() {
        if (!this._historyAction.enabled)
            return;
        this._moreButton.popdown();
        const list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_start: 8, margin_end: 8,
            margin_top: 8, margin_bottom: 8 });
        const scroll = new Gtk.ScrolledWindow({ child: list, max_content_height: 420,
            propagate_natural_height: true, hscrollbar_policy: Gtk.PolicyType.NEVER });
        const popover = new Gtk.Popover({ child: scroll });
        this._summaryHistoryPopover = popover;
        popover.set_parent(this._moreButton);
        this._summaryHistory.forEach((s, index) => {
            const meta = summaryMetadata(s);
            const text = `${meta.date} • ${meta.model} • ${meta.cost}`;
            const row = new Gtk.Button({ child: new Gtk.Label({ label: text, use_markup: false, wrap: true }) });
            row.connect('clicked', () => { this.showSummaryVersion(index); popover.popdown(); });
            list.append(row);
        });
        popover.connect('closed', () => {
            if (this._summaryHistoryPopover === popover)
                this._summaryHistoryPopover = null;
            popover.unparent();
        });
        popover.popup();
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


        this._transcriptCopyMenu = this._copyButton.menu_model;
        this._summaryCopyMenu = new Gio.Menu();
        this._summaryCopyMenu.append('Copiar resumo', 'pane.summary-copy');
        this._summaryCopyAction = new Gio.SimpleAction({ name: 'summary-copy' });
        this._summaryCopyAction.connect('activate', () => {
            if (!this.displayedSummary)
                return;
            this.get_clipboard().set(this.displayedSummary.text);
            this._summaryToastOverlay.add_toast(new Adw.Toast({ title: 'Resumo copiado', use_markup: false, timeout: 2 }));
            this.emit('summary-copy-requested');
        });
        group.add_action(this._summaryCopyAction);
        this._summaryRegenerateAction = new Gio.SimpleAction({ name: 'summary-regenerate' });
        this._summaryRegenerateAction.connect('activate', () => this.emit('summary-requested', true));
        group.add_action(this._summaryRegenerateAction);
        this._historyAction = new Gio.SimpleAction({ name: 'summary-history' });
        this._historyAction.connect('activate', () => this._showSummaryHistory());
        group.add_action(this._historyAction);
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

    _syncGenerate() {
        const duration = this._recording?.duration ?? 0;
        this._generateButton.sensitive = Number.isFinite(duration) && duration > 0 &&
            this._status !== 'running' && this._summaryStatus !== 'running';
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
        this._syncGenerate();
        this._syncSummary();
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
        const summary = this._summaryStatus === 'running' ? 'running' : this.displayedSummary ? 'ready' : this._summaryStatus;
        const actions = paneActions({ state: this._state, status: this._status, tab: this._tab,
            summary, hasHistory: this._summaryHistory.length > 0 });
        if (!actions.search)
            this._closeSearch();
        this._searchButton.sensitive = actions.search;
        this._copyButton.sensitive = actions.copy;
        this._copyAction.enabled = actions.copy && this._tab === 'transcricao';
        this._summaryCopyAction.enabled = actions.copy && this._tab === 'resumo';
        const menu = this._tab === 'resumo' ? this._summaryCopyMenu : this._transcriptCopyMenu;
        if (this._copyButton.menu_model !== menu)
            this._copyButton.menu_model = menu;
        this._exportButton.sensitive = actions.export;
        this._exportAction.enabled = actions.export;
        this._regenerateAction.enabled = actions.regenerate;
        this._summaryRegenerateAction.enabled = actions.summaryRegenerate;
        this._historyAction.enabled = actions.history;
        this._moreButton.sensitive = actions.regenerate || actions.summaryRegenerate || actions.history;
    }
});
