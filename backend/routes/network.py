from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
import ipaddress
from utils.auth import require_role
from utils.errors import internal_error
from utils import wifi_manager

network_bp = Blueprint('network', __name__)


@network_bp.route('/api/v1/network/status', methods=['GET'])
@jwt_required()
def network_status():
    """Live per-interface status (ethernet + wifi) for the Settings page."""
    try:
        return jsonify({
            "interfaces": wifi_manager.get_network_status(),
            "rescue_address": wifi_manager.RESCUE_ADDRESS,
        }), 200
    except Exception as e:
        return internal_error(e)


def _validate_static_config(data):
    """Return (parsed_config, error_message)."""
    address = (data.get('address') or '').strip()
    gateway = (data.get('gateway') or '').strip()
    dns_raw = (data.get('dns') or '').strip()

    try:
        prefix = int(data.get('prefix', 24))
    except (TypeError, ValueError):
        return None, "Prefix length must be a number"
    if not 1 <= prefix <= 32:
        return None, "Prefix length must be between 1 and 32"

    try:
        addr = ipaddress.IPv4Address(address)
    except (ipaddress.AddressValueError, ValueError):
        return None, "Invalid IP address"
    if addr.is_loopback or addr.is_multicast or addr.is_unspecified:
        return None, "IP address must be a usable host address"
    if addr.is_link_local:
        return None, ("169.254.x.x is reserved for the built-in direct-cable "
                      "fallback and cannot be set manually")

    network = ipaddress.IPv4Network(f'{address}/{prefix}', strict=False)

    gw = None
    if gateway:
        try:
            gw = ipaddress.IPv4Address(gateway)
        except (ipaddress.AddressValueError, ValueError):
            return None, "Invalid gateway address"
        if gw not in network:
            return None, (f"Gateway {gateway} is not inside "
                          f"{network.with_prefixlen} — it must be on the same subnet")

    dns = []
    if dns_raw:
        for server in dns_raw.split(','):
            server = server.strip()
            if not server:
                continue
            try:
                ipaddress.IPv4Address(server)
            except (ipaddress.AddressValueError, ValueError):
                return None, f"Invalid DNS server address: {server}"
            dns.append(server)
        if len(dns) > 3:
            return None, "At most 3 DNS servers are supported"

    return {
        "address": str(addr),
        "prefix": prefix,
        "gateway": str(gw) if gw else None,
        "dns": dns,
    }, None


@network_bp.route('/api/v1/network/ethernet', methods=['PUT'])
@jwt_required()
@require_role(['admin'])
def configure_ethernet():
    """Set the wired interface to DHCP (with link-local fallback) or a
    static address. Applying re-activates the link, briefly dropping it."""
    try:
        data = request.get_json(silent=True) or {}
        mode = (data.get('mode') or '').strip().lower()

        if mode == 'dhcp':
            success, message = wifi_manager.set_ethernet_config('dhcp')
        elif mode == 'static':
            config, error = _validate_static_config(data)
            if error:
                return jsonify({"error": error}), 400
            success, message = wifi_manager.set_ethernet_config(
                'static',
                address=config['address'],
                prefix=config['prefix'],
                gateway=config['gateway'],
                dns=config['dns'],
            )
        else:
            return jsonify({"error": "mode must be 'dhcp' or 'static'"}), 400

        if not success:
            return jsonify({"error": message}), 500
        return jsonify({"success": True, "message": message}), 200
    except Exception as e:
        return internal_error(e)


@network_bp.route('/api/v1/network/ethernet/reset', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def reset_ethernet():
    """Restore the shipped default wired configuration."""
    try:
        success, message = wifi_manager.reset_ethernet_config()
        if not success:
            return jsonify({"error": message}), 500
        return jsonify({"success": True, "message": message}), 200
    except Exception as e:
        return internal_error(e)
