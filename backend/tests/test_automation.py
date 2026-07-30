#!/usr/bin/env python3
"""Unit tests for the automation engine - no hardware needed.

The decision logic is exercised directly, and the full evaluate/act path runs
against an in-memory database with a fake PLC handler planted in the
DeviceManager, so the tests cover exactly what the daemon thread does without
touching a serial port.

Run from backend/: venv/bin/python tests/test_automation.py
"""

import os
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.environ["DISABLE_AUTO_CONNECT"] = "1"

from flask import Flask

from automation_engine import (AutomationEngine, condition_met, next_value,
                               validate_rule_fields)
from database.models import (db, Device, AutomationRule, AutomationEvent,
                             ChimeraRawData)
from device_manager import DeviceManager


# ----------------------------------------------------------------------
# Pure decision logic
# ----------------------------------------------------------------------
def test_condition_met():
    assert condition_met(60, "gt", 55)
    assert not condition_met(55, "gt", 55)
    assert condition_met(55, "gte", 55)
    assert condition_met(50, "lt", 55)
    assert not condition_met(55, "lt", 55)
    assert condition_met(55, "lte", 55)
    print("condition_met ok")


def test_next_value():
    assert next_value(10, "increase", 5, 0, 20) == (15, False)
    assert next_value(18, "increase", 5, 0, 20) == (20, True)   # clamped at max
    assert next_value(10, "decrease", 5, 8, 20) == (8, True)    # clamped at min
    assert next_value(10, "set", 12, 0, 20) == (12, False)
    assert next_value(10, "set", 40, 0, 20) == (20, True)
    print("next_value ok")


def test_validate_rule_fields():
    good = {
        "name": "feed on methane", "source_type": "chimera_gas",
        "source_device_id": 1, "source_channel": 3, "gas_name": "CH4",
        "window_minutes": 0, "operator": "gt", "threshold": 55,
        "target_device_id": 2, "unit_type": "feeder", "unit_number": 1,
        "parameter": "on_for", "action_type": "increase", "amount": 5,
        "min_value": 5, "max_value": 60, "cooldown_seconds": 3600,
    }
    assert validate_rule_fields(good) is None

    assert "name" in validate_rule_fields({**good, "name": " "})
    assert "source_type" in validate_rule_fields({**good, "source_type": "psychic"})
    assert "operator" in validate_rule_fields({**good, "operator": "=="})
    assert "parameter" in validate_rule_fields({**good, "parameter": "target"})
    assert "gas_name" in validate_rule_fields({**good, "gas_name": None})
    assert "min_value" in validate_rule_fields({**good, "min_value": 100})
    assert "threshold" in validate_rule_fields({**good, "threshold": "high"})
    assert "cooldown" in validate_rule_fields({**good, "cooldown_seconds": 1})
    assert "clamps" in validate_rule_fields(
        {**good, "action_type": "set", "amount": 100})
    print("validate_rule_fields ok")


# ----------------------------------------------------------------------
# Full evaluate/act path with a fake PLC
# ----------------------------------------------------------------------
class FakePlc:
    """Just enough of PlcHandler for the engine: status readback and setters."""

    def __init__(self):
        self.maintenance_mode = False
        self.firmware_update_in_progress = False
        self.machine_type = "ray"
        self.latest_temperatures = {}
        self.active_profile_name = None
        self.feeders = {1: {"number": 1, "enabled": True, "on_for": 10,
                            "off_for_minutes": 120, "on": False}}
        self.set_calls = []

    def get_status(self):
        return {"uptime": 100, "maintenance_mode": self.maintenance_mode,
                "heaters": [], "mixers": [], "agitators": [],
                "feeders": list(self.feeders.values())}

    def set_feeder(self, number, on_for, off_for_minutes):
        self.feeders[number]["on_for"] = on_for
        self.feeders[number]["off_for_minutes"] = off_for_minutes
        self.set_calls.append(("feeder", number, on_for, off_for_minutes))
        return True, "ok"

    def auto_save(self):
        return True


