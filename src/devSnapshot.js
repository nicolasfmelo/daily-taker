/* exported COMPONENTS MUTATING_COMPONENTS PANE_STATES SIDEBAR_STATES WINDOW_STATES isSandboxed maybeSnapshot
   silencePlayback snapshotParams stateError */
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

// Componentes que alteram arquivos (renomeiam, reescrevem transcrições): só rodam no
// ambiente isolado do tools/snapshot.sh, conferido ANTES de qualquer alteração.
var MUTATING_COMPONENTS = ['detailpanecheck', 'sidebarcheck'];

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

// nome → (params, { app, window }) → Gtk.Widget ou { widget, ready?, cleanup? }. Se o
// widget for um Gtk.Window, ele é capturado como está; qualquer outro vai para uma janela
// simples do tamanho pedido. `ready` (Promise) adia a captura até o componente terminar
// de carregar (ex.: picos da onda); `cleanup` roda antes de sair.
var COMPONENTS = {
    window: (_params, ctx) => ctx.window,
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
        embedded: intOrNull(env('DAILY_TAKER_SNAPSHOT_EMBEDDED')),
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
        // Sair de dentro de um job de Promise trava até o timeout do snapshot.sh: sai
        // do laço principal.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => imports.system.exit(3));
    });
    target.present();
    return true;
};
