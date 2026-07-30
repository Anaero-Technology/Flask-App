#!/usr/bin/env python3
"""Unit tests for the automation engine - no hardware needed.

Three layers are covered:

- the pure decision functions (condition_met, combine_conditions, gate_check,
  plan_action) that both the live engine and the simulator run on
- the simulator, including AND/OR behaviour under dropouts, cooldowns,
  clamping and closed-loop feedback
- the full live evaluate/act path, against an in-memory database with a fake
  PLC handler planted in the DeviceManager

Run from backend/: venv/bin/python tests/test_automation.py
"""

import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.environ["DISABLE_AUTO_CONNECT"] = "1"

import time
import random
from types import SimpleNamespace

from flask import Flask

from automation_engine import (AutomationEngine, condition_met, combine_conditions,
                              gate_check, plan_action, next_value, simulate,
                              scenario_series, rule_from_spec, validate_rule_fields)
from database.models import (db, Device, AutomationRule, AutomationCondition,
                             AutomationEvent, ChimeraRawData)
from device_manager import DeviceManager


def reading(value, met, description="m"):
    return {"value": value, "met": met, "description": description}


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


def test_combine_conditions():
    met, unmet = reading(60, True), reading(40, False)
    unknown = reading(None, None)

    # AND
    assert combine_conditions([met, met], "all")[0] is True
    assert combine_conditions([met, unmet], "all")[0] is False
    # an unknown blocks an AND rather than counting as false - acting would
    # mean driving the machine on evidence nobody asked for
    assert combine_conditions([met, unknown], "all")[0] is None
    assert combine_conditions([unmet, unknown], "all")[0] is False  # already decided

    # OR
    assert combine_conditions([met, unmet], "any")[0] is True
    assert combine_conditions([unmet, unmet], "any")[0] is False
    # an unknown is ignored when something positive was actually measured
    assert combine_conditions([met, unknown], "any")[0] is True
    # but with nothing positive and something unknown, the answer is unknown
    assert combine_conditions([unmet, unknown], "any")[0] is None

    # nothing readable at all, either way
    assert combine_conditions([unknown, unknown], "all")[0] is None
    assert combine_conditions([unknown, unknown], "any")[0] is None
    assert combine_conditions([], "all")[0] is None
    print("combine_conditions ok")


def test_next_value():
    assert next_value(10, "increase", 5, 0, 20) == (15, False)
    assert next_value(18, "increase", 5, 0, 20) == (20, True)   # clamped at max
    assert next_value(10, "decrease", 5, 8, 20) == (8, True)    # clamped at min
    assert next_value(10, "set", 12, 0, 20) == (12, False)
    assert next_value(10, "set", 40, 0, 20) == (20, True)
    print("next_value ok")


def test_gate_and_plan():
    rule = SimpleNamespace(condition_logic="all", cooldown_seconds=3600,
                           action_type="increase", amount=5, min_value=5,
                           max_value=20, unit_type="feeder", unit_number=1,
                           parameter="on_for")

    assert gate_check(rule, [reading(60, True)], None)["outcome"] == "proceed"
    assert gate_check(rule, [reading(40, False)], None)["outcome"] == "not_met"
    assert gate_check(rule, [reading(None, None)], None)["outcome"] == "no_data"
    # cooldown only applies once the rule has actually acted
    assert gate_check(rule, [reading(60, True)], 100)["outcome"] == "cooldown"
    assert gate_check(rule, [reading(60, True)], 4000)["outcome"] == "proceed"

    assert plan_action(rule, 10)["outcome"] == "fire"
    assert plan_action(rule, 10)["new_value"] == 15
    assert plan_action(rule, 20)["outcome"] == "clamped"   # already at max
    assert plan_action(rule, 18)["new_value"] == 20        # clamped but still moves
    print("gate_check / plan_action ok")


