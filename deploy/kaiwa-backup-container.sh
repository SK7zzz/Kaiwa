#!/usr/bin/env bash
# Shared target selection for the root-installed backup/export helpers.
set -euo pipefail

load_backup_project() {
  [[ "${KAIWA_COMPOSE_PROJECT+x}" ]] && return 0
  local project_file="${KAIWA_BACKUP_PROJECT_FILE:-/etc/kaiwa/compose-project}"
  local additional_line=''
  KAIWA_COMPOSE_PROJECT=kaiwa-private
  [[ -e "$project_file" || -L "$project_file" ]] || return 0
  [[ -f "$project_file" && -r "$project_file" ]] \
    || { echo 'No se puede leer la configuración del proyecto de copias.' >&2; return 1; }
  # Read literal text, never shell syntax; reject a second line, even empty.
  {
    IFS= read -r KAIWA_COMPOSE_PROJECT || [[ -n "$KAIWA_COMPOSE_PROJECT" ]]
    ! IFS= read -r additional_line && [[ -z "$additional_line" ]]
  } < "$project_file" \
    || { echo 'La configuración del proyecto debe contener una única línea.' >&2; return 1; }
}

initialize_backup_target() {
  [[ "$(id -u)" == 0 ]] || { echo 'El helper de copias debe ejecutarse como root.' >&2; return 1; }
  KAIWA_DOCKER_HOST="${KAIWA_DOCKER_HOST:-unix:///var/run/docker.sock}"
  load_backup_project
  [[ "$KAIWA_DOCKER_HOST" == unix:///* ]] \
    || { echo 'Las copias requieren un socket Docker Unix explícito.' >&2; return 1; }
  [[ "$KAIWA_COMPOSE_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] \
    || { echo 'El proyecto Compose de copias no es válido.' >&2; return 1; }
  unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS_VERIFY DOCKER_CERT_PATH
}

kaiwa_docker() { docker --host "$KAIWA_DOCKER_HOST" "$@"; }

select_backup_container() {
  local matching_containers
  matching_containers="$(kaiwa_docker ps --quiet --no-trunc \
    --filter "label=com.docker.compose.project=$KAIWA_COMPOSE_PROJECT" \
    --filter label=com.docker.compose.service=kaiwa \
    --filter status=running)" || return 1
  [[ -n "$matching_containers" && "$matching_containers" != *$'\n'* ]] \
    || { echo 'Se requiere exactamente un servicio Kaiwa activo en el proyecto indicado.' >&2; return 1; }
  printf '%s' "$matching_containers"
}
