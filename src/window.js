/* exported Window WindowState */
/*
* Copyright 2013 Meg Ford
* This library is free software; you can redistribute it and/or
* modify it under the terms of the GNU Library General Public
* License as published by the Free Software Foundation; either
* version 2 of the License, or (at your option) any later version.
*
* This library is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
* Library General Public License for more details.
*
* You should have received a copy of the GNU Library General Public
* License along with this library; if not, see <http://www.gnu.org/licenses/>.
*
* Author: Meg Ford <megford@gnome.org>
*
*/

// Janela mestre-detalhe: cabeçalho (ícone, título, Nova gravação, Preferências, menu),
// sidebar com as gravações e, à direita, o painel de detalhe com o player único embaixo.
// A seleção da sidebar é a fonte da verdade: a janela leva a gravação selecionada ao
// painel, à barra do player e ao Playback. A tela de gravação cobre a janela inteira.
const { Adw, Gdk, Gio, GLib, GObject, Gtk } = imports.gi;

const { Recorder } = imports.recorder;
const { RecordingList } = imports.recordingList;
const { RecorderWidget } = imports.recorderWidget;
const { NOTHING_RECORDED_MESSAGE } = imports.recorderPipeline;
const { Settings } = imports.application;
const { Playback } = imports.playback;
const { PlayerBar } = imports.playerBar;
const { Sidebar } = imports.sidebar;
const { DetailPane } = imports.detailPane;
const { msUntilNextDay } = imports.recordingGroups;
const { defaultKeyStore } = imports.secrets;
const { transcribeFile } = imports.transcriber;
const { exportFileName } = imports.transcriptFormat;
const { loadTranscript, saveTranscriptKeepingSummary, transcriptFileFor } = imports.transcriptStore;
const { getSummary, getSummaryHistory } = imports.transcript;
const { saveSummary, restoreSummaryAt } = imports.transcriptStore;
const { summarizeTranscript } = imports.summarizer;
const { SummaryService } = imports.summaryService;
const { SummaryController } = imports.summaryController;
const { summaryConfirmMessage } = imports.summaryUi;
const { normalizeSummaryModel } = imports.preferencesLogic;
const { exportContent, exportExtension } = imports.transcriptViewModel;
const { TranscriptionService } = imports.transcriptionService;
const { TranscriptionController } = imports.transcriptionController;
const { confirmMessage, guardedSave, hasNamedSpeakers, recordingNameProblem, rowActions, rowStatus } =
    imports.transcriptionUi;
const { DeleteQueue } = imports.deleteQueue;
const { stripIconFromLayout } = imports.headerLayout;
const { cancelAllPeaks } = imports.peaksPipeline;
const { deletedToastTitle, shortcutFor, shouldHandleShortcut } = imports.shortcuts;

var WindowState = {
    BROWSE: 0,
    RECORDER: 1,
};

// Diálogo de arquivo fechado pelo usuário: nada a avisar.
const dismissed = e => e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED) ?? false;

// Pulo dos atalhos B/N, em segundos.
const SEEK_STEP = 10;
// Tempo do toast "… excluída" com Desfazer, em segundos.
const UNDO_TIMEOUT = 8;
const RENAME_BUSY_MESSAGE = 'Aguarde a transcrição terminar para renomear.';
const DELETE_BUSY_MESSAGE = 'Aguarde a transcrição terminar para excluir.';
const DELETE_UNSAVED_MESSAGE = 'Há uma transcrição paga que ainda não foi salva. ' +
    'Toque em Tentar de novo antes de excluir.';
const TRASH_FAILED_MESSAGE = 'Não foi possível mover a gravação para a lixeira.';

// Do widget com o foco até a janela: algum ancestral satisfaz `pred`?
const focusWithin = (widget, pred) => {
    for (let w = widget; w; w = w.get_parent()) {
        if (pred(w))
            return true;
    }
    return false;
};
const isEditable = w => w instanceof Gtk.TextView || GObject.type_is_a(w.constructor.$gtype, Gtk.Editable.$gtype);
const isButton = w => w instanceof Gtk.Button || w instanceof Gtk.CheckButton || w instanceof Gtk.Switch;

