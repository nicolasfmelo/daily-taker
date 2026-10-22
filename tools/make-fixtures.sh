#!/usr/bin/env bash
# Cria gravações de exemplo para conferência visual (tools/snapshot.sh) e testes.
#
#   bash tools/make-fixtures.sh DIR
#
# Gera DIR/daily-taker/ com 4 gravações Ogg/Opus mono (sem extensão, como as do
# app): 3 com <nome>.transcript.json (formato v1) e "Sem transcrição" sem ela.
# As datas (mtime e recorded_at) são relativas a hoje, então rodar de novo
# atualiza tudo. FIXTURE_FAST=1 gera áudio curto (30 s) em vez da duração real.
#
# Segurança: recusa DIR dentro de ~/.local/share, ~/.config ou ~/.cache reais e
# recusa DIR/daily-taker com arquivos que não sejam destas fixtures.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
marker_name='.daily-taker-fixtures'
names=('Daily · Projeto Atlas' 'Ideias para o app' 'Notas da reunião' 'Sem transcrição')
durations=(1148 272 760 95)

die() {
    echo "make-fixtures: $*" >&2
    exit 1
}

[ $# -eq 1 ] && [ -n "$1" ] || die "uso: $0 DIR"

dir="$(realpath -m -- "$1")"
real_home="$(getent passwd "$(id -u)" | cut -d: -f6)"

# Nunca dentro dos dados, configuração ou cache reais do usuário.
for home in "$real_home" "${HOME:-}"; do
    [ -n "$home" ] || continue
    [ "$dir" != "$(realpath -m -- "$home")" ] || die "recusado: '$dir' é o diretório pessoal"
    for sub in .local/share .config .cache; do
        base="$(realpath -m -- "$home/$sub")"
        case "$dir/" in
            "$base"/*) die "recusado: '$dir' fica dentro de '$base'" ;;
        esac
    done
done

data="$dir/daily-taker"
marker="$dir/$marker_name"
mode="${FIXTURE_FAST:+fast}"
mode="${mode:-full}"

is_fixture_name() {
    local entry="$1" n
    for n in "${names[@]}"; do
        [ "$entry" = "$n" ] || [ "$entry" = "$n.transcript.json" ] && return 0
    done
    return 1
}

if [ -d "$data" ]; then
    shopt -s nullglob dotglob
    entries=("$data"/*)
    shopt -u nullglob dotglob
    if [ ${#entries[@]} -gt 0 ]; then
        [ -f "$marker" ] || die "recusado: '$data' já tem arquivos e não foi criado por este script"
        for e in "${entries[@]}"; do
            is_fixture_name "$(basename -- "$e")" || die "recusado: '$e' não é uma fixture"
        done
    fi
elif [ -e "$data" ]; then
    die "recusado: '$data' existe e não é um diretório"
fi

mkdir -p -- "$data"

# Reaproveita o áudio de uma execução anterior no mesmo modo (o resto é refeito).
if [ "$(cat -- "$marker" 2>/dev/null || true)" != "$mode" ]; then
    for n in "${names[@]}"; do
        rm -f -- "$data/$n"
    done
fi
printf '%s\n' "$mode" > "$marker"

for i in "${!names[@]}"; do
    out="$data/${names[$i]}"
    [ -s "$out" ] && continue
    secs="${durations[$i]}"
    [ "$mode" = full ] || secs=30
    # Tom com volume variando, para a forma de onda não sair chapada.
    ffmpeg -nostdin -loglevel error -y -f lavfi \
        -i "aevalsrc='0.4*sin(2*PI*220*t)*(0.55+0.45*sin(2*PI*0.37*t)*sin(2*PI*1.3*t))':s=16000:d=$secs" \
        -ac 1 -c:a libopus -b:a 32k -f ogg "$out.tmp"
    mv -f -- "$out.tmp" "$out"
done

GJS_PATH="$repo/src" gjs "$repo/tools/fixtureData.js" "$data"
echo "fixtures ($mode) em $data"
