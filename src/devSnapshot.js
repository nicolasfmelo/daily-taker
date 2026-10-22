/* exported COMPONENTS MUTATING_COMPONENTS PANE_STATES SIDEBAR_STATES WINDOW_STATES isSandboxed maybeSnapshot
   playbackOptions silencePlayback snapshotParams stateError */
// Captura de tela para conferência visual (tools/snapshot.sh). Inerte sem a variável
// DAILY_TAKER_SNAPSHOT: com ela, mostra a janela (ou um componente numa janela simples),
// espera assentar, grava um PNG no caminho indicado e encerra o app.
const { Adw, Gdk, Gio, GLib, Graphene, Gst, Gtk } = imports.gi;

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

// Componentes que alteram arquivos (renomeiam, reescrevem transcrições): só rodam no
// ambiente isolado do tools/snapshot.sh, conferido ANTES de qualquer alteração.
var MUTATING_COMPONENTS = ['detailpanecheck', 'sidebarcheck', 'windowcheck'];

const hasDotSegment = path => path.split('/').some(part => part === '.' || part === '..');
const trimSlashes = path => path.replace(/\/+$/, '');

// O snapshot.sh exporta DAILY_TAKER_SNAPSHOT_SANDBOX=1 e a raiz temporária em
// DAILY_TAKER_SNAPSHOT_ROOT; a pasta de dados em uso tem de estar dentro dessa raiz.
var isSandboxed = (env, dataDir) => {
    if (env?.DAILY_TAKER_SNAPSHOT_SANDBOX !== '1')
        return false;
    const root = trimSlashes(env.DAILY_TAKER_SNAPSHOT_ROOT ?? '');
    const dir = trimSlashes(dataDir ?? '');
    if (!root.startsWith('/') || !dir.startsWith('/') || hasDotSegment(root) || hasDotSegment(dir))
        return false;
    return dir.startsWith(`${root}/`);
};

const sandboxEnv = () => ({
    DAILY_TAKER_SNAPSHOT_SANDBOX: GLib.getenv('DAILY_TAKER_SNAPSHOT_SANDBOX'),
    DAILY_TAKER_SNAPSHOT_ROOT: GLib.getenv('DAILY_TAKER_SNAPSHOT_ROOT'),
});

// Lança (sem alterar nada) fora do ambiente isolado.
const assertSandboxed = () => {
    const dataDir = GLib.canonicalize_filename(GLib.get_user_data_dir(), null);
    if (!isSandboxed(sandboxEnv(), dataDir)) {
        throw new Error('este componente altera arquivos e só roda pelo tools/snapshot.sh ' +
            `(ambiente isolado); pasta de dados atual: ${dataDir}`);
    }
};

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

// Visão da transcrição sozinha (a do painel de detalhe) com a transcrição da
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

    const view = new TranscriptView();
    const playback = silentPlayback();
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
// renomeada, transcrição com o banner de erro). Altera arquivos: só roda isolado
// (MUTATING_COMPONENTS, isSandboxed).
const detailPaneCheckComponent = () => {
    assertSandboxed();
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
    print(`devSnapshot: detailpanecheck: ${checks} verificações OK`);
    return { widget: pane, ready: built };
};

// Serviço de transcrição falso: nunca chama a API. `statuses` = uri → status.
const fakeService = (statuses = new Map()) => {
    const listeners = [];
    return {
        status: file => statuses.get(file.get_uri()) ?? 'none',
        hasUnsaved: () => false,
        connectChange: fn => listeners.push(fn),
        set(uri, status) {
            if (status === 'none')
                statuses.delete(uri);
            else
                statuses.set(uri, status);
            for (const fn of listeners)
                fn(uri, status);
        },
    };
};

// Resolve quando a lista tem `count` itens e todos têm a duração conhecida.
const listReady = (list, count) => new Promise(resolve => {
    const waitDurations = () => {
        const items = [];
        for (let i = 0; i < list.get_n_items(); i++)
            items.push(list.get_item(i));
        Promise.all(items.map(r => r.duration > 0
            ? Promise.resolve()
            : nextSignal(r, 'notify::duration'))).then(() => resolve(items));
    };
    if (list.get_n_items() >= count) {
        waitDurations();
        return;
    }
    const id = list.connect('items-changed', () => {
        if (list.get_n_items() < count)
            return;
        list.disconnect(id);
        waitDurations();
    });
});

// Sidebar com a biblioteca das fixtures (RecordingList real, só leitura), um serviço de
// transcrição falso e: --select N (item N da lista), --query TEXTO (busca),
// --state running|error (a gravação 2 nesse status), --empty 1 (biblioteca vazia).
// Tamanho padrão 360x900.
const sidebarComponent = params => {
    const { Recording } = imports.recording;
    const { RecordingList } = imports.recordingList;
    const { Sidebar } = imports.sidebar;

    const files = params.empty ? [] : recordingFiles();
    const statuses = new Map();
    if (params.state && files[1])
        statuses.set(files[1].get_uri(), params.state);
    const list = params.empty ? new Gio.ListStore({ item_type: Recording }) : new RecordingList();
    const sidebar = new Sidebar({ recordingList: list, transcriptionService: fakeService(statuses) });
    const ready = listReady(list, files.length).then(items => {
        const n = params.select ?? 0;
        if (n > 0) {
            if (!items[n - 1])
                throw new Error(`não há gravação ${n} nas fixtures (há ${items.length})`);
            sidebar.select(items[n - 1]);
        }
        if (params.query !== null)
            sidebar.setQuery(params.query);
        // Numa janela só com a sidebar o foco cairia na busca (anel laranja); a captura
        // mostra o estado em repouso, como na mockup.
        sidebar.get_root()?.set_focus(null);
        const visible = sidebar._visible.map(r => r.name);
        print(`devSnapshot: sidebar: ${visible.length} visível(is): ${visible.join(' | ')}; ` +
            `selecionada: ${sidebar.selected?.name ?? 'nenhuma'}`);
    });
    return { widget: sidebar, ready };
};

