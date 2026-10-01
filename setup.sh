#!/bin/bash
# Python dependencies by default; large offline assets are explicit opt-in.
set -euo pipefail
cd "$(dirname "$0")"

KAIWA_SETUP_OFFLINE=false
usage() {
  cat <<'HELP'
Uso: ./setup.sh [--offline]
  --offline  Descarga whisper.cpp (~466 MB) y el diccionario JMdict japonés–inglés.
Por defecto prepara Python y dependencias para usar tu suscripción con Codex.
KAIWA_PYTHON permite elegir un ejecutable Python 3.10 o posterior.
HELP
}
for argument in "$@"; do
  case "$argument" in
    --offline) KAIWA_SETUP_OFFLINE=true ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

python_supported() {
  command -v "$1" >/dev/null 2>&1 && "$1" -c 'import sys; sys.exit(sys.version_info < (3, 10))'
}
select_python() {
  local candidate
  if [ -n "${KAIWA_PYTHON:-}" ]; then
    python_supported "$KAIWA_PYTHON" || { echo "KAIWA_PYTHON debe apuntar a Python 3.10 o posterior." >&2; return 1; }
    printf '%s\n' "$KAIWA_PYTHON"
    return
  fi
  for candidate in python3.14 python3.13 python3.12 python3.11 python3.10 /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if python_supported "$candidate"; then printf '%s\n' "$candidate"; return; fi
  done
  echo "Instala Python 3.10 o posterior; en Mac: brew install python." >&2
  return 1
}

KAIWA_SETUP_PYTHON="$(select_python)"
if [ ! -d .venv ]; then
  echo "Creando entorno con $KAIWA_SETUP_PYTHON…"
  "$KAIWA_SETUP_PYTHON" -m venv .venv
fi
if ! python_supported .venv/bin/python; then
  echo "El entorno .venv existente utiliza un Python antiguo. Renómbralo y ejecuta ./setup.sh de nuevo." >&2
  exit 1
fi
echo "Instalando dependencias…"
.venv/bin/python -m pip install --quiet --upgrade pip
.venv/bin/python -m pip install --quiet -r requirements.txt
mkdir -p data models

download_offline_assets() {
  if [ ! -f models/ggml-small.bin ]; then
    echo "Descargando reconocimiento de voz local (~466 MB)…"
    curl --fail --location --progress-bar -o models/ggml-small.bin.part \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
    mv models/ggml-small.bin.part models/ggml-small.bin
  fi
  if compgen -G 'models/jmdict-eng-*.json' >/dev/null; then return; fi
  echo "Descargando diccionario japonés–inglés…"
  local release_url
  release_url="$(curl --fail --silent --show-error https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest \
    | .venv/bin/python -c 'import json,re,sys; assets=json.load(sys.stdin)["assets"]; print(next(item["browser_download_url"] for item in assets if re.fullmatch(r"jmdict-eng-[0-9].*\.json\.zip", item["name"])))')"
  curl --fail --location --progress-bar -o models/kaiwa-jmdict.zip.part "$release_url"
  unzip -oq models/kaiwa-jmdict.zip.part -d models/
  rm models/kaiwa-jmdict.zip.part
}

if "$KAIWA_SETUP_OFFLINE"; then
  download_offline_assets
  if ! command -v whisper-cli >/dev/null; then echo "Para voz local instala whisper.cpp: brew install whisper-cpp"; fi
fi

echo "Entorno preparado. Inicia sesión con codex login y arranca ./run.sh."
if ! command -v codex >/dev/null; then
  echo "Codex CLI aún no está instalado. Consulta la guía del fork en README.md."
fi
