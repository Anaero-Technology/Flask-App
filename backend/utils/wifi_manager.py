"""Shared WiFi/network management built on nmcli (Linux) with macOS dev fallbacks.

Single source of truth for WiFi operations, used by:
  - routes/wifi.py       (web UI: WPA-PSK and WPA-Enterprise/eduroam)
  - chimera_handler.py   (device screen: WPA-PSK only -- the Chimera screen
                          cannot collect a username, so enterprise networks
                          must be joined from the web UI)

Command construction and terse-output parsing patterns are adapted from
Opentrons' nmcli wrapper (Apache-2.0):
https://github.com/Opentrons/opentrons/blob/edge/api/src/opentrons/system/nmcli.py

Key behaviors:
  - Every nmcli invocation's returncode is checked; stderr is surfaced.
  - nmcli terse output is split on *unescaped* colons (SSIDs may contain ':').
  - The WiFi interface is auto-detected (no hardcoded wlan0).
  - Enterprise connects set anonymous-identity and use the system CA store,
    with configurable EAP method / phase2 (eduroam sites vary).
  - A profile created by a failed connect attempt is deleted so a bad
    password does not leave a broken profile that autoconnect loops on.
  - get_local_ip() works without a default route (direct ethernet /
    link-local setups) by enumerating interfaces, preferring ethernet.
"""

import platform
import re
import subprocess
import threading
from typing import List, Optional, Tuple

IS_LINUX = platform.system() == 'Linux'
IS_MACOS = platform.system() == 'Darwin'

# EAP methods / phase2 algorithms accepted from the API. PEAP+MSCHAPv2 is the
# most common eduroam configuration, but many sites use TTLS+PAP.
VALID_EAP_METHODS = ('peap', 'ttls', 'pwd')
VALID_PHASE2_METHODS = ('mschapv2', 'pap', 'chap', 'mschap', 'md5', 'gtc')
DEFAULT_EAP_METHOD = 'peap'
DEFAULT_PHASE2 = 'mschapv2'

_SECRET_ARG_MARKERS = ('password', 'psk')

_iface_lock = threading.Lock()
_cached_wifi_iface: Optional[str] = None
_cached_macos_iface: Optional[str] = None


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------

def sanitize_args(cmd: List[str]) -> List[str]:
    """Return a copy of cmd safe for logging (secrets masked)."""
    sanitized = []
    hide_next = False
    for arg in cmd:
        if hide_next:
            sanitized.append('****')
            hide_next = False
            continue
        sanitized.append(arg)
        if any(marker in arg.lower() for marker in _SECRET_ARG_MARKERS):
            hide_next = True
    return sanitized


def _nmcli(args: List[str], timeout: float = 10.0) -> subprocess.CompletedProcess:
    """Run an nmcli command (via sudo, matching the deployed sudoers rule)."""
    cmd = ['sudo', 'nmcli'] + args
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        print(f"[WIFI] Timed out: {' '.join(sanitize_args(cmd))}")
        raise


def split_terse_fields(line: str) -> List[str]:
    """Split one line of `nmcli -t` output on unescaped colons.

    nmcli escapes ':' as '\\:' and '\\' as '\\\\' in terse mode; a naive
    line.split(':') corrupts SSIDs containing colons or backslashes.
    """
    fields = []
    current = []
    escaped = False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
        elif char == '\\':
            escaped = True
        elif char == ':':
            fields.append(''.join(current))
            current = []
        else:
            current.append(char)
    fields.append(''.join(current))
    return fields


def _result_error(result: subprocess.CompletedProcess, fallback: str) -> str:
    return (result.stderr or result.stdout or '').strip() or fallback


# ---------------------------------------------------------------------------
# Interface detection
# ---------------------------------------------------------------------------