// Verificação da Sidebar na cópia temporária das fixtures (renomeia e grava uma
// transcrição: só no ambiente isolado). Imprime PASS/FAIL por verificação; uma falha =
// sem PNG e saída ≠ 0. Captura a sidebar no fim.
const sidebarCheckComponent = () => {
    assertSandboxed();
    const { RecordingList } = imports.recordingList;
    const { Sidebar } = imports.sidebar;
    const { loadTranscript, saveTranscript, transcriptFileFor } = imports.transcriptStore;

    const files = recordingFiles();
    if (files.length < 4)
        throw new Error('fixtures incompletas');
    const list = new RecordingList();
    const service = fakeService();
    const sidebar = new Sidebar({ recordingList: list, transcriptionService: service });
    let failures = 0;
    const check = (ok, what) => {
        print(`${ok ? 'PASS' : 'FAIL'} sidebarcheck: ${what}`);
        if (!ok)
            failures++;
    };
    const names = () => sidebar._visible.map(r => r.name);
    const rowOf = r => sidebar._rowFor(r);
    const emitted = [];
    sidebar.connect('recording-selected', (_s, r) => emitted.push(r));
    const emits = fn => {
        emitted.length = 0;
        fn();
        return [...emitted];
    };

    // Deixa rodar o que foi agendado em ocioso (ex.: selo de uma transcrição ilegível).
    const idle = () => new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
    const ready = listReady(list, files.length).then(async items => {
        const [daily, ideias, notas, sem] = items;
        const entries = () => [...sidebar._transcripts.values()];
        check(sidebar._parses === 0 && entries().length === 4 && entries().every(en => !en.parsed),
            'na partida nenhuma transcrição é lida (selo só pela existência do arquivo)');
        check(names().join('|') === 'Daily · Projeto Atlas|Ideias para o app|Notas da reunião|Sem transcrição',
            'ordem da lista (mais recente primeiro)');
        check(rowOf(daily).badgeKind === 'ok' && rowOf(sem).badgeKind === 'none', 'selos: Transcrita / nada');
        check(sidebar.selected === null && !sidebar._exportButton.sensitive, 'sem seleção: Exportar desligado');

        // 1. Seleção emite uma vez por mudança.
        let e = emits(() => sidebar.select(ideias));
        check(e.length === 1 && e[0] === ideias && sidebar.selected === ideias, 'select emite uma vez');
        check(sidebar._list.get_selected_row() === rowOf(ideias), 'linha destacada = seleção');
        check(sidebar._exportButton.sensitive, 'com seleção: Exportar ligado');
        e = emits(() => sidebar.select(ideias));
        check(e.length === 0, 'selecionar a mesma não emite');
        e = emits(() => sidebar._list.select_row(rowOf(notas)));
        check(e.length === 1 && sidebar.selected === notas, 'clique na linha seleciona (uma emissão)');
        e = emits(() => sidebar.select(null));
        check(e.length === 1 && e[0] === null && sidebar._list.get_selected_row() === null, 'select(null) limpa');

        // 2. Busca: nome, conteúdo da transcrição, sem resultado; coerência da seleção.
        sidebar.select(daily);
        e = emits(() => sidebar.setQuery('notas'));
        check(names().join('|') === 'Notas da reunião', 'busca "notas" filtra pelo nome');
        check(e.length === 0 && sidebar.selected === daily && sidebar._list.get_selected_row() === null &&
            sidebar._exportButton.sensitive,
            'selecionada escondida pela busca: continua selecionada, sem emissão, Exportar ligado');
        e = emits(() => sidebar.setQuery(''));
        check(e.length === 0 && sidebar.selected === daily && sidebar._list.get_selected_row() === rowOf(daily),
            'limpar a busca destaca de novo a selecionada, sem emissão');
        sidebar.setQuery('notas');
        e = emits(() => sidebar._list.select_row(rowOf(notas)));
        check(e.length === 1 && e[0] === notas && sidebar.selected === notas,
            'escolher outra visível com a selecionada escondida emite uma vez');
        e = emits(() => sidebar.setQuery(''));
        check(names().length === 4 && e.length === 0 && sidebar.selected === notas &&
            sidebar._list.get_selected_row() === rowOf(notas), 'limpar a busca mantém a seleção visível');
        sidebar.setQuery('reuniao');
        check(names().join('|') === 'Daily · Projeto Atlas|Ideias para o app|Notas da reunião',
            'busca "reuniao": nome e conteúdo da transcrição (a sem transcrição fica de fora)');
        const parsed = sidebar._parses;
        check(parsed === 3, `transcrições lidas na primeira busca: ${parsed} (as 3 que existem)`);
        sidebar.setQuery('acompanhar');
        check(names().join('|') === 'Daily · Projeto Atlas|Ideias para o app|Notas da reunião',
            'busca só no conteúdo da transcrição');
        check(sidebar._parses === parsed, 'outra busca não lê de novo (no máximo uma vez por URI)');
        check(entries().every(en => !('words' in en) && (en.haystack === null || typeof en.haystack === 'string')),
            'cache guarda só o texto de busca, não a transcrição');
        sidebar.setQuery('zzzz');
        check(names().length === 0 && sidebar._listStack.visible_child_name === 'empty' &&
            sidebar._emptyLabel.label === 'Nada encontrado para essa busca', 'sem resultado: aviso');
        e = emits(() => sidebar.select(sem));
        check(sidebar._searchEntry.text === '' && names().length === 4 && sidebar.selected === sem &&
            e.length === 1, 'select de item escondido limpa a busca e seleciona');
        check(sidebar._listStack.visible_child_name === 'list', 'lista visível de novo');

        // 3. invalidateTranscript: transcrição nova no disco → selo e busca.
        saveTranscript(sem.file, loadTranscript(daily.file));
        check(rowOf(sem).badgeKind === 'none', 'antes de invalidar: cache antigo (sem selo)');
        sidebar.invalidateTranscript(sem.uri);
        check(rowOf(sem).badgeKind === 'ok', 'invalidateTranscript atualiza o selo');
        sidebar.setQuery('acompanhar');
        check(names().includes('Sem transcrição'), 'invalidateTranscript atualiza a busca');
        check(sidebar._parses === parsed + 1, 'invalidar relê só aquela transcrição');
        sidebar.setQuery('');

        // 4. Status do serviço: running → spinner; sai de running → relê a transcrição.
        service.set(ideias.uri, 'running');
        check(rowOf(ideias).badgeKind === 'running', 'serviço running → Transcrevendo…');
        service.set(ideias.uri, 'error');
        check(rowOf(ideias).badgeKind === 'error', 'serviço error → Erro');
        service.set(ideias.uri, 'none');
        check(rowOf(ideias).badgeKind === 'ok', 'serviço none → Transcrita');

        // 4b. Menu ⋮: montado só ao abrir; ações por URI; bloqueios durante a transcrição.
        const asked = [];
        for (const signal of ['rename-requested', 'delete-requested', 'export-audio-requested'])
            sidebar.connect(signal, (_s, r) => asked.push([signal, r]));
        sidebar.connect('transcribe-requested', (_s, r, again) => asked.push(['transcribe-requested', r, again]));
        const button = rowOf(sem).menuButton;
        check(button.menu_model === null, 'menu ainda não montado');
        button.popup();
        const labels = [];
        const menu = button.menu_model;
        for (let i = 0; i < menu.get_n_items(); i++) {
            const section = menu.get_item_link(i, 'section');
            for (let j = 0; j < section.get_n_items(); j++)
                labels.push(section.get_item_attribute_value(j, 'label', null).get_string()[0]);
        }
        check(labels.join('|') === 'Renomear|Gerar novamente|Exportar áudio|Excluir', `itens do menu: ${labels.join('|')}`);
        let destructive = false;
        const walk = w => {
            for (let c = w?.get_first_child(); c; c = c.get_next_sibling()) {
                destructive ||= c.has_css_class('destructive') && c.text === 'Excluir';
                walk(c);
            }
        };
        walk(button.popover);
        check(destructive, 'Excluir com estilo destrutivo');
        button.popdown();
        const target = new GLib.Variant('s', sem.uri);
        for (const action of ['rename', 'transcribe', 'export', 'delete'])
            sidebar.activate_action(`sidebar.${action}`, target);
        check(asked.map(a => a[0]).join('|') ===
            'rename-requested|transcribe-requested|export-audio-requested|delete-requested' &&
            asked.every(a => a[1] === sem) && asked[1][2] === true, 'ações do menu emitem os sinais (regenerar = true)');
        asked.length = 0;
        sidebar.select(daily);
        sidebar._exportButton.emit('clicked');
        check(asked.length === 1 && asked[0][0] === 'export-audio-requested' && asked[0][1] === daily,
            'botão Exportar áudio do cabeçalho: gravação selecionada');
        asked.length = 0;
        service.set(sem.uri, 'running');
        sidebar.activate_action('sidebar.transcribe', target);
        check(asked.length === 0, 'Gerar bloqueado durante a transcrição');
        sidebar.activate_action('sidebar.rename', target);
        check(asked.length === 0, 'Renomear bloqueado durante a transcrição (na ação)');
        service.set(sem.uri, 'none');

        // 4d. Duração ainda desconhecida: Gerar desligado (menu e ação), como na linha antiga;
        // liga sozinho quando a duração chega (notify::duration), mesmo com o menu aberto.
        const generateAction = () => {
            const section = button.menu_model.get_item_link(0, 'section');
            return section.get_item_attribute_value(1, 'action', null).get_string()[0];
        };
        const knownDuration = sem._duration;
        sem._duration = 0;
        sem.notify('duration');
        button.popup();
        check(generateAction() === 'sidebar.busy', 'duração 0: Gerar desligado no menu');
        asked.length = 0;
        sidebar.activate_action('sidebar.transcribe', target);
        check(asked.length === 0, 'duração 0: ação Gerar não emite');
        sem._duration = knownDuration;
        sem.notify('duration');
        check(generateAction() === 'sidebar.transcribe', 'duração conhecida com o menu aberto: Gerar ligado');
        button.popdown();
        sidebar.activate_action('sidebar.transcribe', target);
        check(asked.length === 1 && asked[0][0] === 'transcribe-requested', 'duração conhecida: ação Gerar emite');

        // 4c. Transcrição ilegível: conta como existente até ser lida; lida, sai o selo.
        transcriptFileFor(sem.file).replace_contents('{ isto não é json', null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        sidebar.invalidateTranscript(sem.uri);
        check(rowOf(sem).badgeKind === 'ok', 'ilegível, ainda não lida: selo pela existência');
        sidebar.setQuery('acompanhar');
        check(!names().includes('Sem transcrição'), 'ilegível não casa pelo conteúdo');
        sidebar.setQuery('');
        await idle();
        check(rowOf(sem).badgeKind === 'none', 'ilegível, depois de lida: sem selo');

        // 5. Renomear: rótulo, chave do cache (URI nova) e busca pelo nome novo.
        const oldUri = notas.uri;
        sidebar.select(notas);
        notas.name = 'Retro renomeada';
        check(rowOf(notas)._title.label === 'Retro renomeada', 'renomear atualiza o rótulo');
        check(!sidebar._transcripts.has(oldUri) && sidebar._transcripts.get(notas.uri)?.exists === true,
            'renomear troca a chave do cache');
        check(rowOf(notas).badgeKind === 'ok', 'renomeada continua Transcrita');
        sidebar.setQuery('retro');
        check(names().join('|') === 'Retro renomeada' && sidebar.selected === notas, 'busca pelo nome novo');
        sidebar.setQuery('acompanhar');
        check(names().includes('Retro renomeada') && sidebar._transcripts.get(notas.uri)?.haystack !== null,
            'renomeada: busca no conteúdo pela transcrição movida');
        sidebar.setQuery('');

        // 6. Remover a selecionada seleciona a vizinha; a última → a nova última; tudo → nenhuma.
        e = emits(() => list.remove(list.getIndex(notas.file)));
        check(e.length === 1 && sidebar.selected === sem && sidebar._list.get_selected_row() === rowOf(sem),
            'remover a selecionada seleciona a vizinha');
        e = emits(() => list.remove(list.getIndex(sem.file)));
        check(e.length === 1 && sidebar.selected === ideias, 'remover a última seleciona a nova última');
        // Selecionada escondida pela busca e removida da biblioteca: decide nextSelection
        // (ela não tinha posição visível → nenhuma), uma emissão.
        sidebar.setQuery('daily');
        check(sidebar.selected === ideias, 'escondida pela busca continua selecionada');
        e = emits(() => list.remove(list.getIndex(ideias.file)));
        check(e.length === 1 && e[0] === null && sidebar.selected === null,
            'remover a selecionada escondida → nenhuma, uma emissão');
        sidebar.setQuery('');
        list.append(ideias);
        sidebar.select(daily);
        e = emits(() => list.remove(list.getIndex(ideias.file)));
        check(e.length === 0 && sidebar.selected === daily, 'remover outra não mexe na seleção');
        e = emits(() => list.remove(0));
        check(e.length === 1 && e[0] === null && sidebar.selected === null, 'lista vazia → nenhuma');
        check(sidebar._emptyLabel.label === 'Nenhuma gravação ainda' &&
            sidebar._listStack.visible_child_name === 'empty', 'lista vazia: aviso');
        // Itens removidos não reagem mais (ouvintes desligados).
        let threw = false;
        try {
            notas.name = 'Depois de removida';
        } catch (err) {
            threw = true;
        }
        check(!threw && sidebar._tracked.size === 0, 'item removido sem ouvintes');

        // Volta ao estado para a captura.
        list.append(daily);
        list.append(ideias);
        sidebar.select(daily);
        print(`devSnapshot: sidebarcheck: ${failures === 0 ? 'todas as verificações OK' : `${failures} falha(s)`}`);
        if (failures > 0)
            throw new Error(`${failures} verificação(ões) falharam`);
    });
    return { widget: sidebar, ready };
};

// Biblioteca da janela pronta: a varredura da pasta terminou (RecordingList.loaded) e
// cada gravação tem a duração conhecida. Resolve com os itens, na ordem da lista.
const libraryReady = list => new Promise(resolve => {
    const done = () => {
        const items = [];
        for (let i = 0; i < list.get_n_items(); i++)
            items.push(list.get_item(i));
        Promise.all(items.map(r => r.duration > 0
            ? Promise.resolve()
            : nextSignal(r, 'notify::duration'))).then(() => resolve(items));
    };
    if (list.loaded) {
        done();
        return;
    }
    const id = list.connect('notify::loaded', () => {
        list.disconnect(id);
        done();
    });
});

// Resolve quando o Playback conhece a duração da mídia carregada.
const durationKnown = playback => playback.duration > 0
    ? Promise.resolve()
    : nextSignal(playback, 'duration-changed', seconds => seconds > 0);

const sleep = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve();
    return GLib.SOURCE_REMOVE;
}));

