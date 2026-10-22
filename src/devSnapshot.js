/* exported COMPONENTS WINDOW_STATES maybeSnapshot silencePlayback snapshotParams stateError */
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

// Gravação mais recente da pasta de dados (a primeira da lista do app), ou null.
const newestRecordingFile = () => {
    const { RecordingsDir } = imports.application;
    const children = RecordingsDir.enumerate_children('standard::name,time::modified',
        Gio.FileQueryInfoFlags.NONE, null);
    let newest = null;
    let newestTime = -1;
    for (let info = children.next_file(null); info; info = children.next_file(null)) {
        const name = info.get_name();
        if (name.endsWith('.json') || name.startsWith('.'))
            continue;
        const time = info.get_attribute_uint64('time::modified');
        if (time > newestTime) {
            newest = RecordingsDir.get_child(name);
            newestTime = time;
        }
    }
    children.close(null);
    return newest;
};

// Barra do player sozinha, com a gravação mais recente das fixtures, pausada em --at
// (padrão 0). Saída de áudio = fakesink e nada é posto para tocar: nenhum som.
const playerBarComponent = params => {
    const { Playback } = imports.playback;
    const { PlayerBar } = imports.playerBar;
    const { Recording } = imports.recording;

    const file = newestRecordingFile();
    if (!file)
        throw new Error('nenhuma gravação nas fixtures');
    const settings = Gio.Settings.new_with_backend(pkg.name, Gio.memory_settings_backend_new());
    // Volume de exemplo, como na mockup (a saída é um fakesink: não sai som).
    settings.set_double('playback-volume', 0.6);

    const playback = new Playback({
        audioSinkFactory: () => Gst.ElementFactory.make('fakesink', null),
    });
    silencePlayback(playback);
    const bar = new PlayerBar({ settings });
    bar.bind(playback);

    const recording = new Recording(file);
    const peaks = nextSignal(recording, 'peaks-updated');
    const duration = nextSignal(playback, 'duration-changed', seconds => seconds > 0);
    bar.setRecording(recording);
    playback.load(recording.uri);

    const at = params.at ?? 0;
    const positioned = duration.then(() => {
        if (at <= 0)
            return null;
        const done = nextSignal(playback, 'position-updated', pos => Math.abs(pos - at) < 0.5);
        playback.seek(at);
        return done;
    });
    return {
        widget: bar,
        ready: Promise.all([peaks, positioned]),
        cleanup: () => playback.destroy(),
    };
};

// nome → (params, { app, window }) → Gtk.Widget ou { widget, ready?, cleanup? }. Se o
// widget for um Gtk.Window, ele é capturado como está; qualquer outro vai para uma janela
// simples do tamanho pedido. `ready` (Promise) adia a captura até o componente terminar
// de carregar (ex.: picos da onda); `cleanup` roda antes de sair. As próximas tarefas
// acrescentam transcriptview, detailpane e sidebar.
var COMPONENTS = {
    window: (_params, ctx) => ctx.window,
    playerbar: playerBarComponent,
};

// --state (só com --component window): página mostrada no lugar da lista. Só troca a
// página; nenhuma gravação começa e nenhum dispositivo de áudio é aberto.
var WINDOW_STATES = {
    recorder: window => {
        window.state = imports.window.WindowState.RECORDER;
    },
};

// Mensagem de erro para um --state inválido, ou null.
var stateError = params => {
    if (!params.state)
        return null;
    if (params.component !== 'window')
        return `--state só vale com --component window (recebido "${params.component}")`;
    if (!(params.state in WINDOW_STATES))
        return `estado desconhecido: "${params.state}" (disponíveis: ${Object.keys(WINDOW_STATES).join(', ')})`;
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
    if (params.state)
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
