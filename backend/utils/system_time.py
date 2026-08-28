"""Check whether the Pi's own system clock is trustworthy.

On boot, this hardware has no battery backing its onboard RTC, so the clock
starts from whatever was last saved to disk (which can be badly stale after
the device has been powered off, e.g. during a move) until NTP corrects it --
and NTP correction requires the network to actually reach a time server, not
just have a link/IP (see systemd's network-online.target vs time-sync.target).

Callers that are about to timestamp something important (starting a test)
should check is_ntp_synced() first and fall back to another time source
(e.g. a connected device's own battery-backed RTC) when it's False.
"""

import platform
import subprocess

IS_LINUX = platform.system() == 'Linux'


def is_ntp_synced(timeout: float = 3.0) -> bool:
    """Return True if the OS reports the system clock as NTP-synchronized.

    Uses `timedatectl show -p NTPSynchronized --value`, which is only "yes"
    once systemd-timesyncd (or another NTP client) has actually completed a
    sync against a time server -- unlike network-online.target, which only
    means an interface got a link/IP and says nothing about whether an NTP
    server was ever reachable.

    Fails closed: any error (not Linux, no timedatectl, timeout, non-Linux
    dev machine) returns False, since the safe assumption is "don't trust
    the clock" rather than silently trusting a possibly-wrong one.
    """
    if not IS_LINUX:
        return False

    try:
        result = subprocess.run(
            ['timedatectl', 'show', '-p', 'NTPSynchronized', '--value'],
            capture_output=True, text=True, timeout=timeout
        )
        return result.returncode == 0 and result.stdout.strip() == 'yes'
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
        print(f"[SYSTEM_TIME] Could not check NTP sync status: {e}")
        return False
