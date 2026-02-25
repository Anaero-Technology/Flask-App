#!/usr/bin/env bash
# setup_ethernet_no_mdns.sh
# Configure Ethernet direct-connect behavior WITHOUT Avahi/mDNS changes.
# Usage:
#   bash setup_ethernet_no_mdns.sh [iface] [fallback_cidr]
# Example:
#   bash setup_ethernet_no_mdns.sh eth0 169.254.50.1/16

set -euo pipefail

IFACE="${1:-eth0}"
FALLBACK_CIDR="${2:-169.254.50.1/16}"

echo "=== Ethernet Setup (No mDNS) ==="
echo "Interface      : ${IFACE}"
echo "Fallback CIDR  : ${FALLBACK_CIDR}"

if ! command -v nmcli >/dev/null 2>&1; then
    echo "Error: nmcli not found. Install NetworkManager first."
    echo "Try: sudo apt update && sudo apt install -y network-manager"
    exit 1
fi

if ! ip link show "${IFACE}" >/dev/null 2>&1; then
    echo "Error: interface '${IFACE}' not found."
    exit 1
fi

# Reuse an existing ethernet profile bound to this interface if present.
ETH_CONN="$(nmcli -t -f NAME,TYPE,DEVICE con show | awk -F: -v iface="${IFACE}" '$2=="ethernet" && $3==iface {print $1; exit}')"

if [ -z "${ETH_CONN}" ]; then
    ETH_CONN="Ethernet ${IFACE}"
    echo "Creating connection profile: ${ETH_CONN}"
    sudo nmcli con add type ethernet ifname "${IFACE}" con-name "${ETH_CONN}" \
        connection.autoconnect yes \
        ipv4.method auto \
        ipv4.addresses "${FALLBACK_CIDR}" \
        ipv4.dhcp-timeout 3 \
        ipv4.never-default yes \
        ipv6.method link-local
else
    echo "Updating connection profile: ${ETH_CONN}"
    sudo nmcli con modify "${ETH_CONN}" \
        connection.autoconnect yes \
        ipv4.method auto \
        ipv4.addresses "${FALLBACK_CIDR}" \
        ipv4.dhcp-timeout 3 \
        ipv4.never-default yes \
        ipv6.method link-local
fi

# Bring connection up; if cable is unplugged this may fail, which is okay.
sudo nmcli con up "${ETH_CONN}" >/dev/null 2>&1 || true

echo ""
echo "Done."
echo "- DHCP is attempted first on ${IFACE}."
echo "- If no DHCP server is present, use fallback direct-connect address: ${FALLBACK_CIDR%/*}"
echo "- No Avahi/mDNS settings were changed."
echo ""
echo "To check addresses:"
echo "  ip -4 addr show ${IFACE}"
