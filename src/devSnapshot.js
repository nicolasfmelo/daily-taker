/* exported COMPONENTS PANE_STATES WINDOW_STATES maybeSnapshot silencePlayback snapshotParams stateError */
// Captura de tela para conferência visual (tools/snapshot.sh). Inerte sem a variável
// DAILY_TAKER_SNAPSHOT: com ela, mostra a janela (ou um componente numa janela simples),
// espera assentar, grava um PNG no caminho indicado e encerra o app.
const { Adw, Gio, GLib, Graphene, Gst, Gtk } = imports.gi;

const SETTLE_MS = 1500;
// Limite para um componente ficar pronto (ex.: picos da onda gerados).
const READY_TIMEOUT_MS = 30000;

// Resolve no primeiro `signal` de `obj` cujo predicado aceite os argumentos.
const nextSignal = (obj, signal, pred = () => true) => new Promise(resolve => {
    const id = obj.connect(signal, (_o, ...args) => {
        if (!pred(...args))
            return;
        obj.disconnect(id);
        resolve(args);
    });
});

// Gravações da pasta de dados, da mais recente para a mais antiga (a ordem da lista do app).
const recordingFiles = () => {
    const { RecordingsDir } = imports.application;
    const children = RecordingsDir.enumerate_children('standard::name,time::modified',
        Gio.FileQueryInfoFlags.NONE, null);
    const found = [];
    for (let info = children.next_file(null); info; info = children.next_file(null)) {
        const name = info.get_name();
        if (name.endsWith('.json') || name.startsWith('.'))
            continue;
        found.push({ file: RecordingsDir.get_child(name), time: info.get_attribute_uint64('time::modified') });
    }
    children.close(null);
    return found.sort((a, b) => b.time - a.time).map(r => r.file);
};

// Gravação mais recente da pasta de dados (a primeira da lista do app), ou null.
const newestRecordingFile = () => recordingFiles()[0] ?? null;

// Playback que nunca faz som: saída fakesink e volume 0.
const silentPlayback = () => {
    const { Playback } = imports.playback;
    const playback = new Playback({
        audioSinkFactory: () => Gst.ElementFactory.make('fakesink', null),
    });
    silencePlayback(playback);
    return playback;
};

// Carrega `uri` pausado e, com `at` > 0, posiciona em `at` s; resolve quando chegou lá.
const positionPlayback = (playback, uri, at) => {
    const duration = nextSignal(playback, 'duration-changed', seconds => seconds > 0);
    playback.load(uri);
    return duration.then(() => {
        if (!(at > 0))
            return null;
        const done = nextSignal(playback, 'position-updated', pos => Math.abs(pos - at) < 0.5);
        playback.seek(at);
        return done;
    });
};

// Barra do player sozinha, com a gravação mais recente das fixtures, pausada em --at
// (padrão 0). Saída de áudio = fakesink e nada é posto para tocar: nenhum som.
const playerBarComponent = params => {
    const { PlayerBar } = imports.playerBar;
    const { Recording } = imports.recording;

    const file = newestRecordingFile();
    if (!file)
        throw new Error('nenhuma gravação nas fixtures');
    const settings = Gio.Settings.new_with_backend(pkg.name, Gio.memory_settings_backend_new());
    // Volume de exemplo, como na mockup (a saída é um fakesink: não sai som).
    settings.set_double('playback-volume', 0.6);

    const playback = silentPlayback();
    const bar = new PlayerBar({ settings });
    bar.bind(playback);

    const recording = new Recording(file);
    const peaks = nextSignal(recording, 'peaks-updated');
    bar.setRecording(recording);
    const positioned = positionPlayback(playback, recording.uri, params.at ?? 0);
    return {
        widget: bar,
        ready: Promise.all([peaks, positioned]),
        cleanup: () => playback.destroy(),
    };
};