// `promise` ou false depois de `ms` (uma verificação falha em vez de travar a captura).
const within = (promise, ms) => Promise.race([promise.then(() => true), sleep(ms).then(() => false)]);

const whenMapped = widget => widget.get_mapped() ? Promise.resolve() : nextSignal(widget, 'map');

// Seleciona a gravação na janela real e espera os blocos da transcrição, se houver.
// Já selecionada: nada muda (nenhum blocks-built viria).
const selectInWindow = (window, recording) => {
    const { loadTranscript } = imports.transcriptStore;
    if (window._sidebar.selected === recording)
        return Promise.resolve();
    const built = loadTranscript(recording.file)
        ? nextSignal(window._detailPane.view, 'blocks-built')
        : Promise.resolve();
    window.selectRecording(recording);
    return built;
};

// Janela principal real com a biblioteca das fixtures: --select N (gravação N da lista;
// carrega painel, transcrição e player), --tab, --at SEG (posiciona o player pausado;
// saída fakesink, nada toca), --query TEXTO (busca da sidebar), --empty 1 (esvazia só a
// lista em memória: nenhum arquivo é tocado). --state recorder é aplicado antes.
const windowComponent = (params, { window }) => {
    const ready = libraryReady(window._recordingList).then(async items => {
        if (params.empty)
            window._recordingList.remove_all();
        const n = params.empty ? 0 : params.select ?? 0;
        if (n > 0) {
            const recording = items[n - 1];
            if (!recording)
                throw new Error(`não há gravação ${n} nas fixtures (há ${items.length})`);
            await selectInWindow(window, recording);
        }
        if (params.tab)
            window._detailPane.tab = params.tab;
        if (params.query !== null)
            window._sidebar.setQuery(params.query);
        if (n > 0) {
            await durationKnown(window.playback);
            if (params.at > 0) {
                const positioned = nextSignal(window.playback, 'position-updated',
                    pos => Math.abs(pos - params.at) < 0.5);
                window.playback.seek(params.at);
                await positioned;
            }
        }
        // A captura mostra o estado em repouso (sem o anel de foco na busca).
        await whenMapped(window);
        window.set_focus(null);
        const minWidth = w => w.measure(Gtk.Orientation.HORIZONTAL, -1)[0];
        print(`devSnapshot: larguras mínimas: sidebar ${minWidth(window._sidebar)}, painel ` +
            `${minWidth(window._detailPane)}, player ${minWidth(window._playerBar)}, janela ${minWidth(window)}; ` +
            `breakpoint: ${window.current_breakpoint === window._narrowBreakpoint ? 'estreita'
                : window.current_breakpoint === window._mediumBreakpoint ? 'média' : 'nenhum'}`);
        print(`devSnapshot: janela: selecionada: ${window._sidebar.selected?.name ?? 'nenhuma'}; ` +
            `painel: ${window._detailPane._state}; recolhida: ${window._splitView.collapsed}`);
    });
    return { widget: window, ready };
};

