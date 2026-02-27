# Flask Device Management Application

Full-stack app for managing and monitoring device tests (Flask backend + React/Vite frontend).

## Requirements

- Debian/Ubuntu (Raspberry Pi OS supported)
- Python 3.8+
- Node.js 20+
- Redis
- USB/serial access for connected devices

## Install (Steps 1 to 7)

### 1. Clone the repository

```bash
git clone https://github.com/Anaero-Technology/Flask-App.git
cd Flask-App
```

### 2. Set up backend (creates venv, installs deps, prepares `.env`)

```bash
cd backend
chmod +x start.sh
./start.sh
```

`start.sh` ends by starting Gunicorn. After you confirm it starts, stop it with `Ctrl+C`.

### 3. Set up frontend dependencies

```bash
cd ../frontend
chmod +x install.sh
./install.sh
npm run build
```

### 4. Create the first admin user

```bash
cd ../backend
source venv/bin/activate
flask create-admin
```

### 5. Configure networking on Raspberry Pi

No-mDNS option (recommended if you want to avoid Avahi/mDNS):

```bash
cd ..
bash setup_ethernet_no_mdns.sh
```

mDNS option (`chimera.local`):

```bash
bash setup_ethernet.sh
```

### 6. Create systemd services (backend + frontend + updater)

Replace paths/usernames below if your install path is different.

#### Backend service

Create `/etc/systemd/system/flaskapp-backend.service`:

```ini
[Unit]
Description=Flaskapp Backend
After=network-online.target redis-server.service
Wants=network-online.target

[Service]
Type=simple
User=anaero
Group=anaero
WorkingDirectory=/home/anaero/Flask-App/backend
Environment=PATH=/home/anaero/Flask-App/backend/venv/bin
ExecStart=/home/anaero/Flask-App/backend/venv/bin/gunicorn --worker-class gevent --worker-connections 1000 --timeout 30 -w 1 -b 0.0.0.0:6000 app:app
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

#### Frontend service

Create `/etc/systemd/system/flaskapp-frontend.service`:

```ini
[Unit]
Description=Flaskapp Frontend (Vite)
After=network-online.target flaskapp-backend.service
Wants=network-online.target

[Service]
Type=simple
User=anaero
Group=anaero
WorkingDirectory=/home/anaero/Flask-App/frontend
ExecStart=/usr/bin/npm run preview -- --host 0.0.0.0 --port 5173
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

#### Updater service

Create `/etc/systemd/system/flaskapp-updater.service`:

```ini
[Unit]
Description=Flaskapp Safe Updater
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
WorkingDirectory=/home/anaero/Flask-App
Environment=FLASKAPP_USER=anaero
ExecStart=/bin/bash /home/anaero/Flask-App/backend/scripts/system_update_orchestrator.sh
```

Allow the backend service user to start (but not edit) the updater service without a password:

```bash
sudo visudo -f /etc/sudoers.d/flaskapp-updater
```

Add this line:

```text
anaero ALL=(root) NOPASSWD: /bin/systemctl start flaskapp-updater.service, /bin/systemctl is-active --quiet flaskapp-updater.service
```

Load and start services:

```bash
sudo systemctl enable --now redis-server
sudo systemctl daemon-reload
sudo systemctl enable flaskapp-backend flaskapp-frontend
sudo systemctl restart flaskapp-backend flaskapp-frontend
```

### 7. Reboot and verify

```bash
sudo reboot
```

After reboot:

```bash
systemctl status flaskapp-backend --no-pager
systemctl status flaskapp-frontend --no-pager
journalctl -u flaskapp-backend -n 80 --no-pager
journalctl -u flaskapp-frontend -n 80 --no-pager
```

Access the app:

- Local device: `http://localhost:5173`
- Wi-Fi/LAN: `http://<pi_wifi_ip>:5173`
- Ethernet fallback (if using `setup_ethernet_no_mdns.sh`): `http://169.254.50.1:5173`
- mDNS mode (if using `setup_ethernet.sh`): `http://chimera.local:5173`

## API docs

See `backend/API_DOCUMENTATION.md`.

## Troubleshooting

### `status=200/CHDIR` in backend service

This means the `WorkingDirectory` or `ExecStart` path in the service file does not exist for that user.

Quick checks:

```bash
ls -la /home/anaero/Flask-App/backend
ls -la /home/anaero/Flask-App/backend/venv/bin/gunicorn
sudo systemctl cat flaskapp-backend
```

If your repo directory is `FlaskApp` (no hyphen) instead of `Flask-App`, update both `WorkingDirectory` and `ExecStart` in the service file to match exactly.

### Frontend service cannot find `npm`

```bash
which npm
```

If it is not `/usr/bin/npm`, update `ExecStart` in `flaskapp-frontend.service` to the correct absolute path.
