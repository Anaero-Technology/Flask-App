import json
import os
import tempfile
import threading
import time
from datetime import datetime

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from flask_sse import sse

import plc_firmware
from device_manager import DeviceManager
from database.models import *
from plc_handler import PlcHandler
from utils.auth import require_role, check_stream_token
from utils.errors import internal_error

plc_bp = Blueprint('plc', __name__)
device_manager = DeviceManager()

WRITE_ROLES = ['admin', 'operator', 'technician']


def _get_handler(device_id):
    """Resolve a connected PLC handler, or an error response to return."""
    device = Device.query.get(device_id)
    if not device or device.device_type != 'plc':
        return None, (jsonify({"error": "PLC not found"}), 404)
    if not device.connected:
        return None, (jsonify({"error": "PLC not connected"}), 404)

    handler = device_manager.get_plc(device_id)
    if not handler:
        return None, (jsonify({"error": "Device handler not found"}), 404)
    return handler, None


def _result(success, message, extra=None):
    payload = {"success": success, "message": message}
    if extra:
        payload.update(extra)
    return jsonify(payload), (200 if success else 400)


# ----------------------------------------------------------------------
# Discovery and connection
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/connected', methods=['GET'])
@jwt_required()
def get_connected_plcs():
    try:
        return jsonify({"plcs": device_manager.list_devices().get("plcs", [])})
    except Exception as e:
        return internal_error(e)


@plc_bp.route('/api/v1/plc/machine_types', methods=['GET'])
@jwt_required()
def get_machine_types():
    """The personalities the firmware implements."""
    return jsonify({"machine_types": PlcHandler.machine_types})


