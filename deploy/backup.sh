#!/usr/bin/env bash
set -euo pipefail
umask 0077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$script_dir/kaiwa-backup-container.sh"
initialize_backup_target
container_id="$(select_backup_container)"
kaiwa_docker exec --user 1000:1000 "$container_id" python -c '
import os
import sys
from server import backup

os.umask(0o077)
try:
    backup.backup_now()
except Exception:
    print("No se pudo crear el snapshot consistente de Kaiwa.", file=sys.stderr)
    sys.exit(1)
print("Snapshot SQLite consistente de Kaiwa guardado.")
'