def _get_macos_wifi_interface() -> str:
    """Detect the macOS WiFi device (usually en0, but not always). Cached."""
    global _cached_macos_iface
    with _iface_lock:
        if _cached_macos_iface:
            return _cached_macos_iface
        try:
            result = subprocess.run(
                ['networksetup', '-listallhardwareports'],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                in_wifi_port = False
                for line in result.stdout.splitlines():
                    if line.startswith('Hardware Port:'):
                        in_wifi_port = 'Wi-Fi' in line or 'AirPort' in line
                    elif in_wifi_port and line.startswith('Device:'):
                        _cached_macos_iface = line.split(':', 1)[1].strip()
                        return _cached_macos_iface
        except Exception:
            pass
        _cached_macos_iface = 'en0'
        return _cached_macos_iface


def get_wifi_interface() -> Optional[str]:
    """Detect the WiFi interface name (cached). Returns None if none found."""
    global _cached_wifi_iface
    if IS_MACOS:
        return _get_macos_wifi_interface()
    if not IS_LINUX:
        return None

    with _iface_lock:
        if _cached_wifi_iface:
            return _cached_wifi_iface
        try:
            result = _nmcli(['-t', '-f', 'DEVICE,TYPE', 'device'], timeout=5)
            if result.returncode == 0:
                for line in result.stdout.strip().split('\n'):
                    fields = split_terse_fields(line)
                    if len(fields) >= 2 and fields[1] == 'wifi':
                        _cached_wifi_iface = fields[0]
                        return _cached_wifi_iface
        except Exception as e:
            print(f"[WIFI] Interface detection failed: {e}")
        return None


# ---------------------------------------------------------------------------
# Status / scanning
# ---------------------------------------------------------------------------

def get_connected_ssid() -> Optional[str]:
    """Return the SSID currently connected to, or None."""
    if IS_MACOS:
        try:
            result = subprocess.run(
                ['networksetup', '-getairportnetwork', _get_macos_wifi_interface()],
                capture_output=True, text=True, timeout=3
            )
            if result.returncode == 0 and ':' in result.stdout:
                ssid = result.stdout.split(':', 1)[1].strip()
                return ssid or None
        except Exception:
            pass
        return None

    # iwgetid is cheapest when available
    try:
        result = subprocess.run(['iwgetid', '-r'], capture_output=True, text=True, timeout=3)
        if result.returncode == 0:
            ssid = result.stdout.strip()
            if ssid:
                return ssid
    except Exception:
        pass

    try:
        result = _nmcli(['-t', '-f', 'ACTIVE,SSID', 'dev', 'wifi'], timeout=5)
        if result.returncode == 0:
            for line in result.stdout.splitlines():
                fields = split_terse_fields(line)
                if len(fields) >= 2 and fields[0] == 'yes':
                    return fields[1].strip() or None
    except Exception:
        pass
    return None


def scan_networks(rescan: bool = True) -> Tuple[List[dict], Optional[str]]:
    """Scan for WiFi networks.

    Returns (networks, error_message). Each network dict has:
    ssid, signal, security, connected, enterprise.
    """
    if IS_MACOS:
        return _scan_networks_macos()

    try:
        connected_ssid = get_connected_ssid()

        if rescan:
            # Best-effort: a failed rescan (e.g. radio busy) is not fatal.
            try:
                _nmcli(['dev', 'wifi', 'rescan'], timeout=8)
            except subprocess.TimeoutExpired:
                pass

        result = _nmcli(
            ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'dev', 'wifi', 'list'],
            timeout=15
        )
        if result.returncode != 0:
            stderr = (result.stderr or '').strip().lower()
            if 'no wi-fi device' in stderr or ('wifi' in stderr and 'not found' in stderr):
                return [], "No WiFi adapter found"
            return [], _result_error(result, "WiFi scan failed")

        networks = []
        for line in result.stdout.strip().split('\n'):
            if not line.strip():
                continue
            fields = split_terse_fields(line)
            if len(fields) < 4:
                continue
            in_use = fields[0].strip() == '*'
            ssid = fields[1]
            if not ssid:
                continue
            security = fields[3] or 'Open'
            networks.append({
                'ssid': ssid,
                'signal': fields[2] or 'N/A',
                'security': security,
                'connected': in_use or (connected_ssid is not None and ssid == connected_ssid),
                'enterprise': '802.1X' in security,
            })
        return networks, None
    except subprocess.TimeoutExpired:
        return [], "WiFi scan timed out"
    except Exception as e:
        print(f"[WIFI] Error scanning networks: {e}")
        return [], None


