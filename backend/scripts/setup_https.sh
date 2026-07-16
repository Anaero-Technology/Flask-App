#!/bin/bash
set -Eeuo pipefail

# nginx front door for the Flask-App appliance. Idempotent; run as root.
#
# Installs nginx on ports 80/443 in front of the app so users can browse to
# http://<device> with no port number:
#   - serves frontend/dist statically (the :5173 vite preview service keeps
#     working as a legacy fallback, but nginx is the supported front door)
#   - proxies /api and /stream to gunicorn on 127.0.0.1:6000 (SSE unbuffered)
#   - port 80 serves the app directly. It deliberately does NOT redirect to
#     HTTPS: with a self-signed cert, browsers show a full-page "connection
#     is not private" interstitial, which is far more alarming to lab users
#     than http's quiet "Not secure" chip.
#   - HTTPS on 443 is available opt-in with a per-device CA + server cert
#     (no public domain exists on a LAN appliance, so a publicly trusted
#     cert is impossible). Labs that want a warning-free padlock install the
#     CA once per client machine from http://<device>/ca.crt and use
#     https://<device>.
#
# Called from system_update_orchestrator.sh on every fleet update, and
# manually from the README install steps. Safe to re-run: it only installs /
# generates what is missing, but ALWAYS rewrites the nginx site config —
# hand edits to /etc/nginx/sites-available/flaskapp will be overwritten.

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export DEBIAN_FRONTEND=noninteractive

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
APP_USER="${FLASKAPP_USER:-anaero}"
FRONTEND_DIST="${PROJECT_ROOT}/frontend/dist"
BACKEND_ENV="${PROJECT_ROOT}/backend/.env"

SSL_DIR="/etc/flaskapp/ssl"
CA_KEY="${SSL_DIR}/ca.key"
CA_CRT="${SSL_DIR}/ca.crt"
SERVER_KEY="${SSL_DIR}/server.key"
SERVER_CRT="${SSL_DIR}/server.crt"
SITE_AVAILABLE="/etc/nginx/sites-available/flaskapp"
SITE_ENABLED="/etc/nginx/sites-enabled/flaskapp"

# Apple platforms reject user-trusted leaf certs valid for more than 825
# days, so stay under that; the CA can be long-lived.
CA_DAYS=3650
LEAF_DAYS=820
RENEW_BEFORE_SECONDS=$((30 * 24 * 3600))

log() {
  echo "[setup-https] $*"
}

if [[ "$(id -u)" -ne 0 ]]; then
  log "ERROR: must run as root (try: sudo bash $0)"
  exit 1
fi

# --- 1. nginx ---------------------------------------------------------------

if ! command -v nginx >/dev/null 2>&1; then
  log "nginx not installed; installing via apt"
  # Tolerate stale index files on airgapped/flaky networks; only fail if the
  # install itself fails.
  apt-get update -qq || true
  if ! apt-get install -y -qq nginx; then
    log "WARNING: could not install nginx (offline?). Skipping HTTPS setup;"
    log "         the app remains reachable on http://<device>:5173."
    exit 0
  fi
fi

# --- 2. Certificates --------------------------------------------------------

mkdir -p "${SSL_DIR}"
chmod 755 /etc/flaskapp "${SSL_DIR}"

if [[ ! -f "${CA_KEY}" || ! -f "${CA_CRT}" ]]; then
  log "Generating device CA"
  openssl ecparam -name prime256v1 -genkey -noout -out "${CA_KEY}"
  openssl req -x509 -new -key "${CA_KEY}" -sha256 -days "${CA_DAYS}" \
    -subj "/O=Anaero Technology/CN=Anaero Device CA ($(hostname))" \
    -out "${CA_CRT}"
fi

leaf_needs_regen() {
  [[ ! -f "${SERVER_KEY}" || ! -f "${SERVER_CRT}" ]] && return 0
  # Renew when within 30 days of expiry
  if ! openssl x509 -in "${SERVER_CRT}" -checkend "${RENEW_BEFORE_SECONDS}" >/dev/null 2>&1; then
    log "Server certificate expires within 30 days"
    return 0
  fi
  return 1
}

