#!/bin/bash

# Activate virtual environment
source venv/bin/activate

# Install libraries
pip install -r requirements.txt

echo "Starting Server..." 
gunicorn --worker-class gevent --worker-connections 1000 --timeout 30 -w 1 -b :6000 app:app
echo "Closing Server Down. "