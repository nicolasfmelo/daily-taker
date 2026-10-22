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
const { Adw, Gio, GLib, GObject, Gtk } = imports.gi;

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
const { loadTranscript, saveTranscript, transcriptFileFor } = imports.transcriptStore;
const { exportContent, exportExtension } = imports.transcriptViewModel;
const { TranscriptionService } = imports.transcriptionService;
const { TranscriptionController } = imports.transcriptionController;
const { confirmMessage, guardedSave, hasNamedSpeakers, recordingNameProblem, rowStatus } =
    imports.transcriptionUi;
const { playbackOptions } = imports.devSnapshot;

var WindowState = {
    BROWSE: 0,
    RECORDER: 1,
};

// Diálogo de arquivo fechado pelo usuário: nada a avisar.
const dismissed = e => e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED) ?? false;

var Window = GObject.registerClass({
    Template: 'resource:///dev/nicolas/DailyTaker/ui/window.ui',
    InternalChildren: [
        'toastOverlay', 'mainStack', 'backButton', 'appIcon', 'splitView', 'sidebarPage',
        'contentView', 'mediumBreakpoint', 'narrowBreakpoint',
    ],
}, class Window extends Adw.ApplicationWindow {
    _init(params) {
        super._init({ icon_name: pkg.name, ...params });
        this._appIcon.icon_name = pkg.name;
        this._closed = false;
        this._selected = null;          // gravação mostrada no painel e carregada no player
        this._selectedUri = null;       // URI dela quando foi carregada (renomear muda a URI)
        this._selectedIds = [];
        this._pendingSeek = null;       // { id } do seek que espera a mídia recarregada
        this._midnightId = 0;

        this.recorder = new Recorder();
        this.recorderWidget = new RecorderWidget(this.recorder);
        this._mainStack.add_named(this.recorderWidget, 'recorder');
        this.insert_action_group('recorder', this.recorderWidget.actionsGroup);

        this._recordingList = new RecordingList();
        this.transcriptionService = new TranscriptionService({
            getKey: () => defaultKeyStore().get(),
            transcribe: transcribeFile,
            save: guardedSave(saveTranscript),
            language: () => Settings.get_string('language'),
            now: () => new Date(),
        });
        this._transcription = new TranscriptionController({
            parent: this,
            service: this.transcriptionService,
            showToast: toast => this._toastOverlay.add_toast(toast),
            openPreferences: () => this.application.activate_action('preferences', null),
            hasRecording: recording => this._indexOf(recording) >= 0,
            onDone: file => this._onTranscriptionDone(file),
            onFailed: (recording, message) => this._onTranscriptionFailed(recording, message),
        });

        // Player único: criado uma vez; velocidade e volume salvos são aplicados pelo bind.
        this.playback = new Playback(playbackOptions());
        this._sidebar = new Sidebar({
            recordingList: this._recordingList,
            transcriptionService: this.transcriptionService,
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
        this._playerBar.bind(this.playback);
        this._detailPane.bindPlayback(this.playback);
        this._playerBar.bind_property('follow-audio', this._detailPane.view, 'follow-audio',
            GObject.BindingFlags.SYNC_CREATE);

        this._connectSidebar();
        this._connectPane();
        this._connectRecorder();
        this._connectNavigation();
        // Depois da sidebar: quando este ouvinte roda, ela já reconciliou a seleção.
        this._recordingList.connect('items-changed', () => this._onLibraryChanged());
        this._recordingList.connect('notify::loaded', () => this._syncLibrary());
        // Um único ouvinte do serviço na janela (a sidebar cuida dos próprios selos).
        this.transcriptionService.connectChange((uri, status) => this._onTranscriptionChanged(uri, status));
        this._setupDates();

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

    addToast(title) {
        // Sem markup: nomes de gravação podem ter & ou < (ex.: "Reunião P&D").
        this._toastOverlay.add_toast(new Adw.Toast({ title, use_markup: false }));
    }

    get state() {
        return this._state;
    }

    set state(state) {
        this._state = state;
        this._mainStack.visible_child_name = state === WindowState.RECORDER ? 'recorder' : 'browse';
    }

    vfunc_close_request() {
        this.shutdown();
        return false;
    }

    // Encerra o app: solta player, gravador e temporizadores, desmonta os widgets e sai.
    // Chamado ao fechar a janela (e pelo devSnapshot, que pode nunca mostrá-la).
    shutdown() {
        if (this._closed)
            return;
        // Uma transcrição em andamento não segura o fechamento: é simplesmente abandonada.
        this._closed = true;
        this._transcription.close();
        if (this._midnightId) {
            GLib.source_remove(this._midnightId);
            this._midnightId = 0;
        }
        this._cancelPendingSeek();
        this._recordingList.cancellable.cancel();
        this.playback.destroy();
        this.recorder.stop();
        // Desmonta os widgets com o JS ainda vivo e só então sai: sem isso a árvore (com
        // vfuncs e funções JS, como o cabeçalho da lista) só seria desfeita na coleta de
        // lixo do encerramento, onde o GJS bloqueia essas chamadas.
        const app = this.application;
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._sidebarPage.child = null;
            this._sidebar.run_dispose();
            this.run_dispose();
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    }

    // --- Ligações ---

    _connectSidebar() {
        const sidebar = this._sidebar;
        sidebar.connect('recording-selected', (_s, recording) => this._onRecordingSelected(recording));
        sidebar.connect('transcribe-requested', (_s, recording, regenerate) => {
            this._transcription.request(recording, {
                regenerate,
                namedSpeakers: regenerate && hasNamedSpeakers(loadTranscript(recording.file)),
            });
        });
        sidebar.connect('rename-requested', (_s, recording) => this._showRenameDialog(recording));
        sidebar.connect('delete-requested', (_s, recording) => this._deleteRecording(recording));
        sidebar.connect('export-audio-requested', (_s, recording) => this._exportAudio(recording));
    }

    _connectPane() {
        const pane = this._detailPane;
        pane.connect('generate-requested', (_p, regenerate) => {
            if (this._selected)
                this._transcription.request(this._selected, this._generateOptions(regenerate));
        });
        pane.connect('retry-requested', () => {
            if (this._selected)
                this._transcription.retry(this._selected, this._generateOptions(pane.view.transcript !== null));
        });
        pane.connect('export-requested', (_p, ext) => this._exportTranscript(ext));
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

    // "Hoje"/"Ontem" mudam à meia-noite e enquanto a janela fica em segundo plano.
    _setupDates() {
        this.connect('notify::is-active', () => {
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
        pane.setTranscript(next ? loadTranscript(next.file) : null);
        pane.setErrorMessage(next ? this._transcription.failureMessage(next) : '');
        pane.setState(next ? this._statusOf(next) : 'none');
        this._syncCost();
        this._playerBar.setRecording(next);
        // Troca de mídia para o áudio anterior; nada começa a tocar sozinho.
        this._cancelPendingSeek();
        this.playback.load(next?.uri ?? null);
        if (!next && this._splitView.collapsed)
            this._splitView.show_content = false;
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
    // para ela, parado).
    onRecorderStopped(recording) {
        if (!recording) {
            this.addToast(NOTHING_RECORDED_MESSAGE);
            this.state = WindowState.BROWSE;
            return;
        }
        if (this._recordingList.getIndex(recording.file) < 0)
            this._recordingList.sortedInsert(recording);
        this.playback.stop();
        this.selectRecording(recording);
        this.state = WindowState.BROWSE;
    }

    // Depois de 'stopped'/'canceled': só o aviso, e a janela volta à lista.
    onRecorderFailed(message) {
        this.addToast(message);
        this.state = WindowState.BROWSE;
    }

    // --- Transcrição ---

    _onTranscriptionChanged(uri, status) {
        const recording = this._selected;
        if (this._closed || !recording || recording.uri !== uri)
            return;
        if (status === 'running') {
            this._detailPane.setState('running');
        } else if (status === 'error') {
            this._detailPane.setErrorMessage(this._transcription.failureMessage(recording));
            this._detailPane.setState('error');
        }
        // 'none' depois de salvar: _onTranscriptionDone relê a transcrição do disco.
    }

    _onTranscriptionDone(file) {
        const recording = this._selected;
        if (!recording || !recording.file.equal(file))
            return;
        this._detailPane.setTranscript(loadTranscript(recording.file));
        this._detailPane.setState(this._statusOf(recording));
    }

    _onTranscriptionFailed(recording, message) {
        if (recording === this._selected)
            this._detailPane.setErrorMessage(message);
    }

    // --- Exportar, renomear, excluir ---

    _exportTranscript(ext) {
        const transcript = this._detailPane.view.transcript;
        if (!transcript)
            return;
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
                    this.addToast('Não foi possível exportar a transcrição');
                return;
            }
            try {
                const content = exportContent(transcript, exportExtension(file.get_basename(), ext));
                file.replace_contents(new TextEncoder().encode(content), null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                this.addToast('Transcrição exportada');
            } catch (e) {
                this.addToast('Não foi possível exportar a transcrição');
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

    // Renomear simples (a Task 11 refina): diálogo com o nome atual, validado.
    _showRenameDialog(recording) {
        if (this.transcriptionService.status(recording.file) === 'running')
            return;
        const entry = new Gtk.Entry({ text: recording.name, activates_default: true });
        const dialog = new Adw.MessageDialog({
            transient_for: this,
            modal: true,
            heading: 'Renomear gravação',
            extra_child: entry,
        });
        dialog.add_response('cancel', 'Cancelar');
        dialog.add_response('rename', 'Renomear');
        dialog.set_response_appearance('rename', Adw.ResponseAppearance.SUGGESTED);
        dialog.default_response = 'rename';
        dialog.close_response = 'cancel';
        const validate = () => {
            const problem = recordingNameProblem(entry.text);
            dialog.body = problem ?? '';
            dialog.set_response_enabled('rename', !problem && entry.text.trim() !== '');
            if (problem)
                entry.add_css_class('error');
            else
                entry.remove_css_class('error');
        };
        entry.connect('changed', validate);
        validate();
        dialog.connect('response', (_dialog, response) => {
            if (response === 'rename' && !this._closed)
                this._renameRecording(recording, entry.text);
        });
        dialog.present();
        entry.grab_focus();
    }

    // Devolve true se renomeou. O player e o painel seguem a gravação (notify::name).
    _renameRecording(recording, text) {
        const name = text.trim();
        if (!name || name === recording.name)
            return false;
        const problem = recordingNameProblem(name);
        if (problem) {
            this.addToast(problem);
            return false;
        }
        // O serviço grava ao lado do arquivo antigo: renomear durante a transcrição a perderia.
        if (this.transcriptionService.status(recording.file) === 'running')
            return false;
        try {
            recording.name = name;
        } catch (e) {
            this.addToast('Não foi possível renomear a gravação');
            return false;
        }
        return true;
    }

    // Task 11: troca por uma fila com "Desfazer" (DeleteQueue). Por ora a gravação vai
    // direto para a lixeira do sistema (recuperável por lá). Sai da lista antes: a sidebar
    // seleciona a vizinha e o player solta o arquivo antes de ele ir para a lixeira.
    _deleteRecording(recording) {
        const index = this._indexOf(recording);
        if (index < 0)
            return;
        const name = recording.name;
        this._recordingList.remove(index);
        recording.delete();
        this.addToast(`"${name}" foi para a lixeira`);
    }
});
