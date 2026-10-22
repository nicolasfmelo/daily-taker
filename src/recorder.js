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
const { GLib, GObject, Gst, GstPbutils } = imports.gi;
const { RecordingsDir } = imports.application;
const { Recording } = imports.recording;
const { buildPipelineDescription } = imports.recorderPipeline;

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
        this.pipeline = null;
    }

    _createPipeline(location) {
        const pipeline = Gst.parse_launch(buildPipelineDescription({ location }));
        // Define o caminho também como propriedade, sem depender de aspas na descrição.
        pipeline.get_by_name('filesink').set_property('location', location);
        return pipeline;
    }

    start() {
        let index = 1;

        do {
            // Nome padrão de uma gravação nova (por exemplo, "Gravação 1").
            this.file = RecordingsDir.get_child_for_display_name(_('Gravação %d').format(index++));
        } while (this.file.query_exists(null));

        this._peaks.length = 0;
        this._reachedEos = false;
        this.mic_peak = -Infinity;
        this.system_peak = -Infinity;
        try {
            this.pipeline = this._createPipeline(this.file.get_path());
        } catch (error) {
            log(`Unable to create the recorder pipeline.\n${error}`);
            this.pipeline = null;
            return;
        }

        this.recordBus = this.pipeline.get_bus();
        this.recordBus.add_signal_watch();
        this.handlerId = this.recordBus.connect('message', (_, message) => {
            if (message !== null)
                this._onMessageReceived(message);
        });

        this.state = Gst.State.PLAYING;

        this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this.pipeline)
                return true;
            // Consulta o `level` da mixagem: a posição do pipeline vem do filesink e
            // atrasa ~1 s (páginas Ogg retidas pelo oggmux).
            const pos = this.pipeline.get_by_name('mix').query_position(Gst.Format.TIME)[1];
            if (pos > 0)
                this.duration = pos;
            return true;
        });
    }

    pause() {
        this.state = Gst.State.PAUSED;
    }

    resume() {
        if (this.state === Gst.State.PAUSED)
            this.state = Gst.State.PLAYING;
    }

    stop() {
        if (this.recordBus) {
            this.recordBus.remove_watch();
            this.recordBus.disconnect(this.handlerId);
            this.recordBus = null;
        }

        this._finishStream();
        this.state = Gst.State.NULL;
        this.pipeline = null;
        this.duration = 0;
        if (this.timeout) {
            GLib.source_remove(this.timeout);
            this.timeout = null;
        }

        if (this.file && this.file.query_exists(null) && this._peaks.length > 0) {
            let recording = new Recording(this.file);
            recording.peaks = this._peaks.slice();
            this._peaks.length = 0;
            return recording;
        }

        return null;
    }

    // Envia EOS e espera (no máximo 2 s) o opusenc/oggmux escoarem e fecharem o arquivo.
    // Pausado, as fontes ao vivo não fluem: volta a PLAYING só para o EOS passar.
    _finishStream() {
        if (!this.pipeline || this._reachedEos)
            return;

        if (this.state === Gst.State.PAUSED)
            this.state = Gst.State.PLAYING;
        this.pipeline.send_event(Gst.Event.new_eos());
        const msg = this.pipeline.get_bus().timed_pop_filtered(2 * Gst.SECOND,
            Gst.MessageType.EOS | Gst.MessageType.ERROR);
        if (!msg || msg.type !== Gst.MessageType.EOS)
            log('Recorder pipeline did not reach EOS cleanly');
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
            this._reachedEos = true;
            this.stop();
            break;
        case Gst.MessageType.WARNING:
            log(message.parse_warning()[0].toString());
            break;
        case Gst.MessageType.ERROR:
            log(message.parse_error().toString());
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

    get state() {
        return this._pipeState;
    }

    set state(s) {
        this._pipeState = s;
        if (!this.pipeline)
            return;

        const ret = this.pipeline.set_state(this._pipeState);

        if (ret === Gst.StateChangeReturn.FAILURE)
            log('Unable to update the recorder pipeline state');
    }

});
