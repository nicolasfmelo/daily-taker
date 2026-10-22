#!/usr/bin/env bash
# Renderiza a janela real do Daily Taker (ou um componente) num PNG, sem usar a tela,
# os dados, a configuração, o chaveiro nem o áudio do usuário. Ver tools/README.md.
#
#   bash tools/snapshot.sh OUT.png [--component window|playerbar|transcriptview|detailpane|sidebar]
#                          [--select N] [--tab transcricao|resumo] [--at SEG] [--size LxA]
#                          [--state recorder]
#   bash tools/snapshot.sh --probe-audio   # prova, no mesmo ambiente, que o áudio vai para o nada
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
build="$repo/build"
app_id='dev.nicolas.DailyTaker'
timeout_s="${SNAPSHOT_TIMEOUT:-60}"

die() {
    echo "snapshot: $*" >&2
    exit 1
}

usage() {
    sed -n '5,7p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
}

[ $# -ge 1 ] || usage
probe_audio=''
if [ "$1" = '--probe-audio' ]; then
    probe_audio=1
    set -- "${TMPDIR:-/tmp}/daily-taker-probe-unused.png"
fi
case "$1" in -*) usage ;; esac
out="$(realpath -m -- "$1")"
shift

component='window' select='' tab='' at='' size='1536x1024' state=''
while [ $# -gt 0 ]; do
    [ $# -ge 2 ] || die "falta o valor de $1"
    case "$1" in
        --component) component="$2" ;;
        --select) select="$2" ;;
        --tab) tab="$2" ;;
        --at) at="$2" ;;
        --size) size="$2" ;;
        --state) state="$2" ;;
        *) die "opção desconhecida: $1" ;;
    esac
    shift 2
done

[[ "$component" =~ ^[a-z]+$ ]] || die "--component inválido: $component"
[ -z "$select" ] || [[ "$select" =~ ^[1-9][0-9]*$ ]] || die "--select espera um número a partir de 1"
[ -z "$tab" ] || [[ "$tab" =~ ^(transcricao|resumo)$ ]] || die "--tab espera transcricao ou resumo"
[ -z "$at" ] || [[ "$at" =~ ^[0-9]+(\.[0-9]+)?$ ]] || die "--at espera segundos"
[ -z "$state" ] || [[ "$state" =~ ^recorder$ ]] || die "--state espera recorder"
[[ "$size" =~ ^([1-9][0-9]*)x([1-9][0-9]*)$ ]] || die "--size espera LxA, por exemplo 1536x1024"
[ -d "$(dirname -- "$out")" ] || die "diretório de saída não existe: $(dirname -- "$out")"
[ -f "$build/build.ninja" ] || die "configure antes: meson setup build --prefix \$HOME/.local"

