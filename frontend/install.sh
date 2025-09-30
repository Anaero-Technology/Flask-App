#!/bin/bash

set -e  # Exit on any error

echo "Setting up React frontend..."

# Install curl if not present
if ! command -v curl &> /dev/null; then
    echo "Installing curl..."
    sudo apt update
    sudo apt install -y curl
fi

# Install Node.js LTS 
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs npm

# Clean up setup script
rm -f nodesource_setup.sh

# Verify installation
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install project dependencies
echo "Installing project dependencies..."
npm install

# Install Vite globally for convenience
echo "Installing Vite..."
npm install -D vite

echo "Frontend setup complete!"
echo "Run 'npm run dev' to start the development server."