def test_validate_rule_fields():
    good = {
        "name": "feed on methane", "condition_logic": "all",
        "conditions": [{
            "source_type": "chimera_gas", "source_device_id": 1,
            "source_channel": 3, "gas_name": "CH4", "window_minutes": 0,
            "operator": "gt", "threshold": 55,
        }],
        "target_device_id": 2, "unit_type": "feeder", "unit_number": 1,
        "parameter": "on_for", "action_type": "increase", "amount": 5,
        "min_value": 5, "max_value": 60, "cooldown_seconds": 3600,
    }
    assert validate_rule_fields(good) is None

    assert "name" in validate_rule_fields({**good, "name": " "})
    assert "condition_logic" in validate_rule_fields({**good, "condition_logic": "maybe"})
    assert "at least one condition" in validate_rule_fields({**good, "conditions": []})
    assert "at most" in validate_rule_fields({**good, "conditions": good["conditions"] * 6})
    assert "parameter" in validate_rule_fields({**good, "parameter": "target"})
    assert "min_value" in validate_rule_fields({**good, "min_value": 100})
    assert "clamps" in validate_rule_fields({**good, "action_type": "set", "amount": 100})
    assert "cooldown" in validate_rule_fields({**good, "cooldown_seconds": 1})

    # errors inside a condition are reported with its position
    bad_condition = {**good, "conditions": [good["conditions"][0],
                                            {**good["conditions"][0], "operator": "=="}]}
    assert "condition 2" in validate_rule_fields(bad_condition)
    assert "gas_name" in validate_rule_fields(
        {**good, "conditions": [{**good["conditions"][0], "gas_name": None}]})
    print("validate_rule_fields ok")


# ----------------------------------------------------------------------
# Scenario generation
# ----------------------------------------------------------------------
def test_scenario_series():
    rng = random.Random(0)
    assert scenario_series({"pattern": "constant", "value": 7}, 4, rng) == [7, 7, 7, 7]
    assert scenario_series({"pattern": "ramp", "from": 0, "to": 3}, 4, rng) == [0, 1, 2, 3]
    assert scenario_series({"pattern": "step", "from": 1, "to": 9, "at": 2}, 4, rng) == [1, 1, 9, 9]
    # a custom series holds its last value rather than looping
    assert scenario_series({"pattern": "custom", "values": [5, 6]}, 4, rng) == [5, 6, 6, 6]
    # dropouts punch holes for the no-data paths
    assert scenario_series({"pattern": "constant", "value": 2, "dropout_every": 2}, 4, rng) \
        == [2, None, 2, None]
    # sine stays inside its band
    sine = scenario_series({"pattern": "sine", "from": 0, "to": 10, "period": 4}, 8, rng)
    assert all(-0.01 <= v <= 10.01 for v in sine)
    print("scenario_series ok")


# ----------------------------------------------------------------------
# Simulation
# ----------------------------------------------------------------------
def sim_rule(logic="all", conditions=None, **overrides):
    spec = {
        "name": "sim", "condition_logic": logic,
        "conditions": conditions or [{
            "source_type": "chimera_gas", "source_device_id": 1,
            "source_channel": 1, "gas_name": "CH4", "operator": "gt",
            "threshold": 55, "window_minutes": 0,
        }],
        "target_device_id": 2, "unit_type": "feeder", "unit_number": 1,
        "parameter": "on_for", "action_type": "increase", "amount": 5,
        "min_value": 5, "max_value": 20, "cooldown_seconds": 3600,
        **overrides,
    }
    return rule_from_spec(spec)


def test_simulation_basics():
    rule = sim_rule()

    # Always above threshold, one step per cooldown: fires until it saturates
    # at max (10 -> 15 -> 20), then reports clamped.
    result = simulate(rule, [{"pattern": "constant", "value": 60}],
                      steps=5, minutes_per_step=60, starting_value=10)
    assert result["summary"]["fired"] == 2
    assert result["summary"]["final_value"] == 20
    assert result["summary"]["hit_limit"] is True
    assert [s["outcome"] for s in result["steps"]] == \
        ["fire", "fire", "clamped", "clamped", "clamped"]

    # Never above threshold: nothing happens at all
    quiet = simulate(rule, [{"pattern": "constant", "value": 10}],
                     steps=5, minutes_per_step=60, starting_value=10)
    assert quiet["summary"]["fired"] == 0
    assert quiet["summary"]["final_value"] == 10
    assert all(s["outcome"] == "not_met" for s in quiet["steps"])

    # Cooldown longer than the step size holds the rule back between actions
    slow = simulate(rule, [{"pattern": "constant", "value": 60}],
                    steps=6, minutes_per_step=30, starting_value=10)
    assert [s["outcome"] for s in slow["steps"]] == \
        ["fire", "cooldown", "fire", "cooldown", "clamped", "cooldown"]
    print("simulation basics ok")