// Visão da transcrição sozinha (modo embutido, salvo --embedded 0) com a transcrição da
// gravação --select N (padrão 1, a mais recente). --at SEG posiciona o Playback (pausado,
// fakesink) e realça o bloco daquele instante; --find TEXTO aplica a busca interna.
const transcriptViewComponent = params => {
    const { loadTranscript } = imports.transcriptStore;
    const { TranscriptView } = imports.transcriptView;

    const files = recordingFiles();
    const n = params.select ?? 1;
    const file = files[n - 1];
    if (!file)
        throw new Error(`não há gravação ${n} nas fixtures (há ${files.length})`);
    const transcript = loadTranscript(file);
    if (!transcript)
        throw new Error(`a gravação ${n} não tem transcrição`);

    const view = new TranscriptView({ embedded: params.embedded !== 0 });
    const playback = silentPlayback();
    if (view.embedded)
        view.bindPlayback(playback);
    const built = nextSignal(view, 'blocks-built');
    view.setTranscript(transcript, file);
    const positioned = positionPlayback(playback, file.get_uri(), params.at ?? 0);
    const ready = Promise.all([built, positioned]).then(() => {
        if (params.find) {
            const { count, index } = view.setFindQuery(params.find);
            print(`devSnapshot: busca "${params.find}": ${count} resultado(s), ativo ${index}`);
        }
    });
    return {
        widget: view,
        ready,
        cleanup: () => playback.destroy(),
    };
};

// Exemplo de erro mostrado no cartão de erro (--state error).
const SAMPLE_ERROR = 'Sem conexão com o serviço de transcrição. Verifique a internet e tente de novo.';

// Painel de detalhe com a gravação --select N (padrão 1; 0 = nenhuma selecionada) e a
// transcrição dela, se houver. --empty 1 = biblioteca vazia. --state força o estado
// (padrão: ready com transcrição, none sem); --tab escolhe a aba; --at SEG posiciona o
// Playback (pausado, fakesink: sem som) e --find TEXTO abre a busca do painel.
const detailPaneComponent = params => {
    const { DetailPane } = imports.detailPane;
    const { Recording } = imports.recording;
    const { loadTranscript } = imports.transcriptStore;
    const { confirmMessage } = imports.transcriptionUi;

    const files = params.empty ? [] : recordingFiles();
    const playback = silentPlayback();
    const pane = new DetailPane();
    pane.bindPlayback(playback);
    pane.setHasRecordings(files.length > 0);
    const cleanup = () => playback.destroy();

    const n = params.select ?? 1;
    if (files.length === 0 || n === 0) {
        pane.setRecording(null);
        return { widget: pane, cleanup };
    }
    const file = files[n - 1];
    if (!file)
        throw new Error(`não há gravação ${n} nas fixtures (há ${files.length})`);

    const recording = new Recording(file);
    const durationKnown = recording.duration > 0
        ? Promise.resolve()
        : nextSignal(recording, 'notify::duration');
    const transcript = loadTranscript(file);
    const state = params.state ?? (transcript ? 'ready' : 'none');

    pane.setRecording(recording);
    pane.setErrorMessage(SAMPLE_ERROR);
    const built = transcript ? nextSignal(pane.view, 'blocks-built') : Promise.resolve();
    pane.setTranscript(transcript);
    pane.setState(state);
    if (params.tab)
        pane.tab = params.tab;

    const positioned = positionPlayback(playback, file.get_uri(), params.at ?? 0);
    const ready = Promise.all([built, positioned, durationKnown]).then(() => {
        // O custo estimado vem da janela no app; aqui, o mesmo texto do diálogo de custo.
        pane.setCostText(confirmMessage(recording.duration / 1e9).body);
        if (params.find) {
            const { count, index } = pane.search(params.find) ?? { count: 0, index: -1 };
            print(`devSnapshot: busca "${params.find}": ${count} resultado(s), ativo ${index}`);
        }
    });
    return { widget: pane, ready, cleanup };
};

