#!/bin/bash
set -Eeuo pipefail

# Some service managers provide a minimal environment without PATH.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKEND_DIR="${PROJECT_ROOT}/backend"
FRONTEND_DIR="${PROJECT_ROOT}/frontend"
LOCK_FILE="/tmp/flaskapp_update.lock"
LOG_DIR="${BACKEND_DIR}/logs"
LOG_FILE="${LOG_DIR}/update.log"

BRANCH="${UPDATE_BRANCH:-master}"
TARGET_REF="origin/${BRANCH}"

mkdir -p "${LOG_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

log() {
  echo "[$(timestamp)] $*"
}

retry() {
  local attempts="$1"
  shift
  local n=1
  until "$@"; do
    if [[ "${n}" -ge "${attempts}" ]]; then
      return 1
    fi
    sleep $((n * 2))
    n=$((n + 1))
  done
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    log "ERROR: required command '$1' is not installed"
    exit 2
  }
}

rollback() {
  local old_commit="$1"
  log "Rollback started (target commit: ${old_commit})"
  git -C "${PROJECT_ROOT}" reset --hard "${old_commit}"
  "${BACKEND_DIR}/venv/bin/pip" install --disable-pip-version-check --quiet -r "${BACKEND_DIR}/requirements.txt"
  (
    cd "${FRONTEND_DIR}"
    npm install --no-audit --no-fund --silent
  )
  log "Rollback completed"
}

main() {
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "Another update is already running"
    exit 42
  fi

  require_cmd git
  require_cmd npm
  require_cmd flock

  if [[ ! -x "${BACKEND_DIR}/venv/bin/pip" ]]; then
    log "ERROR: backend virtualenv not found at ${BACKEND_DIR}/venv"
    exit 2
  fi

  local status
  status="$(git -C "${PROJECT_ROOT}" status --porcelain --untracked-files=no)"
  if [[ -n "${status}" ]]; then
    log "ERROR: Refusing update because tracked local changes exist in repository"
    echo "${status}"
    exit 3
  fi

  local old_commit new_commit remote_commit
  old_commit="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
  log "Starting update from commit ${old_commit}"

  retry 3 git -C "${PROJECT_ROOT}" fetch --prune origin
  remote_commit="$(git -C "${PROJECT_ROOT}" rev-parse "${TARGET_REF}")"

  if [[ "${old_commit}" == "${remote_commit}" ]]; then
    log "Already up to date (${old_commit}). Skipping dependency sync and frontend build."
    exit 0
  fi

  if ! (
    git -C "${PROJECT_ROOT}" reset --hard "${TARGET_REF}"
    new_commit="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
    log "Checked out ${new_commit}"

    "${BACKEND_DIR}/venv/bin/pip" install --disable-pip-version-check --quiet -r "${BACKEND_DIR}/requirements.txt"
    "${BACKEND_DIR}/venv/bin/python" -m py_compile "${BACKEND_DIR}/app.py"

    (
      cd "${FRONTEND_DIR}"
      npm install --no-audit --no-fund --silent
      npm run build --silent
    )
  ); then
    log "Update failed. Attempting rollback..."
    rollback "${old_commit}" || log "WARNING: rollback encountered errors"
    exit 1
  fi

  new_commit="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
  log "Update finished successfully (${old_commit} -> ${new_commit})"
  log "Reboot required to run updated backend/frontend services cleanly"
}

main "$@"
