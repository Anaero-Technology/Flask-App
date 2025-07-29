#!/bin/bash

# Activate virtual environment
source venv/bin/activate

# Install libraries
pip install -r requirements.txt

echo "Starting Server..." 
gunicorn -w 1 -b :6000 app:app
echo "Closing Server Down. "