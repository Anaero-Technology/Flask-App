from flask import Blueprint, jsonify, request
import subprocess
import re
import platform

wifi_bp = Blueprint('wifi', __name__)

def get_wifi_networks_macos():
    """Scan for WiFi networks on macOS"""
    try:
        # Use system_profiler to get WiFi networks
        result = subprocess.run(
            ['system_profiler', 'SPAirPortDataType'],
            capture_output=True,
            text=True,
            timeout=15
        )

        if result.returncode != 0:
            print(f"system_profiler failed with return code: {result.returncode}")
            print(f"stderr: {result.stderr}")
            return []

        networks = []
        lines = result.stdout.split('\n')

        # Parse the "Other Local Wi-Fi Networks:" section
        in_other_networks = False
        current_ssid = None
        current_network = {}

        for line in lines:
            stripped = line.strip()

            if 'Other Local Wi-Fi Networks:' in line:
                in_other_networks = True
                continue

            if not in_other_networks:
                continue

            # New network entry (ends with :)
            if stripped.endswith(':') and not any(x in stripped for x in ['PHY Mode', 'Channel', 'Network Type', 'Security', 'Signal']):
                # Save previous network if it exists
                if current_ssid and current_network:
                    current_network['ssid'] = current_ssid
                    networks.append(current_network.copy())

                # Start new network
                current_ssid = stripped[:-1]  # Remove the trailing ':'
                current_network = {
                    'signal': 'N/A',
                    'security': 'Unknown'
                }

            # Parse network details
            if current_ssid:
                if 'Security:' in line:
                    security = stripped.split('Security:')[1].strip()
                    current_network['security'] = security if security else 'Open'
                elif 'Signal / Noise:' in line:
                    match = re.search(r'(-?\d+)\s*dBm', stripped)
                    if match:
                        current_network['signal'] = match.group(1)

        # Add the last network
        if current_ssid and current_network:
            current_network['ssid'] = current_ssid
            networks.append(current_network.copy())

        # Filter out invalid networks (interface names, system entries, etc.)
        filtered_networks = []
        for net in networks:
            ssid = net['ssid']
            # Skip system entries and interface names
            if ssid in ['awdl0', 'llw0', 'Current Network Information'] or ssid.startswith('en'):
                continue
            # Skip empty SSIDs
            if not ssid or ssid.strip() == '':
                continue
            filtered_networks.append(net)

        print(f"Found {len(filtered_networks)} WiFi networks on macOS")
        return filtered_networks

    except subprocess.TimeoutExpired:
        print("WiFi scan timed out on macOS")
        return []
    except Exception as e:
        print(f"Error scanning WiFi networks on macOS: {e}")
        import traceback
        traceback.print_exc()
        return []

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

def connect_to_wifi_macos(ssid, password):
    """Connect to WiFi network on macOS"""
    try:
        # Use networksetup to connect
        result = subprocess.run(
            ['networksetup', '-setairportnetwork', 'en0', ssid, password],
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
    """Scan for available WiFi networks"""
    try:
        system = platform.system()

        if system == 'Darwin':  # macOS
            networks = get_wifi_networks_macos()
        elif system == 'Linux':
            networks = get_wifi_networks_linux()
        else:
            return jsonify({'error': 'Unsupported operating system'}), 400

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
    """Connect to a WiFi network"""
    try:
        data = request.get_json()
        ssid = data.get('ssid')
        password = data.get('password', '')

        if not ssid:
            return jsonify({'error': 'SSID is required'}), 400

        system = platform.system()

        if system == 'Darwin':  # macOS
            success, message = connect_to_wifi_macos(ssid, password)
        elif system == 'Linux':
            success, message = connect_to_wifi_linux(ssid, password)
        else:
            return jsonify({'error': 'Unsupported operating system'}), 400

        if success:
            return jsonify({'message': message})
        else:
            return jsonify({'error': message}), 400

    except Exception as e:
        return jsonify({'error': str(e)}), 500
