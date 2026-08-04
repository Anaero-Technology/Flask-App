#!/usr/bin/env python3
"""Machine-type handling against the current firmware personality list.

The list is hardcoded in the handler and must stay in step with the firmware's
own systemNames table - it is the one thing that silently stops every later
command working if it drifts. These pin it down, along with the setter's
behaviour for machines the firmware does not have.

Deliberately no backward compatibility for the pre-rename "max" spelling: the
software targets current firmware only.

No hardware: PlcHandler is driven through a stub that records the commands it
would have sent and answers the way the firmware would.

Run from backend/: venv/bin/python tests/test_plc_machine_types.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.environ["DISABLE_AUTO_CONNECT"] = "1"

from plc_handler import PlcHandler

# What the firmware reports, from serial.md and personalities.cpp
FIRMWARE_MACHINES = {
    "lobster":     (1, 6, 6, 6, 2),   # type, heaters, mixers, agitators, feeders
    "ray":         (2, 2, 2, 2, 1),
    "lobster-i":   (3, 4, 4, 4, 4),
    "caterpillar": (4, 5, 5, 5, 1),
    "blackswan":   (5, 10, 8, 4, 4),
    "medusa":      (6, 0, 1, 10, 2),
    "ray-i":       (7, 2, 2, 2, 2),
}


class StubPlc(PlcHandler):
    """A PlcHandler whose serial layer is replaced by a scripted firmware."""

    def __init__(self, known_machines):
        # Deliberately skip PlcHandler.__init__ - it opens nothing, but it also
        # registers telemetry handlers that need a real SerialHandler.
        self.known_machines = known_machines
        self.machine_type = None
        self.machine_counts = {"heaters": 0, "mixers": 0, "agitators": 0, "feeders": 0}
        self.active_profile_name = None
        self.sent = []
        self.saved = False

    def _acked(self, command, timeout=10.0):
        self.sent.append(command)
        root, _, argument = command.partition(" ")
        if root == "systemset":
            if argument not in self.known_machines:
                return False, "invalid"
            self._set_current(argument)
            return True, "ok"
        return True, "ok"

    def _get_system(self):
        return True

    def _set_current(self, token):
        _, heaters, mixers, agitators, feeders = FIRMWARE_MACHINES[token]
        self.machine_type = token
        self.machine_counts = {"heaters": heaters, "mixers": mixers,
                               "agitators": agitators, "feeders": feeders}

    def auto_save(self):
        self.saved = True
        return True

    def get_status(self):
        return None

    def set_heater(self, *a):
        self.sent.append(("heater", *a))
        return True, "ok"

    def set_mixer(self, *a):
        self.sent.append(("mixer", *a))
        return True, "ok"

    def set_feeder(self, *a):
        self.sent.append(("feeder", *a))
        return True, "ok"

    def set_agitator(self, *a):
        self.sent.append(("agitator", *a))
        return True, "ok"


FIRMWARE = set(FIRMWARE_MACHINES)


def test_machine_type_list():
    """The advertised list must be exactly what the firmware accepts."""
    assert PlcHandler.machine_types == [
        "lobster", "ray", "lobster-i", "caterpillar", "blackswan",
        "medusa", "ray-i"], PlcHandler.machine_types
    assert "max" not in PlcHandler.machine_types, "max was renamed to lobster-i"
    assert set(PlcHandler.machine_types) == FIRMWARE
    print("machine_types matches the firmware ok")


def test_every_machine_sets():
    for token in FIRMWARE_MACHINES:
        plc = StubPlc(FIRMWARE)
        ok, message = plc.set_machine_type(token)
        assert ok, (token, message)
        assert plc.sent == [f"systemset {token}"], plc.sent
        assert plc.machine_type == token
    print("every machine type sets ok")


def test_unit_counts_follow_the_machine():
    """The handler must take counts from the device, not a table of its own.

    Ray and Ray-I differ only in feeder count, so this is what stops the two
    being confused once a personality is set.
    """
    for token, (_, heaters, mixers, agitators, feeders) in FIRMWARE_MACHINES.items():
        plc = StubPlc(FIRMWARE)
        plc.set_machine_type(token)
        assert plc.machine_counts == {
            "heaters": heaters, "mixers": mixers,
            "agitators": agitators, "feeders": feeders}, (token, plc.machine_counts)
    assert StubPlc(FIRMWARE).machine_counts["feeders"] == 0
    print("unit counts follow the machine ok")


def test_retired_and_unknown_machines_rejected():
    """Anything the firmware does not implement must fail before the wire."""
    for token in ("max", "hungry", ""):
        plc = StubPlc(FIRMWARE)
        ok, message = plc.set_machine_type(token)
        assert not ok, token
        assert "Unknown machine type" in message, message
        assert plc.sent == [], f"{token} must never reach the device"
    print("retired and unknown machines rejected before the wire ok")


def test_apply_settings_only_switches_when_needed():
    """systemset re-runs sensor discovery, so it must not fire needlessly."""
    plc = StubPlc(FIRMWARE)
    plc.set_machine_type("lobster-i")
    plc.sent.clear()

    ok, message = plc.apply_settings(
        {"machine_type": "lobster-i", "heaters": [{"number": 1, "target": 37}]})
    assert ok, message
    assert not any(str(c).startswith("systemset") for c in plc.sent), plc.sent
    assert ("heater", 1, 37) in plc.sent, plc.sent

    # ...but a genuinely different machine still switches
    plc.sent.clear()
    ok, _ = plc.apply_settings({"machine_type": "ray-i", "heaters": []})
    assert "systemset ray-i" in plc.sent, plc.sent
    print("apply_settings only switches when needed ok")


if __name__ == "__main__":
    test_machine_type_list()
    test_every_machine_sets()
    test_unit_counts_follow_the_machine()
    test_retired_and_unknown_machines_rejected()
    test_apply_settings_only_switches_when_needed()
    print("\nAll PLC machine-type tests passed")