def test_simulation_and_or_with_dropouts():
    two = [
        {"source_type": "chimera_gas", "source_device_id": 1, "source_channel": 1,
         "gas_name": "CH4", "operator": "gt", "threshold": 55, "window_minutes": 0},
        {"source_type": "plc_temperature", "source_device_id": 2, "source_channel": 1,
         "operator": "gte", "threshold": 35, "window_minutes": 0},
    ]
    # first condition always met; second always unreadable
    scenarios = [{"pattern": "constant", "value": 60},
                 {"pattern": "constant", "value": 40, "dropout_every": 1}]

    and_run = simulate(sim_rule("all", two), scenarios, steps=3,
                       minutes_per_step=60, starting_value=10)
    assert all(s["outcome"] == "no_data" for s in and_run["steps"])
    assert and_run["summary"]["fired"] == 0

    or_run = simulate(sim_rule("any", two), scenarios, steps=3,
                      minutes_per_step=60, starting_value=10)
    assert or_run["summary"]["fired"] == 2      # acts on the one it can read

    # AND with both readable and both met fires
    both = simulate(sim_rule("all", two),
                    [{"pattern": "constant", "value": 60},
                     {"pattern": "constant", "value": 40}],
                    steps=2, minutes_per_step=60, starting_value=10)
    assert both["summary"]["fired"] == 2

    # AND where the second condition is readable but false never fires
    one_false = simulate(sim_rule("all", two),
                         [{"pattern": "constant", "value": 60},
                          {"pattern": "constant", "value": 20}],
                         steps=3, minutes_per_step=60, starting_value=10)
    assert one_false["summary"]["fired"] == 0
    assert all(s["outcome"] == "not_met" for s in one_false["steps"])
    print("simulation AND/OR ok")


def test_simulation_feedback():
    """Closed-loop: the measurement reacts to what the rule already did."""
    rule = sim_rule(action_type="increase", amount=5, min_value=0, max_value=100,
                    cooldown_seconds=60)

    # Feeding harder pushes methane down, so the rule should settle rather
    # than run away: each +5 on the parameter drops the reading by 5.
    settling = simulate(rule, [{"pattern": "constant", "value": 60,
                                "response_per_unit": -1.0}],
                        steps=6, minutes_per_step=60, starting_value=0)
    # 60 -> fire (param 5, reading 55) -> 55 is not > 55, so it stops
    assert settling["summary"]["fired"] == 1
    assert settling["summary"]["final_value"] == 5
    assert settling["summary"]["crossings"] == 1     # crossed once and stayed

    # A measurement swinging across the threshold makes the rule act in
    # bursts; the crossing count is what exposes that hunting.
    oscillating = simulate(rule, [{"pattern": "sine", "from": 40, "to": 70,
                                   "period": 4}],
                           steps=12, minutes_per_step=60, starting_value=0)
    assert oscillating["summary"]["crossings"] >= 4

    # A rule that never crosses its threshold reports no hunting at all
    steady = simulate(rule, [{"pattern": "constant", "value": 10}],
                      steps=6, minutes_per_step=60, starting_value=0)
    assert steady["summary"]["crossings"] == 0
    print("simulation feedback ok")


def test_simulation_is_deterministic():
    rule = sim_rule()
    scenario = [{"pattern": "noise", "from": 40, "to": 70}]
    a = simulate(rule, scenario, steps=20, minutes_per_step=60,
                 starting_value=10, seed=7)
    b = simulate(rule, scenario, steps=20, minutes_per_step=60,
                 starting_value=10, seed=7)
    c = simulate(rule, scenario, steps=20, minutes_per_step=60,
                 starting_value=10, seed=8)
    assert a == b, "same seed must reproduce exactly - a simulator you cannot repeat is useless"
    assert a != c
    print("simulation determinism ok")


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


