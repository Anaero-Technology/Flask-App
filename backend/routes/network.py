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


def _subnet_change_warning(config, iface_type):
    """Warn when the new static address is outside every subnet currently
    live on the link — valid config, but peers (e.g. a laptop sharing its
    connection over the cable, or the WiFi router) won't reach it until
    they are reconfigured too."""
    try:
        current = next(
            (i for i in wifi_manager.get_network_status() if i['type'] == iface_type),
            None
        )
        if not current:
            return ""
        on_link = [a for a in current.get('addresses', []) if not a.startswith('169.254.')]
        if not on_link:
            return ""
        new_net = ipaddress.IPv4Network(f"{config['address']}/{config['prefix']}", strict=False)
        if any(ipaddress.IPv4Interface(a).network.overlaps(new_net) for a in on_link):
            return ""
        current_net = ipaddress.IPv4Interface(on_link[0]).network.with_prefixlen
        peer = "the device(s) on the cable" if iface_type == 'ethernet' else "the WiFi network"
        return (f" Warning: {peer} currently uses {current_net} — "
                f"{config['address']} will not be reachable until the other "
                f"side is reconfigured to the new subnet.")
    except Exception:
        return ""


@network_bp.route('/api/v1/network/<iface_type>', methods=['PUT'])
@jwt_required()
@require_role(['admin'])
def configure_interface(iface_type):
    """Set the wired or WiFi interface to DHCP or a static address.
    Applying re-activates the link, briefly dropping it."""
    try:
        if iface_type not in ('ethernet', 'wifi'):
            return jsonify({"error": "Interface type must be 'ethernet' or 'wifi'"}), 404

        data = request.get_json(silent=True) or {}
        mode = (data.get('mode') or '').strip().lower()

        if mode == 'dhcp':
            success, message = wifi_manager.set_ip_config(iface_type, 'dhcp')
        elif mode == 'static':
            config, error = _validate_static_config(data)
            if error:
                return jsonify({"error": error}), 400
            # Must be computed before applying (the link state changes after)
            warning = _subnet_change_warning(config, iface_type)
            success, message = wifi_manager.set_ip_config(
                iface_type,
                'static',
                address=config['address'],
                prefix=config['prefix'],
                gateway=config['gateway'],
                dns=config['dns'],
            )
            if success and warning:
                message += warning
        else:
            return jsonify({"error": "mode must be 'dhcp' or 'static'"}), 400

        if not success:
            return jsonify({"error": message}), 500
        return jsonify({"success": True, "message": message}), 200
    except Exception as e:
        return internal_error(e)