// Verificação do DetailPane (só no ambiente isolado do snapshot.sh, com a cópia das
// fixtures): troca de gravação, ordem invertida, renomear e banner. Falha = sem PNG e
// saída ≠ 0; sucesso = imprime as verificações e captura o painel no fim (gravação 2
// renomeada, transcrição com o banner de erro).
const detailPaneCheckComponent = () => {
    const { DetailPane } = imports.detailPane;
    const { Recording } = imports.recording;
    const { loadTranscript, transcriptFileFor } = imports.transcriptStore;

    const files = recordingFiles();
    if (files.length < 4)
        throw new Error('fixtures incompletas');
    let checks = 0;
    const check = (ok, what) => {
        if (!ok)
            throw new Error(`verificação falhou: ${what}`);
        checks++;
    };
    const sameFile = (a, b) => Boolean(a && b && a.equal(b));

    const [fileA, fileB] = files;
    const fileNone = files[3];
    const tA = loadTranscript(fileA);
    const tB = loadTranscript(fileB);
    check(tA && tB && !loadTranscript(fileNone), 'fixtures 1 e 2 com transcrição, 4 sem');

    const pane = new DetailPane();
    const view = pane.view;
    pane.setHasRecordings(true);
    const recA = new Recording(fileA);
    const recB = new Recording(fileB);
    const recNone = new Recording(fileNone);

    // 1. A com transcrição → B sem transcrição: nada de A fica.
    pane.setRecording(recA);
    pane.setTranscript(tA);
    pane.setState('ready');
    check(view.transcript === tA && sameFile(view.recordingFile, fileA), 'A carregada');
    check(pane._stateStack.visible_child_name === 'ready', 'A mostra a visão');
    pane.setRecording(recNone);
    pane.setState('none');
    check(view.transcript === null && view.recordingFile === null, 'trocar para B limpa a visão');
    check(pane._stateStack.visible_child_name === 'not-transcribed', 'B mostra o cartão de gerar');
    check(!pane._copyButton.sensitive && !pane._exportButton.sensitive, 'Copiar/Exportar desligados em B');

    // 2. Nenhuma seleção também limpa.
    pane.setRecording(recA);
    pane.setTranscript(tA);
    pane.setState('ready');
    pane.setRecording(null);
    check(view.transcript === null && view.recordingFile === null, 'sem seleção limpa a visão');
    check(pane._mainStack.visible_child_name === 'no-selection', 'sem seleção mostra o aviso');

    // 3. Ordem invertida (transcrição antes da gravação): liga ao arquivo de B.
    pane.setTranscript(tB);
    check(view.recordingFile === null, 'sem gravação a visão não tem arquivo');
    pane.setRecording(recB);
    pane.setState('ready');
    check(view.transcript === tB && sameFile(view.recordingFile, fileB), 'ordem invertida usa o arquivo de B');
    check(pane._stateStack.visible_child_name === 'ready', 'ordem invertida mostra a visão');

    // 4. Transcrição de B dada com A selecionada e depois B: a de A nunca fica ligada a B.
    pane.setRecording(recA);
    pane.setTranscript(tA);
    pane.setTranscript(tB);
    pane.setRecording(recB);
    check(view.transcript === null && view.recordingFile === null, 'troca de gravação descarta o que veio antes');
    pane.setTranscript(tB);
    pane.setState('ready');
    check(sameFile(view.recordingFile, fileB), 'B religada ao próprio arquivo');

    // 5. Renomear a gravação: a visão passa a usar o arquivo novo e salva nele.
    const oldSidecar = transcriptFileFor(fileB);
    recB.name = 'Ideias renomeadas';
    const renamed = recB.file;
    check(renamed.get_basename() === 'Ideias renomeadas', 'gravação renomeada');
    check(sameFile(view.recordingFile, renamed), 'visão usa o arquivo renomeado');
    check(pane._titleLabel.label === 'Ideias renomeadas', 'título atualizado');
    view._applySpeakerName(view.recordingFile, 0, 'Ana Teste');
    check(loadTranscript(renamed)?.speakers?.['0'] === 'Ana Teste', 'nome do locutor salvo na transcrição movida');
    check(!oldSidecar.query_exists(null), 'nenhuma transcrição órfã no caminho antigo');

    // 6. Banner sobre a transcrição (erro / gerando) sem escondê-la.
    pane.setErrorMessage('Sem conexão com o serviço de transcrição.');
    pane.setState('running');
    check(pane._stateStack.visible_child_name === 'ready' && pane._banner.revealed, 'gerando: visão + banner');
    check(pane._copyButton.sensitive && pane._exportButton.sensitive, 'gerando: Copiar/Exportar ligados');
    check(!pane._moreButton.sensitive, 'gerando: Gerar novamente desligado');
    pane.setState('ready');
    check(!pane._banner.revealed && pane._moreButton.sensitive, 'pronta: sem banner');
    pane.setState('error');
    check(pane._stateStack.visible_child_name === 'ready' && pane._banner.revealed, 'erro: visão + banner');
    check(pane._banner.button_label === 'Tentar de novo', 'erro: botão Tentar de novo');
    check(pane._copyButton.sensitive && pane._moreButton.sensitive, 'erro: Copiar e Gerar novamente ligados');
    let retried = 0;
    const retryId = pane.connect('retry-requested', () => retried++);
    pane._banner.emit('button-clicked');
    pane.disconnect(retryId);
    check(retried === 1, 'banner pede retry');

    // 7. Erro sem transcrição: cartão de erro; "pronta" sem transcrição: gerar de novo.
    pane.setRecording(recNone);
    pane.setState('error');
    check(pane._stateStack.visible_child_name === 'error' && !pane._banner.revealed, 'erro sem transcrição: cartão');
    pane.setState('ready');
    check(pane._stateStack.visible_child_name === 'not-transcribed', 'pronta sem transcrição: cartão');
    check(pane._generateTitleLabel.label === 'Não foi possível carregar a transcrição', 'mensagem de falha ao carregar');
    let regenerate = null;
    const genId = pane.connect('generate-requested', (_p, again) => {
        regenerate = again;
    });
    pane._generateButton.emit('clicked');
    pane.disconnect(genId);
    check(regenerate === true, 'gerar com confirmação de sobrescrever');

    // Captura: B renomeada com o banner de erro.
    pane.setRecording(recB);
    const built = nextSignal(view, 'blocks-built');
    pane.setTranscript(loadTranscript(renamed));
    pane.setState('error');
    // Os testes não devem gravar nada fora da cópia temporária: confere de novo o caminho.
    check(renamed.get_path().startsWith(imports.application.RecordingsDir.get_path()), 'arquivos só na cópia das fixtures');
    print(`devSnapshot: detailpanecheck: ${checks} verificações OK`);
    return { widget: pane, ready: built };
};