def make_rule(logic="all", extra_conditions=()):
    rule = AutomationRule(
        name="feed on methane", enabled=True, condition_logic=logic,
        target_device_id=2, unit_type="feeder", unit_number=1,
        parameter="on_for", action_type="increase", amount=5.0,
        min_value=5.0, max_value=20.0, cooldown_seconds=3600)
    rule.conditions.append(AutomationCondition(
        position=0, source_type="chimera_gas", source_device_id=1,
        source_channel=3, gas_name="CH4", window_minutes=0,
        operator="gt", threshold=55.0))
    for position, condition in enumerate(extra_conditions, start=1):
        condition.position = position
        rule.conditions.append(condition)
    return rule


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
        assert result["outcome"] == "no_data"
        assert AutomationEvent.query.count() == 0

        # Reading below threshold: condition not met, no event
        add_reading(peak=40.0)
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "not_met"
        assert result["readings"][0]["value"] == 40.0
        assert AutomationEvent.query.count() == 0

        # Reading above threshold: fires, feeder stepped 10 -> 15
        add_reading(peak=60.0)
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "fired", result
        assert fake.set_calls == [("feeder", 1, 15, 120)]
        event = AutomationEvent.query.one()
        assert (event.outcome, event.old_value, event.new_value) == ("fired", 10, 15)
        assert "CH4" in event.observed_values
        assert rule.last_triggered_at is not None

        # Still above threshold but inside cooldown: no second action
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "cooldown"
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
        assert result["outcome"] == "no_data"
        assert "stale" in result["message"].lower()

        # Averaging window uses both readings
        add_reading(peak=40.0)
        rule.conditions[0].window_minutes = 180
        result = engine.evaluate_rule(rule, act=False)
        assert result["readings"][0]["value"] == 50.0

        # Maintenance mode blocks the action but records why
        rule.conditions[0].window_minutes = 0
        rule.last_triggered_at = None
        ChimeraRawData.query.delete()
        add_reading(peak=60.0)
        fake.maintenance_mode = True
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "failed"
        assert "maintenance" in result["message"].lower()
        assert len(fake.set_calls) == 1

    print("evaluate_and_act ok")


def test_evaluate_multi_condition():
    """A second condition on a PLC temperature gates the same rule live."""
    app = make_app()
    fake = FakePlc()
    DeviceManager.set_app(app)
    DeviceManager()._active_handlers[2] = fake

    engine = AutomationEngine()
    engine.app = None

    with app.app_context():
        rule = make_rule(logic="all", extra_conditions=[AutomationCondition(
            source_type="plc_temperature", source_device_id=2, source_channel=1,
            window_minutes=0, operator="gte", threshold=35.0)])
        db.session.add(rule)
        db.session.commit()
        add_reading(peak=60.0)

        # Gas is met, but the PLC has reported no temperature yet: an AND rule
        # waits rather than acting on half its evidence.
        result = engine.evaluate_rule(rule, act=True)
        assert result["outcome"] == "no_data"
        assert not fake.set_calls

        # Temperature present but too low: genuinely not met
        fake.latest_temperatures = {1: 30.0}
        assert engine.evaluate_rule(rule, act=True)["outcome"] == "not_met"
        assert not fake.set_calls

        # Both met: fires
        fake.latest_temperatures = {1: 37.0}
        assert engine.evaluate_rule(rule, act=True)["outcome"] == "fired"
        assert fake.set_calls == [("feeder", 1, 15, 120)]

        # The same pair as OR fires on gas alone, even with no temperature
        rule.condition_logic = "any"
        rule.last_triggered_at = None
        fake.latest_temperatures = {}
        fake.feeders[1]["on_for"] = 10
        assert engine.evaluate_rule(rule, act=True)["outcome"] == "fired"
        assert len(fake.set_calls) == 2

    print("evaluate multi-condition ok")


if __name__ == "__main__":
    test_condition_met()
    test_combine_conditions()
    test_next_value()
    test_gate_and_plan()
    test_validate_rule_fields()
    test_scenario_series()
    test_simulation_basics()
    test_simulation_and_or_with_dropouts()
    test_simulation_feedback()
    test_simulation_is_deterministic()
    test_evaluate_and_act()
    test_evaluate_multi_condition()
    print("\nAll automation tests passed")
