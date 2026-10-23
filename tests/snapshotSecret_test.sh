#!/usr/bin/env bash
# Exercita snapshot.sh real com compositor falso: nenhuma GUI/rede/chave real.
set -euo pipefail
unset DAILY_TAKER_OP_KEY
repo="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$repo" <<'PY'
import os, pathlib, signal, subprocess, sys, tempfile, time, shutil
repo = pathlib.Path(sys.argv[1])
scratch = repo / '.superpowers/sdd/2026-10-22-daily-taker-summary/scratch'
scratch.mkdir(parents=True, exist_ok=True)
work = pathlib.Path(tempfile.mkdtemp(prefix='secret-test-', dir=scratch))
secret = 'snapshot-fake-' + 'never-a-key'
key_paths = []
children = []
try:
    stub = work / 'mutter'
    stub.write_text('''#!/usr/bin/env bash
set -euo pipefail
[ -z "${DAILY_TAKER_OP_KEY:-}" ] || exit 31
while [ "$1" != -- ]; do shift; done
shift
# O segredo deve ser injetado DEPOIS do compositor, não antes do D-Bus.
[ "$1" = bash ] && [[ "$2" = */snapshot-child.sh ]] || exit 32
key_file="$3"
[ "$(stat -c %a "$key_file")" = 600 ] || exit 33
[ "$(stat -f -c %T "$key_file")" = tmpfs ] || exit 34
printf '%s' "$key_file" > "$DAILY_TAKER_SNAPSHOT.keypath"
case "$DAILY_TAKER_SNAPSHOT" in
    *term.png|*int.png) while :; do sleep 1; done ;;
    *exit.png) exit 35 ;;
esac
exec bash "$2" "$key_file" bash -c '\''
set -euo pipefail
expected="snapshot-fake-""never-a-key"
[ "$DAILY_TAKER_OP_KEY" = "$expected" ] || exit 36
[ ! -e "$1" ] || exit 37
printf "received; removed before exec\\n" > "$DAILY_TAKER_SNAPSHOT"
sleep 1
case "$DAILY_TAKER_SNAPSHOT" in *late.png) exit 139 ;; esac
'\'' probe "$key_file"
''')
    stub.chmod(0o700)
    env = dict(os.environ, PATH=str(work) + ':' + os.environ['PATH'],
               DAILY_TAKER_OP_KEY=secret, SNAPSHOT_TIMEOUT='15')
    started = time.time_ns()
    for mode in ['normal', 'exit', 'term', 'int', 'late']:
        out = work / (mode + '.png')
        proc = subprocess.Popen(['bash', 'tools/snapshot.sh', str(out), '--component', 'summarycheck'],
                                cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        children.append(proc)
        marker = pathlib.Path(str(out) + '.keypath')
        deadline = time.monotonic() + 20
        while not marker.exists() and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(.02)
        if not marker.exists():
            output = proc.communicate(timeout=20)[0].decode()
            raise AssertionError(f'{mode}: injeção tardia/tmpfs não observada (rc {proc.returncode}): {output}')
        key = pathlib.Path(marker.read_text())
        key_paths.append(key)
        # Não imprimir cmdline nem segredo, mesmo numa falha.
        for item in pathlib.Path('/proc').glob('[0-9]*/cmdline'):
            try:
                assert secret.encode() not in item.read_bytes(), 'segredo encontrado em argv'
            except (FileNotFoundError, PermissionError, ProcessLookupError):
                pass
        if mode in ('term', 'int'):
            proc.send_signal(signal.SIGTERM if mode == 'term' else signal.SIGINT)
        output = proc.communicate(timeout=20)[0].decode()
        assert not key.exists(), f'{mode}: segredo não removido'
        if mode == 'normal':
            assert proc.returncode == 0 and out.read_text() == 'received; removed before exec\n', 'filho não recebeu segredo'
        else:
            assert proc.returncode != 0, f'{mode}: falha/sinal não propagado'
        print(f'PASS snapshotSecret: {mode}: tmpfs 0600, argv limpo, segredo removido')
    for p in (repo / 'build').rglob('*'):
        if p.is_file() and p.stat().st_mtime_ns >= started:
            assert secret.encode() not in p.read_bytes(), 'segredo persistido em build'
    status = subprocess.check_output(['git', 'status', '--short'], cwd=repo)
    assert secret.encode() not in status, 'segredo em git status'
    print('PASS snapshotSecret: nenhum segredo em arquivos persistentes novos ou git status')
finally:
    for proc in children:
        if proc.poll() is None:
            proc.terminate()
            proc.communicate(timeout=20)
    for key in key_paths:
        key.unlink(missing_ok=True)
    shutil.rmtree(work)
PY
