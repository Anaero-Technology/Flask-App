import json
import time

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from automation_engine import (AutomationEngine, simulate, validate_rule_fields,
                               rule_from_spec, condition_description,
                               UNIT_PARAMETERS, MAX_SIMULATION_STEPS)
from database.models import (db, AutomationRule, AutomationCondition,
                             AutomationEvent, ChimeraRawData, Device)
from device_manager import DeviceManager
from utils.auth import require_role
from utils.errors import internal_error

automation_bp = Blueprint('automation', __name__)
device_manager = DeviceManager()

WRITE_ROLES = ['admin', 'operator', 'technician']

RULE_FIELDS = (
    'name', 'enabled', 'condition_logic',
    'target_device_id', 'unit_type', 'unit_number', 'parameter',
    'action_type', 'amount', 'min_value', 'max_value', 'cooldown_seconds',
)
CONDITION_FIELDS = (
    'source_type', 'source_device_id', 'source_channel', 'gas_name',
    'window_minutes', 'operator', 'threshold',
)


def _condition_json(condition):
    return {
        "id": condition.id,
        "position": condition.position,
        "source_type": condition.source_type,
        "source_device_id": condition.source_device_id,
        "source_channel": condition.source_channel,
        "gas_name": condition.gas_name,
        "window_minutes": condition.window_minutes,
        "operator": condition.operator,
        "threshold": condition.threshold,
        "description": condition_description(condition),
    }


def _rule_json(rule):
    return {
        "id": rule.id,
        "name": rule.name,
        "enabled": rule.enabled,
        "condition_logic": rule.condition_logic,
        "conditions": [_condition_json(c) for c in rule.conditions],
        "target_device_id": rule.target_device_id,
        "unit_type": rule.unit_type,
        "unit_number": rule.unit_number,
        "parameter": rule.parameter,
        "action_type": rule.action_type,
        "amount": rule.amount,
        "min_value": rule.min_value,
        "max_value": rule.max_value,
        "cooldown_seconds": rule.cooldown_seconds,
        "last_triggered_at": rule.last_triggered_at.isoformat() if rule.last_triggered_at else None,
        "created_by": rule.created_by,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
    }


