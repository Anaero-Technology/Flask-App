"""Closed-loop automation for dynamic experiments.

Watches measurements the devices are already producing (chimera gas
concentrations, black box gas production, PLC reactor temperatures) and drives
PLC outputs in response, so an experiment can adapt itself - "gas level high,
feed more" - without an operator watching the plots.

The engine is a background daemon thread in the same mould as the auto-connect
scanner: one loop, one worker process, everything it changes goes through the
same PlcHandler setters an operator's click would, so auto-save and the
per-test configuration timeline behave identically for a rule and for a hand
edit.

The decision logic (compare, clamp, step) is kept in pure functions so it can
be unit tested without hardware or a Flask app.
"""

import threading
import time
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

SOURCE_TYPES = ("chimera_gas", "blackbox_volume", "plc_temperature")
OPERATORS = ("gt", "lt", "gte", "lte")
ACTION_TYPES = ("increase", "decrease", "set")

# Which parameters a rule may drive on each unit type, and how the setter is
# called. Mixer mode is deliberately not adjustable: a rule nudges magnitudes,
# it does not switch operating regimes.
UNIT_PARAMETERS = {
    "heater": ("target",),
    "feeder": ("on_for", "off_for_minutes"),
    "mixer": ("on_for", "off_for"),
    "agitator": ("pre_feed",),
}

# A "latest reading" older than this is a stopped experiment, not a signal.
STALE_READING_SECONDS = 30 * 60

CHECK_INTERVAL_SECONDS = 15


# ----------------------------------------------------------------------
# Pure decision logic
# ----------------------------------------------------------------------
def condition_met(value: float, operator: str, threshold: float) -> bool:
    if operator == "gt":
        return value > threshold
    if operator == "lt":
        return value < threshold
    if operator == "gte":
        return value >= threshold
    if operator == "lte":
        return value <= threshold
    raise ValueError(f"Unknown operator: {operator}")


def next_value(current: float, action_type: str, amount: float,
               min_value: float, max_value: float) -> Tuple[float, bool]:
    """The value the parameter should move to, and whether the clamp bit.

    Relative steps move from the machine's current value; 'set' ignores it.
    The result always lands inside [min_value, max_value] - the clamps are the
    hard safety bounds the rule was created with.
    """
    if action_type == "increase":
        wanted = current + amount
    elif action_type == "decrease":
        wanted = current - amount
    elif action_type == "set":
        wanted = amount
    else:
        raise ValueError(f"Unknown action type: {action_type}")

    clamped = min(max(wanted, min_value), max_value)
    return clamped, clamped != wanted


def validate_rule_fields(data: Dict) -> Optional[str]:
    """The reason a rule definition is invalid, or None if it is sound.

    Shared by the create and update routes so the two can never drift.
    """
    if not str(data.get("name") or "").strip():
        return "name is required"
    if data.get("source_type") not in SOURCE_TYPES:
        return f"source_type must be one of {', '.join(SOURCE_TYPES)}"
    if data.get("operator") not in OPERATORS:
        return f"operator must be one of {', '.join(OPERATORS)}"
    if data.get("action_type") not in ACTION_TYPES:
        return f"action_type must be one of {', '.join(ACTION_TYPES)}"

    unit_type = data.get("unit_type")
    if unit_type not in UNIT_PARAMETERS:
        return f"unit_type must be one of {', '.join(UNIT_PARAMETERS)}"
    if data.get("parameter") not in UNIT_PARAMETERS[unit_type]:
        return (f"parameter for a {unit_type} must be one of "
                f"{', '.join(UNIT_PARAMETERS[unit_type])}")

    if data.get("source_type") == "chimera_gas" and not data.get("gas_name"):
        return "gas_name is required for a chimera_gas source"

    for field in ("threshold", "amount", "min_value", "max_value"):
        try:
            float(data.get(field))
        except (TypeError, ValueError):
            return f"{field} must be a number"
    for field in ("source_channel", "unit_number"):
        try:
            int(data.get(field))
        except (TypeError, ValueError):
            return f"{field} must be an integer"

    if float(data["min_value"]) > float(data["max_value"]):
        return "min_value cannot be greater than max_value"
    if float(data["amount"]) < 0 and data["action_type"] != "set":
        return "amount must not be negative - use action_type to pick the direction"
    if not (float(data["min_value"]) <= float(data["amount"]) <= float(data["max_value"])) \
            and data["action_type"] == "set":
        return "a 'set' amount must lie inside the min/max clamps"

    window = data.get("window_minutes", 0)
    try:
        if int(window) < 0:
            return "window_minutes must not be negative"
    except (TypeError, ValueError):
        return "window_minutes must be an integer"

    cooldown = data.get("cooldown_seconds", 3600)
    try:
        if int(cooldown) < CHECK_INTERVAL_SECONDS:
            return f"cooldown_seconds must be at least {CHECK_INTERVAL_SECONDS}"
    except (TypeError, ValueError):
        return "cooldown_seconds must be an integer"

    return None