def make_app():
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    app.config["REDIS_URL"] = "redis://localhost:6379/0"
    db.init_app(app)
    with app.app_context():
        db.create_all()
        db.session.add(Device(id=1, name="chimera", device_type="chimera-max",
                              serial_port="fake0", connected=True))
        db.session.add(Device(id=2, name="plc", device_type="plc",
                              serial_port="fake1", connected=True))
        db.session.commit()
    return app


def make_rule():
    return AutomationRule(
        name="feed on methane", enabled=True,
        source_type="chimera_gas", source_device_id=1, source_channel=3,
        gas_name="CH4", window_minutes=0, operator="gt", threshold=55.0,
        target_device_id=2, unit_type="feeder", unit_number=1,
        parameter="on_for", action_type="increase", amount=5.0,
        min_value=5.0, max_value=20.0, cooldown_seconds=3600)


def add_reading(peak, age_seconds=0):
    db.session.add(ChimeraRawData(
        test_id=1, device_id=1, channel_number=3, sensor_number=1,
        gas_name="CH4", peak_value=peak,
        timestamp=int(time.time()) - age_seconds, seconds_elapsed=0))
    db.session.commit()


def test_evaluate_and_act():
    app = make_app()
    fake = FakePlc()
    DeviceManager.set_app(app)
    DeviceManager()._active_handlers[2] = fake

    engine = AutomationEngine()
    engine.app = None  # no SSE in tests

    with app.app_context():
        rule = make_rule()
        db.session.add(rule)
        db.session.commit()

        # No readings at all: nothing to act on, no event
        result = engine.evaluate_rule(rule, act=True)
        assert result["value"] is None
        assert AutomationEvent.query.count() == 0

        # Reading below threshold: condition not met, no event
        add_reading(peak=40.0)
        result = engine.evaluate_rule(rule, act=True)
        assert result["value"] == 40.0 and not result["condition_met"]
        assert AutomationEvent.query.count() == 0

        # Reading above threshold: fires, feeder stepped 10 -> 15
        add_reading(peak=60.0)
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "fired", result
        assert fake.set_calls == [("feeder", 1, 15, 120)]
        event = AutomationEvent.query.one()
        assert (event.outcome, event.old_value, event.new_value) == ("fired", 10, 15)
        assert rule.last_triggered_at is not None

        # Still above threshold but inside cooldown: no second action
        result = engine.evaluate_rule(rule, act=True)
        assert "cooldown" in result["message"].lower()
        assert len(fake.set_calls) == 1

        # Cooldown over, feeder already at max: clamped, machine untouched
        rule.last_triggered_at = datetime.utcnow() - timedelta(hours=2)
        fake.feeders[1]["on_for"] = 20
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "clamped"
        assert len(fake.set_calls) == 1
        assert AutomationEvent.query.count() == 2

        # Dry run ignores cooldown and never touches the machine
        rule.last_triggered_at = datetime.utcnow()
        fake.feeders[1]["on_for"] = 10
        result = engine.evaluate_rule(rule, act=False)
        assert result["outcome"] == "would_fire"
        assert len(fake.set_calls) == 1
        assert AutomationEvent.query.count() == 2

        # Stale latest reading (only old data): treated as no data
        ChimeraRawData.query.delete()
        add_reading(peak=60.0, age_seconds=2 * 3600)
        result = engine.evaluate_rule(rule, act=True)
        assert result["value"] is None and "stale" in result["message"].lower()

        # Averaging window uses both readings
        add_reading(peak=40.0)
        rule.window_minutes = 180
        result = engine.evaluate_rule(rule, act=True)
        assert result["value"] == 50.0

        # Maintenance mode blocks the action but records why
        rule.window_minutes = 0
        rule.last_triggered_at = None
        ChimeraRawData.query.delete()
        add_reading(peak=60.0)
        fake.maintenance_mode = True
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "failed"
        assert "maintenance" in result["message"].lower()
        assert len(fake.set_calls) == 1

    print("evaluate_and_act ok")


if __name__ == "__main__":
    test_condition_met()
    test_next_value()
    test_validate_rule_fields()
    test_evaluate_and_act()
    print("\nAll automation tests passed")