// nome → (params, { app, window }) → Gtk.Widget ou { widget, ready?, cleanup? }. Se o
// widget for um Gtk.Window, ele é capturado como está; qualquer outro vai para uma janela
// simples do tamanho pedido. `ready` (Promise) adia a captura até o componente terminar
// de carregar (ex.: picos da onda); `cleanup` roda antes de sair. A próxima tarefa
// acrescenta sidebar.
var COMPONENTS = {
    window: (_params, ctx) => ctx.window,
    playerbar: playerBarComponent,
    transcriptview: transcriptViewComponent,
    detailpane: detailPaneComponent,
    detailpanecheck: detailPaneCheckComponent,
};

// --state (só com --component window): página mostrada no lugar da lista. Só troca a
// página; nenhuma gravação começa e nenhum dispositivo de áudio é aberto.
var WINDOW_STATES = {
    recorder: window => {
        window.state = imports.window.WindowState.RECORDER;
    },
};

// --state com --component detailpane: estado forçado do painel (DetailPane.setState).
var PANE_STATES = ['none', 'running', 'error', 'ready'];

// Mensagem de erro para um --state inválido, ou null.
var stateError = params => {
    if (!params.state)
        return null;
    const available = { window: Object.keys(WINDOW_STATES), detailpane: PANE_STATES }[params.component];
    if (!available)
        return `--state só vale com --component window ou detailpane (recebido "${params.component}")`;
    if (!available.includes(params.state))
        return `estado desconhecido: "${params.state}" (disponíveis: ${available.join(', ')})`;
    return null;
};

const env = name => GLib.getenv(name) || null;

const intOrNull = text => {
    if (text === null)
        return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
};

// Lê os parâmetros do ambiente (definidos por tools/snapshot.sh); null sem DAILY_TAKER_SNAPSHOT.
var snapshotParams = () => {
    const output = env('DAILY_TAKER_SNAPSHOT');
    if (!output)
        return null;
    const [width, height] = (env('DAILY_TAKER_SNAPSHOT_SIZE') || '1536x1024').split('x').map(Number);
    return {
        output,
        component: env('DAILY_TAKER_SNAPSHOT_COMPONENT') || 'window',
        select: intOrNull(env('DAILY_TAKER_SNAPSHOT_SELECT')),
        tab: env('DAILY_TAKER_SNAPSHOT_TAB'),
        at: intOrNull(env('DAILY_TAKER_SNAPSHOT_AT')),
        state: env('DAILY_TAKER_SNAPSHOT_STATE'),
        embedded: intOrNull(env('DAILY_TAKER_SNAPSHOT_EMBEDDED')),
        find: env('DAILY_TAKER_SNAPSHOT_FIND'),
        empty: env('DAILY_TAKER_SNAPSHOT_EMPTY') === '1',
        width,
        height,
    };
};

