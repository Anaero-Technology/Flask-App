#!/bin/bash

set -e  # Exit on any error

echo "Setting up Flask backend..."

# Check if virtual environment exists, create if not
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install Python dependencies
echo "Installing Python dependencies..."
pip install --upgrade pip
pip install -r requirements.txt

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "Warning: .env file not found. Copying from .env.example..."
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "Please configure .env file before running the server."
    else
        echo "Error: .env.example not found. Please create .env file manually."
        exit 1
    fi
fi

# Check if Redis is installed
if ! command -v redis-server &> /dev/null; then
    echo "Redis not found. Installing Redis..."
    sudo apt-get update
    sudo apt-get install -y redis-server
    sudo systemctl enable redis-server
fi

# Start Redis if not running
if ! pgrep -x "redis-server" > /dev/null; then
    echo "Starting Redis server..."
    sudo systemctl start redis-server
else
    echo "Redis server is already running."
fi

echo "Starting Flask server..." 
gunicorn --worker-class gevent --worker-connections 1000 --timeout 30 -w 1 -b :6000 app:app
echo "Server stopped."