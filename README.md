# Flask Device Management Application

A full-stack application for managing and monitoring BlackBox and Chimera devices with real-time data streaming.

## System Requirements

- **Operating System**: Ubuntu/Debian Linux (or WSL on Windows)
- **Python**: 3.8 or higher
- **Node.js**: 20.x LTS (automatically installed)
- **Redis**: Required for real-time SSE streaming
- **Hardware**: Serial port access for device communication

## Installation Instructions

### 1. Clone Repository
```bash
git clone https://github.com/Anaero-Technology/Flask-App.git
cd Flask-App
```

### 2. Backend Setup
```bash
cd backend
chmod +x start.sh
./start.sh
```

The backend script will automatically:
- Create Python virtual environment
- Install Python dependencies
- Install and configure Redis server
- Copy .env.example to .env (if needed)
- Initialize database tables
- Start the Flask server on port 6000

### 3. Frontend Setup
```bash
cd ../frontend
chmod +x install.sh
./install.sh
```

The frontend script will automatically:
- Install Node.js 20.x LTS
- Install project dependencies
- Install Vite build tool

### 4. Start Frontend Development Server
```bash
npm run dev
```

### 5. Network Setup (Raspberry Pi)
```bash
bash setup_ethernet.sh
sudo reboot
```

This configures:
- **mDNS hostname** (`chimera.local`) via Avahi so devices can be accessed without knowing the IP
- **Ethernet direct-connection** for cable-only access (DHCP with link-local fallback at `169.254.50.1`)
- **Avahi safety settings** to prevent IPv6-related hostname conflicts

After reboot, access the app from any device on the network at `http://chimera.local:5173`.

To use a custom hostname: `bash setup_ethernet.sh myhostname` (default is `chimera`).

The hostname can also be changed at runtime from **Settings > Network** in the web UI (admin only).

## Configuration

### Environment Variables
Edit `backend/.env` to configure:
- Database settings
- Redis connection
- Serial port preferences
- API keys (if needed)

### First Run
1. Connect your BlackBox/Chimera devices via USB/Serial
2. Navigate to `http://chimera.local:5173` (or `http://localhost:5173` if not on a Pi)
3. The backend API runs on port 6000

## Features

- **Device Management**: Auto-discovery and registration of BlackBox/Chimera devices
- **Real-time Monitoring**: Live tip/datapoint streaming via Server-Sent Events
- **Test Management**: Automatic test creation and data logging
- **Data Recovery**: Automatic detection and recovery of missing tip data
- **Database Storage**: All device data stored with full traceability

## API Documentation

See `backend/API_DOCUMENTATION.md` for complete API reference.

## Troubleshooting

### Redis Issues
If Redis fails to start:
```bash
sudo systemctl status redis-server
sudo systemctl restart redis-server
```

### Database Issues
To reset database:
```bash
cd backend
rm -f instance/database.db  # SQLite database
./start.sh  # Will recreate tables
```

### Port Conflicts
- Frontend (default 5173): Change in `vite.config.js`
- Backend (default 6000): Change in `start.sh` gunicorn command
