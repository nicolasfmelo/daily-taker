/* exported Sidebar */
// Sidebar "Gravações": título com Exportar áudio, busca por nome e conteúdo da
// transcrição, lista agrupada por data (HOJE, ONTEM, …) com selo do status da
// transcrição e menu ⋮ por item, e o rodapé fixo. Não abre diálogos nem chama a API:
// pede ao dono (a janela) por sinais. A seleção (`selected`) é a fonte da verdade; a
// linha destacada na lista só a reflete.
const { Gio, GLib, GObject, Gtk, Pango } = imports.gi;

const { groupLabel, itemSubtitle } = imports.recordingGroups;
const { emptyListMessage, itemTimestamp, nextSelection, recordingMatches, statusBadge } =
    imports.sidebarModel;
const { rowStatus } = imports.transcriptionUi;
const { loadTranscript } = imports.transcriptStore;

const EMPTY_TEXT = {
    'no-recordings': 'Nenhuma gravação ainda',
    'no-results': 'Nada encontrado para essa busca',
};

// Data do item: início da gravação (ver itemTimestamp), ou null.
const itemDate = recording => {
    const seconds = itemTimestamp(recording.timeCreated?.to_unix(), recording.timeModified?.to_unix());
    return seconds === null ? null : new Date(seconds * 1000);
};

const SidebarItem = GObject.registerClass(class SidebarItem extends Gtk.ListBoxRow {
    _init(recording) {
        super._init({ css_classes: ['sidebar-item'] });
        this.recording = recording;
        this.badgeKind = 'none';

        const box = new Gtk.Box({ spacing: 14 });
        this._icon = new Gtk.Image({
            icon_name: 'audio-waveform-symbolic',
            pixel_size: 24,
            valign: Gtk.Align.CENTER,
            accessible_role: Gtk.AccessibleRole.PRESENTATION,
            css_classes: ['item-icon'],
        });
        box.append(this._icon);

        const text = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        // Nome dado pelo usuário: nunca interpretado como markup.
        this._title = new Gtk.Label({
            xalign: 0,
            ellipsize: Pango.EllipsizeMode.END,
            use_markup: false,
            css_classes: ['item-title'],
        });
        text.append(this._title);

        const line = new Gtk.Box({ spacing: 8 });
        // Curto (hora/data e duração): nunca cortado; quem encolhe é o rótulo do selo.
        this._subtitle = new Gtk.Label({
            xalign: 0,
            hexpand: true,
            use_markup: false,
            css_classes: ['item-subtitle', 'numeric'],
        });
        line.append(this._subtitle);

        this._badge = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER, visible: false, css_classes: ['status-badge'] });
        this._dot = new Gtk.Box({ valign: Gtk.Align.CENTER, css_classes: ['status-dot'] });
        this._spinner = new Gtk.Spinner({ valign: Gtk.Align.CENTER, css_classes: ['status-spinner'] });
        this._badgeLabel = new Gtk.Label({ use_markup: false, ellipsize: Pango.EllipsizeMode.END });
        this._badge.append(this._dot);
        this._badge.append(this._spinner);
        this._badge.append(this._badgeLabel);
        line.append(this._badge);
        text.append(line);
        box.append(text);

        this.menuButton = new Gtk.MenuButton({
            icon_name: 'view-more-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Mais ações',
            css_classes: ['flat', 'circular', 'item-menu'],
        });
        box.append(this.menuButton);
        this.child = box;
    }

    setTitle(name) {
        this._title.label = name ?? '';
        this._title.tooltip_text = this._title.label;
    }

    setSubtitle(text) {
        this._subtitle.label = text;
    }

    setBadge({ kind, label }) {
        this.badgeKind = kind;
        this._badge.visible = kind !== 'none';
        this._badgeLabel.label = label;
        // Numa sidebar estreita o rótulo pode ser cortado: o texto inteiro fica na dica.
        this._badge.tooltip_text = label || null;
        this._dot.visible = kind === 'ok' || kind === 'error';
        this._spinner.visible = kind === 'running';
        this._spinner.spinning = kind === 'running';
        for (const [cls, on] of [['badge-ok', kind === 'ok'], ['badge-error', kind === 'error'],
            ['badge-running', kind === 'running']]) {
            if (on)
                this._badge.add_css_class(cls);
            else
                this._badge.remove_css_class(cls);
        }
    }
});

