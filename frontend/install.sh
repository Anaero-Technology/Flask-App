#!/bin/bash
set -euo pipefail

echo "Setting up React frontend..."

# Install curl if not present
if ! command -v curl &> /dev/null; then
    echo "Installing curl..."
    sudo apt update
    sudo apt install -y curl
fi

# Install Node.js LTS from NodeSource.
# Do NOT install Debian's separate `npm` package, it conflicts with NodeSource nodejs.
echo "Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt install -y nodejs

# Clean up setup script
rm -f nodesource_setup.sh

# Verify installation
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# Install project dependencies
echo "Installing project dependencies..."
npm install

echo "Frontend setup complete!"
echo "Run 'npm run dev' to start the development server."