def list_ssids(rescan: bool = False) -> List[str]:
    """Convenience: unique SSIDs, strongest signal first (for the Chimera screen)."""
    networks, _ = scan_networks(rescan=rescan)

    def signal_value(net):
        try:
            return int(net.get('signal'))
        except (TypeError, ValueError):
            return -1

    seen = set()
    ssids = []
    for net in sorted(networks, key=signal_value, reverse=True):
        ssid = net['ssid']
        if ssid and ssid != '--' and ssid not in seen:
            seen.add(ssid)
            ssids.append(ssid)
    return ssids


def _scan_networks_macos() -> Tuple[List[dict], Optional[str]]:
    """macOS scan via system_profiler (development convenience only).

    Note: Apple removed CLI WiFi scanning (airport -s) in modern macOS, so
    system_profiler only returns the OS's *cached* scan results -- typically
    the connected network plus whatever the last system scan saw. Open the
    WiFi menu to force a rescan before hitting Scan in the app. The Linux
    (nmcli) path used in production performs a real active scan.
    """
    try:
        result = subprocess.run(
            ['system_profiler', 'SPAirPortDataType'],
            capture_output=True, text=True, timeout=15
        )
        if result.returncode != 0:
            return [], "WiFi scan failed"

        networks = []
        current_ssid = None
        current_network = {}
        # 'current' = "Current Network Information:" (the connected network),
        # 'other'   = "Other Local Wi-Fi Networks:"
        section = None

        def flush():
            if current_ssid and current_network:
                current_network['ssid'] = current_ssid
                networks.append(current_network.copy())

        for line in result.stdout.split('\n'):
            stripped = line.strip()
            if 'Current Network Information:' in line:
                flush()
                current_ssid, current_network, section = None, {}, 'current'
                continue
            if 'Other Local Wi-Fi Networks:' in line:
                flush()
                current_ssid, current_network, section = None, {}, 'other'
                continue
            if section is None:
                continue
            if stripped.endswith(':') and not any(
                x in stripped for x in ['PHY Mode', 'Channel', 'Network Type', 'Security', 'Signal', 'MCS', 'Country']
            ):
                flush()
                current_ssid = stripped[:-1]
                current_network = {'signal': 'N/A', 'security': 'Unknown',
                                   'connected': section == 'current'}
            if current_ssid:
                if 'Security:' in line:
                    security = stripped.split('Security:')[1].strip()
                    current_network['security'] = security if security else 'Open'
                elif 'Signal / Noise:' in line:
                    match = re.search(r'(-?\d+)\s*dBm', stripped)
                    if match:
                        current_network['signal'] = match.group(1)
        flush()

        connected_ssid = get_connected_ssid()
        filtered = []
        redacted_count = 0
        for net in networks:
            ssid = net['ssid']
            if not ssid or ssid.strip() == '':
                continue
            if ssid in ['awdl0', 'llw0'] or ssid.startswith('en'):
                continue
            # Without Location Services permission, macOS replaces SSIDs
            # with the literal string '<redacted>' -- unusable for connecting.
            if ssid == '<redacted>':
                redacted_count += 1
                continue
            net['connected'] = net.get('connected', False) or (
                connected_ssid is not None and ssid == connected_ssid
            )
            net['enterprise'] = '802.1X' in net.get('security', '')
            filtered.append(net)

        if redacted_count and not filtered:
            return [], ("macOS is hiding WiFi network names. Grant Location Services "
                        "to your terminal app (System Settings > Privacy & Security > "
                        "Location Services), then rescan. This does not affect the "
                        "Raspberry Pi deployment.")
        if redacted_count:
            print(f"[WIFI] macOS redacted {redacted_count} SSID(s); grant Location "
                  f"Services to the terminal to see them during development.")

        # Connected network first, then strongest signal
        def sort_key(net):
            try:
                signal = int(net.get('signal'))
            except (TypeError, ValueError):
                signal = -999
            return (not net['connected'], -signal)

        return sorted(filtered, key=sort_key), None
    except subprocess.TimeoutExpired:
        return [], "WiFi scan timed out"
    except Exception as e:
        print(f"[WIFI] Error scanning networks (macOS): {e}")
        return [], None


