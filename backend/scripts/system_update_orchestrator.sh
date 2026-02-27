#!/bin/bash
set -Eeuo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
LOG_DIR="${BACKEND_DIR}/logs"
LOG_FILE="${LOG_DIR}/update_orchestrator.log"
UPDATE_SCRIPT="${BACKEND_DIR}/scripts/safe_git_update.sh"
APP_USER="${FLASKAPP_USER:-anaero}"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

log() {
  echo "[$(timestamp)] $*"
}

stop_services() {
  log "Stopping services before update"
  systemctl stop flaskapp-frontend.service || true
  systemctl stop flaskapp-backend.service || true
}

start_services() {
  log "Starting services after update"
  systemctl start flaskapp-backend.service || true
  systemctl start flaskapp-frontend.service || true
}

main() {
  log "Orchestrator started"

  if [[ ! -f "${UPDATE_SCRIPT}" ]]; then
    log "ERROR: update script not found at ${UPDATE_SCRIPT}"
    exit 2
  fi

  if ! id "${APP_USER}" >/dev/null 2>&1; then
    log "ERROR: app user '${APP_USER}' does not exist"
    exit 2
  fi

  stop_services

  local rc=0
  if ! runuser -u "${APP_USER}" -- /bin/bash "${UPDATE_SCRIPT}"; then
    rc=$?
    log "Update script failed with exit code ${rc}"
  fi

  start_services

  if [[ "${rc}" -ne 0 ]]; then
    log "Orchestrator completed with failure"
    exit "${rc}"
  fi

  log "Orchestrator completed successfully"
}

main "$@"
