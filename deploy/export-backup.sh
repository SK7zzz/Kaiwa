#!/usr/bin/env bash
# Install as /usr/local/libexec/kaiwa-export-backup.sh, root-owned.
# Stdout contains SQLite bytes only. Never run with a pseudo-terminal.
set -euo pipefail
umask 0077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/kaiwa-backup-container.sh"
initialize_backup_target
container_id="$(select_backup_container)"
kaiwa_docker exec --user 1000:1000 "$container_id" python -c '
import os
import shutil
import sys
from server import backup

os.umask(0o077)
snapshot_path = None
try:
    snapshot_path = backup.export_snapshot()
    with open(snapshot_path, "rb") as snapshot:
        shutil.copyfileobj(snapshot, sys.stdout.buffer)
    sys.stdout.buffer.flush()
except Exception:
    print("No se pudo exportar el snapshot consistente de Kaiwa.", file=sys.stderr)
    sys.exit(1)
finally:
    if snapshot_path is not None:
        os.unlink(snapshot_path)
'
