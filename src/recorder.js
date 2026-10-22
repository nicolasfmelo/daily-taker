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
const { RecordingsDir, Settings } = imports.application;
const { Recording } = imports.recording;

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

var AudioChannels = {
    0: { name: 'stereo', channels: 2 },
    1: { name: 'mono', channels: 1 },
};

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
    },
}, class Recorder extends GObject.Object {
    _init() {
        this._peaks = [];
        super._init({});

        let srcElement, audioConvert, caps;
        try {
            this.pipeline = new Gst.Pipeline({ name: 'pipe' });
            srcElement = Gst.ElementFactory.make('pulsesrc', 'srcElement');
            audioConvert = Gst.ElementFactory.make('audioconvert', 'audioConvert');
            caps = Gst.Caps.from_string('audio/x-raw');
            this.level = Gst.ElementFactory.make('level', 'level');
            this.ebin = Gst.ElementFactory.make('encodebin', 'ebin');
            this.filesink = Gst.ElementFactory.make('filesink', 'filesink');
        } catch (error) {
            log(`Not all elements could be created.\n${error}`);
        }

        try {
            this.pipeline.add(srcElement);
            this.pipeline.add(audioConvert);
            this.pipeline.add(this.level);
            this.pipeline.add(this.ebin);
            this.pipeline.add(this.filesink);
        } catch (error) {
            log(`Not all elements could be addded.\n${error}`);
        }

        srcElement.link(audioConvert);
        audioConvert.link_filtered(this.level, caps);
    }

    start() {
        let index = 1;

        do {
            /* Translators: ""Recording %d"" is the default name assigned to a file created
            by the application (for example, "Recording 1"). */
            this.file = RecordingsDir.get_child_for_display_name(_('Recording %d').format(index++));
        } while (this.file.query_exists(null));

        this.recordBus = this.pipeline.get_bus();
        this.recordBus.add_signal_watch();
        this.handlerId = this.recordBus.connect('message', (_, message) => {
            if (message !== null)
                this._onMessageReceived(message);
        });


        this.ebin.set_property('profile', this._getProfile());
        this.filesink.set_property('location', this.file.get_path());
        this.level.link(this.ebin);
        this.ebin.link(this.filesink);

        this.state = Gst.State.PLAYING;

        this.timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            const pos = this.pipeline.query_position(Gst.Format.TIME)[1];
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
        this.state = Gst.State.NULL;
        this.duration = 0;
        if (this.timeout) {
            GLib.source_remove(this.timeout);
            this.timeout = null;
        }

        if (this.recordBus) {
            this.recordBus.remove_watch();
            this.recordBus.disconnect(this.handlerId);
            this.recordBus = null;
        }


        if (this.file && this.file.query_exists(null) && this._peaks.length > 0) {
            let recording = new Recording(this.file);
            recording.peaks = this._peaks.slice();
            this._peaks.length = 0;
            return recording;
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

                if (peakVal)
                    this.current_peak = peakVal.get_nth(0);
            }
            break;
        }

        case Gst.MessageType.EOS:
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

    _getChannel() {
        let channelIndex = Settings.get_enum('audio-channel');
        return AudioChannels[channelIndex].channels;
    }

    _getProfile() {
        let profileIndex = Settings.get_enum('audio-profile');
        const profile = EncodingProfiles[profileIndex];

        let audioCaps = Gst.Caps.from_string(profile.audioCaps);
        audioCaps.set_value('channels', this._getChannel());

        let encodingProfile = GstPbutils.EncodingAudioProfile.new(audioCaps, null, null, 1);
        let containerCaps = Gst.Caps.from_string(profile.containerCaps);
        let containerProfile = GstPbutils.EncodingContainerProfile.new('record', null, containerCaps, null);
        containerProfile.add_profile(encodingProfile);

        return containerProfile;
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
        if (peak > 0)
            peak = 0;

        this._current_peak = Math.pow(10, peak / 20);
        this._peaks.push(this._current_peak);
        this.notify('current-peak');
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
        const ret = this.pipeline.set_state(this._pipeState);

        if (ret === Gst.StateChangeReturn.FAILURE)
            log('Unable to update the recorder pipeline state');
    }

});
