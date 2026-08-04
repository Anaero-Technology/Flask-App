#!/usr/bin/env python3
"""Machine-type handling across the max -> lobster-i firmware rename.

The firmware's personality list gained ray-i and renamed max to lobster-i. Both
sides of the fleet exist in the field - reflashed PLCs know the new tokens, un
reflashed ones only the old - and profiles captured before the rename still
carry "max". These check the handler copes with either without the caller
having to know which.

No hardware: PlcHandler is driven through a stub that records the commands it
would have sent and answers the way each firmware generation would.

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
        # A PLC reports whatever its own firmware calls the machine.
        _, heaters, mixers, agitators, feeders = FIRMWARE_MACHINES[
            PlcHandler.machine_type_aliases.get(token, token)]
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


NEW_FIRMWARE = set(FIRMWARE_MACHINES)
OLD_FIRMWARE = {"lobster", "ray", "max", "caterpillar", "blackswan", "medusa"}


def test_machine_type_list():
    """The advertised list must be exactly what the firmware accepts."""
    assert PlcHandler.machine_types == [
        "lobster", "ray", "lobster-i", "caterpillar", "blackswan",
        "medusa", "ray-i"], PlcHandler.machine_types
    assert "max" not in PlcHandler.machine_types
    assert set(PlcHandler.machine_types) == NEW_FIRMWARE
    print("machine_types matches the firmware ok")


def test_current_firmware():
    for token in FIRMWARE_MACHINES:
        plc = StubPlc(NEW_FIRMWARE)
        ok, message = plc.set_machine_type(token)
        assert ok, (token, message)
        assert plc.sent == [f"systemset {token}"], plc.sent
        assert plc.machine_type == token
    print("every current machine type sets ok")


def test_legacy_profile_on_new_firmware():
    """A profile saved as "max" must still configure a reflashed PLC."""
    plc = StubPlc(NEW_FIRMWARE)
    ok, message = plc.set_machine_type("max")
    assert ok, message
    assert plc.sent == ["systemset lobster-i"], plc.sent
    assert plc.machine_type == "lobster-i"
    assert plc.machine_counts["feeders"] == 4
    print("legacy 'max' profile applies to new firmware ok")


def test_new_name_on_old_firmware():
    """Choosing Lobster-I must still work on a PLC that has not been reflashed."""
    plc = StubPlc(OLD_FIRMWARE)
    ok, message = plc.set_machine_type("lobster-i")
    assert ok, message
    # tries the current name, falls back to the one that firmware knows
    assert plc.sent == ["systemset lobster-i", "systemset max"], plc.sent
    assert plc.machine_type == "max"
    print("new 'lobster-i' name falls back on old firmware ok")


def test_ray_i_unavailable_on_old_firmware():
    """ray-i genuinely does not exist on old firmware - fail, do not fall back."""
    plc = StubPlc(OLD_FIRMWARE)
    ok, message = plc.set_machine_type("ray-i")
    assert not ok
    assert "invalid" in message, message
    assert plc.sent == ["systemset ray-i"], plc.sent
    print("ray-i correctly rejected by old firmware ok")


def test_unknown_machine_rejected():
    plc = StubPlc(NEW_FIRMWARE)
    ok, message = plc.set_machine_type("hungry")
    assert not ok and "Unknown machine type" in message
    assert plc.sent == [], "an unknown machine must never reach the device"
    print("unknown machine rejected before the wire ok")


def test_apply_settings_skips_redundant_systemset():
    """A "max" profile on a PLC already reporting lobster-i is the same machine.

    systemset re-runs sensor discovery and takes tens of seconds, so applying a
    profile must not trigger one just because the token was spelled the old way.
    """
    plc = StubPlc(NEW_FIRMWARE)
    plc.set_machine_type("lobster-i")
    plc.sent.clear()

    ok, message = plc.apply_settings(
        {"machine_type": "max", "heaters": [{"number": 1, "target": 37}]})
    assert ok, message
    assert not any(str(c).startswith("systemset") for c in plc.sent), plc.sent
    assert ("heater", 1, 37) in plc.sent, plc.sent

    # ...but a genuinely different machine still switches
    plc.sent.clear()
    ok, _ = plc.apply_settings({"machine_type": "ray", "heaters": []})
    assert "systemset ray" in plc.sent, plc.sent
    print("apply_settings avoids a redundant systemset ok")


if __name__ == "__main__":
    test_machine_type_list()
    test_current_firmware()
    test_legacy_profile_on_new_firmware()
    test_new_name_on_old_firmware()
    test_ray_i_unavailable_on_old_firmware()
    test_unknown_machine_rejected()
    test_apply_settings_skips_redundant_systemset()
    print("\nAll PLC machine-type tests passed")
