/* exported EncodingProfiles Recorder */
/*
 * Copyright 2013 Meg Ford
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Library General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Library General Public License for more details.
 *
 * You should have received a copy of the GNU Library General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 *
 *  Author: Meg Ford <megford@gnome.org>
 *
 */
const { Gio, GLib, GObject, Gst, GstPbutils } = imports.gi;
const { RecordingsDir } = imports.application;
const { Recording } = imports.recording;
const { RecordingPipeline, keepRecording } = imports.recorderPipeline;
const { recordingFileFor } = imports.recordingName;

// All supported encoding profiles.
var EncodingProfiles = [
    { name: 'VORBIS',
        containerCaps: 'application/ogg;audio/ogg;video/ogg',
        audioCaps: 'audio/x-vorbis',
        contentType: 'audio/x-vorbis+ogg',
        extension: 'ogg' },

    { name: 'OPUS',
        containerCaps: 'application/ogg',
        audioCaps: 'audio/x-opus',
        contentType: 'audio/x-opus+ogg',
        extension: 'opus' },

    { name: 'FLAC',
        containerCaps: 'audio/x-flac',
        audioCaps: 'audio/x-flac',
        contentType: 'audio/flac',
        extension: 'flac' },

    { name: 'MP3',
        containerCaps: 'application/x-id3',
        audioCaps: 'audio/mpeg,mpegversion=(int)1,layer=(int)3',
        contentType: 'audio/mpeg',
        extension: 'mp3' },

    { name: 'M4A',
        containerCaps: 'video/quicktime,variant=(string)iso',
        audioCaps: 'audio/mpeg,mpegversion=(int)4',
        contentType: 'video/mp4',
        extension: 'm4a' },
];

// Converte um pico do elemento `level` (dBFS) para [0, 1].
function _dbToLinear(peak) {
    return Math.pow(10, Math.min(peak, 0) / 20);
}

var Recorder = new GObject.registerClass({
    Signals: {
        // Falha ao ligar ou no meio da gravação; a mensagem é para a interface (pt-BR).
        'error': { param_types: [GObject.TYPE_STRING] },
    },
    Properties: {
        'duration': GObject.ParamSpec.int(
            'duration',
            'Recording Duration', 'Recording duration in nanoseconds',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0, GLib.MAXINT16, 0),
        'current-peak': GObject.ParamSpec.float(
            'current-peak',
            'Waveform current peak', 'Waveform current peak in float [0, 1]',
            GObject.ParamFlags.READWRITE | GObject.ParamFlags.CONSTRUCT,
            0.0, 1.0, 0.0),
        'mic-peak': GObject.ParamSpec.float(
            'mic-peak',
            'Microphone peak', 'Microphone current peak in float [0, 1]',
            GObject.ParamFlags.READABLE,
            0.0, 1.0, 0.0),
        'system-peak': GObject.ParamSpec.float(
            'system-peak',
            'System audio peak', 'System audio current peak in float [0, 1]',
            GObject.ParamFlags.READABLE,
            0.0, 1.0, 0.0),
    },
}, class Recorder extends GObject.Object {
    _init() {
        this._peaks = [];
        this._micPeak = 0.0;
        this._systemPeak = 0.0;
        super._init({});
        this._session = null;
        this._errorIdleId = 0;
    }

    start() {
        // Nome padrão de uma gravação nova: "Gravação 22 out 14:30" (com " (2)" se repetir).
        this.file = recordingFileFor(RecordingsDir, new Date());

        this._peaks.length = 0;
        this.mic_peak = -Infinity;
        this.system_peak = -Infinity;
        this._session = new RecordingPipeline({
            location: this.file.get_path(),
            onError: message => this._reportError(message),
            onMessage: message => this._onMessageReceived(message),
        });
        this._session.start();

        this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._session)
                return true;
            const pos = this._session.position();
            if (pos > 0)
                this.duration = pos;
            return true;
        });
    }

    // O aviso sai fora da pilha atual: start()/pause() terminam antes de a interface reagir.
    _reportError(message) {
        if (this._errorIdleId)
            return;
        this._errorIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._errorIdleId = 0;
            this.emit('error', message);
            return GLib.SOURCE_REMOVE;
        });
    }

    pause() {
        this._session?.setState(Gst.State.PAUSED);
    }

    resume() {
        if (this._session?.state === Gst.State.PAUSED)
            this._session.setState(Gst.State.PLAYING);
    }

    // Devolve a gravação, ou null se nada foi gravado (o arquivo vazio é apagado).
    // Depois de um erro no meio da gravação, o trecho já gravado é mantido.
    stop() {
        if (this.timeout) {
            GLib.source_remove(this.timeout);
            this.timeout = null;
        }
        if (this._errorIdleId) {
            GLib.source_remove(this._errorIdleId);
            this._errorIdleId = 0;
        }
        this.duration = 0;

        const session = this._session;
        this._session = null;
        if (!session)
            return null;
        session.stop();

        const file = this.file;
        const peaks = this._peaks.slice();
        this._peaks.length = 0;
        const exists = file.query_exists(null);
        let size = 0;
        try {
            size = exists ? file.query_info('standard::size', Gio.FileQueryInfoFlags.NONE, null).get_size() : 0;
        } catch (e) {
            size = 0;
        }

        if (keepRecording({ exists, size, peakCount: peaks.length })) {
            let recording = new Recording(file);
            recording.peaks = peaks;
            return recording;
        }

        if (exists) {
            try {
                file.delete(null);
            } catch (e) {
                log(`Unable to remove the empty recording ${file.get_basename()}: ${e.message}`);
            }
        }
        return null;
    }

    _onMessageReceived(message) {
        switch (message.type) {
        case Gst.MessageType.ELEMENT: {
            if (GstPbutils.is_missing_plugin_message(message)) {
                let detail = GstPbutils.missing_plugin_message_get_installer_detail(message);
                let description = GstPbutils.missing_plugin_message_get_description(message);
                log(`Detail: ${detail}\nDescription: ${description}`);
                break;
            }

            let s = message.get_structure();
            if (s && s.has_name('level')) {
                const peakVal = s.get_value('peak');

                if (peakVal) {
                    const peak = peakVal.get_nth(0);
                    switch (message.src.name) {
                    case 'mic':
                        this.mic_peak = peak;
                        break;
                    case 'system':
                        this.system_peak = peak;
                        break;
                    case 'mix':
                        this.current_peak = peak;
                        break;
                    }
                }
            }
            break;
        }

        case Gst.MessageType.EOS:
            this.stop();
            break;
        }
    }

    get duration() {
        return this._duration;
    }

    // eslint-disable-next-line camelcase
    get current_peak() {
        return this._current_peak;
    }

    // eslint-disable-next-line camelcase
    set current_peak(peak) {
        this._current_peak = _dbToLinear(peak);
        this._peaks.push(this._current_peak);
        this.notify('current-peak');
    }

    // eslint-disable-next-line camelcase
    get mic_peak() {
        return this._micPeak;
    }

    // eslint-disable-next-line camelcase
    set mic_peak(peak) {
        this._micPeak = _dbToLinear(peak);
        this.notify('mic-peak');
    }

    // eslint-disable-next-line camelcase
    get system_peak() {
        return this._systemPeak;
    }

    // eslint-disable-next-line camelcase
    set system_peak(peak) {
        this._systemPeak = _dbToLinear(peak);
        this.notify('system-peak');
    }

    set duration(val) {
        this._duration = val;
        this.notify('duration');
    }
});