var Window = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/window.ui',
    InternalChildren: [
        'toastOverlay', 'mainStack', 'headerBar', 'backButton', 'appIcon', 'splitView', 'sidebarPage',
        'contentView', 'mediumBreakpoint', 'narrowBreakpoint',
    ],
}, class Window extends Adw.ApplicationWindow {
    // playbackOptions: opções do Playback (o Application passa a saída silenciosa
    // durante uma captura do tools/snapshot.sh; o código de produção não carrega o devSnapshot).
    _init({ playbackOptions = {}, ...params } = {}) {
        super._init({ icon_name: pkg.name, ...params });
        this._appIcon.icon_name = pkg.name;
        this._closed = false;
        this._selected = null;          // gravação mostrada no painel e carregada no player
        this._selectedUri = null;       // URI dela quando foi carregada (renomear muda a URI)
        this._selectedIds = [];
        this._pendingSeek = null;       // { id } do seek que espera a mídia recarregada
        this._midnightId = 0;
        this._signalIds = [];           // [objeto, id] soltos no shutdown
        this._deleteQueue = new DeleteQueue();
        // Para as formas de onda em andamento no encerramento (trocável pela verificação).
        this._cancelPeaks = cancelAllPeaks;
        this._deleteToasts = new Map(); // id da exclusão → { toast, handlerId } até o toast sumir
        this._renameDialog = null;      // { recording, validate } do diálogo aberto

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, 'recorder');
        this.insert_action_group('recorder', this.recorderWidget.actionsGroup);

        this._recordingList = new RecordingList();
        this.transcriptionService = new TranscriptionService({
            getKey: () => defaultKeyStore().get(),
            transcribe: transcribeFile,
            // Uma gravação esperando o "Desfazer" já saiu da biblioteca: nada é salvo ao lado dela.
            save: guardedSave(saveTranscriptKeepingSummary, {
                isRemoved: file => this._deleteQueue.pending().some(r => r.file.equal(file)),
            }),
            language: () => Settings.get_string('language'),
            now: () => new Date(),
        });
        this._transcription = new TranscriptionController({
            parent: this,
            service: this.transcriptionService,
            showToast: toast => this._toastOverlay.add_toast(toast),
            openPreferences: () => this.application.activate_action('preferences', null),
            hasRecording: recording => this._indexOf(recording) >= 0,
            canRequest: recording => this.summaryService.status(recording.file) !== 'running',
            onDone: file => this._onTranscriptionDone(file),
            onFailed: (recording, message) => this._onTranscriptionFailed(recording, message),
        });
        this.summaryService = new SummaryService({
            getKey: () => defaultKeyStore().get(),
            getModel: () => this._summaryModel(),
            summarize: summarizeTranscript,
            save: (file, summary) => {
                if (!file.query_exists(null) || this._deleteQueue.pending().some(r => r.file.equal(file)))
                    throw new imports.transcriber.TranscribeError('recordingGone', 0,
                        'A gravação foi excluída antes de o resumo terminar.');
                return saveSummary(file, summary);
            },
            now: () => new Date(),
        });
        this._summary = new SummaryController({
            parent: this, service: this.summaryService, getModel: () => this._summaryModel(),
            showToast: toast => this._toastOverlay.add_toast(toast),
            openPreferences: () => this.application.activate_action('preferences', null),
            showDiscard: recording => this._confirmDiscard(recording, this._summary),
            hasRecording: recording => this._indexOf(recording) >= 0,
            canRequest: recording => !this._isTranscribing(recording),
            getTranscript: recording => loadTranscript(recording.file),
            onDone: file => this._onSummaryDone(file),
            onFailed: (recording, message) => {
                if (recording === this._selected)
                    this._detailPane.setSummaryError(message);
            },
        });

        // Player único: criado uma vez; velocidade e volume salvos são aplicados pelo bind.
        this.playback = new Playback(playbackOptions);
        this._sidebar = new Sidebar({
            recordingList: this._recordingList,
            transcriptionService: this.transcriptionService,
            summaryService: this.summaryService,
        });
        this._sidebarPage.child = this._sidebar;
        this._detailPane = new DetailPane();
        this._playerBar = new PlayerBar({ settings: Settings });
        this._contentView.content = this._detailPane;
        this._contentView.add_bottom_bar(this._playerBar);
        for (const breakpoint of [this._mediumBreakpoint, this._narrowBreakpoint]) {
            breakpoint.add_setter(this._playerBar, 'compact', true);
            breakpoint.add_setter(this._detailPane, 'compact', true);
        }
        // Só na média: recolhida, a sidebar ocupa a janela e mostra os selos inteiros.
        this._mediumBreakpoint.add_setter(this._sidebar, 'compact', true);
        this._playerBar.bind(this.playback);
        this._detailPane.bindPlayback(this.playback);
        this._playerBar.bind_property('follow-audio', this._detailPane.view, 'follow-audio',
            GObject.BindingFlags.SYNC_CREATE);

        this._connectSidebar();
        this._connectPane();
        this._connectRecorder();
        this._connectNavigation();
        this._setupActions();
        // Depois da sidebar: quando este ouvinte roda, ela já reconciliou a seleção.
        this._track(this._recordingList, 'items-changed', () => this._onLibraryChanged());
        this._track(this._recordingList, 'notify::loaded', () => this._syncLibrary());
        // Um único ouvinte do serviço na janela (a sidebar cuida dos próprios selos).
        this.transcriptionService.connectChange((uri, status) => this._onTranscriptionChanged(uri, status));
        this.summaryService.connectChange((uri, status) => this._onSummaryChanged(uri, status));
        this._setupDates();
        this._setupHeaderLayout();

        const builder = Gtk.Builder.new_from_resource('/dev/nicolas/DailyTaker/gtk/help-overlay.ui');
        this.set_help_overlay(builder.get_object('help_overlay'));

        this._onRecordingSelected(null);
        this._syncLibrary();
        this.state = WindowState.BROWSE;
    }

    // Seleciona `recording` (ou nenhuma) pela sidebar; false se ela não está na lista.
    selectRecording(recording) {
        return this._sidebar.select(recording ?? null);
    }

    addToast(title, { buttonLabel = null, onClick = null } = {}) {
        const toast = new Adw.Toast({ title, use_markup: false });
        if (buttonLabel) {
            toast.button_label = buttonLabel;
            toast.connect('button-clicked', onClick);
        }
        this._toastOverlay.add_toast(toast);
        return toast;
    }

    _showRefusal(recording, title) {
        const controller = this.transcriptionService.hasUnsaved(recording.file) ? this._transcription
            : this.summaryService.hasUnsaved(recording.file) ? this._summary : null;
        return this.addToast(title, controller ? {
            buttonLabel: 'Descartar…',
            onClick: () => this._confirmDiscard(recording, controller),
        } : {});
    }

    _confirmDiscard(recording, controller) {
        if (this._closed || this._discardDialog)
            return;
        const file = recording.file;
        const dialog = new Adw.MessageDialog({
            transient_for: this, modal: true, heading: 'Descartar resultado pago?',
            body: 'Descartar o resultado pago que não foi salvo? Isso não pode ser desfeito.',
            heading_use_markup: false, body_use_markup: false,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('discard', 'Descartar');
        dialog.default_response = 'cancel';
        dialog.close_response = 'cancel';
        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        this._discardDialog = dialog;
        dialog.connect('response', (_dialog, response) => {
            this._discardDialog = null;
            dialog.destroy();
            if (response === 'discard' && !this._closed && recording.file.equal(file) &&
                controller._service.status(file) !== 'running')
                controller.discardUnsaved(recording);
        });
        dialog.present();
    }

    get state() {
        return this._state;
    }

    set state(state) {
        this._state = state;
        this._mainStack.visible_child_name = state === WindowState.RECORDER ? 'recorder' : 'browse';
        this._syncActions();
    }

    // X e Ctrl+Q passam pela mesma confirmação; cancelar não confirma exclusões.
    vfunc_close_request() {
        if (this._closed)
            return true;
        if (this._closeDialog) {
            this._closeDialog.present();
            return true;
        }
        if (this.transcriptionService.hasRunning() || this.summaryService.hasRunning()) {
            const dialog = new Adw.MessageDialog({
                transient_for: this, modal: true,
                heading: 'Fechar durante uma operação paga?',
                body: 'Há uma transcrição (ou resumo) em andamento. Se fechar agora, o resultado já cobrado será perdido. Fechar mesmo assim?',
                heading_use_markup: false, body_use_markup: false,
            });
            dialog.add_response('cancel', 'Cancelar');
            dialog.add_response('close', 'Fechar mesmo assim');
            dialog.default_response = 'cancel';
            dialog.close_response = 'cancel';
            dialog.set_response_appearance('close', Adw.ResponseAppearance.DESTRUCTIVE);
            this._closeDialog = dialog;
            dialog.connect('response', (_dialog, response) => {
                this._closeDialog = null;
                if (response === 'close')
                    this.shutdown();
            });
            dialog.present();
            return true;
        }
        this.shutdown();
        return true;
    }

    // Encerra o app. Ordem: (1) PRIMEIRO, e de forma síncrona, as exclusões pendentes vão
    // para a lixeira (o usuário já viu os avisos; nada antes delas pode atrasá-las ou
    // impedi-las); (2) solta leituras de duração, formas de onda, transcrição, temporizador,
    // ouvintes, monitor da pasta, player e gravador, cada passo isolado (uma falha vai para o
    // log, sem conteúdo, e não pula os outros); (3) num ocioso desmonta os widgets com o JS
    // ainda vivo, destrói a janela e sai. Chamado ao fechar a janela (e pelo devSnapshot, que
    // pode nunca mostrá-la). Uma segunda chamada não faz nada.
    shutdown() {
        if (this._closed)
            return;
        this._closed = true;
        this._teardown('exclusões pendentes', () => this._commitPendingDeletes());
        // Leituras de duração em andamento param antes de o app sair (senão o GStreamer
        // desmonta o Discoverer no meio, com avisos).
        this._teardown('leituras de duração', () => {
            for (let i = 0; i < this._recordingList.get_n_items(); i++)
                this._recordingList.get_item(i).cancelDiscovery();
        });
        // Formas de onda ainda sendo geradas (de qualquer gravação, inclusive as que já saíram
        // da lista): os pipelines vão para NULL agora, não na finalização da saída.
        this._teardown('formas de onda', () => this._cancelPeaks());
        // Uma transcrição em andamento não segura o fechamento: é simplesmente abandonada.
        this._teardown('transcrição', () => this._transcription.close());
        this._teardown('resumo', () => this._summary.close());
        this._teardown('temporizador', () => {
            if (this._midnightId) {
                GLib.source_remove(this._midnightId);
                this._midnightId = 0;
            }
        });
        this._teardown('ouvintes', () => {
            const ids = this._signalIds;
            this._signalIds = [];
            for (const [object, id] of ids)
                object.disconnect(id);
        });
        this._teardown('avisos de exclusão', () => {
            for (const { toast, handlerId } of this._deleteToasts.values())
                toast.disconnect(handlerId);
            this._deleteToasts.clear();
        });
        this._teardown('player', () => {
            this._cancelPendingSeek();
            this.playback.destroy();
        });
        this._teardown('pasta', () => {
            this._recordingList.cancellable.cancel();
            this._recordingList.dirMonitor.cancel();
        });
        this._teardown('gravador', () => this.recorder.stop());
        // Sem isso a árvore (com vfuncs e funções JS, como o cabeçalho da lista) só seria
        // desfeita na coleta de lixo do encerramento, onde o GJS bloqueia essas chamadas.
        const app = this.application;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._teardown('widgets', () => {
                this._sidebarPage.child = null;
                this._sidebar.run_dispose();
                this.destroy();
                this.run_dispose();
            });
            app?.quit();
            return GLib.SOURCE_REMOVE;
        });
    }

    // Um passo do encerramento: uma falha vai para o log (só o passo e o tipo do erro, nunca
    // nomes ou conteúdo) e não impede os seguintes.
    _teardown(step, fn) {
        try {
            fn();
        } catch (e) {
            log(`Falha ao encerrar (${step}): ${e?.constructor?.name ?? 'erro'}`);
        }
    }

    // Todas as exclusões pendentes vão para a lixeira agora (fechar a janela), na ordem em
    // que foram feitas. Uma que não puder ir fica intacta no disco (volta na próxima
    // abertura); só o nome vai para o log.
    _commitPendingDeletes() {
        for (const recording of this._deleteQueue.commitAll()) {
            let ok = false;
            try {
                ok = recording.delete({ sync: true });
            } catch (e) {
                ok = false;
            }
            if (!ok)
                log(`Exclusão não concluída ao fechar (arquivos mantidos): ${recording.name}`);
            // Já fora da lista: a leitura da duração dela (se houver) também para.
            this._teardown('leitura de duração', () => recording.cancelDiscovery());
        }
    }

    // connect() que o shutdown desfaz.
    _track(object, signal, handler) {
        this._signalIds.push([object, object.connect(signal, handler)]);
    }

    // --- Ligações ---

    _connectSidebar() {
        const sidebar = this._sidebar;
        sidebar.connect('recording-selected', (_s, recording) => this._onRecordingSelected(recording));
        sidebar.connect('transcribe-requested', (_s, recording, regenerate) => {
            if (this.summaryService.status(recording.file) === 'running')
                return;
            this._transcription.request(recording, {
                regenerate,
                namedSpeakers: regenerate && hasNamedSpeakers(loadTranscript(recording.file)),
            });
        });
        sidebar.connect('rename-requested', (_s, recording) => this._showRenameDialog(recording));
        sidebar.connect('rename-refused', (_s, recording) =>
            this._showRefusal(recording, this._renameRefusal(recording) ?? RENAME_BUSY_MESSAGE));
        sidebar.connect('delete-requested', (_s, recording) => this._deleteRecording(recording));
        sidebar.connect('delete-refused', (_s, recording) =>
            this._showRefusal(recording, this._deleteRefusal(recording) ?? DELETE_BUSY_MESSAGE));
        sidebar.connect('export-audio-requested', (_s, recording) => this._exportAudio(recording));
    }

    _connectPane() {
        const pane = this._detailPane;
        pane.connect('generate-requested', (_p, regenerate) => {
            if (this._selected && this.summaryService.status(this._selected.file) === 'running')
                return;
            if (this._selected)
                this._transcription.request(this._selected, this._generateOptions(regenerate));
        });
        pane.connect('retry-requested', () => {
            if (this._selected)
                this._transcription.retry(this._selected, this._generateOptions(pane.view.transcript !== null));
        });
        pane.connect('export-requested', (_p, ext) => this._exportTranscript(ext));
        pane.connect('summary-requested', (_p, regenerate) => {
            if (this._selected)
                this._summary.request(this._selected, { regenerate });
        });
        pane.connect('summary-retry-requested', () => {
            if (this._selected)
                this._summary.retry(this._selected);
        });
        pane.connect('summary-restore-requested', (_p, generatedAt) => this._restoreSummary(generatedAt));
        pane.connect('new-recording-requested', () => this.recorderWidget.actionsGroup.activate_action('start', null));
        pane.view.connect('seek-requested', (_v, seconds) => this._seekAndPlay(seconds));
    }

    _connectRecorder() {
        const widget = this.recorderWidget;
        widget.connect('started', () => this.onRecorderStarted());
        widget.connect('canceled', () => this.onRecorderCanceled());
        widget.connect('stopped', (_w, recording) => this.onRecorderStopped(recording));
        widget.connect('failed', (_w, message) => this.onRecorderFailed(message));
    }

    // Janela estreita (< 720 sp): escolher uma gravação abre o painel; Voltar retorna à
    // lista sem mexer na seleção.
    _connectNavigation() {
        const split = this._splitView;
        this._sidebar.connect('recording-activated', () => {
            if (split.collapsed)
                split.show_content = true;
        });
        this._backButton.connect('clicked', () => {
            split.show_content = false;
        });
        const syncBack = () => {
            this._backButton.visible = split.collapsed && split.show_content;
        };
        split.connect('notify::collapsed', syncBack);
        split.connect('notify::show-content', syncBack);
        syncBack();
    }

    // O layout dos botões da barra de título é o do sistema (ordem e lados do usuário), sem o
    // token `icon`: o GTK desenharia um ícone pequeno do app antes do nosso, maior, ao lado
    // do título. Acompanha mudanças do layout do sistema. Layout vazio: o padrão vale.
    _setupHeaderLayout() {
        const settings = Gtk.Settings.get_default();
        const sync = () => {
            this._headerBar.decoration_layout = stripIconFromLayout(settings.gtk_decoration_layout) || null;
        };
        this._track(settings, 'notify::gtk-decoration-layout', sync);
        sync();
    }

    // "Hoje"/"Ontem" mudam à meia-noite e enquanto a janela fica em segundo plano.
    _setupDates() {
        this._track(this, 'notify::is-active', () => {
            if (this.is_active)
                this._sidebar.refreshDates();
        });
        const schedule = () => {
            this._midnightId = GLib.timeout_add(GLib.PRIORITY_LOW, msUntilNextDay(new Date()) + 1000, () => {
                this._midnightId = 0;
                this._sidebar.refreshDates();
                schedule();
                return GLib.SOURCE_REMOVE;
            });
        };
        schedule();
    }

    // --- Seleção e player ---

    _onRecordingSelected(recording) {
        if (this._closed)
            return;
        const next = recording ?? null;
        this._trackSelected(next);
        const pane = this._detailPane;
        // Ordem do painel: setRecording → setTranscript → setState.
        pane.setRecording(next);
        const transcript = next ? loadTranscript(next.file) : null;
        pane.setTranscript(transcript);
        pane.setSummary(getSummary(transcript));
        pane.setSummaryHistory(getSummaryHistory(transcript));
        pane.setSummaryState(next ? this.summaryService.status(next.file) : 'none');
        pane.setSummaryError(next ? this._summary.failureMessage(next) : '');
        pane.setErrorMessage(next ? this._transcription.failureMessage(next) : '');
        pane.setState(next ? this._statusOf(next) : 'none');
        this._syncCost();
        this._playerBar.setRecording(next);
        // Troca de mídia para o áudio anterior; nada começa a tocar sozinho.
        this._cancelPendingSeek();
        this.playback.load(next?.uri ?? null);
        if (!next && this._splitView.collapsed)
            this._splitView.show_content = false;
        this._syncActions();
    }

    _trackSelected(recording) {
        for (const id of this._selectedIds)
            this._selected.disconnect(id);
        this._selected = recording;
        this._selectedUri = recording?.uri ?? null;
        this._selectedIds = recording ? [
            recording.connect('notify::name', () => this._onSelectedRenamed(recording)),
            recording.connect('notify::duration', () => this._syncCost()),
        ] : [];
    }

    // Renomear troca o arquivo (e a URI): o Playback, que guarda a URI antiga, é
    // recarregado no arquivo novo, pausado na mesma posição. O painel e a sidebar se
    // atualizam sozinhos (notify::name).
    _onSelectedRenamed(recording) {
        const oldUri = this._selectedUri;
        this._selectedUri = recording.uri;
        if (oldUri === recording.uri || this.playback.uri !== oldUri)
            return;
        const position = this.playback.position;
        this._cancelPendingSeek();
        this.playback.load(recording.uri);
        if (position > 0)
            this._seekWhenLoaded(recording.uri, position);
    }

    // Posiciona (pausado) assim que a mídia `uri` tiver duração conhecida.
    _seekWhenLoaded(uri, position) {
        const pending = {};
        pending.id = this.playback.connect('duration-changed', (_p, seconds) => {
            if (seconds <= 0 || this.playback.uri !== uri)
                return;
            this._cancelPendingSeek();
            this.playback.seek(position);
        });
        this._pendingSeek = pending;
    }

    _cancelPendingSeek() {
        if (this._pendingSeek) {
            this.playback.disconnect(this._pendingSeek.id);
            this._pendingSeek = null;
        }
    }

    // Clique num bloco da transcrição: pula para o trecho e toca.
    _seekAndPlay(seconds) {
        const recording = this._selected;
        if (!recording)
            return;
        if (this.playback.uri !== recording.uri)
            this.playback.load(recording.uri);
        this.playback.seek(seconds);
        this.playback.play();
    }

    _statusOf(recording) {
        return rowStatus({
            hasTranscript: transcriptFileFor(recording.file).query_exists(null),
            serviceStatus: this.transcriptionService.status(recording.file),
        });
    }

    _generateOptions(regenerate) {
        return {
            regenerate: Boolean(regenerate),
            namedSpeakers: Boolean(regenerate) && hasNamedSpeakers(this._detailPane.view.transcript),
        };
    }

    // Custo estimado no cartão "ainda não foi transcrita" (o mesmo texto do diálogo).
    _syncCost() {
        const recording = this._selected;
        this._detailPane.setCostText(recording ? confirmMessage(recording.duration / 1e9).body : '');
        this._detailPane.setSummaryCost(recording
            ? summaryConfirmMessage(this._detailPane.view.transcript, this._summaryModel()).body : '');
    }

    // --- Biblioteca ---

    _indexOf(recording) {
        for (let i = 0; i < this._recordingList.get_n_items(); i++) {
            if (this._recordingList.get_item(i) === recording)
                return i;
        }
        return -1;
    }

    _syncLibrary() {
        // Enquanto a pasta é lida a biblioteca não é dada como vazia.
        const n = this._recordingList.get_n_items();
        this._detailPane.setHasRecordings(n > 0 || !this._recordingList.loaded);
    }

    _onLibraryChanged() {
        this._syncLibrary();
        // A sidebar já trocou a seleção para a vizinha (ou nenhuma) se a selecionada saiu da
        // lista. Se mesmo assim a gravação carregada sumiu, o áudio não pode continuar.
        if (this._selected && this._indexOf(this._selected) < 0) {
            const next = this._sidebar.selected;
            this._onRecordingSelected(next && this._indexOf(next) >= 0 ? next : null);
        }
    }

    // --- Gravador ---

    onRecorderStarted() {
        this.playback.stop();
        this.state = WindowState.RECORDER;
    }

    onRecorderCanceled() {
        // A seleção anterior continua.
        this.state = WindowState.BROWSE;
    }

    // A gravação nova entra na lista primeiro e então vira a selecionada (o player troca
    // para ela, parado). Na janela estreita o painel dela abre (com Voltar para a lista).
    onRecorderStopped(recording) {
        if (!recording) {
            this.addToast(NOTHING_RECORDED_MESSAGE);
            this.state = WindowState.BROWSE;
            return;
        }
        if (this._recordingList.getIndex(recording.file) < 0)
            this._recordingList.sortedInsert(recording);
        this.playback.stop();
        if (this.selectRecording(recording) && this._splitView.collapsed)
            this._splitView.show_content = true;
        this.state = WindowState.BROWSE;
    }

    // Depois de 'stopped'/'canceled': só o aviso, e a janela volta à lista.
    onRecorderFailed(message) {
        this.addToast(message);
        this.state = WindowState.BROWSE;
    }

    // --- Transcrição ---

    _onTranscriptionChanged(uri, status) {
        if (this._closed)
            return;
        // Começou uma transcrição da gravação do diálogo de renomear aberto: ele bloqueia.
        if (this._renameDialog?.recording.uri === uri)
            this._renameDialog.validate();
        const recording = this._selected;
        if (!recording || recording.uri !== uri)
            return;
        this._syncActions();
        if (status === 'running') {
            this._detailPane.setState('running');
        } else if (status === 'error') {
            // O serviço avisa 'error' antes de o controlador registrar a falha: a mensagem
            // chega logo depois por _onTranscriptionFailed (onFailed).
            this._detailPane.setState('error');
        }
        // 'none' depois de salvar: _onTranscriptionDone relê a transcrição do disco.
    }

    _onTranscriptionDone(file) {
        const recording = this._selected;
        if (!recording || !recording.file.equal(file))
            return;
        const transcript = loadTranscript(recording.file);
        this._detailPane.setTranscript(transcript);
        this._detailPane.setSummary(getSummary(transcript));
        this._detailPane.setSummaryHistory(getSummaryHistory(transcript));
        this._syncCost();
        this._detailPane.setState(this._statusOf(recording));
    }

    _onTranscriptionFailed(recording, message) {
        if (recording === this._selected)
            this._detailPane.setErrorMessage(message);
    }

    _summaryModel() {
        return normalizeSummaryModel(Settings.get_string('summary-model'));
    }

    _onSummaryChanged(uri, status) {
        if (this._closed)
            return;
        this._sidebar.refreshStatus(uri);
        if (this._renameDialog?.recording.uri === uri)
            this._renameDialog.validate();
        this._syncActions();
        if (this._selected?.uri === uri)
            this._detailPane.setSummaryState(status);
        if (status === 'none') {
            const recording = this._selected;
            this._sidebar.invalidateTranscript(uri);
            if (recording?.uri === uri)
                this._onSummaryDone(recording.file);
        }
    }

    _onSummaryDone(file) {
        if (this._closed)
            return;
        this._sidebar.invalidateTranscript(file.get_uri());
        if (!this._selected?.file.equal(file))
            return;
        const transcript = loadTranscript(file);
        this._detailPane.setSummary(getSummary(transcript));
        this._detailPane.setSummaryHistory(getSummaryHistory(transcript));
        this._detailPane.setSummaryState(this.summaryService.status(file));
        this._syncCost();
    }

    _restoreSummary(generatedAt) {
        const recording = this._selected;
        if (!recording || this._isTranscribing(recording) ||
            this.summaryService.status(recording.file) === 'running')
            return;
        try {
            guardedSave((file, i) => restoreSummaryAt(file, i), {
                isRemoved: file => this._deleteQueue.pending().some(r => r.file.equal(file)),
            })(recording.file, generatedAt);
            this._onSummaryDone(recording.file);
        } catch (e) {
            this.addToast('Não foi possível restaurar a versão do resumo.');
        }
    }

    // --- Exportar, renomear, excluir ---

    _exportTranscript(ext) {
        const recording = this._selected;
        const transcript = recording ? loadTranscript(recording.file) : null;
        if (!transcript) {
            this.addToast('Não foi possível exportar a transcrição.');
            return;
        }
        const dialog = new Gtk.FileDialog({
            title: 'Exportar transcrição',
            initial_name: exportFileName(transcript, ext),
            modal: true,
        });
        dialog.save(this, null, (_dialog, result) => {
            let file;
            try {
                file = dialog.save_finish(result);
            } catch (e) {
                if (!dismissed(e))
                    this.addToast('Não foi possível exportar a transcrição.');
                return;
            }
            try {
                const content = exportContent(recording.file, exportExtension(file.get_basename(), ext));
                file.replace_contents(new TextEncoder().encode(content), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this.addToast('Transcrição exportada');
            } catch (e) {
                this.addToast('Não foi possível exportar a transcrição.');
            }
        });
    }

    _exportAudio(recording) {
        const target = recording ?? this._selected;
        if (!target)
            return;
        const dialog = new Gtk.FileDialog({
            title: 'Exportar áudio',
            initial_name: target.extension ? `${target.name}.${target.extension}` : target.name,
            modal: true,
        });
        dialog.save(this, null, (_dialog, result) => {
            let dest;
            try {
                dest = dialog.save_finish(result);
            } catch (e) {
                if (!dismissed(e))
                    this.addToast('Não foi possível exportar o áudio');
                return;
            }
            target.save(dest, ok => this.addToast(ok ? 'Áudio exportado' : 'Não foi possível exportar o áudio'));
        });
    }

    // Diálogo de renomear: nome atual pré-preenchido, Enter confirma, validação na hora
    // (nome inválido ou vazio desliga Renomear; transcrição em andamento também, mesmo que
    // comece com o diálogo aberto). Texto do usuário nunca como markup.
    _showRenameDialog(recording) {
        if (this._closed || !recording || this._indexOf(recording) < 0)
            return;
        const refusal = this._renameRefusal(recording);
        if (refusal) {
            this._showRefusal(recording, refusal);
            return;
        }
        const entry = new Gtk.Entry({ text: recording.name, activates_default: true, hexpand: true });
        const dialog = new Adw.MessageDialog({
            transient_for: this,
            modal: true,
            heading: 'Renomear gravação',
            heading_use_markup: false,
            body_use_markup: false,
        });
        // Pelo método: a propriedade extra-child é marcada obsoleta (aviso do GJS).
        dialog.set_extra_child(entry);
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('rename', 'Renomear');
        dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'rename';
        dialog.close_response = 'cancel';
        const validate = () => {
            const problem = this._renameRefusal(recording) ?? recordingNameProblem(entry.text);
            dialog.body = problem ?? '';
            dialog.set_response_enabled('rename', !problem && entry.text.trim() !== '');
            if (problem)
                entry.add_css_class('error');
            else
                entry.remove_css_class('error');
        };
        entry.connect('changed', validate);
        validate();
        const state = { recording, validate, dialog };
        this._renameDialog = state;
        dialog.connect('response', (_dialog, response) => {
            if (this._renameDialog === state)
                this._renameDialog = null;
            if (response === 'rename' && !this._closed)
                this._renameRecording(recording, entry.text);
        });
        dialog.present();
        entry.grab_focus();
    }

    _isTranscribing(recording) {
        return this.transcriptionService.status(recording.file) === 'running';
    }

    _renameRefusal(recording) {
        if (this._isTranscribing(recording))
            return RENAME_BUSY_MESSAGE;
        if (this.transcriptionService.hasUnsaved(recording.file))
            return 'Há uma transcrição paga ainda não salva. Toque em Tentar de novo antes de renomear.';
        if (this.summaryService.status(recording.file) === 'running')
            return 'Aguarde o resumo terminar para renomear.';
        if (this.summaryService.hasUnsaved(recording.file))
            return 'Há um resumo pago que ainda não foi salvo. Toque em Tentar de novo antes de renomear.';
        return null;
    }

    // Devolve true se renomeou. Vazio ou igual: nada. O player (recarregado na URI nova,
    // pausado na mesma posição), o painel e a sidebar seguem a gravação (notify::name).
    _renameRecording(recording, text) {
        const name = (text ?? '').trim();
        if (!name || name === recording.name || this._indexOf(recording) < 0)
            return false;
        const problem = recordingNameProblem(name);
        if (problem) {
            this.addToast(problem);
            return false;
        }
        // O serviço grava ao lado do arquivo antigo: renomear durante a transcrição a perderia.
        const refusal = this._renameRefusal(recording);
        if (refusal) {
            this._showRefusal(recording, refusal);
            return false;
        }
        try {
            recording.name = name;
            if (recording.transcriptMoveFailed)
                this.addToast('A transcrição não acompanhou o novo nome.');
        } catch (e) {
            this.addToast(e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)
                ? 'Já existe uma gravação com esse nome.'
                : 'Não foi possível renomear a gravação.');
            return false;
        }
        return true;
    }

    // Por que excluir agora perderia uma transcrição paga (aviso para o usuário), ou null.
    // Em andamento: seria salva ao lado de uma gravação já fora da biblioteca (e perdida mesmo
    // com Desfazer): excluir espera ela terminar. Paga e ainda não salva (o disco falhou): só
    // existe na memória; excluir a perderia ao confirmar: o usuário salva antes ("Tentar de novo").
    _deleteRefusal(recording) {
        if (this._isTranscribing(recording))
            return DELETE_BUSY_MESSAGE;
        if (this.transcriptionService.hasUnsaved(recording.file))
            return DELETE_UNSAVED_MESSAGE;
        if (this.summaryService.status(recording.file) === 'running')
            return 'Aguarde o resumo terminar para excluir.';
        if (this.summaryService.hasUnsaved(recording.file))
            return 'Há um resumo pago que ainda não foi salvo. Toque em Tentar de novo antes de excluir.';
        return null;
    }

    // Excluir com "Desfazer": o player solta o arquivo, a gravação sai da lista (a sidebar
    // seleciona a vizinha ou nenhuma) e entra na fila; um toast por exclusão, com o id dela
    // na ação win.undo-delete. Sem Desfazer até o toast sumir, vai para a lixeira do sistema.
    _deleteRecording(recording) {
        if (this._closed || !recording)
            return;
        const index = this._indexOf(recording);
        if (index < 0)
            return;
        const refusal = this._deleteRefusal(recording);
        if (refusal) {
            this._showRefusal(recording, refusal);
            return;
        }
        if (this.playback.uri === recording.uri) {
            this._cancelPendingSeek();
            this.playback.load(null);
        }
        this._recordingList.remove(index);
        const id = this._deleteQueue.add(recording, index);
        // Sem markup: o nome é do usuário. HIGH: a exclusão mais recente aparece já (a
        // anterior volta para a fila de toasts, ainda com o próprio Desfazer).
        const toast = new Adw.Toast({
            title: deletedToastTitle(recording.name),
            use_markup: false,
            timeout: UNDO_TIMEOUT,
            priority: Adw.ToastPriority.HIGH,
            button_label: 'Desfazer',
            action_name: 'win.undo-delete',
            action_target: new GLib.Variant('i', id),
        });
        // Num ocioso: se o clique em Desfazer chegar junto com o dismissed, o undo vence
        // (commit de um id já desfeito não faz nada).
        // O ouvinte sai junto com o toast (ou no shutdown): nenhum JS fica preso a um toast
        // que só seria finalizado na coleta de lixo do encerramento.
        const handlerId = toast.connect('dismissed', () => {
            toast.disconnect(handlerId);
            this._deleteToasts.delete(id);
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._commitDelete(id);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._deleteToasts.set(id, { toast, handlerId });
        this._toastOverlay.add_toast(toast);
    }

    // O toast sumiu sem Desfazer: a gravação vai para a lixeira (nada se já foi desfeita).
    // Se o áudio não puder ir, nada foi tocado: aviso e a gravação volta para a lista.
    // Devolve a Promise do resultado (ou null), para a verificação do devSnapshot.
    _commitDelete(id) {
        const recording = this._deleteQueue.commit(id);
        if (!recording)
            return null;
        return recording.delete().then(ok => {
            if (ok || this._closed)
                return ok;
            this.addToast(TRASH_FAILED_MESSAGE);
            if (this._recordingList.getIndex(recording.file) < 0)
                this._recordingList.sortedInsert(recording);
            return ok;
        });
    }

    // Desfazer: a gravação volta para a lista, na ordem por data, e é selecionada.
    _undoDelete(id) {
        const item = this._deleteQueue.undo(id);
        // Pelo botão o toast já está sumindo; pela ação direta, some agora.
        this._deleteToasts.get(id)?.toast.dismiss();
        if (!item || this._closed)
            return;
        const { recording } = item;
        if (!recording.file.query_exists(null)) {
            this.addToast('Não foi possível restaurar a gravação.');
            return;
        }
        if (this._recordingList.getIndex(recording.file) < 0)
            this._recordingList.sortedInsert(recording);
        this.selectRecording(recording);
    }

    // --- Ações e atalhos de teclado ---

    // Ações win.* da gravação selecionada (desligadas no gravador e sem seleção) e
    // win.undo-delete(id). As teclas chegam por _onKeyPressed (ver shortcuts.js para a regra).
    _setupActions() {
        const add = (name, fn, parameterType = null) => {
            const action = new Gio.SimpleAction({ name, parameter_type: parameterType });
            action.connect('activate', (_action, param) => fn(param));
            this.add_action(action);
            return action;
        };
        const selected = fn => () => {
            if (this._selected)
                fn(this._selected);
        };
        this._actions = {
            'play-pause': add('play-pause', selected(r => this._togglePlay(r))),
            'seek-backward': add('seek-backward', selected(r => this._seekBy(r, -SEEK_STEP))),
            'seek-forward': add('seek-forward', selected(r => this._seekBy(r, SEEK_STEP))),
            'rename': add('rename', selected(r => this._showRenameDialog(r))),
            'delete': add('delete', selected(r => this._deleteRecording(r))),
            'export-audio': add('export-audio', selected(r => this._exportAudio(r))),
        };
        add('undo-delete', param => this._undoDelete(param.unpack()), new GLib.VariantType('i'));

        // Captura: a janela vê a tecla antes do widget focado e decide (shouldHandleShortcut);
        // o que ela não trata segue para o widget. Os atalhos não usam set_accels_for_action:
        // os aceleradores do app disparariam mesmo digitando na busca.
        const keys = new Gtk.EventControllerKey({ propagation_phase: Gtk.PropagationPhase.CAPTURE });
        keys.connect('key-pressed', (controller, keyval, _keycode, state) => {
            const event = controller.get_current_event();
            const surface = event?.get_surface() ?? null;
            return this.handleShortcutKey(keyval, state, {
                inPopover: surface !== null && surface !== this.get_surface(),
            });
        });
        this.add_controller(keys);
        this._syncActions();
    }

    // Trata a tecla se for um atalho válido agora; true = consumida. `inPopover`: a tecla
    // veio de um popover (outra superfície). Público para a verificação do devSnapshot,
    // que não consegue criar um Gdk.KeyEvent.
    handleShortcutKey(keyval, state, { inPopover = false } = {}) {
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        const action = shortcutFor({
            key: Gdk.keyval_name(Gdk.keyval_to_lower(keyval)),
            ctrl: (mods & Gdk.ModifierType.CONTROL_MASK) !== 0,
            shift: (mods & Gdk.ModifierType.SHIFT_MASK) !== 0,
            alt: (mods & Gdk.ModifierType.ALT_MASK) !== 0,
        });
        if (!action)
            return false;
        const focus = this.get_focus();
        const handle = shouldHandleShortcut({
            action,
            focusIsEditable: focusWithin(focus, isEditable),
            focusIsButton: focusWithin(focus, isButton),
            inDialog: inPopover || focusWithin(focus, w => w instanceof Gtk.Popover),
            recorderState: this.state === WindowState.RECORDER,
        });
        const target = this._actions[action];
        if (!handle || !target.enabled)
            return false;
        if (action === 'delete') {
            const now = GLib.get_monotonic_time();
            if (this._lastDeleteKeyUs && now - this._lastDeleteKeyUs < 500000)
                return true;
            const recording = this._selected;
            target.activate(null);
            if (recording && this._deleteQueue.has(recording))
                this._lastDeleteKeyUs = now;
            return true;
        }
        target.activate(null);
        return true;
    }

    _syncActions() {
        if (!this._actions)
            return;
        const recording = this._closed ? null : this._selected;
        const browsing = this._state !== WindowState.RECORDER;
        const on = browsing && recording !== null;
        const allowed = recording ? rowActions({
            status: this.transcriptionService.status(recording.file),
            seconds: recording.duration / 1e9,
            editMode: false,
        }) : { rename: false };
        for (const name of ['play-pause', 'seek-backward', 'seek-forward', 'delete', 'export-audio'])
            this._actions[name].enabled = on;
        this._actions.rename.enabled = on && allowed.rename && !this._renameRefusal(recording);
    }

    _togglePlay(recording) {
        if (this.playback.uri !== recording.uri)
            this.playback.load(recording.uri);
        this.playback.toggle();
    }

    _seekBy(recording, delta) {
        if (this.playback.uri === recording.uri)
            this.playback.seek(this.playback.position + delta);
    }
});
