#!/usr/bin/env bash
#
# Local demo: the full app against a simulated PLC with the pH controller module.
#
#   ./demo.sh                 start everything (first run installs dependencies)
#   ./demo.sh --reset         also wipe the demo database and the simulated PLC
#   ./demo.sh --speed 20      process time multiplier for the simulator (default 10)
#
# Then open http://localhost:5173 and sign in as  admin / demo1234
# Ctrl+C stops everything.
#
# Needs: python3 (3.9+), Node.js 20+, redis-server
#   macOS:  brew install python node redis
#   Debian: sudo apt install python3-venv nodejs npm redis-server
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
SIM="$ROOT/simulator"
LOGS="$SIM/.logs"
SPEED=10
RESET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --reset) RESET=1; shift ;;
    --speed) SPEED="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing '$1'. $2"; exit 1; }; }
need python3 "Install Python 3.9+."
need node    "Install Node.js 20+ (macOS: brew install node)."
need npm     "Install npm (comes with Node.js)."
need redis-server "Install Redis (macOS: brew install redis, Debian: sudo apt install redis-server)."

mkdir -p "$LOGS"

# ---- backend -----------------------------------------------------------------
if [[ ! -x "$BACKEND/venv/bin/python" ]]; then
  echo "==> Creating backend virtualenv and installing dependencies (first run only)"
  python3 -m venv "$BACKEND/venv"
  "$BACKEND/venv/bin/pip" install -q --upgrade pip
  "$BACKEND/venv/bin/pip" install -q -r "$BACKEND/requirements.txt"
fi

if [[ ! -f "$BACKEND/.env" ]]; then
  echo "==> Writing backend/.env (SQLite demo database)"
  cp "$BACKEND/.env.example" "$BACKEND/.env"
fi
# Use a dedicated demo database so this never touches a real one.
if grep -q '^SQLALCHEMY_DATABASE_URI' "$BACKEND/.env"; then
  sed -i.bak 's|^SQLALCHEMY_DATABASE_URI.*|SQLALCHEMY_DATABASE_URI = "sqlite:///demo.db"|' "$BACKEND/.env" && rm -f "$BACKEND/.env.bak"
else
  echo 'SQLALCHEMY_DATABASE_URI = "sqlite:///demo.db"' >> "$BACKEND/.env"
fi

if [[ $RESET -eq 1 ]]; then
  echo "==> Resetting demo database and simulated PLC"
  rm -f "$BACKEND/instance/demo.db" "$BACKEND/demo.db"
  rm -rf "$SIM/.state"
fi

# ---- frontend ----------------------------------------------------------------
if [[ ! -d "$FRONTEND/node_modules" ]]; then
  echo "==> Installing frontend dependencies (first run only)"
  (cd "$FRONTEND" && npm ci --no-audit --no-fund)
fi

# ---- redis -------------------------------------------------------------------
STARTED_REDIS=0
if ! redis-cli ping >/dev/null 2>&1; then
  echo "==> Starting Redis"
  redis-server --daemonize yes --save "" --appendonly no >/dev/null
  STARTED_REDIS=1
  sleep 0.5
fi

# ---- demo login --------------------------------------------------------------
(cd "$BACKEND" && DISABLE_AUTO_CONNECT=1 venv/bin/flask --app app create-admin \
   --username admin --email admin@example.com --password demo1234 2>/dev/null \
   | grep -v DEBUG | grep -E "created|already" || true)

# ---- processes ---------------------------------------------------------------
PIDS=()
cleanup() {
  echo
  echo "==> Stopping demo"
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  if [[ $STARTED_REDIS -eq 1 ]]; then redis-cli shutdown nosave >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM

echo "==> Starting simulated PLC (x$SPEED process time)"
python3 "$SIM/plc_simulator.py" --speed "$SPEED" > "$LOGS/simulator.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 50); do [[ -e "$SIM/.state/ttySIMPLC" ]] && break; sleep 0.1; done
PORT_LINK="$SIM/.state/ttySIMPLC"

echo "==> Starting backend on :6000"
(cd "$BACKEND" && SIMULATED_SERIAL_PORTS="$PORT_LINK" exec venv/bin/gunicorn \
   --worker-class gevent --worker-connections 1000 --timeout 30 -w 1 -b 127.0.0.1:6000 app:app) \
   > "$LOGS/backend.log" 2>&1 &
PIDS+=($!)

echo "==> Starting frontend on :5173"
(cd "$FRONTEND" && exec npx vite --port 5173 --strictPort) > "$LOGS/frontend.log" 2>&1 &
PIDS+=($!)

cat <<EOF

  Demo is starting - give it ~15 s for the PLC to be found.

    Open      http://localhost:5173
    Sign in   admin / demo1234
    Then      PLC in the sidebar (appears once the simulated PLC connects)

  Logs: $LOGS
  Ctrl+C to stop.

EOF

# Stop everything if any one of them dies.
while true; do
  for pid in ${PIDS[@]+"${PIDS[@]}"}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "A demo process exited - see $LOGS"; exit 1
    fi
  done
  sleep 2
done
