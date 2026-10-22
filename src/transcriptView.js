/* exported TranscriptView */
const { Adw, Gdk, Gio, GLib, GObject, Graphene, Gtk, Pango } = imports.gi;
const { formatShortClock, shouldScroll } = imports.playerModel;
const { speakerClass } = imports.speakerColors;
const { buildBlocks, renameSpeaker } = imports.transcript;
const { copyBlock, copyText } = imports.transcriptFormat;
const { saveTranscript } = imports.transcriptStore;
const { currentBlockIndex, findMatches, nextIndex, shouldSeekOnClick, speakerEntry } =
    imports.transcriptViewModel;

// Blocos criados por iteração ociosa: milhares de blocos não travam a interface.
const CHUNK_SIZE = 100;
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

// Visão da transcrição dentro do painel de detalhe (DetailPane): blocos no layout da
// mockup (horário, ponto do locutor, nome, texto), realce do bloco que está tocando pelo
// Playback único (bindPlayback), busca interna e cópia. Título, metadados e ações da
// transcrição inteira ficam no cabeçalho do painel.
var TranscriptView = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/transcript-view.ui',
    InternalChildren: [
        'toastOverlay', 'scroller', 'clamp', 'blocksBox',
    ],
    Properties: {
        // Acompanhar áudio: rola até o bloco que está tocando.
        'follow-audio': GObject.ParamSpec.boolean('follow-audio', 'follow-audio',
            'Scroll to the block being played', GObject.ParamFlags.READWRITE, true),
    },
    Signals: {
        'seek-requested': { param_types: [GObject.TYPE_DOUBLE] },
        'transcript-changed': { param_types: [GObject.TYPE_JSOBJECT] },
        // Todos os blocos foram criados (o preenchimento é feito em lotes ociosos).
        'blocks-built': {},
    },
}, class TranscriptView extends Gtk.Box {
    _init(params) {
        this._followAudio = true;
        super._init(params);

        this._transcript = null;
        this._recordingFile = null;
        this._blocks = [];
        this._blockRows = [];
        this._fillSourceId = 0;
        this._currentIndex = -1;
        this._running = false;
        this._playback = null;
        this._playbackIds = [];
        this._findQuery = '';
        this._findMatches = [];
        this._findActive = -1;
        this._pendingScroll = -1;
        this._scrollAnimation = null;

        // Menu de cada bloco: "Copiar bloco".
        const actions = new Gio.SimpleActionGroup();
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
        if (value && this._currentIndex >= 0)
            this._scrollToBlock(this._currentIndex);
    }

    get recordingFile() {
        return this._recordingFile;
    }

    get transcript() {
        return this._transcript;
    }

    // O destaque segue o Playback único (re-ligar troca o anterior).
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
        this._connectPlayback();
    }

    vfunc_unroot() {
        this.release();
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
            // Outra mídia: a posição ainda não vale para ela; o próximo position-updated decide.
            this._playback.connect('notify::uri', () => {
                this._cancelScroll();
                this._setCurrent(-1);
            }),
        ];
    }

    _disconnectPlayback() {
        for (const id of this._playbackIds)
            this._playback.disconnect(id);
        this._playbackIds = [];
    }

    // Saindo da página: nada de trabalho em segundo plano.
    release() {
        if (this._fillSourceId) {
            GLib.source_remove(this._fillSourceId);
            this._fillSourceId = 0;
        }
        this._cancelScroll();
    }

    // Cancela rolagem pendente (bloco ainda não criado) e a animação em curso, parando
    // onde está (pause, não skip: skip pularia para o destino).
    _cancelScroll() {
        this._pendingScroll = -1;
        const animation = this._scrollAnimation;
        this._scrollAnimation = null;
        animation?.pause();
    }

    // Durante uma nova transcrição renomear fica bloqueado: o resultado sobrescreveria o nome.
    set running(running) {
        this._running = running;
        for (const row of this._blockRows) {
            if (row.speakerButton)
                row.speakerButton.sensitive = !running;
        }
    }

    get running() {
        return this._running;
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

        this._fillBlocks();
        this._scrollAnimation?.skip();
        this._scroller.vadjustment.value = 0;
        this._syncHighlight();
    }

    // Esvazia a visão (outra gravação selecionada): sem transcrição, sem arquivo, sem
    // blocos, sem busca nem realce; nada pendente em segundo plano.
    clear() {
        this.release();
        this._transcript = null;
        this._recordingFile = null;
        this._blocks = [];
        this._currentIndex = -1;
        this._findQuery = '';
        this._findMatches = [];
        this._findActive = -1;
        for (let child; (child = this._blocksBox.get_first_child());)
            this._blocksBox.remove(child);
        this._blockRows = [];
        this._scroller.vadjustment.value = 0;
    }

    // A gravação foi renomeada (o arquivo mudou): salvar nomes de locutor e o realce pelo
    // URI passam a usar o arquivo novo. Não refaz os blocos.
    setRecordingFile(file) {
        this._recordingFile = file ?? null;
        this._syncHighlight();
    }

    // Copiar tudo (o botão fica no cabeçalho do DetailPane).
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

    // Layout da mockup: horário | ponto do locutor | nome (renomear) sobre o texto.
    // Grade: linha 0 = horário, ponto, nome (ou o texto, sem locutor), menu; linha 1 = texto.
    _createBlock(index) {
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
    // Controlador "legacy" na fase de captura, observando o bloco todo: os gestos de
    // seleção do rótulo reivindicam a sequência e cancelariam um GtkGestureClick comum.
    _addBlockSeek(box, text, start) {
        const controller = new Gtk.EventControllerLegacy({
            propagation_phase: Gtk.PropagationPhase.CAPTURE,
        });
        let pressed = false;
        // Eventos do popover do menu do bloco também sobem até aqui (o popover é filho
        // do MenuButton), mas vêm de outra superfície: nunca pulam o áudio.
        const where = event => {
            const sameSurface = event.get_surface() === box.get_native()?.get_surface();
            return { sameSurface, insideButton: sameSurface && this._eventOnButton(box, event) };
        };
        controller.connect('event', (_controller, event) => {
            const type = event.get_event_type();
            if (type === Gdk.EventType.BUTTON_PRESS) {
                const { sameSurface, insideButton: onButton } = where(event);
                pressed = event.get_button() === Gdk.BUTTON_PRIMARY && sameSurface && !onButton;
            } else if (type === Gdk.EventType.BUTTON_RELEASE && pressed) {
                pressed = false;
                const [hasSelection] = text.get_selection_bounds();
                if (shouldSeekOnClick({ pressed: true, ...where(event), hasSelection }))
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

    _syncHighlight() {
        this._syncPlaybackHighlight();
    }

    // Reage a position-updated (sem timer). Só com ESTA gravação carregada
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

    _setCurrent(index) {
        const previousIndex = this._currentIndex;
        if (index === previousIndex)
            return;
        // Nada tocando: uma rolagem até o bloco anterior não faz mais sentido.
        if (index < 0)
            this._cancelScroll();
        this._blockRows[previousIndex]?.box.remove_css_class('current');
        this._currentIndex = index;
        this._blockRows[index]?.box.add_css_class('current');
        if (shouldScroll({ follow: this._followAudio, index, previousIndex }))
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

    _copy(text) {
        this.get_clipboard().set(text);
        this._toastOverlay.add_toast(new Adw.Toast({ title: 'Copiado', timeout: 2, use_markup: false }));
    }

    _toast(title) {
        this._toastOverlay.add_toast(new Adw.Toast({ title, use_markup: false }));
    }
});