const fail = message => {
    printerr(`devSnapshot: ${message}`);
    // Código de saída ≠ 0 para o snapshot.sh; sair direto evita mostrar qualquer janela.
    imports.system.exit(2);
};

const savePng = (target, path) => {
    const width = target.get_width();
    const height = target.get_height();
    const snapshot = new Gtk.Snapshot();
    Gtk.WidgetPaintable.new(target).snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node)
        throw new Error('nada para desenhar');
    // O recorte no tamanho da janela deixa de fora a sombra da decoração.
    const viewport = new Graphene.Rect().init(0, 0, width, height);
    const texture = target.get_native().get_renderer().render_texture(node, viewport);
    if (!texture.save_to_png(path))
        throw new Error(`não foi possível gravar ${path}`);
    print(`devSnapshot: ${path} (${width}x${height})`);
};

// Defesa extra para quem tocar áudio durante uma captura (ex.: --at): zera o volume e
// silencia o player/playbin. Sem DAILY_TAKER_SNAPSHOT não faz nada.
var silencePlayback = playback => {
    if (!env('DAILY_TAKER_SNAPSHOT') || !playback)
        return;
    // GstPlayer e playbin expõem as propriedades volume e mute (os setters diferem).
    if ('volume' in playback)
        playback.volume = 0;
    if ('mute' in playback)
        playback.mute = true;
};

// Devolve true se assumiu a exibição (o chamador não deve mostrar a janela).
var maybeSnapshot = (window, params = snapshotParams()) => {
    if (!params)
        return false;

    const app = window.get_application();
    const build = COMPONENTS[params.component];
    if (!build) {
        fail(`componente desconhecido ou ainda não disponível: "${params.component}" ` +
            `(disponíveis: ${Object.keys(COMPONENTS).join(', ')})`);
        return true;
    }
    const badState = stateError(params);
    if (badState) {
        fail(badState);
        return true;
    }
    silencePlayback(window.player);
    if (params.state && params.component === 'window')
        WINDOW_STATES[params.state](window);
    if (params.component === 'window' && (params.select !== null || params.tab || params.at !== null))
        print('devSnapshot: nota: --select/--tab/--at ainda são ignorados pela janela atual');

    let built;
    try {
        built = build(params, { app, window });
    } catch (e) {
        fail(`componente "${params.component}": ${e.message}`);
        return true;
    }
    const isWidget = built instanceof Gtk.Widget;
    let target = isWidget ? built : built.widget;
    const ready = isWidget ? Promise.resolve() : built.ready ?? Promise.resolve();
    const cleanup = isWidget ? () => {} : built.cleanup ?? (() => {});
    if (!(target instanceof Gtk.Window))
        target = new Adw.ApplicationWindow({ application: app, content: target });
    target.set_default_size(params.width, params.height);

    const timeout = new Promise((_resolve, reject) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, READY_TIMEOUT_MS, () => {
            reject(new Error(`componente não ficou pronto em ${READY_TIMEOUT_MS} ms`));
            return GLib.SOURCE_REMOVE;
        });
    });
    const mapped = nextSignal(target, 'map');

    Promise.race([Promise.all([ready, mapped]), timeout]).then(() => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            let ok = true;
            try {
                savePng(target, params.output);
            } catch (e) {
                ok = false;
                printerr(`devSnapshot: falhou: ${e.message}`);
            }
            cleanup();
            if (!ok)
                imports.system.exit(3);
            if (target === window)
                window.close();
            else
                app.quit();
            return GLib.SOURCE_REMOVE;
        });
    }).catch(e => {
        printerr(`devSnapshot: falhou: ${e.message}`);
        cleanup();
        imports.system.exit(3);
    });
    target.present();
    return true;
};