// Verificação da janela inteira na cópia das fixtures (renomeia, manda para a lixeira do
// ambiente isolado e copia um arquivo: só isolada). Imprime PASS/FAIL por verificação;
// uma falha = sem PNG e saída ≠ 0. O Playback da janela usa fakesink: tocar não faz som.
// Nenhum microfone: a gravação "nova" é a cópia de uma fixture.
const windowCheckComponent = (params, { window }) => {
    assertSandboxed();
    const { RecordingsDir } = imports.application;
    const { Recording } = imports.recording;
    const { NOTHING_RECORDED_MESSAGE } = imports.recorderPipeline;
    const { WindowState } = imports.window;
    const { loadTranscript, saveTranscript, transcriptFileFor } = imports.transcriptStore;
    const { TranscribeError } = imports.transcriber;
    const { GONE_MESSAGE } = imports.transcriptionController;

    const list = window._recordingList;
    const sidebar = window._sidebar;
    const pane = window._detailPane;
    const bar = window._playerBar;
    const playback = window.playback;
    const split = window._splitView;
    let failures = 0;
    const check = (ok, what) => {
        print(`${ok ? 'PASS' : 'FAIL'} windowcheck: ${what}`);
        if (!ok)
            failures++;
    };
    const toasts = [];
    const addToast = window.addToast;
    window.addToast = title => {
        toasts.push(title);
        addToast.call(window, title);
    };
    const sameFile = (a, b) => Boolean(a && b && a.equal(b));
    // Cópia de uma fixture (com a transcrição dela, se `withTranscript`) já na lista.
    const copyFixture = (source, name, withTranscript) => {
        const file = RecordingsDir.get_child(name);
        source.file.copy(file, Gio.FileCopyFlags.NONE, null, null);
        if (withTranscript)
            saveTranscript(file, loadTranscript(source.file));
        const recording = new Recording(file);
        list.sortedInsert(recording);
        return recording;
    };
    const playing = () => within(nextSignal(playback, 'state-changed', p => p === true), 5000);
    const rowOf = r => sidebar._rowFor(r);

    // Esperas com limite: uma que não chega vira falha com mensagem, não uma captura travada.
    const withTimeout = (promise, ms, what) => Promise.race([promise,
        sleep(ms).then(() => {
            throw new Error(`tempo esgotado esperando ${what}`);
        })]);
    const select = recording => withTimeout(selectInWindow(window, recording), 10000,
        `a seleção de "${recording.name}"`);

    const ready = withTimeout(libraryReady(list), 20000, 'a biblioteca (varredura e durações)').then(async items => {
        await whenMapped(window);
        check(items.length === 4, `biblioteca com as 4 fixtures (${items.length})`);
        const [daily, ideias, notas, sem] = items;

        // 0. Partida: nada selecionado.
        check(sidebar.selected === null && pane._state === 'no-selection' && playback.uri === null &&
            !bar._playButton.sensitive, 'partida: sem seleção, painel "Selecione", player desligado');

        // 1. Cada fixture mostra o estado certo, com o player carregado e parado.
        for (const [recording, expected] of [[daily, 'ready'], [ideias, 'ready'], [notas, 'ready'],
            [sem, 'not-transcribed']]) {
            await select(recording);
            const viewFile = pane.view.recordingFile;
            check(sidebar.selected === recording && pane._state === expected &&
                playback.uri === recording.uri && !playback.playing && bar._recording === recording &&
                bar._playButton.sensitive &&
                (expected === 'ready' ? sameFile(viewFile, recording.file) : viewFile === null),
            `selecionar "${recording.name}": painel ${expected}, player carregado e parado`);
        }
        check(pane._costLabel.visible && pane._costLabel.label.startsWith('Custo estimado'),
            `sem transcrição: custo estimado no cartão ("${pane._costLabel.label}")`);

        // 2. Trocar de gravação com outra tocando: o áudio anterior para.
        await select(daily);
        await durationKnown(playback);
        let started = playing();
        playback.play();
        check(await started, 'daily tocando (fakesink, sem som)');
        await select(ideias);
        check(playback.uri === ideias.uri && !playback.playing, 'trocar de gravação: áudio anterior parado, a nova carregada parada');
        await sleep(400);
        check(playback.uri === ideias.uri && !playback.playing, 'depois de 400 ms continua parada (nada atrasado da mídia anterior)');

        // 3. Clique num bloco da transcrição: pula e toca.
        await select(daily);
        await durationKnown(playback);
        // Recolhida, o painel só aparece (e realça) depois de aberto.
        if (split.collapsed)
            split.show_content = true;
        started = playing();
        pane.view.emit('seek-requested', 34);
        check(await started, 'seek-requested da transcrição põe para tocar');
        check(playback.uri === daily.uri && playback.position >= 33.5, `seek-requested pula para 00:34 (${playback.position.toFixed(1)} s)`);
        playback.pause();
        check(pane.view._currentIndex >= 0, `bloco atual realçado (${pane.view._currentIndex})`);
        split.show_content = false;

        // 4. Renomear a selecionada (com o player posicionado): segue a gravação.
        await select(ideias);
        await durationKnown(playback);
        playback.seek(3);
        const oldUri = ideias.uri;
        check(window._renameRecording(ideias, 'Ideias renomeadas') && ideias.name === 'Ideias renomeadas',
            'renomear a selecionada');
        check(ideias.uri !== oldUri && playback.uri === ideias.uri && sidebar.selected === ideias &&
            sameFile(pane.view.recordingFile, ideias.file) && pane._titleLabel.label === 'Ideias renomeadas' &&
            bar._recording === ideias && !playback.playing,
        'renomear: player na URI nova, visão no arquivo novo, seleção e título mantidos, parado');
        await durationKnown(playback);
        await sleep(300);
        check(Math.abs(playback.position - 3) < 0.6 && !playback.playing,
            `renomear: posição mantida, pausado (${playback.position.toFixed(2)} s)`);
        const before = toasts.length;
        check(!window._renameRecording(ideias, 'x.transcript.json') && ideias.name === 'Ideias renomeadas' &&
            toasts.length === before + 1, 'nome terminado em .transcript.json recusado com aviso');

        // 5. A selecionada sai da lista (só em memória): a vizinha é selecionada e carregada.
        await select(notas);
        started = playing();
        playback.play();
        await started;
        const index = list.getIndex(notas.file);
        list.remove(index);
        check(sidebar.selected === sem && playback.uri === sem.uri && !playback.playing &&
            pane._state === 'not-transcribed' && bar._recording === sem,
        'remover a selecionada (tocando): vizinha selecionada, áudio anterior parado');
        list.insert(index, notas);

        // 6. Excluir com Desfazer (Review Focus 1 e 2). A = notas (selecionada, tocando),
        // B = sem (excluída logo depois, pela tecla Delete).
        const queue = window._deleteQueue;
        // Ação pelo caminho de um widget (o botão Desfazer do toast, o menu): o
        // Gio.ActionGroup da janela também tem activate_action (sem prefixo) e esconde este.
        const winAction = (name, param) => Gtk.Widget.prototype.activate_action.call(window, name, param);
        const trashedFile = name => Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_data_dir(),
            'Trash', 'files', name]));
        const lastId = () => Math.max(...window._deleteToasts.keys());
        await select(notas);
        await durationKnown(playback);
        started = playing();
        playback.play();
        await started;
        sidebar.emit('delete-requested', notas);
        const idA = lastId();
        const toastA = window._deleteToasts.get(idA)?.toast;
        check(list.getIndex(notas.file) < 0 && queue.has(notas) && notas.file.query_exists(null),
            'excluir A: sai da lista, fica na fila, arquivo ainda no lugar');
        check(sidebar.selected === sem && playback.uri === sem.uri && !playback.playing &&
            pane._state === 'not-transcribed' && pane._titleLabel.label === sem.name && bar._recording === sem,
        'excluir a selecionada (tocando): vizinha selecionada, player parado nela, painel definido');
        check(toastA?.title === '"Notas da reunião" excluída' && toastA.use_markup === false &&
            toastA.button_label === 'Desfazer' && toastA.action_name === 'win.undo-delete' &&
            toastA.action_target.unpack() === idA && toastA.timeout === 8,
        `toast de A: "${toastA?.title}", sem markup, Desfazer → win.undo-delete(${idA}), 8 s`);
        let gone = null;
        try {
            window.transcriptionService._save(notas.file, {});
        } catch (err) {
            gone = err.kind;
        }
        check(gone === 'recordingGone',
            'transcrição que termina com a gravação na fila de exclusão não é salva (recordingGone)');
        sidebar._list.get_selected_row()?.grab_focus();
        check(window.handleShortcutKey(Gdk.KEY_Delete, 0), 'tecla Delete com o foco na lista exclui a selecionada');
        const idB = lastId();
        check(idB !== idA && queue.has(sem) && list.getIndex(sem.file) < 0 && sidebar.selected === ideias &&
            playback.uri === ideias.uri, 'excluir B logo depois: id próprio, vizinha (nova última) selecionada');
        check(window._deleteToasts.get(idB)?.toast.title === '"Sem transcrição" excluída', 'toast de B com o nome de B');
        winAction('win.undo-delete', new GLib.Variant('i', idA));
        check(list.getIndex(notas.file) === 2 && !queue.has(notas) && sidebar.selected === notas &&
            playback.uri === notas.uri && pane._titleLabel.label === notas.name,
        `Desfazer A: só A volta (na posição por data) e é selecionada (índice ${list.getIndex(notas.file)}, ` +
        `selecionada ${sidebar.selected?.name}, player ${playback.uri === notas.uri}, título ${pane._titleLabel.label})`);
        check(queue.has(sem) && list.getIndex(sem.file) < 0 && sem.file.query_exists(null),
            'Desfazer A não mexe em B (continua pendente)');
        check(transcriptFileFor(notas.file).query_exists(null) && !trashedFile('Notas da reunião.transcript.json').query_exists(null),
            'Desfazer A: a transcrição de A continua no lugar');
        window._deleteToasts.get(idB).toast.dismiss();
        for (let i = 0; i < 20 && sem.file.query_exists(null); i++)
            await sleep(100);
        await sleep(200);
        check(!sem.file.query_exists(null) && trashedFile('Sem transcrição').query_exists(null) &&
            !queue.has(sem) && list.getIndex(notas.file) === 2 && notas.file.query_exists(null),
        'toast de B some sem Desfazer: B na lixeira isolada, A presente');
        const nBefore = toasts.length;
        winAction('win.undo-delete', new GLib.Variant('i', idB));
        check(list.getIndex(sem.file) < 0 && toasts.length === nBefore,
            'Desfazer depois de confirmada: nada (sem erro nem aviso)');
        await sleep(300);
        check(!trashedFile('Notas da reunião').query_exists(null) && notas.file.query_exists(null),
            'o toast de A, dispensado pelo Desfazer, não manda A para a lixeira');

        // 6b. Atalhos de teclado (Review Focus 5). Sem Gdk.KeyEvent no GJS: a tecla entra por
        // handleShortcutKey (o mesmo caminho do controlador de teclas), com o foco real.
        await select(daily);
        await durationKnown(playback);
        sidebar._searchEntry.grab_focus();
        check(!window.handleShortcutKey(Gdk.KEY_space, 0) && !window.handleShortcutKey(Gdk.KEY_b, 0) &&
            !window.handleShortcutKey(Gdk.KEY_Delete, 0) && !window.handleShortcutKey(Gdk.KEY_F2, 0) &&
            !playback.playing && list.getIndex(daily.file) === 0 && window._renameDialog === null,
        'digitando na busca: espaço, B, Delete e F2 seguem para o campo (nada toca, nada é excluído)');
        bar._playButton.grab_focus();
        check(!window.handleShortcutKey(Gdk.KEY_space, 0), 'espaço com um botão focado fica para o botão');
        rowOf(daily).grab_focus();
        check(!window.handleShortcutKey(Gdk.KEY_space, 0, { inPopover: true }), 'tecla vinda de um popover: ignorada');
        check(!window.handleShortcutKey(Gdk.KEY_B, Gdk.ModifierType.SHIFT_MASK), 'Shift+B não é B');
        started = playing();
        check(window.handleShortcutKey(Gdk.KEY_space, 0), 'espaço com o foco na lista: tratado');
        check(await started, 'espaço toca a selecionada');
        const paused = within(nextSignal(playback, 'state-changed', p => p === false), 3000);
        playback.pause();
        await paused;
        const at30 = nextSignal(playback, 'position-updated', pos => Math.abs(pos - 30) < 0.5);
        playback.seek(30);
        await within(at30, 3000);
        await sleep(300);
        window.handleShortcutKey(Gdk.KEY_n, 0);
        check(Math.abs(playback.position - 40) < 0.6, `N avança 10 s (${playback.position.toFixed(1)} s)`);
        window.handleShortcutKey(Gdk.KEY_B, 0);  // Caps Lock: B maiúsculo sem Shift
        window.handleShortcutKey(Gdk.KEY_b, 0);
        check(Math.abs(playback.position - 20) < 0.6, `B volta 10 s, duas vezes (${playback.position.toFixed(1)} s)`);
        started = playing();
        const enabled = window.lookup_action('play-pause').enabled;
        winAction('win.play-pause', null);
        check(await started, `win.play-pause toca (ligada: ${enabled}, tocando: ${playback.playing})`);
        const pausedAgain = within(nextSignal(playback, 'state-changed', p => p === false), 3000);
        winAction('win.play-pause', null);
        check(await pausedAgain && !playback.playing, 'win.play-pause pausa');
        const exported = [];
        const exportAudio = window._exportAudio;
        window._exportAudio = r => exported.push(r);
        sidebar._searchEntry.grab_focus();
        check(window.handleShortcutKey(Gdk.KEY_s, Gdk.ModifierType.CONTROL_MASK) && exported[0] === daily,
            'Ctrl+S (mesmo na busca) exporta a selecionada pelo mesmo caminho do botão e do menu');
        window._exportAudio = exportAudio;
        rowOf(daily).grab_focus();
        window.state = WindowState.RECORDER;
        check(!window.handleShortcutKey(Gdk.KEY_space, 0) && !window.handleShortcutKey(Gdk.KEY_Delete, 0) &&
            ['play-pause', 'seek-backward', 'seek-forward', 'rename', 'delete', 'export-audio']
                .every(a => !window.lookup_action(a).enabled) && list.getIndex(daily.file) === 0 && !playback.playing,
        'tela de gravação: ações win.* desligadas e as teclas ficam para o gravador');
        window.state = WindowState.BROWSE;
        check(window.lookup_action('delete').enabled, 'de volta à lista: ações ligadas');

        // 6c. Renomear pelo F2: diálogo com validação; transcrição que começa com ele aberto
        // bloqueia; nome repetido avisa sem exceção.
        rowOf(daily).grab_focus();
        check(window.handleShortcutKey(Gdk.KEY_F2, 0) && window._renameDialog?.recording === daily,
            'F2 abre o diálogo de renomear da selecionada');
        const dlg = window._renameDialog.dialog;
        const entry = dlg.get_extra_child();
        check(entry.text === daily.name && dlg.get_response_enabled('rename') && dlg.body_use_markup === false,
            'diálogo pré-preenchido com o nome, Renomear ligado, sem markup');
        entry.text = 'x.transcript.json';
        check(!dlg.get_response_enabled('rename') && dlg.body.includes('.transcript.json'), 'nome inválido: aviso no diálogo, Renomear desligado');
        entry.text = '   ';
        check(!dlg.get_response_enabled('rename'), 'nome vazio: Renomear desligado');
        entry.text = 'Daily renomeada';
        const service = window.transcriptionService;
        service._running.set(daily.uri, new Promise(() => {}));
        window._onTranscriptionChanged(daily.uri, 'running');
        check(!dlg.get_response_enabled('rename') && dlg.body === 'Aguarde a transcrição terminar para renomear.' &&
            !window.lookup_action('rename').enabled, 'transcrição começou com o diálogo aberto: Renomear desligado');
        const nToasts = toasts.length;
        dlg.response('rename');
        check(daily.name === 'Daily · Projeto Atlas' && toasts[nToasts] === 'Aguarde a transcrição terminar para renomear.',
            'confirmar mesmo assim: recusado com aviso');
        dlg.close();
        winAction('win.rename', null);
        check(window._renameDialog === null, 'win.rename durante a transcrição: nenhum diálogo');
        service._running.delete(daily.uri);
        window._onTranscriptionChanged(daily.uri, 'none');
        check(window.lookup_action('rename').enabled, 'transcrição terminou: renomear ligado de novo');
        check(!window._renameRecording(daily, notas.name) && daily.name === 'Daily · Projeto Atlas' &&
            toasts[toasts.length - 1] === 'Já existe uma gravação com esse nome.', 'nome de outra gravação: aviso, sem exceção');
        check(!window._renameRecording(daily, daily.name) && !window._renameRecording(daily, '  '),
            'nome igual ou vazio: nada');
        winAction('win.rename', null);
        const dlg2 = window._renameDialog?.dialog;
        dlg2.get_extra_child().text = 'Daily renomeada';
        dlg2.response('rename');
        dlg2.close();
        check(daily.name === 'Daily renomeada' && sidebar.selected === daily && rowOf(daily)._title.label === 'Daily renomeada' &&
            pane._titleLabel.label === 'Daily renomeada' && playback.uri === daily.uri,
        'renomear pelo diálogo: seleção, item da sidebar, título do painel e player seguem');
        daily.name = 'Daily · Projeto Atlas';
        await select(ideias);

        // 6d. Transcrição em andamento: excluir é recusado (o resultado pago se perderia
        // mesmo com Desfazer); terminada, excluir volta a funcionar.
        const busy = 'Aguarde a transcrição terminar para excluir.';
        service._running.set(ideias.uri, new Promise(() => {}));
        window._onTranscriptionChanged(ideias.uri, 'running');
        rowOf(ideias).grab_focus();
        let nt = toasts.length;
        window.handleShortcutKey(Gdk.KEY_Delete, 0);
        check(list.getIndex(ideias.file) >= 0 && queue.pending().length === 0 && toasts[nt] === busy,
            'transcrevendo: Delete recusado (continua na lista, fila vazia, aviso)');
        const ideiasTarget = new GLib.Variant('s', ideias.uri);
        nt = toasts.length;
        sidebar.activate_action('sidebar.delete', ideiasTarget);
        check(list.getIndex(ideias.file) >= 0 && queue.pending().length === 0 && toasts[nt] === busy,
            'transcrevendo: Excluir do menu ⋮ (aberto antes) recusado na hora do clique, com aviso');
        nt = toasts.length;
        sidebar.emit('delete-requested', ideias);
        check(list.getIndex(ideias.file) >= 0 && queue.pending().length === 0 && toasts[nt] === busy,
            'transcrevendo: a janela confere de novo o pedido de exclusão');
        const ideiasMenu = rowOf(ideias).menuButton;
        ideiasMenu.popup();
        const dangerSection = ideiasMenu.menu_model.get_item_link(1, 'section');
        check(dangerSection.get_item_attribute_value(0, 'action', null).get_string()[0] === 'sidebar.busy',
            'transcrevendo: Excluir desligado no menu ⋮');
        ideiasMenu.popdown();
        service._running.delete(ideias.uri);
        window._onTranscriptionChanged(ideias.uri, 'none');
        window.handleShortcutKey(Gdk.KEY_Delete, 0);
        const idIdeias = lastId();
        check(queue.has(ideias) && list.getIndex(ideias.file) < 0, 'transcrição terminou: excluir funciona');
        winAction('win.undo-delete', new GLib.Variant('i', idIdeias));
        check(list.getIndex(ideias.file) >= 0 && !queue.has(ideias), 'e o Desfazer devolve a gravação');

        // 6e. Confirmar a exclusão: áudio e transcrição na lixeira. Lixeira impossível
        // (pasta sem escrita): nada é tocado, aviso e a gravação volta para a lista.
        const waitFor = async (pred, ms = 3000) => {
            for (let t = 0; t < ms && !pred(); t += 50)
                await sleep(50);
            return pred();
        };
        const withSidecar = copyFixture(daily, 'Cópia com transcrição', true);
        sidebar.emit('delete-requested', withSidecar);
        const idSidecar = lastId();
        const committed = new Promise(resolve => {
            const commit = window._commitDelete.bind(window);
            window._commitDelete = id => {
                const result = commit(id);
                if (id === idSidecar) {
                    window._commitDelete = commit;
                    resolve(result);
                }
                return result;
            };
        });
        window._deleteToasts.get(idSidecar).toast.dismiss();
        check(await within(committed.then(r => r), 3000) && await committed === true &&
            !withSidecar.file.query_exists(null) && !transcriptFileFor(withSidecar.file).query_exists(null) &&
            trashedFile('Cópia com transcrição').query_exists(null) &&
            trashedFile('Cópia com transcrição.transcript.json').query_exists(null),
        'confirmada: áudio e transcrição na lixeira isolada');

        const stuck = copyFixture(daily, 'Cópia sem lixeira', true);
        const mode = (file, value) => file.set_attribute_uint32('unix::mode', value,
            Gio.FileQueryInfoFlags.NONE, null);
        sidebar.emit('delete-requested', stuck);
        const idStuck = lastId();
        nt = toasts.length;
        mode(RecordingsDir, 0o555);
        try {
            window._deleteToasts.get(idStuck).toast.dismiss();
            await waitFor(() => toasts.length > nt);
        } finally {
            mode(RecordingsDir, 0o755);
        }
        check(toasts[nt] === 'Não foi possível mover a gravação para a lixeira.' &&
            list.getIndex(stuck.file) >= 0 && !queue.has(stuck) && rowOf(stuck) !== null,
        'lixeira falhou: aviso e a gravação volta para a lista (e para a sidebar)');
        check(stuck.file.query_exists(null) && transcriptFileFor(stuck.file).query_exists(null) &&
            loadTranscript(stuck.file) !== null && !trashedFile('Cópia sem lixeira').query_exists(null) &&
            !trashedFile('Cópia sem lixeira.transcript.json').query_exists(null),
        'lixeira falhou: áudio e transcrição intactos no lugar, nada apagado');
        sidebar.emit('delete-requested', stuck);
        const idStuck2 = lastId();
        window._deleteToasts.get(idStuck2).toast.dismiss();
        check(await waitFor(() => trashedFile('Cópia sem lixeira').query_exists(null) &&
            trashedFile('Cópia sem lixeira.transcript.json').query_exists(null)) && list.getIndex(stuck.file) < 0,
        'com a pasta liberada, excluir de novo vai para a lixeira');
        await select(daily);

        // 6f. Transcrição paga que não foi salva (o disco falhou) e "Tentar de novo" de uma
        // gravação que saiu da lista (esperando o Desfazer). Tudo com fakes no serviço: nenhuma
        // chamada à API, nenhuma chave real (a variável de ambiente é só deste processo).
        const ctl = window._transcription;
        const original = {
            transcribe: service._transcribe, save: service._save, getKey: service._getKey,
            showToast: ctl._showToast, openPreferences: ctl._openPreferences,
        };
        let transcribeCalls = 0;
        let saveCalls = 0;
        let saveFails = false;
        let prefsOpened = 0;
        const ctlToasts = [];
        service._transcribe = async () => {
            transcribeCalls++;
            return { text: 'olá', language: 'por', duration: 3, words: [] };
        };
        service._getKey = () => ({ key: 'sk-windowcheck-fake', source: 'env' });
        service._save = (file, transcript) => {
            if (saveFails)
                throw new TranscribeError('saveFailed', 0, 'Falha simulada do disco.');
            original.save(file, transcript);
            saveCalls++;
        };
        ctl._showToast = toast => {
            ctlToasts.push(toast);
            original.showToast(toast);
        };
        ctl._openPreferences = () => prefsOpened++;
        GLib.setenv('DAILY_TAKER_OP_KEY', 'sk-windowcheck-fake', true);
        const costDialogs = () => Gtk.Window.list_toplevels().filter(w => w instanceof Adw.MessageDialog);
        const trashAll = async recordings => {
            for (const r of recordings) {
                sidebar.emit('delete-requested', r);
                window._deleteToasts.get(lastId()).toast.dismiss();
                await waitFor(() => !r.file.query_exists(null));
            }
        };
        const created = [];
        const retryToastOf = () => ctlToasts[ctlToasts.length - 1];
        try {
            // Parte C: com a transcrição paga só na memória, excluir é recusado.
            const unsaved = copyFixture(daily, 'Cópia com transcrição não salva', false);
            created.push(unsaved);
            await waitFor(() => unsaved.duration > 0);
            saveFails = true;
            ctl._run(unsaved, {});
            check(await waitFor(() => service.status(unsaved.file) === 'error' && service.hasUnsaved(unsaved.file)) &&
                transcribeCalls === 1 && !transcriptFileFor(unsaved.file).query_exists(null),
            'falha ao salvar: transcrição paga retida em memória, nada no disco, uma chamada à API');
            const failToast = retryToastOf();
            check(failToast?.button_label === 'Tentar de novo' && failToast.use_markup === false &&
                failToast.title.includes('só salva'),
            `toast da falha: "Tentar de novo" com o plano só-salvar (${failToast?.title})`);
            await select(unsaved);
            const unsavedMessage = 'Há uma transcrição paga que ainda não foi salva. ' +
                'Toque em Tentar de novo antes de excluir.';
            const refused = () => list.getIndex(unsaved.file) >= 0 && queue.pending().length === 0 &&
                service.hasUnsaved(unsaved.file);
            rowOf(unsaved).grab_focus();
            nt = toasts.length;
            window.handleShortcutKey(Gdk.KEY_Delete, 0);
            check(refused() && toasts[nt] === unsavedMessage && toasts.length === nt + 1,
                'transcrição não salva: Delete recusado (continua na lista, fila vazia, aviso)');
            nt = toasts.length;
            winAction('win.delete', null);
            check(refused() && toasts[nt] === unsavedMessage, 'transcrição não salva: win.delete recusado com aviso');
            nt = toasts.length;
            sidebar.activate_action('sidebar.delete', new GLib.Variant('s', unsaved.uri));
            check(refused() && toasts[nt] === unsavedMessage,
                'transcrição não salva: Excluir do menu ⋮ recusado na hora do clique, com aviso');
            nt = toasts.length;
            sidebar.emit('delete-requested', unsaved);
            check(refused() && toasts[nt] === unsavedMessage, 'transcrição não salva: a janela confere de novo o pedido');
            const unsavedMenu = rowOf(unsaved).menuButton;
            unsavedMenu.popup();
            check(unsavedMenu.menu_model.get_item_link(1, 'section').get_item_attribute_value(0, 'action', null)
                .get_string()[0] === 'sidebar.busy', 'transcrição não salva: Excluir desligado no menu ⋮');
            unsavedMenu.popdown();

            // Parte B (defesa em profundidade; pela interface a Parte C já impede esta fila): a
            // gravação sai da lista com a transcrição retida e o "Tentar de novo" do toast é clicado.
            const index = list.getIndex(unsaved.file);
            list.remove(index);
            const idUnsaved = queue.add(unsaved, index);
            check(window._indexOf(unsaved) < 0 && queue.has(unsaved), 'gravação com transcrição retida fora da lista (pendente)');
            // O disco já não falha: o que impede salvar é só a guarda da gravação pendente
            // (recordingGone), o caminho que descartava a transcrição paga.
            saveFails = false;
            const before = { calls: transcribeCalls, saves: saveCalls, toasts: ctlToasts.length };
            failToast.emit('button-clicked');
            await sleep(200);  // o salvar (se rodasse) é assíncrono
            check(transcribeCalls === before.calls && saveCalls === before.saves && service.hasUnsaved(unsaved.file) &&
                !transcriptFileFor(unsaved.file).query_exists(null) && ctlToasts.length === before.toasts + 1 &&
                ctlToasts[ctlToasts.length - 1].title === GONE_MESSAGE && ctl.failureMessage(unsaved) !== '',
            'Tentar de novo com a gravação pendente: nada salvo, nada descartado (ainda retida), sem API, ' +
                'aviso e plano da falha mantido');
            ctl.retry(unsaved, {});
            ctl.request(unsaved, {});
            await sleep(200);
            check(transcribeCalls === before.calls && saveCalls === before.saves && service.hasUnsaved(unsaved.file) &&
                costDialogs().length === 0 && prefsOpened === 0,
            'retry()/request() com a gravação pendente: nenhuma chamada, nenhum diálogo, transcrição ainda retida');
            // Desfazer e Tentar de novo: salva a mesma transcrição, sem cobrar de novo.
            window._undoDelete(idUnsaved);
            ctl.retry(unsaved, {});
            check(await waitFor(() => !service.hasUnsaved(unsaved.file) && service.status(unsaved.file) === 'none') &&
                saveCalls === 1 && transcribeCalls === 1 && loadTranscript(unsaved.file)?.text === 'olá' &&
                list.getIndex(unsaved.file) >= 0,
            'Desfazer + Tentar de novo: a transcrição retida é salva, com UMA única chamada à API no total');
            check(ctl.failureMessage(unsaved) === '', 'depois de salvar, a falha some do painel');

            // Parte C: salva, excluir volta a funcionar.
            sidebar.emit('delete-requested', unsaved);
            check(queue.has(unsaved) && list.getIndex(unsaved.file) < 0, 'transcrição salva: excluir funciona');
            window._undoDelete(lastId());
            // Descartada (o usuário desiste): também libera a exclusão.
            const discarded = copyFixture(daily, 'Cópia com transcrição descartada', false);
            created.push(discarded);
            await waitFor(() => discarded.duration > 0);
            saveFails = true;
            ctl._run(discarded, {});
            await waitFor(() => service.hasUnsaved(discarded.file));
            sidebar.emit('delete-requested', discarded);
            check(list.getIndex(discarded.file) >= 0 && !queue.has(discarded), 'outra gravação com transcrição retida: excluir recusado');
            saveFails = false;
            service.discardUnsaved(discarded.file);
            sidebar.emit('delete-requested', discarded);
            check(queue.has(discarded) && list.getIndex(discarded.file) < 0, 'transcrição descartada: excluir funciona');
            window._undoDelete(lastId());

            // Parte B, plano 'transcribe': falha sem chave (nenhuma chamada à API), a gravação
            // é excluída (pendente) e o "Tentar de novo" é clicado: nenhuma execução começa.
            const again = copyFixture(daily, 'Cópia para tentar de novo', false);
            created.push(again);
            await waitFor(() => again.duration > 0);
            service._getKey = () => null;
            const callsBefore = transcribeCalls;
            ctl._run(again, {});
            await waitFor(() => service.status(again.file) === 'error');
            service._getKey = () => ({ key: 'sk-windowcheck-fake', source: 'env' });
            const transcribeToast = retryToastOf();
            check(transcribeCalls === callsBefore && transcribeToast.button_label === 'Tentar de novo' &&
                !service.hasUnsaved(again.file), 'falha sem chave: plano transcrever (toast com Tentar de novo), sem API');
            sidebar.emit('delete-requested', again);
            const idAgain = lastId();
            check(queue.has(again) && window._indexOf(again) < 0, 'gravação com falha excluída (pendente)');
            const toastsBefore = ctlToasts.length;
            transcribeToast.emit('button-clicked');
            ctl.retry(again, {});
            ctl.request(again, { regenerate: true });
            const stray = costDialogs();
            for (const dialog of stray)
                dialog.response('transcribe');
            await sleep(300);
            check(stray.length === 0 && transcribeCalls === callsBefore && prefsOpened === 0 &&
                service.status(again.file) === 'error' && ctlToasts.length === toastsBefore + 3 &&
                ctlToasts.slice(toastsBefore).every(t => t.title === GONE_MESSAGE),
            `Tentar de novo (toast, retry, request) com a gravação pendente: nenhuma execução, nenhum diálogo, ` +
                `nenhuma chamada à API (${transcribeCalls - callsBefore}), aviso em cada um`);
            // Controle: de volta à lista o mesmo pedido segue o fluxo normal (diálogo de custo).
            winAction('win.undo-delete', new GLib.Variant('i', idAgain));
            ctl.retry(again, {});
            const dialogs = costDialogs();
            check(list.getIndex(again.file) >= 0 && dialogs.length === 1 && transcribeCalls === callsBefore,
                'de volta à lista, Tentar de novo abre o diálogo de custo (nada cobrado antes de confirmar)');
            for (const dialog of dialogs) {
                dialog.response('cancel');
                dialog.close();
            }
            await sleep(100);
            check(transcribeCalls === callsBefore && service.status(again.file) === 'error',
                'cancelar o diálogo: nenhuma chamada à API');
        } finally {
            service._transcribe = original.transcribe;
            service._save = original.save;
            service._getKey = original.getKey;
            ctl._showToast = original.showToast;
            ctl._openPreferences = original.openPreferences;
            GLib.unsetenv('DAILY_TAKER_OP_KEY');
        }
        await trashAll(created);

        // 7. Gravador: começar para o player; parar insere, seleciona e deixa parado.
        await select(daily);
        await durationKnown(playback);
        started = playing();
        playback.play();
        await started;
        window.onRecorderStarted();
        check(window.state === WindowState.RECORDER && !playback.playing, 'começar a gravar para o player');
        const copy = RecordingsDir.get_child('Gravação de teste');
        daily.file.copy(copy, Gio.FileCopyFlags.NONE, null, null);
        const fresh = new Recording(copy);
        window.onRecorderStopped(fresh);
        let count = 0;
        for (let i = 0; i < list.get_n_items(); i++)
            count += list.get_item(i).uri === fresh.uri ? 1 : 0;
        check(window.state === WindowState.BROWSE && list.get_item(0) === fresh && count === 1 &&
            sidebar.selected === fresh && playback.uri === fresh.uri && !playback.playing &&
            pane._state === 'not-transcribed',
        'parar: gravação nova no topo (uma vez), selecionada, player nela e parado');
        window.onRecorderStarted();
        window.onRecorderStopped(null);
        check(window.state === WindowState.BROWSE && toasts.includes(NOTHING_RECORDED_MESSAGE) &&
            sidebar.selected === fresh, 'parar sem nada gravado: aviso e volta à lista com a seleção');
        window.onRecorderStarted();
        window.recorderWidget.emit('canceled');
        window.recorderWidget.emit('failed', 'Falha simulada do gravador');
        check(window.state === WindowState.BROWSE && toasts.includes('Falha simulada do gravador') &&
            sidebar.selected === fresh && playback.uri === fresh.uri,
        'falha do gravador: aviso, volta à lista, seleção mantida');

        // 8. Janela estreita: recolher/expandir mantém a seleção; escolher abre o painel.
        const width = window.get_width();
        check(split.collapsed === width < 720, `breakpoint: largura ${width} → recolhida ${split.collapsed}`);
        const wasCollapsed = split.collapsed;
        split.collapsed = true;
        split.show_content = false;
        check(sidebar.selected === fresh && !window._backButton.visible, 'recolhida: lista visível, seleção mantida, sem Voltar');
        await select(daily);
        sidebar._list.emit('row-activated', rowOf(daily));
        check(split.show_content && window._backButton.visible && pane._titleLabel.label === daily.name,
            'recolhida: escolher abre o painel com Voltar');
        window._backButton.emit('clicked');
        check(!split.show_content && sidebar.selected === daily && pane._titleLabel.label === daily.name &&
            playback.uri === daily.uri, 'Voltar: lista de novo, seleção e player mantidos');
        split.collapsed = wasCollapsed;
        check(sidebar.selected === daily && window._backButton.visible === false,
            'voltar ao tamanho original mantém a seleção');

        // 9. Biblioteca vazia (só em memória): painel "Nenhuma gravação ainda", player desligado.
        const all = [];
        for (let i = 0; i < list.get_n_items(); i++)
            all.push(list.get_item(i));
        list.remove_all();
        check(pane._mainStack.visible_child_name === 'empty-library' && sidebar.selected === null &&
            playback.uri === null && !bar._playButton.sensitive, 'lista vazia: painel da biblioteca vazia, player desligado');
        list.splice(0, 0, all);
        check(pane._mainStack.visible_child_name === 'no-selection', 'lista de volta: "Selecione uma gravação"');

        // 10. Fechar a janela com DUAS exclusões pendentes: cada uma vai para a lixeira uma
        // vez, na ordem em que foram feitas, antes de sair (conferido no shutdown real,
        // chamado pelo close() do fim da captura).
        const second = copyFixture(daily, 'Gravação de teste 2', true);
        // Duração lida antes de excluir (o Discoverer dela termina antes do fechamento).
        const trashOrder = [];
        for (const r of [fresh, second]) {
            const original = r.delete.bind(r);
            r.delete = opts => {
                trashOrder.push(r.name);
                return original(opts);
            };
        }
        sidebar.emit('delete-requested', fresh);
        sidebar.emit('delete-requested', second);
        check(queue.has(fresh) && queue.has(second) && fresh.file.query_exists(null) && second.file.query_exists(null),
            'duas exclusões pendentes antes de fechar');
        const shutdown = window.shutdown;
        window.shutdown = function () {
            const pending = queue.has(fresh) && queue.has(second);
            shutdown.call(this);
            const ok = pending && !queue.has(fresh) && !queue.has(second) &&
                trashOrder.join('|') === 'Gravação de teste|Gravação de teste 2' &&
                !fresh.file.query_exists(null) && !second.file.query_exists(null) &&
                trashedFile('Gravação de teste').query_exists(null) && trashedFile('Gravação de teste 2').query_exists(null) &&
                trashedFile('Gravação de teste 2.transcript.json').query_exists(null) && queue.commitAll().length === 0;
            print(`${ok ? 'PASS' : 'FAIL'} windowcheck: fechar a janela manda as duas exclusões pendentes para a ` +
                `lixeira, uma vez cada, em ordem (${trashOrder.join(' → ')})`);
            let again = true;
            try {
                window._commitPendingDeletes();
                shutdown.call(this);
            } catch (err) {
                again = false;
            }
            print(`${again ? 'PASS' : 'FAIL'} windowcheck: fechar de novo / fila vazia não lança`);
        };

        // Captura: daily no 00:34.
        await select(daily);
        await durationKnown(playback);
        playback.seek(34);
        await whenMapped(window);
        window.set_focus(null);
        print(`devSnapshot: windowcheck: ${failures === 0 ? 'todas as verificações OK' : `${failures} falha(s)`}`);
        if (failures > 0)
            throw new Error(`${failures} verificação(ões) falharam`);
    });
    return { widget: window, ready };
};

