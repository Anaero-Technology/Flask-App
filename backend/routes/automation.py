import time
from datetime import datetime

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from automation_engine import (AutomationEngine, validate_rule_fields,
                               UNIT_PARAMETERS)
from database.models import (db, AutomationRule, AutomationEvent,
                             ChimeraRawData, Device)
from device_manager import DeviceManager
from utils.auth import require_role
from utils.errors import internal_error

automation_bp = Blueprint('automation', __name__)
device_manager = DeviceManager()

WRITE_ROLES = ['admin', 'operator', 'technician']

RULE_FIELDS = (
    'name', 'enabled',
    'source_type', 'source_device_id', 'source_channel', 'gas_name',
    'window_minutes', 'operator', 'threshold',
    'target_device_id', 'unit_type', 'unit_number', 'parameter',
    'action_type', 'amount', 'min_value', 'max_value', 'cooldown_seconds',
)


def _rule_json(rule):
    return {
        "id": rule.id,
        "name": rule.name,
        "enabled": rule.enabled,
        "source_type": rule.source_type,
        "source_device_id": rule.source_device_id,
        "source_channel": rule.source_channel,
        "gas_name": rule.gas_name,
        "window_minutes": rule.window_minutes,
        "operator": rule.operator,
        "threshold": rule.threshold,
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
        "observed_value": event.observed_value,
        "outcome": event.outcome,
        "old_value": event.old_value,
        "new_value": event.new_value,
        "message": event.message,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def _validated_body():
    """The request body as a rule dict, or (None, error response)."""
    body = request.get_json(silent=True) or {}
    data = {f: body.get(f) for f in RULE_FIELDS if f in body}
    error = validate_rule_fields({**data,
                                  # defaults so a partial body validates the
                                  # same values that will be stored
                                  "window_minutes": data.get("window_minutes", 0),
                                  "cooldown_seconds": data.get("cooldown_seconds", 3600)})
    if error:
        return None, (jsonify({"error": error}), 400)

    for device_field, expect in (("source_device_id", None), ("target_device_id", "plc")):
        device = Device.query.get(data.get(device_field))
        if not device:
            return None, (jsonify({"error": f"{device_field} does not exist"}), 400)
        if expect and device.device_type != expect:
            return None, (jsonify({"error": "target_device_id must be a PLC"}), 400)
    return data, None


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
        data, error = _validated_body()
        if error:
            return error

        rule = AutomationRule(created_by=get_jwt_identity())
        for field, value in data.items():
            setattr(rule, field, value)
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

        # Validate the merged result, so a partial update cannot leave the
        # rule internally inconsistent (e.g. new unit_type, old parameter).
        body = request.get_json(silent=True) or {}
        merged = {**_rule_json(rule), **{f: body[f] for f in RULE_FIELDS if f in body}}
        error = validate_rule_fields(merged)
        if error:
            return jsonify({"error": error}), 400

        for field in RULE_FIELDS:
            if field in body:
                setattr(rule, field, body[field])
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
    """Evaluate the rule right now without touching the machine.

    Shows the live measurement, whether the condition holds, and exactly what
    the action would change - so a rule can be sanity-checked before it is
    trusted with hardware.
    """
    try:
        rule = AutomationRule.query.get(rule_id)
        if not rule:
            return jsonify({"error": "Rule not found"}), 404
        result = AutomationEngine().evaluate_rule(rule, act=False)
        return jsonify(result)
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