var Sidebar = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/sidebar.ui',
    InternalChildren: ['exportButton', 'searchEntry', 'listStack', 'list', 'emptyLabel'],
    Signals: {
        'recording-selected': { param_types: [GObject.TYPE_OBJECT] },
        'rename-requested': { param_types: [GObject.TYPE_OBJECT] },
        'delete-requested': { param_types: [GObject.TYPE_OBJECT] },
        'transcribe-requested': { param_types: [GObject.TYPE_OBJECT, GObject.TYPE_BOOLEAN] },
        'export-audio-requested': { param_types: [GObject.TYPE_OBJECT] },
    },
}, class Sidebar extends Gtk.Box {
    _init({ recordingList, transcriptionService, settings = null, ...params } = {}) {
        super._init(params);
        this._store = recordingList;
        this._service = transcriptionService;
        this._settings = settings;
        this._selected = null;
        this._query = '';
        this._transcripts = new Map();   // uri → Transcript | null
        this._tracked = new Map();       // Recording → { uri, ids }
        this._visible = [];              // itens visíveis, na ordem da lista
        this._modelChanging = false;
        this._syncingRow = false;

        this._filter = Gtk.CustomFilter.new(item => this._matches(item));
        this._model = new Gtk.FilterListModel({ model: recordingList, filter: this._filter, incremental: false });

        // Antes da lista recriar as linhas: uma linha selecionada removida emite
        // row-selected(null), que não é uma escolha do usuário.
        this._model.connect('items-changed', () => {
            this._modelChanging = true;
        });
        this._list.bind_model(this._model, item => this._createRow(item));
        this._model.connect('items-changed', () => this._onModelChanged());
        this._list.set_header_func((row, before) => this._updateHeader(row, before));
        this._list.connect('row-selected', (_list, row) => this._onRowSelected(row));

        this._storeChangedId = recordingList.connect('items-changed', () => this._syncTracked());
        this._syncTracked();

        // Um único ouvinte para a sidebar inteira (o serviço não tem disconnect).
        transcriptionService.connectChange((uri, status) => {
            if (this._disposed)
                return;
            if (status !== 'running')
                this._transcripts.delete(uri);
            this.refreshStatus(uri);
            if (this._query.trim())
                this._filter.changed(Gtk.FilterChange.DIFFERENT);
        });

        this._buildActions();
        this._exportButton.connect('clicked', () => {
            if (this._selected)
                this.emit('export-audio-requested', this._selected);
        });
        this._searchEntry.connect('search-changed', () => this._applyQuery(this._searchEntry.text));
        // Esc limpa a busca. Nenhum atalho de letra é instalado: digitar na busca só busca.
        this._searchEntry.connect('stop-search', () => this.setQuery(''));
        // "Hoje"/"Ontem" mudam com o tempo: recalcula ao reaparecer.
        this.connect('map', () => this._refreshTimes());
        this.connect('destroy', () => this._dispose());

        this._visible = this._visibleRecordings();
        this._syncEmpty();
    }

    get selected() {
        return this._selected;
    }

    // Seleção programática. Uma gravação escondida pela busca limpa a busca antes; uma que
    // não está na lista (nem outra com o mesmo arquivo) é ignorada (devolve false).
    select(recording) {
        if (!recording) {
            this._setSelected(null);
            return true;
        }
        const target = this._storeItem(recording);
        if (!target)
            return false;
        if (!this._visible.includes(target))
            this.setQuery('');
        this._setSelected(target);
        return true;
    }

    // Reavalia o selo do item da gravação `uri` (se estiver visível).
    refreshStatus(uri) {
        const recording = this._visible.find(r => r.uri === uri);
        if (recording)
            this._rowFor(recording)?.setBadge(statusBadge(this._statusOf(recording)));
    }

    // A transcrição de `uri` mudou no disco: relê quando precisar (selo e busca).
    invalidateTranscript(uri) {
        this._transcripts.delete(uri);
        this.refreshStatus(uri);
        if (this._query.trim())
            this._filter.changed(Gtk.FilterChange.DIFFERENT);
    }

    // Aplica a busca já (sem esperar o atraso do campo).
    setQuery(text) {
        const query = text ?? '';
        if (this._searchEntry.text !== query)
            this._searchEntry.text = query;
        this._applyQuery(query);
    }

    // Transcrição de uma gravação (cache por URI; leitura síncrona do disco).
    _transcriptFor(recording) {
        const uri = recording.uri;
        if (!this._transcripts.has(uri))
            this._transcripts.set(uri, loadTranscript(recording.file));
        return this._transcripts.get(uri);
    }

    _statusOf(recording) {
        return rowStatus({
            hasTranscript: this._transcriptFor(recording) !== null,
            serviceStatus: this._service.status(recording.file),
        });
    }

    _matches(recording) {
        if (!this._query.trim())
            return true;
        return recordingMatches(this._query, recording.name, this._transcriptFor(recording));
    }

    _applyQuery(query) {
        if (query === this._query)
            return;
        const narrower = query.startsWith(this._query);
        const wider = this._query.startsWith(query);
        this._query = query;
        let change = Gtk.FilterChange.DIFFERENT;
        if (narrower)
            change = Gtk.FilterChange.MORE_STRICT;
        else if (wider)
            change = Gtk.FilterChange.LESS_STRICT;
        this._filter.changed(change);
        this._refreshTimes();
    }

    _storeItem(recording) {
        let byUri = null;
        for (let i = 0; i < this._store.get_n_items(); i++) {
            const item = this._store.get_item(i);
            if (item === recording)
                return item;
            if (!byUri && item.uri === recording.uri)
                byUri = item;
        }
        return byUri;
    }

    _visibleRecordings() {
        const items = [];
        for (let i = 0; i < this._model.get_n_items(); i++)
            items.push(this._model.get_item(i));
        return items;
    }

    // Linha atual de uma gravação visível (as linhas acompanham o modelo filtrado 1:1).
    _rowFor(recording) {
        const index = this._visible.indexOf(recording);
        return index < 0 ? null : this._list.get_row_at_index(index);
    }

    _createRow(recording) {
        const row = new SidebarItem(recording);
        row.setTitle(recording.name);
        row.setSubtitle(this._subtitleOf(recording, new Date()));
        row.setBadge(statusBadge(this._statusOf(recording)));
        // O menu só é montado ao abrir pela primeira vez; depois é atualizado a cada abertura
        // (rótulo Gerar/Gerar novamente e o que fica bloqueado dependem do status).
        row.menuButton.set_create_popup_func(button => {
            if (!button.menu_model)
                button.menu_model = new Gio.Menu();
            this._fillMenu(button, row.recording);
        });
        row.menuButton.connect('notify::active', button => {
            if (button.active && button.menu_model)
                this._fillMenu(button, row.recording);
        });
        return row;
    }

    _subtitleOf(recording, now) {
        return itemSubtitle({ created: itemDate(recording), durationSec: recording.duration / 1e9 }, now);
    }

    _fillMenu(button, recording) {
        const menu = button.menu_model;
        const status = this._statusOf(recording);
        const running = status === 'running';
        const hasTranscript = this._transcriptFor(recording) !== null;
        const target = new GLib.Variant('s', recording.uri);
        const item = (label, action) => {
            const it = Gio.MenuItem.new(label, null);
            it.set_action_and_target_value(action, target);
            return it;
        };
        menu.remove_all();
        const main = new Gio.Menu();
        // Durante uma transcrição: renomear e gerar ficam bloqueados (ação desligada).
        main.append_item(item('Renomear', running ? 'sidebar.busy' : 'sidebar.rename'));
        main.append_item(item(hasTranscript ? 'Gerar novamente' : 'Gerar transcrição',
            running ? 'sidebar.busy' : 'sidebar.transcribe'));
        main.append_item(item('Exportar áudio', 'sidebar.export'));
        menu.append_section(null, main);
        const danger = new Gio.Menu();
        danger.append_item(item('Excluir', 'sidebar.delete'));
        menu.append_section(null, danger);
        // O popover recria as linhas a cada mudança do modelo: marca de novo.
        this._markDestructive(button.popover);
    }

    // Excluir em vermelho: a linha do menu com esse rótulo ganha a classe destructive.
    _markDestructive(popover) {
        const walk = widget => {
            for (let child = widget?.get_first_child(); child; child = child.get_next_sibling()) {
                if (child.get_css_name() === 'modelbutton' && child.text === 'Excluir')
                    child.add_css_class('destructive');
                walk(child);
            }
        };
        walk(popover);
    }

    _buildActions() {
        const group = new Gio.SimpleActionGroup();
        const add = (name, fn) => {
            const action = new Gio.SimpleAction({ name, parameter_type: new GLib.VariantType('s') });
            action.connect('activate', (_action, param) => {
                const recording = this._storeItem({ uri: param.get_string()[0] });
                if (recording)
                    fn(recording);
            });
            group.add_action(action);
            return action;
        };
        add('rename', r => this.emit('rename-requested', r));
        add('transcribe', r => {
            if (this._service.status(r.file) !== 'running')
                this.emit('transcribe-requested', r, this._transcriptFor(r) !== null);
        });
        add('export', r => this.emit('export-audio-requested', r));
        add('delete', r => this.emit('delete-requested', r));
        // Destino dos itens bloqueados: sempre desligada (o item aparece insensível).
        add('busy', () => {}).enabled = false;
        this.insert_action_group('sidebar', group);
    }

    // Liga/desliga os ouvintes de cada gravação da lista (nome e duração).
    _syncTracked() {
        const present = new Set();
        for (let i = 0; i < this._store.get_n_items(); i++) {
            const recording = this._store.get_item(i);
            present.add(recording);
            if (this._tracked.has(recording))
                continue;
            this._tracked.set(recording, {
                uri: recording.uri,
                ids: [
                    recording.connect('notify::name', () => this._renamed(recording)),
                    recording.connect('notify::duration', () => {
                        this._rowFor(recording)?.setSubtitle(this._subtitleOf(recording, new Date()));
                    }),
                ],
            });
        }
        for (const [recording, { uri, ids }] of this._tracked) {
            if (present.has(recording))
                continue;
            for (const id of ids)
                recording.disconnect(id);
            this._tracked.delete(recording);
            this._transcripts.delete(uri);
        }
    }

    // Renomear troca o arquivo (e a URI) e move a transcrição: a chave do cache muda.
    _renamed(recording) {
        const tracked = this._tracked.get(recording);
        if (tracked) {
            this._transcripts.delete(tracked.uri);
            tracked.uri = recording.uri;
        }
        this._transcripts.delete(recording.uri);
        const row = this._rowFor(recording);
        row?.setTitle(recording.name);
        this.refreshStatus(recording.uri);
        if (this._query.trim())
            this._filter.changed(Gtk.FilterChange.DIFFERENT);
    }

    _onModelChanged() {
        this._modelChanging = false;
        const previous = this._visible;
        this._visible = this._visibleRecordings();
        this._reconcileSelection(previous);
        this._syncEmpty();
    }

    // Depois de qualquer mudança da lista: a selecionada continua destacada; se saiu da
    // biblioteca, a vizinha (nextSelection) é selecionada; se a busca a escondeu, nenhuma.
    _reconcileSelection(previous) {
        const selected = this._selected;
        if (!selected || this._visible.includes(selected)) {
            this._syncRow();
            return;
        }
        if (this._storeItem(selected) === selected) {
            this._setSelected(null);
            return;
        }
        const index = nextSelection(this._visible, previous.indexOf(selected));
        this._setSelected(index >= 0 ? this._visible[index] : null);
    }

    _onRowSelected(row) {
        if (this._syncingRow)
            return;
        if (!row) {
            // Linha removida pelo modelo: _onModelChanged decide. Senão, o usuário desmarcou.
            if (!this._modelChanging)
                this._setSelected(null);
            return;
        }
        this._setSelected(row.recording);
    }

    _setSelected(recording) {
        const next = recording ?? null;
        const changed = next !== this._selected;
        this._selected = next;
        this._exportButton.sensitive = next !== null;
        this._syncRow();
        if (changed)
            this.emit('recording-selected', next);
    }

    // Destaca na lista a linha da seleção (ou nenhuma), sem reentrar em _onRowSelected.
    _syncRow() {
        const row = this._selected ? this._rowFor(this._selected) : null;
        if (this._list.get_selected_row() === row)
            return;
        this._syncingRow = true;
        if (row)
            this._list.select_row(row);
        else
            this._list.unselect_all();
        this._syncingRow = false;
    }

    _updateHeader(row, before) {
        const now = new Date();
        const label = groupLabel(itemDate(row.recording), now);
        const previous = before ? groupLabel(itemDate(before.recording), now) : null;
        if (label === previous || !label) {
            row.set_header(null);
            return;
        }
        const header = row.get_header();
        if (header && header.label === label)
            return;
        row.set_header(new Gtk.Label({
            label,
            xalign: 0,
            use_markup: false,
            css_classes: ['group-label', 'sidebar-group'],
        }));
    }

    _refreshTimes() {
        const now = new Date();
        for (const recording of this._visible)
            this._rowFor(recording)?.setSubtitle(this._subtitleOf(recording, now));
        this._list.invalidate_headers();
    }

    _syncEmpty() {
        const kind = emptyListMessage(this._store.get_n_items(), this._visible.length, this._query);
        if (kind === 'none') {
            this._listStack.visible_child_name = 'list';
        } else {
            this._emptyLabel.label = EMPTY_TEXT[kind];
            this._listStack.visible_child_name = 'empty';
        }
    }

    _dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        this._store.disconnect(this._storeChangedId);
        for (const [recording, { ids }] of this._tracked) {
            for (const id of ids)
                recording.disconnect(id);
        }
        this._tracked.clear();
    }
});
