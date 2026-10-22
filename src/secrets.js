const { GLib, Gio, Secret } = imports.gi;

const SCHEMA_NAME = 'dev.nicolas.DailyTaker';
const DEFAULT_PURPOSE = 'openrouter';
const ENV_VAR = 'DAILY_TAKER_OP_KEY';
const KEY_FILE_NAME = 'api-key';

// Normaliza qualquer valor lido: texto aparado, ou null se vazio/ausente.
const clean = v => {
    if (typeof v !== 'string')
        return null;
    const t = v.trim();
    return t === '' ? null : t;
};

// Guarda da chave da API. Ordem de leitura: secret (libsecret) > file > env.
// Nenhuma mensagem de erro, log ou toString/JSON inclui a chave.
var KeyStore = class KeyStore {
    constructor({ secret, file, env } = defaultBackends()) {
        this._secret = secret;
        this._file = file;
        this._env = env;
    }

    get() {
        const sources = [
            ['secret', () => this._secret.read()],
            ['file', () => this._file.read()],
            ['env', () => this._env()],
        ];
        for (const [source, read] of sources) {
            let key = null;
            try {
                key = clean(read());
            } catch (e) {
                // backend indisponível (ex.: sem keyring): tenta o próximo
            }
            if (key)
                return { key, source };
        }
        return null;
    }

    save(key) {
        const trimmed = clean(key);
        if (!trimmed)
            throw new Error('A chave da API está vazia');
        try {
            this._secret.write(trimmed);
        } catch (e) {
            this._file.write(trimmed);
        }
    }

    // Tenta limpar os dois. Um keyring indisponível é ignorado (nada legível
    // ficou lá); falha ao remover o arquivo é propagada.
    clear() {
        try {
            this._secret.clear();
        } catch (e) {
            // sem keyring: nada a limpar
        }
        this._file.clear();
    }

    toString() {
        return '[KeyStore]';
    }

    toJSON() {
        return {};
    }
};

var createSecretBackend = (purpose = DEFAULT_PURPOSE) => {
    const schema = new Secret.Schema(SCHEMA_NAME, Secret.SchemaFlags.NONE,
        { purpose: Secret.SchemaAttributeType.STRING });
    const attributes = { purpose };
    return {
        read: () => Secret.password_lookup_sync(schema, attributes, null),
        write(key) {
            const ok = Secret.password_store_sync(schema, attributes, Secret.COLLECTION_DEFAULT,
                'Daily Taker — chave da API', key, null);
            if (!ok)
                throw new Error('Não foi possível gravar a chave no keyring');
        },
        clear() {
            Secret.password_clear_sync(schema, attributes, null);
        },
    };
};

var defaultConfigDir = () => GLib.build_filenamev([GLib.get_user_config_dir(), 'daily-taker']);

var createFileBackend = (dirPath = defaultConfigDir()) => {
    const file = () => Gio.File.new_for_path(GLib.build_filenamev([dirPath, KEY_FILE_NAME]));
    return {
        read() {
            try {
                const [, bytes] = file().load_contents(null);
                return clean(new TextDecoder().decode(bytes));
            } catch (e) {
                if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    return null;
                throw e;
            }
        },
        write(key) {
            if (GLib.mkdir_with_parents(dirPath, 0o700) !== 0)
                throw new Error('Não foi possível criar o diretório de configuração');
            // Escrita atômica: temporário exclusivo criado já com 0600 + rename sobre o destino
            // (g_file_set_contents preservaria o modo frouxo de um arquivo pré-existente).
            const tmp = Gio.File.new_for_path(
                GLib.build_filenamev([dirPath, `.${KEY_FILE_NAME}.${GLib.uuid_string_random()}.tmp`]));
            try {
                const out = tmp.create(Gio.FileCreateFlags.PRIVATE, null);
                try {
                    out.write_all(new TextEncoder().encode(key), null);
                } finally {
                    out.close(null);
                }
                tmp.move(file(), Gio.FileCopyFlags.OVERWRITE, null, null);
            } catch (e) {
                try {
                    tmp.delete(null);
                } catch (e2) {
                    // temporário já não existe
                }
                throw e;
            }
        },
        clear() {
            try {
                file().delete(null);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    throw e;
            }
        },
    };
};

var envReader = () => GLib.getenv(ENV_VAR);

function defaultBackends({ purpose, configDir, env } = {}) {
    return {
        secret: createSecretBackend(purpose),
        file: createFileBackend(configDir),
        env: env || envReader,
    };
}

// As opções existem para os testes (outro `purpose`, outro diretório, outro env).
var defaultKeyStore = options => new KeyStore(defaultBackends(options));
