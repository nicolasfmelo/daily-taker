/* exported TranscriptView */
const { Adw, Gdk, Gio, GLib, GObject, Graphene, GstPlayer, Gtk, Pango } = imports.gi;
const { formatShortClock, shouldScroll } = imports.playerModel;
const { speakerClass } = imports.speakerColors;
const { buildBlocks, renameSpeaker } = imports.transcript;
const { copyBlock, copyText, exportFileName, formatClock } = imports.transcriptFormat;
const { saveTranscript } = imports.transcriptStore;
const {
    blockTitle, currentBlockIndex, exportContent, exportExtension, findMatches, nextIndex,
    speakerEntry, viewHeader,
} = imports.transcriptViewModel;

// Blocos criados por iteração ociosa: milhares de blocos não travam a interface.
const CHUNK_SIZE = 100;
// Intervalo do destaque do bloco falado enquanto o player toca esta gravação.
const HIGHLIGHT_INTERVAL_MS = 150;
// Largura máxima do texto: a visão antiga fica numa coluna estreita; a embutida
// (painel de detalhes) ocupa o painel todo, como na mockup.
const CLAMP_CLASSIC = 760;
const CLAMP_EMBEDDED = 1400;
const CLAMP_TIGHTENING = 400; // padrão do AdwClamp
// Rolagem suave até o bloco atual / resultado da busca.
const SCROLL_DURATION_MS = 250;

// Sobe de `widget` até `stop` (exclusive): true se passou por um botão.
const insideButton = (widget, stop) => {
    for (let w = widget; w && w !== stop; w = w.get_parent()) {
        if (w instanceof Gtk.Button || w instanceof Gtk.MenuButton)
            return true;
    }
    return false;
};