// nome → (params, { app, window }) → Gtk.Widget ou { widget, ready?, cleanup? }. Se o
// widget for um Gtk.Window, ele é capturado como está; qualquer outro vai para uma janela
// simples do tamanho pedido. `ready` (Promise) adia a captura até o componente terminar
// de carregar (ex.: picos da onda); `cleanup` roda antes de sair.
var COMPONENTS = {
    window: windowComponent,
    windowcheck: windowCheckComponent,
    playerbar: playerBarComponent,
    transcriptview: transcriptViewComponent,
    detailpane: detailPaneComponent,
    detailpanecheck: detailPaneCheckComponent,
    sidebar: sidebarComponent,
    sidebarcheck: sidebarCheckComponent,
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

// --state com --component sidebar: status do serviço de transcrição da gravação 2.
var SIDEBAR_STATES = ['running', 'error'];

// Mensagem de erro para um --state inválido, ou null.
var stateError = params => {
    if (!params.state)
        return null;
    const available = {
        window: Object.keys(WINDOW_STATES),
        detailpane: PANE_STATES,
        sidebar: SIDEBAR_STATES,
    }[params.component];
    if (!available)
        return `--state só vale com --component window, detailpane ou sidebar (recebido "${params.component}")`;
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
        find: env('DAILY_TAKER_SNAPSHOT_FIND'),
        query: env('DAILY_TAKER_SNAPSHOT_QUERY'),
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

// Opções do Playback da janela: durante uma captura a saída é um fakesink (nunca abre um
// dispositivo de som, além das defesas do snapshot.sh); fora dela, {} (saída padrão).
var playbackOptions = () => env('DAILY_TAKER_SNAPSHOT')
    ? { audioSinkFactory: () => Gst.ElementFactory.make('fakesink', null) }
    : {};

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
    if (MUTATING_COMPONENTS.includes(params.component)) {
        try {
            assertSandboxed();
        } catch (e) {
            fail(`componente "${params.component}": ${e.message}`);
            return true;
        }
    }
    if (params.state && params.component === 'window')
        WINDOW_STATES[params.state](window);

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
            // A janela principal fecha (e o app sai) pelo caminho normal, que desmonta os
            // widgets antes de sair; um componente avulso fecha antes dela.
            if (target !== window) {
                target.destroy();
                target.run_dispose();
                window.shutdown();
            } else {
                window.close();
            }
            return GLib.SOURCE_REMOVE;
        });
    }).catch(e => {
        printerr(`devSnapshot: falhou: ${e.message}`);
        cleanup();
        // Sair de dentro de um job de Promise trava até o timeout do snapshot.sh: sai
        // do laço principal.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => imports.system.exit(3));
    });
    target.present();
    return true;
};
