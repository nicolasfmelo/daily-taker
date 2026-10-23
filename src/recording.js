/* exported Recording */
const { Gio, GLib, GObject, GstPbutils } = imports.gi;
const { CacheDir } = imports.application;
const ByteArray = imports.byteArray;
const Recorder = imports.recorder;
const { moveTranscript, transcriptFileFor } = imports.transcriptStore;
const { trashRecordingFiles, trashRecordingFilesSync } = imports.recordingTrash;
const { generatePeaks } = imports.peaksPipeline;

var Recording = new GObject.registerClass({
    Signals: {
        'peaks-updated': {},
        'peaks-loading': {},
    },
    Properties: {
        'duration': GObject.ParamSpec.int(
            'duration',
            'Recording Duration', 'Recording duration in nanoseconds',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0, GLib.MAXINT16, 0),
        'name': GObject.ParamSpec.string(
            'name',
            'Recording Name', 'Recording name in string',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            null),
    },
}, class Recording extends GObject.Object {
    _init(file) {
        this._file = file;
        this._peaks = [];
        super._init({});

        let info = file.query_info('time::created,time::modified,standard::content-type', 0, null);
        const contentType = info.get_attribute_string('standard::content-type');

        for (let profile of Recorder.EncodingProfiles) {
            if (profile.contentType === contentType) {
                this._extension = profile.extension;
                break;
            }
        }

        let timeModified = info.get_attribute_uint64('time::modified');
        let timeCreated = info.get_attribute_uint64('time::created');
        this._timeModified = GLib.DateTime.new_from_unix_local(timeModified);
        this._timeCreated = GLib.DateTime.new_from_unix_local(timeCreated);

        // Referência guardada até o fim: só com a do próprio sinal o GJS podia coletar o
        // Discoverer antes de 'discovered' (a duração ficava 0 até reabrir o app).
        const discoverer = new GstPbutils.Discoverer();
        this._discoverer = discoverer;
        const release = () => {
            if (this._discoverer !== discoverer)
                return;
            this._discoverer = null;
            discoverer.stop();
        };
        discoverer.connect('discovered', (_discoverer, audioInfo) => {
            this._duration = audioInfo.get_duration();
            this.notify('duration');
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                release();
                return GLib.SOURCE_REMOVE;
            });
        });
        discoverer.connect('finished', () => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            release();
            return GLib.SOURCE_REMOVE;
        }));
        discoverer.start();
        discoverer.discover_uri_async(this.uri);
    }

    get name() {
        return this._file.get_basename();
    }

    set name(filename) {
        if (filename && filename !== this.name) {
            const oldFile = this._file;
            this.transcriptMoveFailed = false;
            this._file = this._file.set_display_name(filename, null);
            try {
                moveTranscript(oldFile, this._file);
            } catch (e) {
                this.transcriptMoveFailed = true;
                log('Não foi possível mover o sidecar da transcrição; arquivo original preservado.');
            }
            this.notify('name');
        }
    }

    // Interrompe a leitura da duração em andamento (fechar o app no meio dela).
    cancelDiscovery() {
        const discoverer = this._discoverer;
        this._discoverer = null;
        discoverer?.stop();
    }

    get extension() {
        return this._extension;
    }

    get timeModified() {
        return this._timeModified;
    }

    get timeCreated() {
        return this._timeCreated;
    }

    get duration() {
        if (this._duration)
            return this._duration;
        else
            return 0;
    }

    get file() {
        return this._file;
    }

    get uri() {
        return this._file.get_uri();
    }

    // eslint-disable-next-line camelcase
    set peaks(data) {
        if (data.length > 0) {
            this._peaks = data;
            this.emit('peaks-updated');
            const buffer = new GLib.Bytes(JSON.stringify(data));
            this.waveformCache.replace_contents_bytes_async(buffer, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, (obj, res) => {
                obj.replace_contents_finish(res);
            });
        }
    }

    // eslint-disable-next-line camelcase
    get peaks() {
        return this._peaks;
    }

    // Manda a gravação para a lixeira do sistema (nunca apaga de vez): o áudio primeiro e,
    // só se ele foi, a transcrição e a forma de onda (recordingTrash.js). Devolve
    // Promise<boolean> (true = o áudio foi para a lixeira); com `sync` (fechar o app) espera
    // e devolve o boolean. Se false, nada foi tocado. `trash`/`trashAsync`: testes.
    delete({ sync = false, trash, trashAsync } = {}) {
        const files = {
            audio: this._file,
            sidecar: transcriptFileFor(this._file),
            waveform: this.waveformCache,
        };
        return sync
            ? trashRecordingFilesSync(files, trash ? { trash } : {})
            : trashRecordingFiles(files, trashAsync ? { trashAsync } : {});
    }

    // Copia o áudio para `dest` (substitui: o diálogo de salvar já confirmou). `onDone(ok)`
    // é chamado ao terminar, se dado.
    save(dest, onDone = null) {
        this.file.copy_async(dest,
            Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null, (obj, res) => {
                let ok = false;
                try {
                    ok = obj.copy_finish(res);
                } catch (e) {
                    log(`Failed to export ${this.name}: ${e.message}`);
                }
                onDone?.(ok);
            });
    }

    get waveformCache() {
        return CacheDir.get_child(`${this.name}_data`);
    }

    loadPeaks() {
        if (this.waveformCache.query_exists(null)) {
            this.waveformCache.load_bytes_async(null, (obj, res) => {
                const bytes = obj.load_bytes_finish(res)[0];
                try {
                    this._peaks = JSON.parse(ByteArray.toString(bytes.get_data()));
                    this.emit('peaks-updated');
                } catch (error) {
                    log(`Error reading waveform data file: ${this.name}_data`);
                }
            });
        } else {
            this.emit('peaks-loading');
            this.generatePeaks();
        }
    }

    generatePeaks() {
        this._peaksJob?.cancel();
        this._peaksJob = generatePeaks(this.uri, {
            onDone: peaks => {
                this._peaksJob = null;
                this.peaks = peaks;
            },
            onError: error => {
                this._peaksJob = null;
                log(`Failed to generate the waveform of ${this.name}: ${error.message}`);
            },
        });
    }
});