var TranscriptView = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/transcript-view.ui',
    InternalChildren: [
        'toastOverlay', 'scroller', 'clamp', 'contentBox', 'headerBox', 'titleLabel',
        'dateTimeLabel', 'detailsLabel', 'speakersLabel', 'blocksBox', 'regenerateStack',
        'regenerateSpinner',
    ],
    Properties: {
        // false: visão antiga (cabeçalho próprio, grupo de ações `transcript`, attachPlayer).
        // true: dentro do DetailPane (sem cabeçalho, blocos da mockup, bindPlayback).
        'embedded': GObject.ParamSpec.boolean('embedded', 'embedded', 'Inside the detail pane',
            GObject.ParamFlags.READWRITE, false),
        // Acompanhar áudio: rola até o bloco que está tocando (só no modo embutido).
        'follow-audio': GObject.ParamSpec.boolean('follow-audio', 'follow-audio',
            'Scroll to the block being played', GObject.ParamFlags.READWRITE, true),
    },
    Signals: {
        'seek-requested': { param_types: [GObject.TYPE_DOUBLE] },
        'transcript-changed': { param_types: [GObject.TYPE_JSOBJECT] },
        'regenerate-requested': {},
        // Todos os blocos foram criados (o preenchimento é feito em lotes ociosos).
        'blocks-built': {},
    },
}, class TranscriptView extends Gtk.Box {
    _init(params) {
        this._embedded = false;
        this._followAudio = true;
        super._init(params);

        this._transcript = null;
        this._recordingFile = null;
        this._blocks = [];
        this._blockRows = [];
        this._fillSourceId = 0;
        this._player = null;
        this._playerState = GstPlayer.PlayerState.STOPPED;
        this._playerStateId = 0;
        this._highlightSourceId = 0;
        this._currentIndex = -1;
        this._running = false;
        this._playback = null;
        this._playbackIds = [];
        this._findQuery = '';
        this._findMatches = [];
        this._findActive = -1;
        this._pendingScroll = -1;
        this._scrollAnimation = null;

        const actions = new Gio.SimpleActionGroup();
        const copyAll = new Gio.SimpleAction({
            name: 'copy-all',
            parameter_type: new GLib.VariantType('b'),
        });
        copyAll.connect('activate', (_action, param) => {
            if (this._transcript)
                this._copy(copyText(this._transcript, { withSpeakers: param.get_boolean() }));
        });
        actions.add_action(copyAll);

        const exportAction = new Gio.SimpleAction({
            name: 'export',
            parameter_type: new GLib.VariantType('s'),
        });
        exportAction.connect('activate', (_action, param) => this._export(param.get_string()[0]));
        actions.add_action(exportAction);

        this._regenerateAction = new Gio.SimpleAction({ name: 'regenerate' });
        this._regenerateAction.connect('activate', () => this.emit('regenerate-requested'));
        actions.add_action(this._regenerateAction);

        // Menu de cada bloco (modo embutido): "Copiar bloco".
        const copyBlockAction = new Gio.SimpleAction({
            name: 'copy-block',
            parameter_type: new GLib.VariantType('i'),
        });
        copyBlockAction.connect('activate', (_action, param) => {
            const block = this._blocks[param.get_int32()];
            if (block)
                this._copy(copyBlock(block));
        });
        actions.add_action(copyBlockAction);

        this.insert_action_group('transcript', actions);

        this.connect('map', () => this._syncHighlight());
        this.connect('unmap', () => this._syncHighlight());
        this._initialized = true;
        this._applyMode();
    }

    get embedded() {
        return this._embedded;
    }

    set embedded(value) {
        value = Boolean(value);
        if (value === this._embedded)
            return;
        this._embedded = value;
        if (this._initialized) {
            this._applyMode();
            // Os blocos mudam de layout: refeitos com a transcrição atual.
            if (this._transcript)
                this._fillBlocks();
        }
        this.notify('embedded');
    }

    get followAudio() {
        return this._followAudio;
    }

    set followAudio(value) {
        value = Boolean(value);
        if (value === this._followAudio)
            return;
        this._followAudio = value;
        this.notify('follow-audio');
        // Religar volta a mostrar o bloco que está tocando.
        if (value && this._embedded && this._currentIndex >= 0)
            this._scrollToBlock(this._currentIndex);
    }

    _applyMode() {
        const embedded = this._embedded;
        this._headerBox.visible = !embedded;
        this._clamp.maximum_size = embedded ? CLAMP_EMBEDDED : CLAMP_CLASSIC;
        // Embutido: ocupa a largura do painel até o máximo, sem estreitar antes.
        this._clamp.tightening_threshold = embedded ? CLAMP_EMBEDDED : CLAMP_TIGHTENING;
        this._blocksBox.spacing = embedded ? 8 : 18;
        this._contentBox.margin_top = embedded ? 8 : 18;
        this._contentBox.margin_start = embedded ? 8 : 16;
        this._contentBox.margin_end = embedded ? 8 : 16;
        if (embedded)
            this._blocksBox.add_css_class('embedded');
        else
            this._blocksBox.remove_css_class('embedded');
    }

    get recordingFile() {
        return this._recordingFile;
    }

    get transcript() {
        return this._transcript;
    }

    // O destaque acompanha o player só quando ele toca ESTA gravação.
    attachPlayer(player, state) {
        this._player = player;
        this._playerState = state ?? GstPlayer.PlayerState.STOPPED;
        if (this.get_root())
            this._connectPlayer();
    }

    // Modo embutido: o destaque segue o Playback único (re-ligar troca o anterior).
    bindPlayback(playback) {
        if (playback === this._playback)
            return;
        this._disconnectPlayback();
        this._playback = playback ?? null;
        if (this.get_root())
            this._connectPlayback();
        this._syncHighlight();
    }

    vfunc_root() {
        super.vfunc_root();
        this._connectPlayer();
        this._connectPlayback();
    }

    vfunc_unroot() {
        this.release();
        if (this._playerStateId) {
            this._player.disconnect(this._playerStateId);
            this._playerStateId = 0;
        }
        this._disconnectPlayback();
        super.vfunc_unroot();
    }

    _connectPlayback() {
        if (!this._playback || this._playbackIds.length > 0)
            return;
        const sync = () => this._syncHighlight();
        this._playbackIds = [
            this._playback.connect('position-updated', sync),
            this._playback.connect('state-changed', sync),
            this._playback.connect('notify::uri', sync),
        ];
    }

    _disconnectPlayback() {
        for (const id of this._playbackIds)
            this._playback.disconnect(id);
        this._playbackIds = [];
    }

    _connectPlayer() {
        if (!this._player || this._playerStateId)
            return;
        this._playerStateId = this._player.connect('state-changed', (_player, state) => {
            this._playerState = state;
            this._syncHighlight();
        });
    }

    // Saindo da página: nada de trabalho em segundo plano.
    release() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        this._stopHighlightTimer();
        this._pendingScroll = -1;
        this._scrollAnimation?.skip();
        this._scrollAnimation = null;
    }

    // Durante uma nova transcrição renomear fica bloqueado: o resultado sobrescreveria o nome.
    set running(running) {
        this._running = running;
        for (const row of this._blockRows) {
            if (row.speakerButton)
                row.speakerButton.sensitive = !running;
        }
        this._regenerateAction.enabled = !running;
        this._regenerateStack.visible_child_name = running ? 'running' : 'idle';
        this._regenerateSpinner.spinning = running;
    }

    setTranscript(t, recordingFile) {
        this._transcript = t;
        this._recordingFile = recordingFile;
        this._blocks = buildBlocks(t);
        this._currentIndex = -1;
        // Outra transcrição: a busca anterior não vale mais (o painel limpa a barra).
        this._findQuery = '';
        this._findMatches = [];
        this._findActive = -1;
        this._pendingScroll = -1;

        this._fillHeader();
        this._fillBlocks();
        this._scrollAnimation?.skip();
        this._scroller.vadjustment.value = 0;
        this._syncHighlight();
    }

    // Copiar tudo (no modo embutido o botão fica no DetailPane).
    copyAll(withSpeakers) {
        if (this._transcript)
            this._copy(copyText(this._transcript, { withSpeakers: Boolean(withSpeakers) }));
    }

    // Busca dentro da transcrição: realça os blocos que batem (.find-match), o ativo com
    // .find-active, e rola até ele. Devolve { count, index } (index na lista de
    // resultados, a partir de 0; -1 sem resultados). Consulta vazia limpa.
    setFindQuery(query) {
        this._findQuery = query ?? '';
        this._applyFind(findMatches(this._blocks, this._findQuery), 0, true);
        return this._findResult();
    }

    findNext() {
        return this._stepFind(1);
    }

    findPrevious() {
        return this._stepFind(-1);
    }

    _stepFind(dir) {
        this._setFindActive(nextIndex(this._findMatches, this._findActive, dir));
        return this._findResult();
    }

    _findResult() {
        return { count: this._findMatches.length, index: this._findActive };
    }

    // Troca os resultados da busca; `scroll` rola até o ativo (não ao renomear).
    _applyFind(matches, active, scroll) {
        this._markFindActive(false);
        for (const i of this._findMatches)
            this._blockRows[i]?.box.remove_css_class('find-match');
        this._findMatches = matches;
        for (const i of matches)
            this._blockRows[i]?.box.add_css_class('find-match');
        this._findActive = matches.length > 0 ? Math.min(Math.max(0, active), matches.length - 1) : -1;
        this._markFindActive(true);
        if (scroll && this._findActive >= 0)
            this._scrollToBlock(matches[this._findActive]);
    }

    _markFindActive(on) {
        const row = this._blockRows[this._findMatches[this._findActive]];
        if (on)
            row?.box.add_css_class('find-active');
        else
            row?.box.remove_css_class('find-active');
    }

    _setFindActive(position) {
        this._markFindActive(false);
        this._findActive = position;
        this._markFindActive(true);
        if (position >= 0)
            this._scrollToBlock(this._findMatches[position]);
    }

    // Centraliza o bloco na área visível, com animação. Bloco ainda não criado (lote
    // ocioso) ou sem tamanho: tenta de novo quando ele existir / no próximo quadro.
    _scrollToBlock(index) {
        const row = this._blockRows[index];
        if (!row) {
            this._pendingScroll = index;
            return;
        }
        this._pendingScroll = -1;
        // Coordenadas no conteúdo (o clamp), não no viewport que rola.
        const [ok, point] = row.box.compute_point(this._clamp, new Graphene.Point({ x: 0, y: 0 }));
        if (!ok || row.box.get_height() === 0) {
            this._pendingScroll = index;
            row.box.add_tick_callback(() => {
                if (this._pendingScroll === index && this._blockRows[index] === row)
                    this._scrollToBlock(index);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        const adj = this._scroller.vadjustment;
        const max = Math.max(0, adj.upper - adj.page_size);
        const wanted = point.y + row.box.get_height() / 2 - adj.page_size / 2;
        const value = Math.min(max, Math.max(0, wanted));
        this._scrollAnimation?.skip();
        if (!this.get_mapped() || Math.abs(value - adj.value) < 1) {
            this._scrollAnimation = null;
            adj.value = value;
            return;
        }
        const animation = new Adw.TimedAnimation({
            widget: this._scroller,
            value_from: adj.value,
            value_to: value,
            duration: SCROLL_DURATION_MS,
            easing: Adw.Easing.EASE_OUT_CUBIC,
            target: Adw.PropertyAnimationTarget.new(adj, 'value'),
        });
        animation.connect('done', () => {
            if (this._scrollAnimation === animation)
                this._scrollAnimation = null;
        });
        this._scrollAnimation = animation;
        animation.play();
    }

    _fillHeader() {
        const header = viewHeader(this._transcript);
        this._titleLabel.label = header.title;
        this._dateTimeLabel.label = header.dateTime;
        this._dateTimeLabel.visible = header.dateTime !== '';
        const details = [`Duração: ${header.duration}`];
        if (header.language)
            details.push(`Idioma: ${header.language}`);
        this._detailsLabel.label = details.join(' · ');
        this._speakersLabel.label = header.speakers ? `Locutores: ${header.speakers}` : '';
        this._speakersLabel.visible = header.speakers !== '';
    }

    _fillBlocks() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        for (let child; (child = this._blocksBox.get_first_child());)
            this._blocksBox.remove(child);
        this._blockRows = [];

        // Lê this._blocks a cada lote: renomear um locutor troca os blocos no meio do caminho.
        let next = 0;
        const addChunk = () => {
            const end = Math.min(next + CHUNK_SIZE, this._blocks.length);
            for (; next < end; next++) {
                const row = this._createBlock(next);
                this._blockRows.push(row);
                this._blocksBox.append(row.box);
                if (next === this._currentIndex)
                    row.box.add_css_class('current');
                if (this._findMatches.includes(next))
                    row.box.add_css_class('find-match');
                if (this._findMatches[this._findActive] === next)
                    row.box.add_css_class('find-active');
                if (this._pendingScroll === next)
                    this._scrollToBlock(next);
            }
            return next < this._blocks.length;
        };

        // O primeiro lote entra já; o resto em segundo plano.
        if (!addChunk()) {
            this.emit('blocks-built');
            return;
        }
        this._fillSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            if (addChunk())
                return GLib.SOURCE_CONTINUE;
            this._fillSourceId = 0;
            this.emit('blocks-built');
            return GLib.SOURCE_REMOVE;
        });
    }

    _createBlock(index) {
        return this._embedded ? this._createEmbeddedBlock(index) : this._createClassicBlock(index);
    }

    // Layout da mockup: horário | ponto do locutor | nome (renomear) sobre o texto.
    // Grade: linha 0 = horário, ponto, nome (ou o texto, sem locutor), menu; linha 1 = texto.
    _createEmbeddedBlock(index) {
        const block = this._blocks[index];
        const box = new Gtk.Grid({
            column_spacing: 14,
            row_spacing: 6,
            css_classes: ['transcript-block', 'embedded'],
        });

        box.attach(new Gtk.Label({
            label: formatShortClock(block.start),
            xalign: 0,
            width_chars: 7,
            valign: Gtk.Align.BASELINE_FILL,
            css_classes: ['numeric', 'transcript-time'],
        }), 0, 0, 1, 1);

        // Sem locutor (transcrição sem palavras): só o texto, com ponto neutro.
        const hasName = block.speaker !== null && block.label !== '';
        const dot = new Gtk.Box({
            valign: hasName ? Gtk.Align.CENTER : Gtk.Align.START,
            halign: Gtk.Align.CENTER,
            css_classes: ['speaker-dot', speakerClass(block.speaker)],
        });
        if (!hasName)
            dot.margin_top = 9;
        box.attach(dot, 1, 0, 1, 1);

        let speakerButton = null;
        if (hasName) {
            speakerButton = new Gtk.Button({
                child: new Gtk.Label({
                    label: block.label,
                    use_markup: false,
                    ellipsize: Pango.EllipsizeMode.END,
                    xalign: 0,
                }),
                tooltip_text: 'Renomear locutor',
                sensitive: !this._running,
                halign: Gtk.Align.START,
                valign: Gtk.Align.BASELINE_FILL,
                css_classes: ['flat', 'speaker-button', 'speaker-name'],
            });
            const speaker = block.speaker;
            speakerButton.connect('clicked', () => this._renameSpeakerDialog(speaker));
            box.attach(speakerButton, 2, 0, 1, 1);
        }

        const text = new Gtk.Label({
            label: block.text,
            use_markup: false,
            selectable: true,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            xalign: 0,
            hexpand: true,
            valign: Gtk.Align.BASELINE_FILL,
            css_classes: ['transcript-text'],
        });
        box.attach(text, 2, hasName ? 1 : 0, 1, 1);

        // Menu do bloco: aparece ao passar o mouse (CSS :hover) ou com o foco (Tab).
        const menuButton = new Gtk.MenuButton({
            icon_name: 'view-more-symbolic',
            tooltip_text: 'Mais ações do bloco',
            valign: Gtk.Align.START,
            css_classes: ['flat', 'circular', 'block-menu'],
        });
        menuButton.update_property([Gtk.AccessibleProperty.LABEL], ['Mais ações do bloco']);
        // O menu só é montado ao abrir: milhares de blocos não criam milhares de menus.
        menuButton.set_create_popup_func(button => {
            if (button.menu_model)
                return;
            const menu = new Gio.Menu();
            const item = Gio.MenuItem.new('Copiar bloco', null);
            item.set_action_and_target_value('transcript.copy-block', new GLib.Variant('i', index));
            menu.append_item(item);
            button.menu_model = menu;
        });
        box.attach(menuButton, 3, 0, 1, hasName ? 2 : 1);

        this._addBlockSeek(box, text, block.start);
        return { box, speakerButton };
    }

    // Clique no bloco (fora dos botões e sem texto selecionado) pula o áudio.
    // Mesma lógica de _addSeekOnClick, observando o bloco todo na fase de captura.
    _addBlockSeek(box, text, start) {
        const controller = new Gtk.EventControllerLegacy({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        let pressed = false;
        controller.connect('event', (_controller, event) => {
            const type = event.get_event_type();
            if (type === Gdk.EventType.BUTTON_PRESS) {
                pressed = event.get_button() === Gdk.BUTTON_PRIMARY &&
                    !this._eventOnButton(box, event);
            } else if (type === Gdk.EventType.BUTTON_RELEASE && pressed) {
                pressed = false;
                const [hasSelection] = text.get_selection_bounds();
                if (!hasSelection)
                    this.emit('seek-requested', start);
            }
            return Gdk.EVENT_PROPAGATE;
        });
        box.add_controller(controller);
    }

    // O evento caiu num botão do bloco (nome do locutor, menu)?
    _eventOnButton(box, event) {
        const native = box.get_native();
        const [hasPos, sx, sy] = event.get_position();
        if (!native || !hasPos)
            return false;
        const [tx, ty] = native.get_surface_transform();
        const [ok, point] = native.compute_point(box, new Graphene.Point({ x: sx - tx, y: sy - ty }));
        if (!ok)
            return false;
        return insideButton(box.pick(point.x, point.y, Gtk.PickFlags.DEFAULT), box);
    }

    _createClassicBlock(index) {
        const block = this._blocks[index];
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 4,
            css_classes: ['transcript-block'],
        });

        const top = new Gtk.Box({ spacing: 6 });
        let speakerButton = null;
        if (block.speaker === null) {
            top.append(new Gtk.Label({
                label: blockTitle(block),
                xalign: 0,
                hexpand: true,
                css_classes: ['heading', 'dim-label'],
            }));
        } else {
            speakerButton = new Gtk.Button({
                child: new Gtk.Label({
                    label: block.label,
                    ellipsize: Pango.EllipsizeMode.END,
                    css_classes: ['heading'],
                }),
                tooltip_text: 'Renomear locutor',
                sensitive: !this._running,
                valign: Gtk.Align.CENTER,
                css_classes: ['flat', 'speaker-button'],
            });
            const speaker = block.speaker;
            speakerButton.connect('clicked', () => this._renameSpeakerDialog(speaker));
            top.append(speakerButton);
            top.append(new Gtk.Label({
                label: formatClock(block.start),
                xalign: 0,
                hexpand: true,
                css_classes: ['dim-label', 'numeric'],
            }));
        }

        const copyButton = new Gtk.Button({
            icon_name: 'edit-copy-symbolic',
            tooltip_text: 'Copiar bloco',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'circular'],
        });
        copyButton.update_property([Gtk.AccessibleProperty.LABEL], ['Copiar bloco']);
        copyButton.connect('clicked', () => this._copy(copyBlock(this._blocks[index])));
        top.append(copyButton);

        const text = new Gtk.Label({
            label: block.text,
            selectable: true,
            wrap: true,
            wrap_mode: Pango.WrapMode.WORD_CHAR,
            xalign: 0,
        });
        this._addSeekOnClick(text, block.start);

        box.append(top);
        box.append(text);
        return { box, speakerButton };
    }

    // Um clique simples no texto pula o áudio; arrastar para selecionar não.
    // Controlador "legacy" na fase de captura: os gestos de seleção do rótulo
    // reivindicam a sequência e cancelariam um GtkGestureClick comum.
    _addSeekOnClick(label, start) {
        const controller = new Gtk.EventControllerLegacy({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        let pressed = false;
        controller.connect('event', (_controller, event) => {
            const type = event.get_event_type();
            if (type === Gdk.EventType.BUTTON_PRESS) {
                pressed = event.get_button() === Gdk.BUTTON_PRIMARY;
            } else if (type === Gdk.EventType.BUTTON_RELEASE && pressed) {
                pressed = false;
                const [hasSelection] = label.get_selection_bounds();
                if (!hasSelection)
                    this.emit('seek-requested', start);
            }
            return Gdk.EVENT_PROPAGATE;
        });
        label.add_controller(controller);
    }

    _syncHighlight() {
        if (this._embedded || this._playback) {
            this._syncPlaybackHighlight();
            return;
        }
        const active = this._isPlayingThis() && this.get_mapped();
        if (active && !this._highlightSourceId) {
            this._highlightSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIGHLIGHT_INTERVAL_MS, () => {
                if (!this._isPlayingThis() || !this.get_mapped()) {
                    this._highlightSourceId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._updateHighlight();
                return GLib.SOURCE_CONTINUE;
            });
            this._updateHighlight();
        } else if (!active) {
            this._stopHighlightTimer();
        }
        // Parado (fim do áudio ou outra gravação): nenhum bloco fica destacado.
        if (!this._isThisLoaded() || this._playerState === GstPlayer.PlayerState.STOPPED)
            this._setCurrent(-1);
    }

    // Modo embutido: reage a position-updated (sem timer). Só com ESTA gravação carregada
    // e a visão visível; descarregada (ou nada tocado ainda) nenhum bloco fica realçado.
    _syncPlaybackHighlight() {
        const playback = this._playback;
        const loaded = Boolean(playback && this._recordingFile &&
            playback.uri === this._recordingFile.get_uri());
        if (!loaded || (!playback.playing && playback.position <= 0)) {
            this._setCurrent(-1);
            return;
        }
        if (!this.get_mapped())
            return;
        this._setCurrent(currentBlockIndex(this._blocks, playback.position * 1e9));
    }

    _stopHighlightTimer() {
        if (this._highlightSourceId) {
            GLib.source_remove(this._highlightSourceId);
            this._highlightSourceId = 0;
        }
    }

    _isThisLoaded() {
        return Boolean(this._player && this._recordingFile &&
            this._player.get_uri() === this._recordingFile.get_uri());
    }

    _isPlayingThis() {
        return this._playerState === GstPlayer.PlayerState.PLAYING && this._isThisLoaded();
    }

    _updateHighlight() {
        this._setCurrent(currentBlockIndex(this._blocks, this._player.position));
    }

    _setCurrent(index) {
        const previousIndex = this._currentIndex;
        if (index === previousIndex)
            return;
        this._blockRows[previousIndex]?.box.remove_css_class('current');
        this._currentIndex = index;
        this._blockRows[index]?.box.add_css_class('current');
        if (this._embedded && shouldScroll({ follow: this._followAudio, index, previousIndex }))
            this._scrollToBlock(index);
    }

    _renameSpeakerDialog(speaker) {
        const { text, placeholder } = speakerEntry(this._transcript, speaker);
        const entry = new Gtk.Entry({
            text,
            placeholder_text: placeholder,
            activates_default: true,
        });
        const dialog = new Adw.MessageDialog({
            transient_for: this.get_root(),
            modal: true,
            heading: 'Renomear locutor',
            body: 'Deixe em branco para voltar ao nome padrão.',
            extra_child: entry,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('rename', 'Renomear');
        dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'rename';
        dialog.close_response = 'cancel';
        // A transcrição pode ter sido trocada enquanto o diálogo estava aberto.
        const transcript = this._transcript;
        const recordingFile = this._recordingFile;
        dialog.connect('response', (_dialog, response) => {
            if (response === 'rename' && transcript === this._transcript && !this._running)
                this._applySpeakerName(recordingFile, speaker, entry.text);
        });
        dialog.present();
        entry.grab_focus();
    }

    _applySpeakerName(recordingFile, speaker, name) {
        const renamed = renameSpeaker(this._transcript, speaker, name);
        try {
            saveTranscript(recordingFile, renamed);
        } catch (e) {
            this._toast('Não foi possível salvar o nome do locutor');
            return;
        }
        this._transcript = renamed;
        this._blocks = buildBlocks(renamed);
        this._fillHeader();
        // Renomear não muda a divisão em blocos: atualiza os já criados no lugar,
        // sem perder a rolagem; os que faltam já nascem com o nome novo.
        this._blockRows.forEach((row, i) => {
            if (row.speakerButton)
                row.speakerButton.child.label = this._blocks[i].label;
        });
        // O nome entra na busca: recalcula sem pular para outro resultado.
        if (this._findQuery)
            this._applyFind(findMatches(this._blocks, this._findQuery), this._findActive, false);
        this.emit('transcript-changed', renamed);
    }

    _export(ext) {
        if (!this._transcript)
            return;
        const transcript = this._transcript;
        const dialog = new Gtk.FileDialog({
            title: 'Exportar transcrição',
            initial_name: exportFileName(transcript, ext),
            modal: true,
        });
        dialog.save(this.get_root(), null, (_dialog, result) => {
            let file;
            try {
                file = dialog.save_finish(result);
            } catch (e) {
                // Cancelado pelo usuário: nada a avisar.
                if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    this._toast('Não foi possível exportar a transcrição');
                return;
            }
            try {
                const content = exportContent(transcript, exportExtension(file.get_basename(), ext));
                file.replace_contents(new TextEncoder().encode(content), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this._toast('Transcrição exportada');
            } catch (e) {
                this._toast('Não foi possível exportar a transcrição');
            }
        });
    }

    _copy(text) {
        this.get_clipboard().set(text);
        this._toastOverlay.add_toast(new Adw.Toast({ title: 'Copiado', timeout: 2, use_markup: false }));
    }

    _toast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({ title, use_markup: false }));
    }
});
