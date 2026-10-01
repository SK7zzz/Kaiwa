#!/bin/bash
# Kaiwa personal: local web app with ChatGPT subscription through Codex.
set -euo pipefail
cd "$(dirname "$0")"

KAIWA_RUN_OFFLINE=false
KAIWA_RUN_PHONE=false
KAIWA_RUN_BROWSER=true
KAIWA_RUN_PORT="${KAIWA_PORT:-8130}"

usage() {
  cat <<'HELP'
Uso: ./run.sh [--offline] [--phone] [--no-browser]
  --offline     Inicia Ollama y motores de voz locales instalados.
  --phone       Activa expresamente el enlace HTTPS de Tailscale.
  --no-browser  No abre automáticamente el navegador.
Por defecto escucha en 127.0.0.1 y utiliza el proveedor guardado (Codex al instalar).
HELP
}

for argument in "$@"; do
  case "$argument" in
    --offline) KAIWA_RUN_OFFLINE=true ;;
    --phone) KAIWA_RUN_PHONE=true ;;
    --no-browser) KAIWA_RUN_BROWSER=false ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
done

[ -x .venv/bin/python ] || { echo "Falta el entorno Python. Ejecuta ./setup.sh." >&2; exit 1; }
.venv/bin/python -c 'import sys; sys.exit(sys.version_info < (3, 10))' || {
  echo "El entorno requiere Python 3.10 o posterior. Vuelve a configurarlo con ./setup.sh." >&2
  exit 1
}
mkdir -p data/logs

start_ollama() {
  if curl --fail --silent --max-time 2 http://127.0.0.1:11434/api/version >/dev/null; then
    return
  fi
  command -v ollama >/dev/null || { echo "Instala Ollama para utilizar --offline." >&2; exit 1; }
  echo "Iniciando Ollama…"
  ollama serve >data/logs/ollama.log 2>&1 &
  for attempt in $(seq 1 20); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:11434/api/version >/dev/null; then
      return
    fi
    sleep 1
  done
  echo "Ollama no arrancó. Consulta data/logs/ollama.log." >&2
  exit 1
}

start_voice_engine() {
  local engine_path="$1" engine_port="$2" engine_label="$3"
  [ -x "$engine_path" ] || return 0
  if curl --fail --silent --max-time 2 "http://127.0.0.1:$engine_port/version" >/dev/null; then
    return
  fi
  echo "Iniciando $engine_label…"
  (cd "$(dirname "$engine_path")" && ./run --host 127.0.0.1 --port "$engine_port") >"data/logs/$engine_label.log" 2>&1 &
}

start_phone_link() {
  local tailscale_bin="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  if command -v tailscale >/dev/null; then tailscale_bin="$(command -v tailscale)"; fi
  [ -x "$tailscale_bin" ] || { echo "Instala Tailscale para usar --phone." >&2; exit 1; }
  "$tailscale_bin" status >/dev/null || { echo "Conecta tu cuenta de Tailscale antes de usar --phone." >&2; exit 1; }
  "$tailscale_bin" serve --bg "$KAIWA_RUN_PORT"
  echo "Enlace privado del móvil activado. Consulta Ajustes → En tu móvil."
}

if "$KAIWA_RUN_OFFLINE"; then
  start_ollama
  start_voice_engine vendor/macos-x64/run 50021 voicevox
  start_voice_engine vendor/aivisspeech-engine/run 10101 aivisspeech
  echo "Selecciona Ollama en Ajustes para conversar con el modelo local."
fi
if "$KAIWA_RUN_PHONE"; then start_phone_link; fi

echo "Kaiwa — http://127.0.0.1:$KAIWA_RUN_PORT"
if "$KAIWA_RUN_BROWSER" && command -v open >/dev/null; then
  (sleep 2 && open "http://127.0.0.1:$KAIWA_RUN_PORT") &
fi
exec .venv/bin/python -m uvicorn server.main:app --host 127.0.0.1 --port "$KAIWA_RUN_PORT"
