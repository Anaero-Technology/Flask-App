from flask import Blueprint, jsonify, request
import subprocess
import re

wifi_bp = Blueprint('wifi', __name__)

def get_wifi_networks_linux():
    """Scan for WiFi networks on Linux"""
    try:
        # Try nmcli first (NetworkManager)
        result = subprocess.run(
            ['nmcli', '-t', '-f', 'SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list'],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0:
            networks = []
            lines = result.stdout.strip().split('\n')

            for line in lines:
                if line.strip():
                    parts = line.split(':')
                    if len(parts) >= 2:
                        ssid = parts[0]
                        signal = parts[1] if len(parts) > 1 else 'N/A'
                        security = parts[2] if len(parts) > 2 else 'Open'

                        networks.append({
                            'ssid': ssid,
                            'signal': signal,
                            'security': security
                        })

            return networks

        # Fallback to iwlist
        result = subprocess.run(
            ['sudo', 'iwlist', 'wlan0', 'scan'],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode == 0:
            networks = []
            current_network = {}

            for line in result.stdout.split('\n'):
                line = line.strip()

                if 'ESSID:' in line:
                    essid = re.search(r'ESSID:"(.*)"', line)
                    if essid:
                        current_network['ssid'] = essid.group(1)

                elif 'Signal level=' in line:
                    signal = re.search(r'Signal level=(-?\d+)', line)
                    if signal:
                        current_network['signal'] = signal.group(1)

                elif 'Encryption key:' in line:
                    if 'on' in line.lower():
                        current_network['security'] = 'Secured'
                    else:
                        current_network['security'] = 'Open'

                    # End of network info, add to list
                    if 'ssid' in current_network:
                        networks.append(current_network.copy())
                    current_network = {}

            return networks

        return []
    except Exception as e:
        print(f"Error scanning WiFi networks on Linux: {e}")
        return []

def connect_to_wifi_linux(ssid, password):
    """Connect to WiFi network on Linux"""
    try:
        # Try nmcli first (NetworkManager)
        result = subprocess.run(
            ['nmcli', 'dev', 'wifi', 'connect', ssid, 'password', password],
            capture_output=True,
            text=True,
            timeout=30
        )

        if result.returncode == 0:
            return True, "Successfully connected to WiFi"
        else:
            return False, result.stderr or "Failed to connect"
    except Exception as e:
        return False, str(e)

@wifi_bp.route('/api/v1/wifi/scan', methods=['GET'])
def scan_wifi():
    """Scan for available WiFi networks (Linux only)"""
    try:
        networks = get_wifi_networks_linux()

        # Remove duplicates by SSID
        seen_ssids = set()
        unique_networks = []
        for network in networks:
            if network['ssid'] not in seen_ssids and network['ssid']:
                seen_ssids.add(network['ssid'])
                unique_networks.append(network)

        return jsonify({'networks': unique_networks})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@wifi_bp.route('/api/v1/wifi/connect', methods=['POST'])
def connect_wifi():
    """Connect to a WiFi network (Linux only)"""
    try:
        data = request.get_json()
        ssid = data.get('ssid')
        password = data.get('password', '')

        if not ssid:
            return jsonify({'error': 'SSID is required'}), 400

        success, message = connect_to_wifi_linux(ssid, password)

        if success:
            return jsonify({'message': message})
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500