work="$(mktemp -d "${TMPDIR:-/tmp}/daily-taker-snapshot-XXXXXX")"
pgid=''
cleanup() {
    # Só o grupo de processos iniciado aqui (dbus-run-session, mutter, app).
    if [ -n "$pgid" ] && kill -0 -- "-$pgid" 2>/dev/null; then
        kill -TERM -- "-$pgid" 2>/dev/null || true
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            kill -0 -- "-$pgid" 2>/dev/null || break
            sleep 0.2
        done
        kill -KILL -- "-$pgid" 2>/dev/null || true
    fi
    rm -rf -- "$work"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# 1. Instala a árvore atual numa raiz temporária (a instalação real não é tocada).
stage="$work/stage"
meson install -C "$build" --destdir "$stage" --quiet >"$work/install.log" 2>&1 ||
    { cat "$work/install.log" >&2; die "falha ao compilar/instalar em $stage"; }
prefix="$(sed -n 's/^ *prefix: "\(.*\)",$/\1/p' "$build/src/$app_id")"
[ -n "$prefix" ] || die "prefixo não encontrado em $build/src/$app_id"
staged="$stage$prefix"
glib-compile-schemas "$staged/share/glib-2.0/schemas"
sed "s|$prefix|$staged|g" "$build/src/$app_id" > "$work/launcher"

# 2. Fixtures (cacheadas em build/; copiadas para cada execução, que pode alterá-las).
bash "$repo/tools/make-fixtures.sh" "$build/snapshot-fixtures" >/dev/null
for d in data config cache home runtime; do
    mkdir -p "$work/$d"
done
chmod 700 "$work/runtime"
cp -a "$build/snapshot-fixtures/daily-taker" "$work/data/"
mkdir -p "$build/snapshot-cache"

# Áudio sem saída nem entrada reais, mesmo se algo tocar (--at, tarefas futuras):
# - ALSA só conhece um "default" nulo (sem pcm.hw/card*: o /dev/snd não é aberto; CTL não
#   tem tipo nulo no alsa-lib, então fica indefinido e abrir um falha);
# - autoaudiosink/autoaudiosrc só acham o fakeaudiosink (sinks e fontes reais com rank 0).
cat > "$work/alsa.conf" <<'ALSA'
pcm.!default { type null }
pcm.null { type null }
ALSA
gst_ranks='fakeaudiosink:MAX'
for e in alsasink alsasrc pulsesink pulsesrc pipewiresink pipewiresrc jackaudiosink jackaudiosrc \
    openalsink openalsrc oss4sink oss4src osssink osssrc; do
    gst_ranks+=",$e:NONE"
done

# 3. mutter headless num barramento D-Bus próprio; o app roda como filho do mutter e o
# mutter sai quando o app sai. Ambiente limpo: sem DISPLAY/WAYLAND_DISPLAY/DBus do usuário,
# sem chave da API, GSettings em memória e sem servidor de áudio alcançável.
rm -f -- "$out"
gjs_bin="$(sed -n '1s/^#!//p' "$work/launcher")"
if [ -n "$probe_audio" ]; then
    command=(bash "$repo/tools/probe-audio.sh" "$work/data/daily-taker/Ideias para o app")
else
    command=(mutter --headless --wayland --no-x11 --wayland-display snapshot-wayland
        --virtual-monitor "$size" -- "$gjs_bin" "$work/launcher")
fi
optional=()
for v in TZ GSK_RENDERER; do
    [ -z "${!v:-}" ] || optional+=("$v=${!v}")
done
set +e
env -i \
    PATH="$PATH" \
    LANG="${LANG:-C.UTF-8}" \
    "${optional[@]}" \
    HOME="$work/home" \
    XDG_DATA_HOME="$work/data" \
    XDG_CONFIG_HOME="$work/config" \
    XDG_CACHE_HOME="$work/cache" \
    XDG_RUNTIME_DIR="$work/runtime" \
    XDG_SESSION_TYPE=wayland \
    GSETTINGS_BACKEND=memory \
    GSETTINGS_SCHEMA_DIR="$staged/share/glib-2.0/schemas" \
    GDK_BACKEND=wayland \
    GDK_DEBUG=no-portals \
    GIO_USE_VFS=local \
    NO_AT_BRIDGE=1 \
    GTK_A11Y=none \
    PULSE_SERVER="unix:$work/runtime/no-pulse" \
    PIPEWIRE_REMOTE="$work/runtime/no-pipewire" \
    ALSA_CONFIG_PATH="$work/alsa.conf" \
    GST_PLUGIN_FEATURE_RANK="$gst_ranks" \
    GST_REGISTRY="$build/snapshot-cache/gstreamer-registry.bin" \
    DAILY_TAKER_SNAPSHOT="$out" \
    DAILY_TAKER_SNAPSHOT_COMPONENT="$component" \
    DAILY_TAKER_SNAPSHOT_SELECT="$select" \
    DAILY_TAKER_SNAPSHOT_TAB="$tab" \
    DAILY_TAKER_SNAPSHOT_AT="$at" \
    DAILY_TAKER_SNAPSHOT_SIZE="$size" \
    DAILY_TAKER_SNAPSHOT_STATE="$state" \
    setsid --wait timeout --kill-after=5 "$timeout_s" \
        dbus-run-session -- "${command[@]}" \
        >"$work/run.log" 2>&1 &
pgid=$!
wait "$pgid"
status=$?
set -e

if [ -n "$probe_audio" ]; then
    cat "$work/run.log"
    exit "$status"
fi

app_lines='^(devSnapshot|Gjs-|\(gjs|\(launcher|JS )'
if [ ! -s "$out" ]; then
    if [ -n "${SNAPSHOT_VERBOSE:-}" ] || ! grep -E "$app_lines" "$work/run.log" >&2; then
        grep -v '^$' "$work/run.log" >&2 || true
    fi
    die "nenhum PNG gerado (saída $status; SNAPSHOT_VERBOSE=1 mostra o log completo)"
fi
# Mensagens do app (as do mutter só com SNAPSHOT_VERBOSE=1 ou em caso de falha).
if [ -n "${SNAPSHOT_VERBOSE:-}" ]; then
    cat "$work/run.log"
else
    grep -E "$app_lines" "$work/run.log" || true
fi
echo "snapshot: $out"
