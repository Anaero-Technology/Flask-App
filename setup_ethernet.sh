#!/usr/bin/env bash
# setup_ethernet.sh — Configure mDNS hostname and ethernet direct-connection support
# Run once on a fresh Raspberry Pi to enable cable-only access via <hostname>.local
set -euo pipefail

HOSTNAME="${1:-chimera}"

echo "=== Ethernet Direct-Connection Setup ==="

# 1. Set the system hostname and update /etc/hosts
echo "[1/3] Setting hostname to '${HOSTNAME}'..."
OLD_HOSTNAME=$(hostname)
sudo hostnamectl set-hostname "$HOSTNAME"
# Update /etc/hosts so sudo can resolve the new hostname
sudo sed -i "s/127\.0\.1\.1.*${OLD_HOSTNAME}/127.0.1.1\t${HOSTNAME}/" /etc/hosts
# Ensure the entry exists even if the old hostname wasn't there
if ! grep -q "127.0.1.1" /etc/hosts; then
    echo "127.0.1.1	${HOSTNAME}" | sudo tee -a /etc/hosts >/dev/null
fi

# 2. Ensure avahi-daemon is installed and configured (mDNS/Bonjour)
echo "[2/3] Configuring avahi-daemon..."
if ! command -v avahi-daemon &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq avahi-daemon
fi

# Disable IPv6 in Avahi — rotating IPv6 privacy addresses cause
# constant hostname conflicts (chimera-2, chimera-3, etc.)
sudo sed -i 's/^use-ipv6=yes/use-ipv6=no/' /etc/avahi/avahi-daemon.conf
# Deny loopback to prevent self-conflicts
sudo sed -i 's/^#deny-interfaces=.*/deny-interfaces=lo/' /etc/avahi/avahi-daemon.conf
# Stop publishing AAAA (IPv6) records over IPv4 mDNS — avoids conflicts
# from rotating privacy addresses even with use-ipv6=no
sudo sed -i 's/^#publish-aaaa-on-ipv4=yes/publish-aaaa-on-ipv4=no/' /etc/avahi/avahi-daemon.conf

# Install avahi-utils for diagnostic commands (avahi-resolve, avahi-browse)
if ! command -v avahi-resolve &>/dev/null; then
    sudo apt-get install -y -qq avahi-utils
fi

sudo systemctl enable avahi-daemon
sudo systemctl restart avahi-daemon

# 3. Configure eth0 with DHCP + link-local fallback
echo "[3/3] Configuring eth0 (DHCP with link-local fallback)..."

# Find ANY ethernet connection for eth0 (active or not)
ETH_CONN=$(nmcli -t -f NAME,TYPE con show 2>/dev/null | grep ':.*ethernet$' | head -1 | cut -d: -f1)

if [ -z "$ETH_CONN" ]; then
    # No ethernet profile at all — create one
    ETH_CONN="Ethernet connection 1"
    sudo nmcli con add type ethernet ifname eth0 con-name "$ETH_CONN" \
        ipv4.method auto \
        ipv4.addresses 169.254.50.1/16 \
        ipv4.dhcp-timeout 3 \
        ipv4.never-default yes \
        ipv6.method link-local \
        connection.autoconnect yes
else
    # Modify existing profile (even if not currently active)
    sudo nmcli con modify "$ETH_CONN" \
        ipv4.method auto \
        ipv4.addresses 169.254.50.1/16 \
        ipv4.dhcp-timeout 3 \
        ipv4.never-default yes \
        ipv6.method link-local \
        connection.autoconnect yes
fi

echo "  Configured profile: $ETH_CONN"

# Reactivate the connection to apply changes (only if eth0 is plugged in)
sudo nmcli con up "$ETH_CONN" 2>/dev/null || true

echo ""
echo "=== Setup Complete ==="
echo "Hostname    : ${HOSTNAME}"
echo "mDNS URL    : http://${HOSTNAME}.local:5173"
echo "Fallback IP : 169.254.50.1 (link-local, for direct cable connections)"
echo ""
echo "Reboot recommended: sudo reboot"