# ---------------------------------------------------------------------------
# Connecting
# ---------------------------------------------------------------------------

def _find_existing_connection(ssid: str) -> Optional[str]:
    """Find an existing NetworkManager WiFi profile UUID for an SSID."""
    try:
        result = _nmcli(['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show'], timeout=5)
        if result.returncode == 0:
            for line in result.stdout.strip().split('\n'):
                fields = split_terse_fields(line)
                if len(fields) >= 3 and fields[0] == ssid and '802-11-wireless' in fields[2]:
                    return fields[1]
    except Exception:
        pass
    return None


def _psk_props(password: str) -> List[str]:
    return ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password]


def _enterprise_props(username: str, password: str,
                      eap_method: str, phase2: str) -> List[str]:
    """nmcli properties for a WPA-Enterprise (802.1X) connection.

    eduroam notes:
      - anonymous-identity preserves the realm so the request is routed to
        the home institution without exposing the real identity.
      - system-ca-certs uses the distro CA store; recent NetworkManager
        releases refuse EAP connections with no CA configuration at all.
    """
    props = [
        'wifi-sec.key-mgmt', 'wpa-eap',
        '802-1x.eap', eap_method,
        '802-1x.phase2-auth', phase2,
        '802-1x.identity', username,
        '802-1x.password', password,
        '802-1x.system-ca-certs', 'yes',
    ]
    if '@' in username:
        realm = username.rsplit('@', 1)[1]
        props += ['802-1x.anonymous-identity', f'anonymous@{realm}']
    return props


