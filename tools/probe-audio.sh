#!/usr/bin/env bash
# Usado por `tools/snapshot.sh --probe-audio`: roda, no ambiente isolado do snapshot,
# reprodução e captura reais do GStreamer e mostra para onde o áudio vai e que nenhum
# processo abre /dev/snd. Saída ≠ 0 se algum pipeline abrir um dispositivo de som.
set -uo pipefail

file="$1"
uri="file://$(realpath -- "$file")"
uri="${uri// /%20}"
failed=0

echo "ALSA_CONFIG_PATH=$ALSA_CONFIG_PATH"
echo "GST_PLUGIN_FEATURE_RANK=$GST_PLUGIN_FEATURE_RANK"
echo "PULSE_SERVER=$PULSE_SERVER PIPEWIRE_REMOTE=$PIPEWIRE_REMOTE"
echo "--- aplay -L (alsa-lib lê a configuração)"
aplay -L 2>&1
echo "rc=$?"

snd_fds() {
    local pid="$1" fd target found=''
    for fd in /proc/"$pid"/fd/*; do
        target="$(readlink "$fd" 2>/dev/null)" || continue
        case "$target" in /dev/snd/*) found+=" $target" ;; esac
    done
    echo "${found:- nenhum}"
}

# Roda "$@" por ~2 s (tocando/gravando em tempo real) e confere os fds no meio.
probe() {
    local name="$1"
    shift
    echo "=== $name"
    GST_DEBUG='autodetect:4' "$@" >"$XDG_RUNTIME_DIR/probe.log" 2>&1 &
    local pid=$!
    sleep 1.5
    local fds
    fds="$(snd_fds "$pid")"
    local alive=no
    kill -0 "$pid" 2>/dev/null && alive=yes
    kill -INT "$pid" 2>/dev/null
    sleep 0.3
    kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    grep -E 'autodetect|actual-sink|actual-src|GstFakeAudioSink|GstAlsa|GstPulse|ERRO|ERROR|Falha' \
        "$XDG_RUNTIME_DIR/probe.log" | sed 's/^\x1b\[[0-9;]*m//' | cut -c1-220 | head -8
    echo "rodando aos 1,5 s: $alive · /dev/snd abertos:$fds"
    [ "$fds" = ' nenhum' ] || failed=1
}

probe 'playbin (o que o GstPlayer do app usa)' gst-launch-1.0 -v playbin "uri=$uri"
probe 'uridecodebin ! autoaudiosink' gst-launch-1.0 -v uridecodebin "uri=$uri" ! audioconvert ! audioresample ! autoaudiosink
probe 'autoaudiosrc (microfone)' gst-launch-1.0 -v autoaudiosrc ! fakesink
probe 'alsasink device=default explícito' gst-launch-1.0 -v audiotestsrc ! alsasink device=default
probe 'alsasink device=hw:0 explícito (deve falhar)' gst-launch-1.0 -v audiotestsrc ! alsasink device=hw:0
probe 'alsasrc explícito (microfone)' gst-launch-1.0 -v alsasrc ! fakesink
probe 'pulsesrc do gravador (deve falhar)' gst-launch-1.0 -v pulsesrc device=@DEFAULT_SOURCE@ ! fakesink
probe 'GstPlayer em gjs, volume normal' gjs -c "
const { GLib, Gst, GstPlayer } = imports.gi;
Gst.init(null);
const p = GstPlayer.Player.new(null, GstPlayer.PlayerGMainContextSignalDispatcher.new(null));
p.set_uri('$uri');
p.connect('state-changed', (_p, s) => printerr('GstPlayer estado: ' + GstPlayer.PlayerState.get_name(s)));
p.play();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1200, () => {
    const sink = p.get_pipeline().get_property('audio-sink');
    const names = [sink.get_factory().get_name()];
    if (sink instanceof Gst.Bin)
        sink.iterate_recurse().foreach(e => names.push(e.get_factory().get_name()));
    printerr('GstPlayer actual-sink: ' + names.join(' > '));
    return GLib.SOURCE_REMOVE;
});
new GLib.MainLoop(null, false).run();"

echo "resultado: $([ $failed -eq 0 ] && echo 'nenhum /dev/snd aberto' || echo 'DISPOSITIVO DE SOM ABERTO')"
exit $failed
