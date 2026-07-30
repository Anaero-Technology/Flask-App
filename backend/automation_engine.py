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

The decision itself is two pure functions - gate_check (are the conditions
satisfied, and is the rule allowed to act?) and plan_action (what value should
the parameter move to?). Nothing about them touches hardware or the database,
which is what lets the simulator drive the very same code the daemon runs
against synthetic measurements. A rule that behaves in simulation behaves live,
because it is not a second implementation.
"""

import math
import random
import threading
import time
from datetime import datetime
from types import SimpleNamespace
from typing import Dict, List, Optional, Tuple

SOURCE_TYPES = ("chimera_gas", "blackbox_volume", "plc_temperature")
OPERATORS = ("gt", "lt", "gte", "lte")
ACTION_TYPES = ("increase", "decrease", "set")
CONDITION_LOGIC = ("all", "any")          # 'all' = AND, 'any' = OR

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

MAX_CONDITIONS = 5
MAX_SIMULATION_STEPS = 500


# ----------------------------------------------------------------------
# Pure decision logic
#
# Shared by the live daemon and the simulator. No I/O here.
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


def combine_conditions(readings: List[Dict], logic: str) -> Tuple[Optional[bool], str]:
    """Fold each condition's outcome into the rule's verdict.

    A reading whose value is None could not be taken - no data, or only data
    old enough to be a stopped experiment. Those are treated as unknown rather
    than false, which matters differently for the two logics:

    - 'all' (AND) needs every condition confirmed, so an unknown one blocks
      the rule. Acting on a partially-observed AND would drive the machine on
      evidence the operator did not ask for.
    - 'any' (OR) only needs one condition confirmed, so unknowns are ignored
      as long as something positive was actually measured.

    Returns (True/False/None, explanation); None means "cannot tell yet".
    """
    if not readings:
        return None, "The rule has no conditions"

    readable = [r for r in readings if r["value"] is not None]
    if not readable:
        # 'detail' carries why a reading could not be taken ("...is stale"),
        # which is the useful thing to say when nothing could be read at all.
        if len(readings) == 1:
            return None, readings[0].get("detail") or readings[0]["description"]
        return None, f"None of the {len(readings)} measurements could be read"

    met = [r for r in readable if r["met"]]

    if logic == "any":
        if met:
            return True, _summary(met, "met")
        if len(readable) < len(readings):
            return None, (f"{len(readings) - len(readable)} of {len(readings)} "
                          f"measurements unavailable, none of the rest met")
        return False, _summary(readable, "not met")

    # 'all' - a condition that is definitively false settles the rule even if
    # another is unknown, and says so more usefully than "waiting for data".
    unmet = [r for r in readable if not r["met"]]
    if unmet:
        return False, _summary(unmet, "not met")
    if len(readable) < len(readings):
        return None, (f"waiting for {len(readings) - len(readable)} of "
                      f"{len(readings)} measurements")
    return True, _summary(readable, "met")


def _summary(readings: List[Dict], state: str) -> str:
    shown = ", ".join(f"{r['description']} {r['value']:.2f}" for r in readings[:3])
    more = f" (+{len(readings) - 3} more)" if len(readings) > 3 else ""
    return f"{shown}{more} {state}"


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


def gate_check(rule, readings: List[Dict],
               seconds_since_trigger: Optional[float]) -> Dict:
    """May this rule act right now?

    Kept separate from plan_action so the live path can answer it without a
    serial round-trip: most passes end here, and reading the PLC's status to
    find the current value is the expensive part.

    outcome is one of 'no_data', 'not_met', 'cooldown', 'proceed'.
    """
    verdict, explanation = combine_conditions(readings, rule.condition_logic)

    if verdict is None:
        return {"outcome": "no_data", "reason": explanation}
    if not verdict:
        return {"outcome": "not_met", "reason": explanation}

    if seconds_since_trigger is not None and seconds_since_trigger < rule.cooldown_seconds:
        remaining = int(rule.cooldown_seconds - seconds_since_trigger)
        return {"outcome": "cooldown",
                "reason": f"In cooldown for another {remaining}s"}

    return {"outcome": "proceed", "reason": explanation}


def plan_action(rule, current_value: float) -> Dict:
    """What the parameter should become, given where it is now.

    outcome is 'clamped' when the rule wants to keep pushing but the value is
    already at the bound it would be held to, and 'fire' otherwise.
    """
    wanted, clamped = next_value(current_value, rule.action_type, rule.amount,
                                 rule.min_value, rule.max_value)

    # The PLC setters take whole numbers, so a sub-unit step that rounds back
    # onto the current value is a no-op, not a change worth sending.
    if int(round(wanted)) == int(round(current_value)):
        return {"outcome": "clamped", "new_value": current_value,
                "clamped": clamped, "current": current_value,
                "reason": (f"already at {current_value:g}, clamps "
                           f"[{rule.min_value:g}, {rule.max_value:g}]")}

    return {"outcome": "fire", "new_value": wanted, "clamped": clamped,
            "current": current_value,
            "reason": (f"{rule.unit_type} {rule.unit_number} {rule.parameter} "
                       f"{current_value:g} -> {wanted:g}"
                       + (" (clamped)" if clamped else ""))}


# ----------------------------------------------------------------------
# Validation
# ----------------------------------------------------------------------
def validate_condition_fields(data: Dict) -> Optional[str]:
    """The reason one condition is invalid, or None if it is sound."""
    if data.get("source_type") not in SOURCE_TYPES:
        return f"source_type must be one of {', '.join(SOURCE_TYPES)}"
    if data.get("operator") not in OPERATORS:
        return f"operator must be one of {', '.join(OPERATORS)}"
    if data.get("source_type") == "chimera_gas" and not data.get("gas_name"):
        return "gas_name is required for a chimera_gas source"

    try:
        float(data.get("threshold"))
    except (TypeError, ValueError):
        return "threshold must be a number"
    for field in ("source_device_id", "source_channel"):
        try:
            int(data.get(field))
        except (TypeError, ValueError):
            return f"{field} must be an integer"
    try:
        if int(data.get("window_minutes", 0)) < 0:
            return "window_minutes must not be negative"
    except (TypeError, ValueError):
        return "window_minutes must be an integer"
    return None


def validate_rule_fields(data: Dict) -> Optional[str]:
    """The reason a rule definition is invalid, or None if it is sound.

    Shared by the create, update and simulate routes so they can never drift.
    """
    if not str(data.get("name") or "").strip():
        return "name is required"
    if data.get("condition_logic", "all") not in CONDITION_LOGIC:
        return f"condition_logic must be one of {', '.join(CONDITION_LOGIC)}"
    if data.get("action_type") not in ACTION_TYPES:
        return f"action_type must be one of {', '.join(ACTION_TYPES)}"

    unit_type = data.get("unit_type")
    if unit_type not in UNIT_PARAMETERS:
        return f"unit_type must be one of {', '.join(UNIT_PARAMETERS)}"
    if data.get("parameter") not in UNIT_PARAMETERS[unit_type]:
        return (f"parameter for a {unit_type} must be one of "
                f"{', '.join(UNIT_PARAMETERS[unit_type])}")

    conditions = data.get("conditions")
    if not conditions:
        return "a rule needs at least one condition"
    if len(conditions) > MAX_CONDITIONS:
        return f"a rule can hold at most {MAX_CONDITIONS} conditions"
    for index, condition in enumerate(conditions, start=1):
        error = validate_condition_fields(condition)
        if error:
            return f"condition {index}: {error}"

    for field in ("amount", "min_value", "max_value"):
        try:
            float(data.get(field))
        except (TypeError, ValueError):
            return f"{field} must be a number"
    for field in ("target_device_id", "unit_number"):
        try:
            int(data.get(field))
        except (TypeError, ValueError):
            return f"{field} must be an integer"

    if float(data["min_value"]) > float(data["max_value"]):
        return "min_value cannot be greater than max_value"
    if float(data["amount"]) < 0 and data["action_type"] != "set":
        return "amount must not be negative - use action_type to pick the direction"
    if data["action_type"] == "set" and \
            not (float(data["min_value"]) <= float(data["amount"]) <= float(data["max_value"])):
        return "a 'set' amount must lie inside the min/max clamps"

    try:
        if int(data.get("cooldown_seconds", 3600)) < CHECK_INTERVAL_SECONDS:
            return f"cooldown_seconds must be at least {CHECK_INTERVAL_SECONDS}"
    except (TypeError, ValueError):
        return "cooldown_seconds must be an integer"

    return None


# ----------------------------------------------------------------------
# Simulation
# ----------------------------------------------------------------------
def scenario_series(spec: Dict, steps: int, rng: random.Random) -> List[Optional[float]]:
    """Synthetic measurements for one condition, one value per step.

    Patterns describe how a measurement behaves over a run so a rule can be
    watched against the shapes that actually break control loops: a slow drift
    (ramp), a sudden process change (step), a daily swing (sine), a noisy
    sensor (noise), and a dropout (gaps) where the value cannot be read at all.
    """
    pattern = spec.get("pattern", "constant")
    start = float(spec.get("from", spec.get("value", 0)))
    end = float(spec.get("to", start))

    if pattern == "custom":
        values = [float(v) for v in (spec.get("values") or [])]
        if not values:
            raise ValueError("a custom scenario needs values")
        # Hold the last value rather than looping, so a short series does not
        # silently restart the experiment part-way through the run.
        series = [values[min(i, len(values) - 1)] for i in range(steps)]
    elif pattern == "ramp":
        span = max(steps - 1, 1)
        series = [start + (end - start) * (i / span) for i in range(steps)]
    elif pattern == "step":
        at = int(spec.get("at", steps // 2))
        series = [start if i < at else end for i in range(steps)]
    elif pattern == "sine":
        period = max(float(spec.get("period", max(steps / 2, 2))), 2.0)
        mid, amplitude = (start + end) / 2, abs(end - start) / 2
        series = [mid + amplitude * math.sin(2 * math.pi * i / period)
                  for i in range(steps)]
    elif pattern == "noise":
        mid, amplitude = (start + end) / 2, abs(end - start) / 2
        series = [mid + rng.uniform(-amplitude, amplitude) for _ in range(steps)]
    else:  # constant
        series = [start] * steps

    # Dropouts: every nth step reads as unavailable, to exercise the no-data
    # paths (an AND rule should stall, an OR rule should carry on).
    dropout = int(spec.get("dropout_every", 0) or 0)
    if dropout > 0:
        series = [None if (i + 1) % dropout == 0 else v for i, v in enumerate(series)]

    return series


def simulate(rule, scenarios: List[Dict], steps: int, minutes_per_step: float,
             starting_value: float, seed: int = 0) -> Dict:
    """Run a rule against synthetic measurements and report what it would do.

    Drives the same gate_check/plan_action the daemon uses, with simulated
    time and a simulated parameter value standing in for the PLC - so this
    predicts real behaviour rather than approximating it.

    Each scenario may declare a `response_per_unit`: how much the measurement
    moves for each unit the parameter is changed. That closes the loop and is
    what exposes an unstable rule (one that overshoots and oscillates). It is
    a deliberately crude static-gain model - real digesters respond slowly and
    non-linearly - so it is for catching runaway logic, not for predicting
    biology.
    """
    steps = max(1, min(int(steps), MAX_SIMULATION_STEPS))
    rng = random.Random(seed)
    series = [scenario_series(s, steps, rng) for s in scenarios]

    value = float(starting_value)
    last_trigger_step = None
    timeline, fires, clamps = [], 0, 0

    labels = [condition_description(c) for c in rule.conditions]

    for i in range(steps):
        readings = []
        for condition, scenario, values, label in zip(
                rule.conditions, scenarios, series, labels):
            base = values[i]
            if base is None:
                readings.append({"value": None, "met": None, "description": label})
                continue
            # Feedback: the measurement reacts to what the rule has already
            # done to the machine.
            response = float(scenario.get("response_per_unit", 0.0) or 0.0)
            observed = base + response * (value - float(starting_value))
            readings.append({
                "value": observed,
                "met": condition_met(observed, condition.operator, condition.threshold),
                "description": label,
            })

        seconds_since = None if last_trigger_step is None else \
            (i - last_trigger_step) * minutes_per_step * 60

        gate = gate_check(rule, readings, seconds_since)
        outcome, reason, before = gate["outcome"], gate["reason"], value
        # Whether the conditions held, independent of cooldown - the cooldown
        # outcome would otherwise hide it, and this is what reveals hunting.
        verdict, _ = combine_conditions(readings, rule.condition_logic)

        if outcome == "proceed":
            plan = plan_action(rule, value)
            outcome, reason = plan["outcome"], plan["reason"]
            if outcome == "fire":
                value = plan["new_value"]
                last_trigger_step = i
                fires += 1
            else:
                # A clamped evaluation still starts the cooldown live, so the
                # simulation must do the same or it will over-report activity.
                last_trigger_step = i
                clamps += 1

        timeline.append({
            "step": i,
            "minutes": round(i * minutes_per_step, 2),
            "readings": [{"value": r["value"], "met": r["met"]} for r in readings],
            "conditions_met": verdict,
            "outcome": outcome,
            "reason": reason,
            "value_before": before,
            "value": value,
        })

    return {
        "steps": timeline,
        "summary": {
            "fired": fires,
            "clamped": clamps,
            "starting_value": float(starting_value),
            "final_value": value,
            "crossings": _crossings([s["conditions_met"] for s in timeline]),
            "hit_limit": any(s["outcome"] == "clamped" for s in timeline),
            "conditions": labels,
        },
    }


def _crossings(verdicts: List[Optional[bool]]) -> int:
    """How many times the conditions flipped between met and not met.

    A rule's own parameter only ever moves one way, so instability does not
    show up in the value trajectory - it shows up here. With feedback enabled,
    a rule that keeps pushing the measurement back and forth across its
    threshold is hunting, and wants a longer cooldown or a smaller step.
    Unknown readings are skipped rather than counted as a flip.
    """
    known = [v for v in verdicts if v is not None]
    return sum(1 for a, b in zip(known, known[1:]) if a != b)


def condition_description(condition) -> str:
    """Short human label for a condition, used in messages and simulation."""
    if condition.source_type == "chimera_gas":
        return f"{condition.gas_name} ch{condition.source_channel}"
    if condition.source_type == "blackbox_volume":
        return f"volume ch{condition.source_channel}"
    return f"reactor {condition.source_channel} temp"


def rule_from_spec(data: Dict) -> SimpleNamespace:
    """Build an in-memory rule from an API payload, for simulating a draft.

    Mirrors the attributes gate_check/plan_action/simulate read, so an unsaved
    rule can be tried before it is ever written to the database.
    """
    conditions = [
        SimpleNamespace(
            source_type=c.get("source_type"),
            source_device_id=c.get("source_device_id"),
            source_channel=int(c.get("source_channel", 1)),
            gas_name=c.get("gas_name"),
            operator=c.get("operator"),
            threshold=float(c.get("threshold")),
            window_minutes=int(c.get("window_minutes", 0) or 0),
        )
        for c in data.get("conditions", [])
    ]
    return SimpleNamespace(
        name=data.get("name", "draft"),
        condition_logic=data.get("condition_logic", "all"),
        unit_type=data.get("unit_type"),
        unit_number=int(data.get("unit_number", 1)),
        parameter=data.get("parameter"),
        action_type=data.get("action_type"),
        amount=float(data.get("amount", 0)),
        min_value=float(data.get("min_value", 0)),
        max_value=float(data.get("max_value", 0)),
        cooldown_seconds=int(data.get("cooldown_seconds", 3600)),
        conditions=conditions,
    )


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

        for rule in AutomationRule.query.filter_by(enabled=True).all():
            try:
                self.evaluate_rule(rule, act=True)
            except Exception as e:
                print(f"[AUTOMATION] Rule '{rule.name}' failed: {e}")

    # ------------------------------------------------------------------
    # Measurement readers
    # ------------------------------------------------------------------
    def read_metric(self, condition) -> Tuple[Optional[float], str]:
        """One condition's current measurement, and a description of it.

        Returns (None, reason) when there is nothing trustworthy to act on -
        no data, or only data old enough to be a stopped experiment.
        """
        if condition.source_type == "chimera_gas":
            return self._read_chimera_gas(condition)
        if condition.source_type == "blackbox_volume":
            return self._read_blackbox_volume(condition)
        if condition.source_type == "plc_temperature":
            return self._read_plc_temperature(condition)
        return None, f"Unknown source type {condition.source_type}"

    def _read_chimera_gas(self, condition) -> Tuple[Optional[float], str]:
        """Peak gas concentration for a channel, latest or averaged."""
        from database.models import ChimeraRawData

        base = ChimeraRawData.query.filter_by(
            device_id=condition.source_device_id,
            channel_number=condition.source_channel,
            gas_name=condition.gas_name,
        )
        if condition.window_minutes and condition.window_minutes > 0:
            cutoff = int(time.time()) - condition.window_minutes * 60
            rows = base.filter(ChimeraRawData.timestamp >= cutoff).all()
            if not rows:
                return None, (f"No {condition.gas_name} readings in the last "
                              f"{condition.window_minutes} min")
            avg = sum(r.peak_value for r in rows) / len(rows)
            return avg, (f"{condition.gas_name} avg over "
                         f"{condition.window_minutes} min ({len(rows)} readings)")

        # id breaks the tie between rows sharing a timestamp second
        row = base.order_by(ChimeraRawData.timestamp.desc(),
                            ChimeraRawData.id.desc()).first()
        if not row:
            return None, (f"No {condition.gas_name} readings for channel "
                          f"{condition.source_channel}")
        if row.timestamp < int(time.time()) - STALE_READING_SECONDS:
            return None, f"Latest {condition.gas_name} reading is stale"
        return row.peak_value, f"Latest {condition.gas_name} reading"

    def _read_blackbox_volume(self, condition) -> Tuple[Optional[float], str]:
        """Gas produced (ml at STP) by a channel over the window.

        A window is required to make this a rate; zero tips genuinely means
        zero production, so an empty window reads as 0.0 rather than no-data -
        that is exactly the signal a "production has collapsed" rule needs.
        Guarded by requiring the channel to be on an actively logging device,
        so a black box that is simply not recording does not read as collapse.
        """
        from database.models import BlackBoxEventLogData, Device

        window = condition.window_minutes if condition.window_minutes > 0 else 60
        device = Device.query.get(condition.source_device_id)
        if not device or not device.connected:
            return None, "Source black box is not connected"
        if not device.active_test_id:
            return None, "Source black box has no running test"

        cutoff = int(time.time()) - window * 60
        rows = (BlackBoxEventLogData.query
                .filter_by(device_id=condition.source_device_id,
                           channel_number=condition.source_channel)
                .filter(BlackBoxEventLogData.timestamp >= cutoff)
                .all())
        total = sum(r.volume_this_tip_stp for r in rows)
        return total, f"Volume over {window} min ({len(rows)} tips)"

    def _read_plc_temperature(self, condition) -> Tuple[Optional[float], str]:
        """A reactor's live temperature, with its calibration offset applied."""
        from database.models import PlcCalibration
        from device_manager import DeviceManager

        handler = DeviceManager().get_plc(condition.source_device_id)
        if not handler:
            return None, "Source PLC is not connected"
        raw = handler.latest_temperatures.get(condition.source_channel)
        if raw is None:
            return None, f"No temperature yet for reactor {condition.source_channel}"

        cal = PlcCalibration.query.filter_by(
            device_id=condition.source_device_id,
            heater_number=condition.source_channel).first()
        return raw + (cal.offset if cal else 0.0), \
            f"Reactor {condition.source_channel} temperature"

    def read_all(self, rule) -> List[Dict]:
        """Every condition's reading, in the shape the pure logic expects."""
        readings = []
        for condition in rule.conditions:
            value, description = self.read_metric(condition)
            readings.append({
                "value": value,
                "met": None if value is None else condition_met(
                    value, condition.operator, condition.threshold),
                "description": condition_description(condition),
                "detail": description,
            })
        return readings

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

        Only evaluations that reach the machine produce events; a rule whose
        conditions are quiet writes nothing.
        """
        from device_manager import DeviceManager

        readings = self.read_all(rule)
        result = {
            "rule_id": rule.id,
            "readings": [{"description": r["description"], "value": r["value"],
                          "met": r["met"], "detail": r["detail"]} for r in readings],
            "outcome": None,
            "message": None,
        }

        seconds_since = None
        if act and rule.last_triggered_at:
            seconds_since = (datetime.utcnow() - rule.last_triggered_at).total_seconds()

        gate = gate_check(rule, readings, seconds_since)
        result["conditions_met"] = gate["outcome"] not in ("no_data", "not_met")
        if gate["outcome"] != "proceed":
            result["outcome"] = gate["outcome"]
            result["message"] = gate["reason"]
            return result

        handler = DeviceManager().get_plc(rule.target_device_id)
        if not handler:
            return self._record(rule, result, "failed", None, None,
                                "Target PLC is not connected", act)
        if handler.maintenance_mode:
            return self._record(rule, result, "failed", None, None,
                                "Target PLC is in maintenance mode", act)
        if getattr(handler, "firmware_update_in_progress", False):
            result["outcome"] = "skipped"
            result["message"] = "Target PLC is being flashed"
            return result

        unit, reason = self._target_unit(handler, rule)
        if unit is None:
            return self._record(rule, result, "failed", None, None, reason, act)

        plan = plan_action(rule, float(unit[rule.parameter]))
        result["current"] = plan["current"]
        result["new_value"] = plan["new_value"]

        if plan["outcome"] == "clamped":
            # Saturated at a clamp (or a no-op set): record it so the operator
            # can see the rule wants to keep pushing but has hit its bounds.
            return self._record(rule, result, "clamped", plan["current"],
                                plan["current"],
                                f"{gate['reason']} - {plan['reason']}", act)

        if not act:
            result["outcome"] = "would_fire"
            result["message"] = f"{gate['reason']} - would change {plan['reason']}"
            return result

        ok, message = self._apply(handler, rule, unit, plan["new_value"])
        if not ok:
            return self._record(rule, result, "failed", plan["current"], None,
                                f"PLC rejected the change: {message}", act)

        handler.auto_save()
        self._append_test_timeline(rule, handler, plan["current"], plan["new_value"])
        return self._record(rule, result, "fired", plan["current"], plan["new_value"],
                            f"{gate['reason']} - {plan['reason']}", act)

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
        import json

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
                observed_values=json.dumps(result["readings"]),
                outcome=outcome,
                old_value=old,
                new_value=new,
                message=message[:500] if message else None,
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
