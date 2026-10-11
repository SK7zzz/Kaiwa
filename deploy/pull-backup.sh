#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Uso: bash deploy/pull-backup.sh /directorio/privado/de/copias\n' >&2
  exit 2
fi

umask 077
backup_directory="$1"
# BSD chmod does not accept --; prefix relative paths so a dash is never an option.
[[ "$backup_directory" == /* ]] || backup_directory="./$backup_directory"
[[ ! -L "$backup_directory" ]] || { echo 'El directorio de copias no puede ser un enlace simbólico.' >&2; exit 1; }
mkdir -p "$backup_directory"
[[ -O "$backup_directory" ]] || { echo 'El directorio privado de copias debe pertenecerte.' >&2; exit 1; }
chmod 700 "$backup_directory"
temporary_path="$(mktemp "$backup_directory/.kaiwa-backup.XXXXXX")"
backup_path="$backup_directory/kaiwa-rushia-$(TZ=Asia/Tokyo date +%Y%m%d-%H%M%S)-${temporary_path##*.}.db"
trap 'rm -f "$temporary_path"' EXIT

ssh_identity="${KAIWA_SSH_IDENTITY:-$HOME/.ssh/rushia_admin_ed25519}"
ssh_target="${KAIWA_SSH_TARGET:-admin@rushia}"
[[ "$ssh_target" != -* ]] || { echo 'El destino SSH no puede empezar por un guion.' >&2; exit 1; }
ssh -T -i "$ssh_identity" -o BatchMode=yes -o IdentitiesOnly=yes \
  -o ConnectTimeout=10 "$ssh_target" \
  'sudo -n /usr/local/libexec/kaiwa-export-backup.sh' > "$temporary_path"

python3 - "$temporary_path" "$backup_path" <<'PY'
import os
import sqlite3
import sys
from pathlib import Path

uri = Path(sys.argv[1]).resolve().as_uri() + "?mode=ro"
with open(sys.argv[1], "rb") as snapshot:
    if snapshot.read(16) != b"SQLite format 3\x00":
        raise SystemExit("El servidor no devolvió un snapshot SQLite válido.")
with sqlite3.connect(uri, uri=True) as database:
    tables = {row[0] for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {"profile", "sessions", "vocab", "personal_memories", "companion_messages", "memory_context_state"} <= tables:
        raise SystemExit("La copia no contiene todos los datos personales de Kaiwa.")
    if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("La copia no superó la comprobación de integridad SQLite.")
os.chmod(sys.argv[1], 0o600)
with open(sys.argv[1], "rb") as snapshot:
    os.fsync(snapshot.fileno())
# Same-directory hard link creates the final name atomically and refuses to
# overwrite an existing file. The shell trap removes the temporary name.
os.link(sys.argv[1], sys.argv[2])
PY
printf 'Copia privada de Kaiwa guardada e integridad SQLite comprobada.\n'
