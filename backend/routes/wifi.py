from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from utils import wifi_manager

wifi_bp = Blueprint('wifi', __name__)


@wifi_bp.route('/api/v1/wifi/scan', methods=['GET'])
@jwt_required()
def scan_wifi():
    """Scan for available WiFi networks"""
    try:
        networks, adapter_error = wifi_manager.scan_networks()

        if adapter_error:
            return jsonify({'error': adapter_error, 'networks': []})

        # Remove duplicates by SSID (keep first occurrence = strongest)
        seen_ssids = set()
        unique_networks = []
        for network in networks:
            if network['ssid'] not in seen_ssids and network['ssid']:
                seen_ssids.add(network['ssid'])
                unique_networks.append(network)

        return jsonify({'networks': unique_networks})

    except Exception as e:
        print(f"[WIFI] Scan error: {e}")
        return jsonify({'error': 'WiFi scan failed'}), 500


@wifi_bp.route('/api/v1/wifi/connect', methods=['POST'])
@jwt_required()
def connect_wifi():
    """Connect to a WiFi network.

    Request body:
        {
            "ssid": "string",           # required
            "password": "string",
            "username": "string",       # WPA-Enterprise (802.1X) only
            "security": "string",       # as reported by /wifi/scan
            "eap_method": "peap|ttls|pwd",          # optional, default peap
            "phase2": "mschapv2|pap|chap|..."        # optional, default mschapv2
        }
    """
    try:
        data = request.get_json() or {}
        ssid = data.get('ssid')
        password = data.get('password', '')
        username = data.get('username', '') or None
        security = data.get('security', '')
        eap_method = data.get('eap_method') or None
        phase2 = data.get('phase2') or None

        if not ssid:
            return jsonify({'error': 'SSID is required'}), 400

        success, message = wifi_manager.connect(
            ssid, password,
            username=username,
            security=security,
            eap_method=eap_method,
            phase2=phase2
        )

        if success:
            return jsonify({'message': message})
        return jsonify({'error': message}), 400

    except Exception as e:
        print(f"[WIFI] Connect error: {e}")
        return jsonify({'error': 'WiFi connection failed'}), 500