def connect(ssid: str, password: str = '', username: Optional[str] = None,
            security: str = '', eap_method: Optional[str] = None,
            phase2: Optional[str] = None) -> Tuple[bool, str]:
    """Connect to a WiFi network (WPA-PSK, WPA-Enterprise, or open).

    Enterprise (802.1X) is used when a username is supplied or the reported
    security contains '802.1X'. Returns (success, message).
    """
    is_enterprise = bool(username) or '802.1X' in (security or '')
    if is_enterprise and not username:
        return False, "This network requires a username (WPA-Enterprise / 802.1X)"

    eap_method = (eap_method or DEFAULT_EAP_METHOD).lower()
    phase2 = (phase2 or DEFAULT_PHASE2).lower()
    if eap_method not in VALID_EAP_METHODS:
        return False, f"Invalid EAP method '{eap_method}'. Use one of: {', '.join(VALID_EAP_METHODS)}"
    if phase2 not in VALID_PHASE2_METHODS:
        return False, f"Invalid phase2 method '{phase2}'. Use one of: {', '.join(VALID_PHASE2_METHODS)}"

    if IS_MACOS:
        return _connect_macos(ssid, password)
    if not IS_LINUX:
        return False, "Unsupported operating system"

    iface = get_wifi_interface()
    if not iface:
        return False, "No WiFi adapter found"

    if is_enterprise:
        props = _enterprise_props(username, password, eap_method, phase2)
    elif password:
        props = _psk_props(password)
    else:
        props = []  # open network

    try:
        existing_uuid = _find_existing_connection(ssid)
        created_new_profile = False

        if existing_uuid:
            # Drop the profile's previous auth settings first: reusing it
            # across enterprise/PSK/open changes would otherwise carry stale
            # wifi-sec/802-1x properties from the old mode (and an "open"
            # reconnect would silently keep the old password requirement).
            result = _nmcli(['connection', 'modify', existing_uuid,
                             'remove', '802-11-wireless-security',
                             'remove', '802-1x'], timeout=15)
            if result.returncode != 0:
                return False, _result_error(result, "Failed to reset connection profile")
            if props:
                result = _nmcli(['connection', 'modify', existing_uuid] + props, timeout=15)
                if result.returncode != 0:
                    return False, _result_error(result, "Failed to update connection profile")
        else:
            add_cmd = ['connection', 'add', 'type', 'wifi',
                       'con-name', ssid, 'ifname', iface, 'ssid', ssid] + props
            result = _nmcli(add_cmd, timeout=15)
            if result.returncode != 0:
                return False, _result_error(result, "Failed to create connection profile")
            created_new_profile = True
            existing_uuid = _find_existing_connection(ssid)

        # Activate. Enterprise auth (RADIUS round-trips) can be slow.
        result = _nmcli(['connection', 'up', existing_uuid or ssid],
                        timeout=60 if is_enterprise else 30)
        if result.returncode == 0:
            return True, "Successfully connected to WiFi"

        stderr = result.stderr or ''
        # Don't leave a broken profile behind that autoconnect will loop on.
        if created_new_profile and existing_uuid:
            try:
                _nmcli(['connection', 'delete', existing_uuid], timeout=10)
            except Exception:
                pass

        if 'Secrets were required' in stderr or 'passwd-file' in stderr:
            if is_enterprise:
                return False, ("Authentication failed. Check the username and password. "
                               "If they are correct, this network may need a different "
                               "EAP method (e.g. TTLS/PAP instead of PEAP/MSCHAPv2).")
            return False, "Incorrect password"
        if 'not found' in stderr:
            return False, "Network not found. It may be out of range."
        return False, _result_error(result, "Failed to connect")
    except subprocess.TimeoutExpired:
        return False, "Connection attempt timed out"
    except Exception as e:
        return False, str(e)


def connect_psk(ssid: str, password: str) -> Tuple[bool, str]:
    """WPA-PSK-only connect used by the Chimera screen flow.

    The Chimera's on-device UI can only collect an SSID and password, so
    enterprise networks are rejected early with a clear log message.
    """
    for net in scan_networks(rescan=False)[0]:
        if net['ssid'] == ssid and net.get('enterprise'):
            print(f"[WIFI] '{ssid}' is WPA-Enterprise; it cannot be joined from "
                  f"the Chimera screen. Use the web UI (Settings > WiFi) instead.")
            return False, "Enterprise network: connect from the web UI"
    return connect(ssid, password)


def _connect_macos(ssid: str, password: str) -> Tuple[bool, str]:
    try:
        result = subprocess.run(
            ['networksetup', '-setairportnetwork', _get_macos_wifi_interface(), ssid, password],
            capture_output=True, text=True, timeout=30
        )
        # networksetup exits 0 even on failure ("Could not find network ...",
        # "Failed to join network ..."), so inspect the output too.
        output = (result.stdout or '') + (result.stderr or '')
        failed = any(marker in output for marker in ('Could not find', 'Failed to join', 'Error'))
        if result.returncode == 0 and not failed:
            return True, "Successfully connected to WiFi"
        return False, output.strip() or "Failed to connect"
    except Exception as e:
        return False, str(e)


# ---------------------------------------------------------------------------
# Local IP detection
# ---------------------------------------------------------------------------

def get_local_ip() -> Optional[str]:
    """Return the machine's LAN IP address.

    Works without a default route (direct ethernet / 169.254 link-local
    setups) by enumerating interface addresses. Preference order:
      1. ethernet with a routable address
      2. wifi with a routable address
      3. ethernet link-local (169.254.x.x -- direct laptop connection)
    """
    if IS_LINUX:
        ip = _get_local_ip_linux()
        if ip:
            return ip
    return _get_local_ip_socket()