@plc_bp.route('/api/v1/plc/<int:device_id>/connect', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def connect_plc(device_id):
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404

        port = (request.get_json(silent=True) or {}).get('port') or device.serial_port
        if not port:
            return jsonify({"error": "No serial port known for this PLC"}), 400

        if device_manager.connect(port):
            return _result(True, f"Connected to PLC on {port}")
        return _result(False, f"Failed to connect to PLC on {port}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/disconnect', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def disconnect_plc(device_id):
    try:
        if device_manager.disconnect_device(device_id):
            return _result(True, "PLC disconnected")
        return _result(False, "Failed to disconnect PLC")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/name', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_name(device_id):
    """Rename the PLC. The name lives in the board's EEPROM, so the handler
    writes it with 'nameset' and the database is kept in step."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        name = (request.get_json(silent=True) or {}).get('name')
        if not name or not str(name).strip():
            return jsonify({"error": "name is required"}), 400

        if not handler.set_name(name):
            return jsonify({"error": "The PLC rejected the new name"}), 502

        # set_name normalises the name (no spaces, capped length), so store
        # exactly what the board now holds.
        device = Device.query.get(device_id)
        if device:
            device.name = handler.device_name
            db.session.commit()

        return _result(True, "Name updated", {"name": handler.device_name})
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# State
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/info', methods=['GET'])
@jwt_required()
def get_info(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error
        return jsonify(handler.get_info())
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


def _calibration_map(device_id):
    """Per-heater offset for a device, {heater_number: offset}."""
    rows = PlcCalibration.query.filter_by(device_id=device_id).all()
    return {r.heater_number: r.offset for r in rows}


def _apply_calibration(status, device_id):
    """Fold each heater's stored offset into the reading the firmware reported.

    'actual' becomes the calibrated temperature; the untouched value is kept as
    'actual_raw' and the offset applied is exposed, so the UI can show all three.
    """
    offsets = _calibration_map(device_id)
    for h in status.get('heaters', []):
        raw = h.get('actual', 0.0)
        offset = offsets.get(h['number'], 0.0)
        h['actual_raw'] = raw
        h['offset'] = offset
        h['actual'] = raw + offset
    return status


@plc_bp.route('/api/v1/plc/<int:device_id>/status', methods=['GET'])
@jwt_required()
def get_status(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        status = handler.get_status()
        if status is None:
            return jsonify({"error": "PLC did not return a status - is a machine type set?"}), 502
        return jsonify(_apply_calibration(status, device_id))
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/calibration', methods=['GET'])
@jwt_required()
def get_calibration(device_id):
    """The stored heater offsets for this PLC."""
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404
        offsets = _calibration_map(device_id)
        return jsonify({"calibration": [{"number": n, "offset": o} for n, o in sorted(offsets.items())]})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/calibration', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_calibration(device_id):
    """Calibrate one heater. Send 'measured' (the true temperature from an
    external thermometer) and the offset is worked out from the current reading;
    or send 'offset' to set it directly (0 clears the calibration)."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        number = body.get('number')
        if number is None:
            return jsonify({"error": "number is required"}), 400

        if 'offset' in body:
            offset = float(body['offset'])
        elif 'measured' in body:
            # offset that makes the reported reading equal the measured value,
            # from the raw sensor value the firmware currently reports.
            status = handler.get_status()
            if status is None:
                return jsonify({"error": "Could not read the PLC to calibrate against"}), 502
            heater = next((h for h in status.get('heaters', []) if h['number'] == number), None)
            if heater is None:
                return jsonify({"error": f"Reactor {number} has no heater on this machine"}), 400
            offset = float(body['measured']) - heater['actual']  # actual is raw here
        else:
            return jsonify({"error": "Provide 'measured' or 'offset'"}), 400

        if offset < -50 or offset > 50:
            return jsonify({"error": "Offset is out of a sensible range (±50°C)"}), 400

        row = PlcCalibration.query.filter_by(device_id=device_id, heater_number=number).first()
        if not row:
            row = PlcCalibration(device_id=device_id, heater_number=number)
            db.session.add(row)
        row.offset = offset
        db.session.commit()

        return _result(True, f"Reactor {number} calibrated", {"number": number, "offset": offset})
    except (TypeError, ValueError):
        return jsonify({"error": "measured/offset must be numbers"}), 400
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/machine_type', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_machine_type(device_id):
    """Choose the machine personality.

    Slow - the firmware runs temperature sensor discovery as part of this, and
    will halt if no sensors are attached.
    """
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        machine_type = (request.get_json(silent=True) or {}).get('machine_type')
        if not machine_type:
            return jsonify({"error": "machine_type is required"}), 400

        was_unconfigured = handler.machine_type is None
        success, message = handler.set_machine_type(machine_type)
        if success:
            # Coming up from a power cycle, put the saved settings back rather
            # than making someone re-enter them. Otherwise this is a deliberate
            # change of machine, so record it as the new starting point.
            if was_unconfigured and handler.restore_settings():
                message = f"{message}, saved settings restored"
            else:
                handler.auto_save()
        return _result(success, message, {"machine_counts": handler.machine_counts})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/heater', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_heater(device_id):
    """Set a reactor target temperature. A target of 0 disables the heater."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        if 'number' not in body or 'target' not in body:
            return jsonify({"error": "number and target are required"}), 400

        ok, message = _apply_and_log(
            device_id, handler, 'heater', body['number'],
            {'target': body['target']},
            f"heater {body['number']} target {body['target']}")
        return _result(ok, message)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/mixer', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_mixer(device_id):
    """mode 0 = always off, 1 = always on, 2 = timed (on_for/off_for seconds)."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        if 'number' not in body or 'mode' not in body:
            return jsonify({"error": "number and mode are required"}), 400

        ok, message = _apply_and_log(
            device_id, handler, 'mixer', body['number'],
            {'mode': body['mode'], 'on_for': body.get('on_for', 0), 'off_for': body.get('off_for', 0)},
            f"mixer {body['number']} mode {body['mode']}")
        return _result(ok, message)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/feeder', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_feeder(device_id):
    """on_for is seconds (minimum 5), off_for is minutes. Either below its
    minimum pauses the feeder."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        if 'number' not in body:
            return jsonify({"error": "number is required"}), 400

        ok, message = _apply_and_log(
            device_id, handler, 'feeder', body['number'],
            {'on_for': body.get('on_for', 0), 'off_for_minutes': body.get('off_for', 0)},
            f"feeder {body['number']} {body.get('on_for', 0)}s every {body.get('off_for', 0)}min")
        return _result(ok, message)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/agitator', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_agitator(device_id):
    """Seconds of agitation before a feed. 0 pauses the agitator."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        if 'number' not in body:
            return jsonify({"error": "number is required"}), 400

        ok, message = _apply_and_log(
            device_id, handler, 'agitator', body['number'],
            {'pre_feed': body.get('pre_feed', 0)},
            f"agitator {body['number']} pre-feed {body.get('pre_feed', 0)}s")
        return _result(ok, message)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/lta_time', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_lta_time(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        minutes = (request.get_json(silent=True) or {}).get('minutes')
        if minutes is None:
            return jsonify({"error": "minutes is required"}), 400

        success, reason = handler.set_lta_time(minutes)
        if success:
            handler.auto_save()
        return _result(success, "Averaging window updated" if success else f"Rejected: {reason}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Maintenance mode
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/maintenance', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def set_maintenance_mode(device_id):
    """Entering maintenance mode turns every output off and blocks configuration."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        enable = (request.get_json(silent=True) or {}).get('enable')
        if enable is None:
            return jsonify({"error": "enable is required"}), 400

        success, reason = handler.set_maintenance_mode(bool(enable))
        return _result(success,
                       f"Maintenance mode {'on' if enable else 'off'}" if success
                       else f"Rejected: {reason}",
                       {"maintenance_mode": handler.maintenance_mode})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/maintenance/unit', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def maintenance_unit(device_id):
    """Drive one output by hand. number 0 means every unit of that type."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        unit_type, number, state = body.get('unit_type'), body.get('number'), body.get('state')
        if unit_type is None or number is None or state is None:
            return jsonify({"error": "unit_type, number and state are required"}), 400

        success, reason = handler.maintenance_unit(unit_type, number, bool(state))
        return _result(success, "Output updated" if success else f"Rejected: {reason}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Sensors, logging and stored config
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/sensors', methods=['GET'])
@jwt_required()
def get_sensors(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        sensors = handler.get_sensors()
        if sensors is None:
            return jsonify({"error": "PLC did not report its sensors"}), 502
        return jsonify(sensors)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/start_logging', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def start_logging(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        success, reason = handler.start_logging()
        if success and reason == "already":
            return _result(True, "PLC was already logging")
        return _result(success, "Logging started" if success else f"Rejected: {reason}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/stop_logging', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def stop_logging(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        success, reason = handler.stop_logging()
        return _result(success, "Logging stopped" if success else f"Rejected: {reason}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/download', methods=['POST'])
@jwt_required()
def download_temp_log(device_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        success, lines = handler.download_temp_log()
        if not success:
            return _result(False, lines[0] if lines else "Download failed")
        return jsonify({"success": True, "line_count": len(lines), "lines": lines})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/config', methods=['GET'])
@jwt_required()
def get_config(device_id):
    """The live settings, as the command script the PLC would save."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        success, commands = handler.get_config()
        if not success:
            return jsonify({"error": "PLC did not return its configuration"}), 502
        return jsonify({"commands": commands})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


#
# There is deliberately no manual save/load. Settings are written to the PLC's
# SD card automatically whenever they change, and restored on connect if the
# unit has come up unconfigured, so the two cannot drift apart.
#

@plc_bp.route('/api/v1/plc/<int:device_id>/configuration', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def apply_configuration(device_id):
    """Apply a batch of unit changes as one operation.

    Sending edits together keeps the machine from sitting half-reconfigured
    while someone clicks through fields one at a time, and gives a test's
    timeline a single entry describing the whole change rather than one per
    field touched.
    """
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        changes = (request.get_json(silent=True) or {}).get('changes') or []
        if not changes:
            return jsonify({"error": "changes is required"}), 400

        applied, rejected, notes = 0, [], []
        for change in changes:
            unit_type = change.get('unit_type')
            number = change.get('number')
            if unit_type not in ('heater', 'mixer', 'feeder', 'agitator') or number is None:
                rejected.append(f"{unit_type} {number}: not a unit on this machine")
                continue

            if unit_type == 'heater':
                ok, reason = handler.set_heater(number, change.get('target', 0))
                note = f"heater {number} {change.get('target', 0)}°C"
            elif unit_type == 'mixer':
                ok, reason = handler.set_mixer(number, change.get('mode', 0),
                                               change.get('on_for', 0), change.get('off_for', 0))
                note = f"mixer {number} mode {change.get('mode', 0)}"
            elif unit_type == 'feeder':
                ok, reason = handler.set_feeder(number, change.get('on_for', 0),
                                                change.get('off_for_minutes', 0))
                note = f"feeder {number} {change.get('on_for', 0)}s/{change.get('off_for_minutes', 0)}min"
            else:
                ok, reason = handler.set_agitator(number, change.get('pre_feed', 0))
                note = f"agitator {number} pre-feed {change.get('pre_feed', 0)}s"

            if ok:
                applied += 1
                notes.append(note)
            else:
                rejected.append(f"{unit_type} {number}: {reason}")

        if applied:
            handler.auto_save()
            test_id = _active_test_id(device_id)
            if test_id:
                # One entry for the whole batch, listing what moved.
                _record_version(test_id, device_id, handler, ", ".join(notes))

        if applied and not rejected:
            return _result(True, f"Applied {applied} change{'s' if applied != 1 else ''}")
        if applied and rejected:
            return _result(True, f"Applied {applied}, rejected {len(rejected)}: {'; '.join(rejected)}")
        return _result(False, f"Nothing applied: {'; '.join(rejected)}")
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Saved profiles
#
# A profile is a machine type plus every unit setting, captured from a PLC and
# replayable onto any PLC running a compatible machine.
# ----------------------------------------------------------------------
def _profile_json(profile):
    return {
        "id": profile.id,
        "name": profile.name,
        "machine_type": profile.machine_type,
        "model_id": profile.model_id,
        "description": profile.description,
        "created_by": profile.created_by,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "settings": json.loads(profile.settings) if profile.settings else {},
    }


@plc_bp.route('/api/v1/plc/profiles', methods=['GET'])
@jwt_required()
def list_profiles():
    try:
        profiles = PlcProfile.query.order_by(PlcProfile.name).all()
        return jsonify({"profiles": [_profile_json(p) for p in profiles]})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/profiles', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def save_profile(device_id):
    """Capture what the PLC is doing right now as a named profile."""
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        body = request.get_json(silent=True) or {}
        name = (body.get('name') or '').strip()
        if not name:
            return jsonify({"error": "name is required"}), 400

        settings = handler.capture_settings()
        if settings is None:
            return jsonify({"error": "Could not read the PLC's settings"}), 502

        existing = PlcProfile.query.filter_by(name=name).first()
        if existing and not body.get('overwrite'):
            return jsonify({"error": f"A profile named '{name}' already exists"}), 409

        profile = existing or PlcProfile(name=name)
        profile.machine_type = handler.machine_type
        profile.model_id = body.get('model_id')
        profile.description = body.get('description')
        profile.settings = json.dumps(settings)
        if not existing:
            profile.created_by = get_jwt_identity()
            db.session.add(profile)
        db.session.commit()

        return jsonify({"success": True,
                        "message": f"Saved profile '{name}'",
                        "profile": _profile_json(profile)})
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/profiles/<int:profile_id>/apply', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def apply_profile(device_id, profile_id):
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        profile = PlcProfile.query.get(profile_id)
        if not profile:
            return jsonify({"error": "Profile not found"}), 404

        success, message = handler.apply_settings(
            json.loads(profile.settings), profile.machine_type)
        if success:
            # apply_settings clears this as it drives each unit, so it is set
            # afterwards: the PLC now matches this profile.
            handler.active_profile_name = profile.name
        return _result(success, f"{profile.name}: {message}",
                       {"model_id": profile.model_id, "profile_name": profile.name})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/profiles/<int:profile_id>', methods=['DELETE'])
@jwt_required()
@require_role(WRITE_ROLES)
def delete_profile(profile_id):
    try:
        profile = PlcProfile.query.get(profile_id)
        if not profile:
            return jsonify({"error": "Profile not found"}), 404
        name = profile.name
        db.session.delete(profile)
        db.session.commit()
        return _result(True, f"Deleted profile '{name}'")
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


# ----------------------------------------------------------------------
# Association with a test
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/test/<int:test_id>', methods=['POST'])
@jwt_required()
@require_role(WRITE_ROLES)
def start_test(device_id, test_id):
    """Attach the PLC to a test and start logging its configuration.

    The machine is already running whatever it was set to - this records that as
    the starting point, and every later change is appended to the timeline.
    """
    try:
        handler, error = _get_handler(device_id)
        if error:
            return error

        test = Test.query.get(test_id)
        if not test:
            return jsonify({"error": "Test not found"}), 404

        body = request.get_json(silent=True) or {}

        device = Device.query.get(device_id)
        if device:
            device.active_test_id = test_id
        handler.set_test_id(test_id)
        db.session.commit()

        record = _record_version(test_id, device_id, handler, "configuration at start",
                                 profile_name=body.get('profile_name'),
                                 model_id=body.get('model_id'))
        if record is None:
            return _result(False, "Could not read the PLC's settings")

        return _result(True, f"PLC driving '{test.name}'")
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/test/<int:test_id>', methods=['DELETE'])
@jwt_required()
@require_role(WRITE_ROLES)
def stop_test(device_id, test_id):
    """Stop recording for a test.

    Deliberately does not touch the outputs: the machine keeps running whatever
    it was last given. Stopping ends the configuration timeline, it does not
    shut a digester down.
    """
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404

        handler = device_manager.get_plc(device_id)
        if handler:
            try:
                _record_version(test_id, device_id, handler, "test stopped - machine left running")
            except Exception:
                pass
            handler.set_test_id(None)

        if device.active_test_id == test_id:
            device.active_test_id = None
        db.session.commit()

        return _result(True, "Stopped recording - the machine is still running")
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/pending', methods=['GET'])
@jwt_required()
def get_test_state(device_id):
    """Whether a test is running, so the page can say changes are being logged."""
    try:
        test_id = _active_test_id(device_id)
        test = Test.query.get(test_id) if test_id else None
        return jsonify({
            "active_test_id": test_id,
            "active_test_name": test.name if test else None,
        })
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/test/<int:test_id>/configuration', methods=['GET'])
@jwt_required()
def get_test_configuration(test_id):
    """The PLC configuration a test ran with, for the database view and export."""
    try:
        return jsonify({"plc_configurations": plc_configurations_for_test(test_id)})
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


def plc_configurations_for_test(test_id):
    """Every configuration a test ran with, oldest first.

    A test has at least one entry (applied at start) and gains another for each
    change made while it ran, so the export shows how the machine was driven
    over time rather than only its final state.
    """
    records = (PlcConfiguration.query
               .filter_by(test_id=test_id)
               .order_by(PlcConfiguration.sequence)
               .all())
    by_device = {}
    for r in records:
        entry = by_device.setdefault(r.device_id, [])
        entry.append(r)

    out = []
    for device_id, versions in by_device.items():
        device = Device.query.get(device_id)
        latest = versions[-1]
        out.append({
            "device_id": device_id,
            "device_name": device.name if device else None,
            "machine_type": latest.machine_type,
            "model_id": latest.model_id,
            "profile_name": latest.profile_name,
            "recorded_at": latest.recorded_at.isoformat() if latest.recorded_at else None,
            "settings": json.loads(latest.settings) if latest.settings else {},
            "history": [{
                "sequence": v.sequence,
                "recorded_at": v.recorded_at.isoformat() if v.recorded_at else None,
                "change": v.change_note,
                "profile_name": v.profile_name,
                "machine_type": v.machine_type,
                "settings": json.loads(v.settings) if v.settings else {},
            } for v in versions],
        })
    return out


# ----------------------------------------------------------------------
# Staged vs live configuration
#
# Editing a PLC that is not running a test writes a draft and leaves the
# machine alone - nothing physical happens until a test starts and applies it.
# Once a test is running, edits go straight to the machine and each one is
# appended to that test's configuration timeline.
# ----------------------------------------------------------------------
def _active_test_id(device_id):
    device = Device.query.get(device_id)
    return device.active_test_id if device else None


def _record_version(test_id, device_id, handler, note, profile_name=None, model_id=None):
    """Append the machine's current settings to a test's timeline."""
    settings = handler.capture_settings()
    if settings is None:
        return None
    last = (PlcConfiguration.query
            .filter_by(test_id=test_id, device_id=device_id)
            .order_by(PlcConfiguration.sequence.desc()).first())
    record = PlcConfiguration(
        test_id=test_id,
        device_id=device_id,
        sequence=(last.sequence + 1) if last else 1,
        machine_type=handler.machine_type,
        model_id=model_id or (last.model_id if last else None),
        settings=json.dumps(settings),
        profile_name=profile_name or getattr(handler, 'active_profile_name', None),
        change_note=note,
        recorded_at=datetime.utcnow(),
    )
    db.session.add(record)
    db.session.commit()
    return record


def _apply_and_log(device_id, handler, unit_type, number, values, note):
    """Drive one unit, and log the change against a running test.

    Changes always reach the machine straight away. When a test is running the
    resulting configuration is appended to its timeline, so the record shows how
    the machine was driven over the course of the test.
    """
    setter = {
        'heater': lambda: handler.set_heater(number, values['target']),
        'mixer': lambda: handler.set_mixer(number, values['mode'],
                                           values.get('on_for', 0), values.get('off_for', 0)),
        'feeder': lambda: handler.set_feeder(number, values.get('on_for', 0),
                                             values.get('off_for_minutes', 0)),
        'agitator': lambda: handler.set_agitator(number, values.get('pre_feed', 0)),
    }[unit_type]

    ok, reason = setter()
    if not ok:
        return False, f"Rejected: {reason}"

    handler.auto_save()

    test_id = _active_test_id(device_id)
    if test_id:
        _record_version(test_id, device_id, handler, note)

    return True, f"{unit_type.capitalize()} updated"


# ----------------------------------------------------------------------
# Firmware update
#
# The PLC cannot rewrite its own flash, so the server runs avrdude against its
# serial port. The port is reserved and the handler disconnected first so
# avrdude has it alone, then the device is reconnected once flashing is done.
# Progress is streamed over SSE, mirroring the chimera firmware flow.
# ----------------------------------------------------------------------
@plc_bp.route('/api/v1/plc/<int:device_id>/stream', methods=['GET'])
def firmware_stream(device_id):
    """SSE stream for firmware update progress. Authed via ?token= because
    EventSource cannot send Authorization headers."""
    auth_error = check_stream_token()
    if auth_error:
        return auth_error
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404
        return sse.stream()
    finally:
        db.session.close()


@plc_bp.route('/api/v1/plc/<int:device_id>/firmware_check', methods=['GET'])
@jwt_required()
def firmware_check(device_id):
    """Report whether the server has avrdude available to flash with, and the
    firmware bundled in the repo. There is no on-device version to compare
    against - the AVR bootloader exposes no firmware hash - so this only tells
    the UI what it can offer."""
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404

        avrdude, _ = plc_firmware.locate_avrdude()
        bundled = _bundled_plc_firmware()
        return jsonify({
            "avrdude_available": bool(avrdude),
            "bundled_available": bundled is not None,
            "bundled_name": os.path.basename(bundled) if bundled else None,
        })
    finally:
        db.session.close()


def _bundled_plc_firmware():
    """Path to the application-only .hex bundled in the repo, if present.

    The plain .hex is flashed over the serial bootloader; the
    with_bootloader variant is for ISP programming and would be wrong here.
    """
    base = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', '..', 'firmware', 'plc', 'Kittiwake_134')
    candidate = os.path.join(base, 'Kittiwake_134.ino.mduinoplus.hex')
    return candidate if os.path.exists(candidate) else None


@plc_bp.route('/api/v1/plc/<int:device_id>/firmware_update', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def firmware_update(device_id):
    """Flash a .hex onto the PLC. Upload one as 'firmware', or omit it to flash
    the repo-bundled firmware. Runs in the background; progress arrives as
    'plc_firmware_progress' SSE events and the outcome as 'plc_firmware_complete'."""
    try:
        device = Device.query.get(device_id)
        if not device or device.device_type != 'plc':
            return jsonify({"error": "PLC not found"}), 404
        if not device.connected:
            return jsonify({"error": "PLC not connected"}), 409
        if device.active_test_id:
            return jsonify({"error": "Cannot flash firmware while a test is running"}), 409

        avrdude, _ = plc_firmware.locate_avrdude()
        if not avrdude:
            return jsonify({"error": "avrdude is not installed on the server"}), 501

        port = device.serial_port

        # Resolve the firmware to a temp file the background thread owns.
        upload = request.files.get('firmware')
        if upload is not None:
            if not upload.filename or not upload.filename.lower().endswith('.hex'):
                return jsonify({"error": "Firmware must be a .hex file"}), 400
            data = upload.read()
            if not plc_firmware.is_intel_hex(data):
                return jsonify({"error": "That does not look like an Intel HEX firmware file"}), 400
            fd, hex_path = tempfile.mkstemp(suffix='.hex')
            with os.fdopen(fd, 'wb') as f:
                f.write(data)
            source = upload.filename
        else:
            bundled = _bundled_plc_firmware()
            if not bundled:
                return jsonify({"error": "No firmware uploaded and none bundled"}), 400
            hex_path = bundled
            source = os.path.basename(bundled)

        _launch_plc_flash(device_id, port, hex_path, source, owns_file=upload is not None)
        return jsonify({"success": True, "message": "Firmware update started"}), 202
    finally:
        db.session.close()


def _launch_plc_flash(device_id, port, hex_path, source, owns_file):
    app = current_app._get_current_object()
    manager = DeviceManager()

    def run():
        with app.app_context():
            last = [-1, '']

            def progress(phase, percent):
                if percent == last[0] and phase == last[1]:
                    return
                last[0], last[1] = percent, phase
                try:
                    sse.publish({"device_id": device_id, "phase": phase, "percent": percent},
                                type='plc_firmware_progress')
                except Exception:
                    pass

            # Hold the port and let go of the live connection so avrdude owns it.
            manager.reserve_port(port)
            manager.disconnect_device(device_id)
            time.sleep(0.5)

            ok, message = plc_firmware.flash(port, hex_path, progress_cb=progress)

            manager.release_port(port)

            # Bring the PLC back. Flashing resets the board, which then spends a
            # couple of seconds in its bootloader, so the first connect often
            # lands too early - retry a few times. If the port name changed, the
            # auto-connect scanner picks it up regardless.
            reconnected = False
            if ok:
                for _ in range(5):
                    time.sleep(2.5)
                    try:
                        if manager.connect(port):
                            reconnected = True
                            break
                    except Exception:
                        pass

            if owns_file:
                try:
                    os.remove(hex_path)
                except Exception:
                    pass

            try:
                sse.publish({
                    "device_id": device_id,
                    "success": ok,
                    "message": message,
                    "source": source,
                    "reconnected": reconnected,
                }, type='plc_firmware_complete')
            except Exception:
                pass
            print(f"[PLC FIRMWARE] device {device_id}: ok={ok} - {message}")

    threading.Thread(target=run, daemon=True, name=f"PlcFirmwareUpdate-{device_id}").start()
