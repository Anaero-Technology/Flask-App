"""Serial port listing that can include simulated devices.

pyserial's comports() only reports real USB/UART ports, so a simulator running
on a pseudo-terminal would never be found by the auto-connect scanner. Setting
SIMULATED_SERIAL_PORTS to a comma separated list of paths (the simulator prints
its own, and keeps a stable symlink) adds those to every scan.

Unset in production, in which case this is exactly comports().
"""
import os

import serial.tools.list_ports


class SimulatedPortInfo:
    """The parts of pyserial's ListPortInfo that the app reads."""

    def __init__(self, device):
        self.device = device
        self.name = os.path.basename(device)
        self.description = "Simulated device"
        self.hwid = "SIMULATED"

    def __repr__(self):
        return f"SimulatedPortInfo({self.device})"


def simulated_ports():
    raw = os.environ.get("SIMULATED_SERIAL_PORTS", "")
    paths = [p.strip() for p in raw.split(",") if p.strip()]
    return [SimulatedPortInfo(p) for p in paths if os.path.exists(p)]


def comports():
    return list(serial.tools.list_ports.comports()) + simulated_ports()