if leaf_needs_regen; then
  log "Generating server certificate"

  # Cover every name/address users are told to type (README + device screen).
  SAN="DNS:chimera.local,DNS:$(hostname),DNS:$(hostname).local,DNS:localhost,IP:127.0.0.1,IP:169.254.50.1"
  for ip in $(hostname -I); do
    # IPv4 only: link-local IPv6 addresses churn and bloat the SAN list
    if [[ "${ip}" == *.*.*.* ]]; then
      SAN="${SAN},IP:${ip}"
    fi
  done
  log "Certificate SANs: ${SAN}"

  openssl ecparam -name prime256v1 -genkey -noout -out "${SERVER_KEY}"
  openssl req -new -key "${SERVER_KEY}" \
    -subj "/O=Anaero Technology/CN=chimera.local" |
    openssl x509 -req -CA "${CA_CRT}" -CAkey "${CA_KEY}" -CAcreateserial \
      -sha256 -days "${LEAF_DAYS}" \
      -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n" "${SAN}") \
      -out "${SERVER_CRT}"
fi

chmod 600 "${CA_KEY}" "${SERVER_KEY}"
chmod 644 "${CA_CRT}" "${SERVER_CRT}"

# --- 3. Filesystem access for nginx -----------------------------------------

# The dist directory lives under the app user's home (mode 700 on this OS).
# Grant traverse-only (o+x, not o+r) so www-data can reach it; in exchange,
# make sure the backend secrets file is not world-readable.
APP_HOME="$(getent passwd "${APP_USER}" | cut -d: -f6)"
if [[ -n "${APP_HOME}" && "${FRONTEND_DIST}" == "${APP_HOME}"* ]]; then
  chmod o+x "${APP_HOME}"
fi
if [[ -f "${BACKEND_ENV}" ]]; then
  chmod 600 "${BACKEND_ENV}"
  chown "${APP_USER}:${APP_USER}" "${BACKEND_ENV}"
fi

# --- 4. nginx site config ---------------------------------------------------

log "Writing ${SITE_AVAILABLE}"
cat > "${SITE_AVAILABLE}" <<EOF
# Managed by Flask-App backend/scripts/setup_https.sh — do not hand-edit,
# fleet updates rewrite this file.

# One server block on both ports: plain HTTP on 80 (the default users are
# sent to — no self-signed-certificate interstitial), TLS on 443 for labs
# that have installed the device CA.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    ssl_certificate     ${SERVER_CRT};
    ssl_certificate_key ${SERVER_KEY};
    ssl_protocols       TLSv1.2 TLSv1.3;

    root ${FRONTEND_DIST};
    index index.html;

    # Largest legitimate upload is a CSV test configuration / sample image
    client_max_body_size 25m;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # Device CA download so client machines can trust this appliance
    location = /ca.crt {
        alias ${CA_CRT};
        default_type application/x-x509-ca-cert;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:6000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    # Per-device SSE endpoints also live under /api/ (e.g.
    # /api/v1/chimera/3/stream). They must not be buffered, or events sit in
    # nginx until the connection dies and live UI (chimera status ring)
    # silently stops updating.
    location ~ ^/api/v1/(chimera|black_box)/[0-9]+/stream\$ {
        proxy_pass http://127.0.0.1:6000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }

    # Server-sent events: no buffering, effectively no read timeout
    location /stream {
        proxy_pass http://127.0.0.1:6000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }

    # SPA fallback
    location / {
        try_files \$uri /index.html;
    }
}
EOF

ln -sf "${SITE_AVAILABLE}" "${SITE_ENABLED}"
# The stock default site also binds :80 default_server and would conflict
rm -f /etc/nginx/sites-enabled/default

# --- 5. Apply ----------------------------------------------------------------

nginx -t
systemctl enable --now nginx >/dev/null 2>&1
systemctl reload nginx

log "Done. App is served at:"
log "  http://$(hostname -I | awk '{print $1}')  (and http://chimera.local in mDNS mode)"
log "Optional HTTPS on https://<device> — install http://<device>/ca.crt on"
log "client machines first, or browsers will warn that the cert is untrusted."