def _get_local_ip_linux() -> Optional[str]:
    try:
        result = subprocess.run(
            ['ip', '-4', '-o', 'addr', 'show', 'up'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            return None

        ethernet_global = []
        wifi_global = []
        ethernet_link_local = []

        for line in result.stdout.strip().split('\n'):
            # e.g. "2: eth0    inet 192.168.1.10/24 brd ... scope global ..."
            match = re.search(r'^\d+:\s+(\S+)\s+inet\s+([\d.]+)/\d+', line)
            if not match:
                continue
            iface, addr = match.group(1), match.group(2)
            if iface == 'lo' or addr.startswith('127.'):
                continue
            is_ethernet = iface.startswith(('eth', 'en'))
            is_wifi = iface.startswith(('wl', 'wlan'))
            if addr.startswith('169.254.'):
                if is_ethernet:
                    ethernet_link_local.append(addr)
            elif is_ethernet:
                ethernet_global.append(addr)
            elif is_wifi:
                wifi_global.append(addr)

        for candidates in (ethernet_global, wifi_global, ethernet_link_local):
            if candidates:
                return candidates[0]
    except Exception as e:
        print(f"[WIFI] Local IP detection failed: {e}")
    return None


def _get_local_ip_socket() -> Optional[str]:
    """Fallback: default-route trick (requires a default route to exist)."""
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Wired / IP configuration (Settings > Network)
# ---------------------------------------------------------------------------

# Kept on the ethernet profile in every mode so a bad static configuration
# can never lock the user out of a direct-cable connection.
RESCUE_ADDRESS = '169.254.50.1/16'

_cached_ethernet_iface: Optional[str] = None


def get_ethernet_interface() -> Optional[str]:
    """Detect the ethernet interface name (cached). Returns None if none."""
    global _cached_ethernet_iface
    if not IS_LINUX:
        return None
    with _iface_lock:
        if _cached_ethernet_iface:
            return _cached_ethernet_iface
        try:
            result = _nmcli(['-t', '-f', 'DEVICE,TYPE', 'device'], timeout=5)
            if result.returncode == 0:
                for line in result.stdout.strip().split('\n'):
                    fields = split_terse_fields(line)
                    if len(fields) >= 2 and fields[1] == 'ethernet':
                        _cached_ethernet_iface = fields[0]
                        return _cached_ethernet_iface
        except Exception as e:
            print(f"[NETWORK] Ethernet interface detection failed: {e}")
        return None


def _device_show_fields(device: str, fields: str) -> dict:
    """Return `nmcli device show` terse output as {FIELD: [values...]}."""
    out = {}
    result = _nmcli(['-t', '-f', fields, 'device', 'show', device], timeout=5)
    if result.returncode != 0:
        return out
    for line in result.stdout.strip().split('\n'):
        key, sep, value = line.partition(':')
        if not sep or not value:
            continue
        key = re.sub(r'\[\d+\]$', '', key)  # IP4.ADDRESS[1] -> IP4.ADDRESS
        out.setdefault(key, []).append(value)
    return out


def get_network_status() -> List[dict]:
    """Status of the ethernet and WiFi interfaces for the Settings UI."""
    if not IS_LINUX:
        return []
    interfaces = []
    try:
        result = _nmcli(['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device'], timeout=5)
        if result.returncode != 0:
            return []
        for line in result.stdout.strip().split('\n'):
            fields = split_terse_fields(line)
            if len(fields) < 4 or fields[1] not in ('ethernet', 'wifi'):
                continue
            device, dev_type, state, connection = fields[0], fields[1], fields[2], fields[3]

            info = _device_show_fields(device, 'GENERAL.CON-UUID,IP4.ADDRESS,IP4.GATEWAY')
            con_uuid = (info.get('GENERAL.CON-UUID') or [None])[0]

            method = None
            if con_uuid:
                method_result = _nmcli(
                    ['-t', '-f', 'ipv4.method', 'connection', 'show', con_uuid], timeout=5
                )
                if method_result.returncode == 0:
                    method = method_result.stdout.strip().partition(':')[2] or None

            interfaces.append({
                'device': device,
                'type': dev_type,
                'state': state,
                'connection': connection or None,
                'method': method,
                'addresses': info.get('IP4.ADDRESS', []),
                'gateway': (info.get('IP4.GATEWAY') or [None])[0],
            })
    except Exception as e:
        print(f"[NETWORK] Status query failed: {e}")
    return interfaces


def _find_ethernet_connection(iface: str) -> Optional[str]:
    """UUID of the ethernet profile (the active one on iface, else the first
    wired profile). Creates the default profile if none exists."""
    try:
        info = _device_show_fields(iface, 'GENERAL.CON-UUID')
        uuid = (info.get('GENERAL.CON-UUID') or [None])[0]
        if uuid:
            return uuid

        result = _nmcli(['-t', '-f', 'NAME,UUID,TYPE', 'connection', 'show'], timeout=5)
        if result.returncode == 0:
            for line in result.stdout.strip().split('\n'):
                fields = split_terse_fields(line)
                if len(fields) >= 3 and '802-3-ethernet' in fields[2]:
                    return fields[1]

        result = _nmcli(['connection', 'add', 'type', 'ethernet',
                         'con-name', f'Ethernet {iface}', 'ifname', iface], timeout=10)
        if result.returncode == 0:
            info = _device_show_fields(iface, 'GENERAL.CON-UUID')
            return (info.get('GENERAL.CON-UUID') or [None])[0]
    except Exception as e:
        print(f"[NETWORK] Ethernet profile lookup failed: {e}")
    return None


def set_ethernet_config(mode: str, address: Optional[str] = None,
                        prefix: Optional[int] = None,
                        gateway: Optional[str] = None,
                        dns: Optional[List[str]] = None) -> Tuple[bool, str]:
    """Configure the wired interface.

    mode 'dhcp':   DHCP with the link-local rescue address as fallback
                   (the shipped default from setup_ethernet*.sh).
    mode 'static': fixed address/prefix (+ optional gateway/DNS), with the
                   rescue address kept alongside.
    Re-activates the profile, which briefly drops the wired link.
    """
    if not IS_LINUX:
        return False, "Network configuration is only supported on the device"

    iface = get_ethernet_interface()
    if not iface:
        return False, "No ethernet adapter found"

    uuid = _find_ethernet_connection(iface)
    if not uuid:
        return False, "No ethernet connection profile found"

    if mode == 'static':
        props = [
            'ipv4.method', 'manual',
            'ipv4.addresses', f'{address}/{prefix},{RESCUE_ADDRESS}',
            'ipv4.gateway', gateway or '',
            'ipv4.dns', ','.join(dns or []),
        ]
    elif mode == 'dhcp':
        props = [
            'ipv4.method', 'auto',
            'ipv4.addresses', RESCUE_ADDRESS,
            'ipv4.gateway', '',
            'ipv4.dns', '',
            'ipv4.dhcp-timeout', '30',
            'ipv4.may-fail', 'yes',
        ]
    else:
        return False, f"Unknown mode '{mode}'"

    result = _nmcli(['connection', 'modify', uuid] + props, timeout=15)
    if result.returncode != 0:
        return False, _result_error(result, "Failed to update ethernet profile")

    result = _nmcli(['connection', 'up', uuid], timeout=45)
    if result.returncode != 0:
        return False, _result_error(result, "Saved, but failed to activate the new configuration")
    return True, "Ethernet configuration applied"


def reset_ethernet_config() -> Tuple[bool, str]:
    """Restore the shipped default: DHCP with link-local fallback."""
    return set_ethernet_config('dhcp')
