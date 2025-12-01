#!/bin/bash
set -e

echo "Setting up Flask backend..."

# Virtual environment
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate

# Dependencies
pip install --upgrade pip -q
pip install -r requirements.txt -q

# Env file
if [ ! -f ".env" ]; then
    cp .env.example .env 2>/dev/null || { echo "Create .env file manually"; exit 1; }
fi

# Start Redis in background (no sudo)
if ! pgrep -x "redis-server" > /dev/null; then
    echo "Starting Redis..."
    redis-server --daemonize yes
fi

echo "Starting Flask server..."
gunicorn --worker-class gevent --worker-connections 1000 --timeout 30 -w 1 -b :6000 app:app