def _event_json(event):
    return {
        "id": event.id,
        "rule_id": event.rule_id,
        "test_id": event.test_id,
        "observed_values": json.loads(event.observed_values) if event.observed_values else [],
        "outcome": event.outcome,
        "old_value": event.old_value,
        "new_value": event.new_value,
        "message": event.message,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def _check_devices(spec):
    """Every device a rule references must exist, and the target must be a PLC."""
    target = Device.query.get(spec.get('target_device_id'))
    if not target:
        return "target_device_id does not exist"
    if target.device_type != 'plc':
        return "target_device_id must be a PLC"
    for index, condition in enumerate(spec.get('conditions') or [], start=1):
        if not Device.query.get(condition.get('source_device_id')):
            return f"condition {index}: source_device_id does not exist"
    return None


def _spec_from_body(body, existing=None):
    """Merge a request body over an existing rule and validate the result.

    Updates are merged before validation so a partial body can never leave the
    rule internally inconsistent - a new unit_type with the old parameter, say,
    or logic that no longer matches the conditions.
    """
    base = _rule_json(existing) if existing else {}
    spec = {**base, **{f: body[f] for f in RULE_FIELDS if f in body}}
    if 'conditions' in body:
        spec['conditions'] = body['conditions']
    spec.setdefault('condition_logic', 'all')
    spec.setdefault('cooldown_seconds', 3600)

    error = validate_rule_fields(spec) or _check_devices(spec)
    if error:
        return None, (jsonify({"error": error}), 400)
    return spec, None


def _write_conditions(rule, conditions):
    """Replace a rule's conditions wholesale.

    Editing a rule is editing one idea, not managing a sub-collection, so the
    API takes the whole set every time and the old rows go with the cascade.
    """
    rule.conditions.clear()
    for position, data in enumerate(conditions):
        row = AutomationCondition(position=position)
        for field in CONDITION_FIELDS:
            if field in data:
                setattr(row, field, data[field])
        row.window_minutes = int(data.get('window_minutes', 0) or 0)
        rule.conditions.append(row)


# ----------------------------------------------------------------------
# Rules
# ----------------------------------------------------------------------
@automation_bp.route('/api/v1/automation/rules', methods=['GET'])
@jwt_required()
def list_rules():
    try:
        rules = AutomationRule.query.order_by(AutomationRule.name).all()
        return jsonify({"rules": [_rule_json(r) for r in rules]})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@automation_bp.route('/api/v1/automation/rules', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def create_rule():
    try:
        spec, error = _spec_from_body(request.get_json(silent=True) or {})
        if error:
            return error

        rule = AutomationRule(created_by=get_jwt_identity())
        for field in RULE_FIELDS:
            if field in spec:
                setattr(rule, field, spec[field])
        _write_conditions(rule, spec['conditions'])
        db.session.add(rule)
        db.session.commit()
        return jsonify({"success": True, "rule": _rule_json(rule)}), 201
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@automation_bp.route('/api/v1/automation/rules/<int:rule_id>', methods=['PUT'])
@jwt_required()
@require_role(WRITE_ROLES)
def update_rule(rule_id):
    try:
        rule = AutomationRule.query.get(rule_id)
        if not rule:
            return jsonify({"error": "Rule not found"}), 404

        body = request.get_json(silent=True) or {}
        spec, error = _spec_from_body(body, existing=rule)
        if error:
            return error

        for field in RULE_FIELDS:
            if field in body:
                setattr(rule, field, body[field])
        if 'conditions' in body:
            _write_conditions(rule, body['conditions'])
        db.session.commit()
        return jsonify({"success": True, "rule": _rule_json(rule)})
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@automation_bp.route('/api/v1/automation/rules/<int:rule_id>', methods=['DELETE'])
@jwt_required()
@require_role(WRITE_ROLES)
def delete_rule(rule_id):
    """Delete a rule. Its events stay - they are part of the experimental
    record of whatever tests they touched."""
    try:
        rule = AutomationRule.query.get(rule_id)
        if not rule:
            return jsonify({"error": "Rule not found"}), 404
        name = rule.name
        db.session.delete(rule)
        db.session.commit()
        return jsonify({"success": True, "message": f"Deleted rule '{name}'"})
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@automation_bp.route('/api/v1/automation/rules/<int:rule_id>/dry_run', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def dry_run(rule_id):
    """Evaluate the rule against live measurements without touching the machine.

    Shows each condition's current reading, whether the combined logic holds,
    and exactly what the action would change - so a rule can be checked against
    the real process before it is trusted with hardware.
    """
    try:
        rule = AutomationRule.query.get(rule_id)
        if not rule:
            return jsonify({"error": "Rule not found"}), 404
        return jsonify(AutomationEngine().evaluate_rule(rule, act=False))
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Simulation
# ----------------------------------------------------------------------
@automation_bp.route('/api/v1/automation/simulate', methods=['POST'])
@jwt_required()
def simulate_rule():
    """Run a rule against synthetic measurements over simulated time.

    Takes either a saved rule (`rule_id`) or an unsaved draft (`rule`), plus
    one scenario per condition describing how that measurement behaves - a
    ramp, a step change, an oscillation, noise, a dropout, or explicit values.
    Nothing is read from a device and nothing is written anywhere: this drives
    the same decision functions the live engine uses, so it shows how the rule
    would really behave, including cooldowns, clamping and AND/OR logic.

    A scenario may also set `response_per_unit` to close the loop - how much
    the measurement moves per unit the parameter changes - which is what
    reveals a rule that overshoots and oscillates.
    """
    try:
        body = request.get_json(silent=True) or {}

        if body.get('rule_id'):
            saved = AutomationRule.query.get(body['rule_id'])
            if not saved:
                return jsonify({"error": "Rule not found"}), 404
            rule = rule_from_spec(_rule_json(saved))
        else:
            spec = body.get('rule') or {}
            error = validate_rule_fields({**spec,
                                          "condition_logic": spec.get("condition_logic", "all"),
                                          "cooldown_seconds": spec.get("cooldown_seconds", 3600)})
            if error:
                return jsonify({"error": error}), 400
            rule = rule_from_spec(spec)

        scenarios = body.get('scenarios') or []
        if len(scenarios) != len(rule.conditions):
            return jsonify({"error": f"expected {len(rule.conditions)} scenario(s), "
                                     f"one per condition, got {len(scenarios)}"}), 400

        steps = int(body.get('steps', 48))
        if steps < 1 or steps > MAX_SIMULATION_STEPS:
            return jsonify({"error": f"steps must be between 1 and {MAX_SIMULATION_STEPS}"}), 400

        return jsonify(simulate(
            rule, scenarios,
            steps=steps,
            minutes_per_step=float(body.get('minutes_per_step', 60)),
            starting_value=float(body.get('starting_value', 0)),
            seed=int(body.get('seed', 0))))
    except (TypeError, ValueError) as e:
        return jsonify({"error": f"Invalid simulation input: {e}"}), 400
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Events
# ----------------------------------------------------------------------
@automation_bp.route('/api/v1/automation/events', methods=['GET'])
@jwt_required()
def list_events():
    """Recent automation activity, newest first. Filter with ?rule_id= and
    cap with ?limit= (default 50)."""
    try:
        query = AutomationEvent.query
        rule_id = request.args.get('rule_id', type=int)
        if rule_id:
            query = query.filter_by(rule_id=rule_id)
        limit = min(request.args.get('limit', default=50, type=int), 500)
        events = query.order_by(AutomationEvent.id.desc()).limit(limit).all()
        return jsonify({"events": [_event_json(e) for e in events]})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Sources and targets for the rule editor
# ----------------------------------------------------------------------
@automation_bp.route('/api/v1/automation/options', methods=['GET'])
@jwt_required()
def options():
    """Everything the rule editor needs to offer sensible choices: connected
    devices per role, the gas names each chimera has actually reported
    recently, and each PLC's unit counts."""
    try:
        devices = device_manager.list_devices()
        day_ago = int(time.time()) - 24 * 3600

        chimeras = []
        for c in devices.get("chimeras", []):
            if not c.get("connected"):
                continue
            gas_rows = (db.session.query(ChimeraRawData.gas_name)
                        .filter(ChimeraRawData.device_id == c["device_id"],
                                ChimeraRawData.timestamp >= day_ago)
                        .distinct().all())
            chimeras.append({**c, "gas_names": sorted(g[0] for g in gas_rows if g[0])})

        return jsonify({
            "chimeras": chimeras,
            "black_boxes": [b for b in devices.get("black_boxes", []) if b.get("connected")],
            # Connected PLC entries already carry machine_type/machine_counts.
            "plcs": [p for p in devices.get("plcs", []) if p.get("connected")],
            "unit_parameters": UNIT_PARAMETERS,
        })
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()