# ----------------------------------------------------------------------
# Engine
# ----------------------------------------------------------------------
class AutomationEngine:
    """Evaluates enabled rules on a fixed cadence and applies their actions.

    One instance per process, started from app.py next to the auto-connect
    scanner. Every pass is independent: rules are re-read from the database,
    so edits made through the API take effect on the next pass without any
    signalling.
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialised = False
        return cls._instance

    def __init__(self):
        if self._initialised:
            return
        self._initialised = True
        self.app = None
        self._thread = None
        self._running = False

    def start(self, app):
        self.app = app
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="AutomationEngine")
        self._thread.start()
        print("[AUTOMATION] Engine started")

    def _loop(self):
        # Let the device scanner make its first pass before rules start
        # looking for handlers.
        time.sleep(10)
        while self._running:
            try:
                with self.app.app_context():
                    self.run_pass()
            except Exception as e:
                print(f"[AUTOMATION] Pass failed: {e}")
            time.sleep(CHECK_INTERVAL_SECONDS)

    def run_pass(self):
        """Evaluate every enabled rule once. Needs an app context."""
        from database.models import AutomationRule

        rules = AutomationRule.query.filter_by(enabled=True).all()
        for rule in rules:
            try:
                self.evaluate_rule(rule, act=True)
            except Exception as e:
                print(f"[AUTOMATION] Rule '{rule.name}' failed: {e}")

    # ------------------------------------------------------------------
    # Measurement readers
    # ------------------------------------------------------------------
    def read_metric(self, rule) -> Tuple[Optional[float], str]:
        """The rule's current measurement, and a description of it.

        Returns (None, reason) when there is nothing trustworthy to act on -
        no data, or only data old enough to be a stopped experiment.
        """
        if rule.source_type == "chimera_gas":
            return self._read_chimera_gas(rule)
        if rule.source_type == "blackbox_volume":
            return self._read_blackbox_volume(rule)
        if rule.source_type == "plc_temperature":
            return self._read_plc_temperature(rule)
        return None, f"Unknown source type {rule.source_type}"

    def _read_chimera_gas(self, rule) -> Tuple[Optional[float], str]:
        """Peak gas concentration for a channel, latest or averaged."""
        from database.models import ChimeraRawData

        base = ChimeraRawData.query.filter_by(
            device_id=rule.source_device_id,
            channel_number=rule.source_channel,
            gas_name=rule.gas_name,
        )
        if rule.window_minutes and rule.window_minutes > 0:
            cutoff = int(time.time()) - rule.window_minutes * 60
            rows = base.filter(ChimeraRawData.timestamp >= cutoff).all()
            if not rows:
                return None, f"No {rule.gas_name} readings in the last {rule.window_minutes} min"
            avg = sum(r.peak_value for r in rows) / len(rows)
            return avg, (f"{rule.gas_name} avg over {rule.window_minutes} min "
                         f"({len(rows)} readings)")

        # id breaks the tie between rows sharing a timestamp second
        row = base.order_by(ChimeraRawData.timestamp.desc(),
                            ChimeraRawData.id.desc()).first()
        if not row:
            return None, f"No {rule.gas_name} readings for channel {rule.source_channel}"
        if row.timestamp < int(time.time()) - STALE_READING_SECONDS:
            return None, f"Latest {rule.gas_name} reading is stale"
        return row.peak_value, f"Latest {rule.gas_name} reading"

    def _read_blackbox_volume(self, rule) -> Tuple[Optional[float], str]:
        """Gas produced (ml at STP) by a channel over the window.

        A window is required to make this a rate; zero tips genuinely means
        zero production, so an empty window reads as 0.0 rather than no-data -
        that is exactly the signal a "production has collapsed" rule needs.
        Guarded by requiring the channel to be on an actively logging device,
        so a black box that is simply not recording does not read as collapse.
        """
        from database.models import BlackBoxEventLogData, Device

        window = rule.window_minutes if rule.window_minutes > 0 else 60
        device = Device.query.get(rule.source_device_id)
        if not device or not device.connected:
            return None, "Source black box is not connected"
        if not device.active_test_id:
            return None, "Source black box has no running test"

        cutoff = int(time.time()) - window * 60
        rows = (BlackBoxEventLogData.query
                .filter_by(device_id=rule.source_device_id,
                           channel_number=rule.source_channel)
                .filter(BlackBoxEventLogData.timestamp >= cutoff)
                .all())
        total = sum(r.volume_this_tip_stp for r in rows)
        return total, f"Volume over {window} min ({len(rows)} tips)"

    def _read_plc_temperature(self, rule) -> Tuple[Optional[float], str]:
        """A reactor's live temperature, with its calibration offset applied."""
        from database.models import PlcCalibration
        from device_manager import DeviceManager

        handler = DeviceManager().get_plc(rule.source_device_id)
        if not handler:
            return None, "Source PLC is not connected"
        raw = handler.latest_temperatures.get(rule.source_channel)
        if raw is None:
            return None, f"No temperature yet for reactor {rule.source_channel}"

        cal = PlcCalibration.query.filter_by(
            device_id=rule.source_device_id,
            heater_number=rule.source_channel).first()
        return raw + (cal.offset if cal else 0.0), \
            f"Reactor {rule.source_channel} temperature"

    # ------------------------------------------------------------------
    # Acting on the PLC
    # ------------------------------------------------------------------
    def _target_unit(self, handler, rule) -> Tuple[Optional[Dict], str]:
        """The target unit's current settings, read back from the machine."""
        status = handler.get_status()
        if status is None:
            return None, "Target PLC did not return its status"
        units = status.get(rule.unit_type + "s", [])
        unit = next((u for u in units if u["number"] == rule.unit_number), None)
        if unit is None:
            return None, f"{rule.unit_type} {rule.unit_number} does not exist on this machine"
        return unit, "ok"

    def _apply(self, handler, rule, unit: Dict, value: float) -> Tuple[bool, str]:
        """Drive the one parameter the rule owns, keeping the unit's other
        settings exactly as the machine reports them."""
        v = int(round(value))
        if rule.unit_type == "heater":
            return handler.set_heater(rule.unit_number, v)
        if rule.unit_type == "feeder":
            on_for = v if rule.parameter == "on_for" else unit["on_for"]
            off_for = v if rule.parameter == "off_for_minutes" else unit["off_for_minutes"]
            return handler.set_feeder(rule.unit_number, on_for, off_for)
        if rule.unit_type == "mixer":
            if unit["mode"] != 2:
                return False, "mixer is not in timed mode, its times have no effect"
            on_for = v if rule.parameter == "on_for" else unit["on_for"]
            off_for = v if rule.parameter == "off_for" else unit["off_for"]
            return handler.set_mixer(rule.unit_number, unit["mode"], on_for, off_for)
        if rule.unit_type == "agitator":
            return handler.set_agitator(rule.unit_number, v)
        return False, f"Unknown unit type {rule.unit_type}"

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------
    def evaluate_rule(self, rule, act: bool) -> Dict:
        """Evaluate one rule; apply its action when act=True.

        With act=False this is a dry run: the same reads and the same
        decision, reported but not applied - so an operator can see what a
        rule would do right now before trusting it with the machine.

        Only condition-met evaluations past their cooldown produce events;
        a quiet rule writes nothing.
        """
        from device_manager import DeviceManager

        result = {
            "rule_id": rule.id,
            "value": None,
            "condition_met": False,
            "outcome": None,
            "message": None,
        }

        value, description = self.read_metric(rule)
        result["value"] = value
        if value is None:
            result["message"] = description
            return result

        met = condition_met(value, rule.operator, rule.threshold)
        result["condition_met"] = met
        if not met:
            result["message"] = f"{description}: {value:.2f}, condition not met"
            return result

        if act and rule.last_triggered_at:
            elapsed = (datetime.utcnow() - rule.last_triggered_at).total_seconds()
            if elapsed < rule.cooldown_seconds:
                result["message"] = (f"In cooldown for another "
                                     f"{int(rule.cooldown_seconds - elapsed)}s")
                return result

        handler = DeviceManager().get_plc(rule.target_device_id)
        if not handler:
            return self._record(rule, result, "failed", None, None,
                                "Target PLC is not connected", act)
        if handler.maintenance_mode:
            return self._record(rule, result, "failed", None, None,
                                "Target PLC is in maintenance mode", act)
        if getattr(handler, "firmware_update_in_progress", False):
            result["message"] = "Target PLC is being flashed"
            return result

        unit, reason = self._target_unit(handler, rule)
        if unit is None:
            return self._record(rule, result, "failed", None, None, reason, act)

        current = float(unit[rule.parameter])
        wanted, clamped = next_value(current, rule.action_type, rule.amount,
                                     rule.min_value, rule.max_value)
        result["current"] = current
        result["new_value"] = wanted

        if int(round(wanted)) == int(round(current)):
            # Saturated at a clamp (or a no-op set): record it so the operator
            # can see the rule wants to keep pushing but has hit its bounds.
            return self._record(rule, result, "clamped", current, current,
                                f"{description}: {value:.2f} - already at "
                                f"{current:g}, clamps [{rule.min_value:g}, "
                                f"{rule.max_value:g}]", act)

        if not act:
            result["outcome"] = "would_fire"
            result["message"] = (f"{description}: {value:.2f} - would change "
                                 f"{rule.unit_type} {rule.unit_number} "
                                 f"{rule.parameter} {current:g} -> {wanted:g}"
                                 + (" (clamped)" if clamped else ""))
            return result

        ok, message = self._apply(handler, rule, unit, wanted)
        if not ok:
            return self._record(rule, result, "failed", current, None,
                                f"PLC rejected the change: {message}", act)

        handler.auto_save()
        self._append_test_timeline(rule, handler, current, wanted)
        return self._record(rule, result, "fired", current, wanted,
                            f"{description}: {value:.2f} - {rule.unit_type} "
                            f"{rule.unit_number} {rule.parameter} "
                            f"{current:g} -> {wanted:g}"
                            + (" (clamped)" if clamped else ""), act)

    def _append_test_timeline(self, rule, handler, old, new):
        """A rule's change lands on a running test's timeline like a hand edit."""
        from routes.plc import _active_test_id, _record_version
        try:
            test_id = _active_test_id(rule.target_device_id)
            if test_id:
                _record_version(
                    test_id, rule.target_device_id, handler,
                    f"automation '{rule.name}': {rule.unit_type} "
                    f"{rule.unit_number} {rule.parameter} {old:g} -> {new:g}")
        except Exception as e:
            print(f"[AUTOMATION] Could not record test timeline entry: {e}")

    def _record(self, rule, result, outcome, old, new, message, act) -> Dict:
        """Finish an evaluation: event row, cooldown stamp, SSE - when acting."""
        result["outcome"] = outcome
        result["message"] = message
        if not act:
            return result

        from database.models import db, AutomationEvent, Device

        try:
            device = Device.query.get(rule.target_device_id)
            event = AutomationEvent(
                rule_id=rule.id,
                test_id=device.active_test_id if device else None,
                observed_value=result["value"],
                outcome=outcome,
                old_value=old,
                new_value=new,
                message=message,
            )
            db.session.add(event)
            # Every recorded outcome starts the cooldown: a failing or
            # saturated rule retries on the same schedule as a firing one
            # instead of hammering the PLC every pass.
            rule.last_triggered_at = datetime.utcnow()
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"[AUTOMATION] Could not record event: {e}")

        self._publish_event(rule, outcome, message)
        print(f"[AUTOMATION] '{rule.name}': {outcome} - {message}")
        return result

    def _publish_event(self, rule, outcome, message):
        if not self.app:
            return
        try:
            from flask_sse import sse
            sse.publish({
                "rule_id": rule.id,
                "rule_name": rule.name,
                "device_id": rule.target_device_id,
                "outcome": outcome,
                "message": message,
            }, type="automation_event")
        except Exception as e:
            print(f"[AUTOMATION] SSE publish failed: {e}")
