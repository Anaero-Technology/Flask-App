from flask import Blueprint, request, jsonify, current_app
from flask_sse import sse
from flask_jwt_extended import jwt_required
from datetime import datetime, timezone
from device_manager import DeviceManager
from database.models import *
from utils.auth import require_role, check_stream_token
import os
import re
import hashlib
import threading
from utils.errors import internal_error

chimera_bp = Blueprint('chimera', __name__)
device_manager = DeviceManager()


@chimera_bp.route('/api/v1/chimera/config/model', methods=['GET'])
@jwt_required()
def get_global_device_model():
    """Get global device model setting (chimera or chimera-max)"""
    try:
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        has_pump = device_model == 'chimera-max'

        return jsonify({
            "device_model": device_model,
            "has_pump": has_pump,
            "has_recirculation": has_pump
        })

    except Exception as e:
        return internal_error(e)


@chimera_bp.route('/api/v1/chimera/<int:device_id>/config', methods=['GET'])
@jwt_required()
def get_device_config(device_id):
    """Get device configuration including device model (chimera or chimera-max)"""
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404

        if device.device_type not in ['chimera', 'chimera-max']:
            return jsonify({"error": "Device is not a chimera"}), 400

        # Get device model from config
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        has_pump = device_model == 'chimera-max'
        calibration_mode = 'pump' if has_pump else 'manual'

        return jsonify({
            "device_id": device_id,
            "device_name": device.name,
            "device_type": device.device_type,
            "device_model": device_model,
            "has_pump": has_pump,
            "calibration_mode": calibration_mode,
            "connected": device.connected
        })

    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/config/model', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def set_device_model(device_id):
    """Set device model (chimera or chimera-max) - Admin only. Requires API call, not available in UI."""
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404

        if device.device_type not in ['chimera', 'chimera-max']:
            return jsonify({"error": "Device is not a chimera"}), 400

        data = request.get_json()
        device_model = data.get('device_model')

        if not device_model or device_model not in ['chimera', 'chimera-max']:
            return jsonify({"error": "device_model must be 'chimera' or 'chimera-max'"}), 400

        # Update the environment variable (this affects current_app.config)
        os.environ['CHIMERA_DEVICE_MODEL'] = device_model
        current_app.config['CHIMERA_DEVICE_MODEL'] = device_model

        # Also update the .env file for persistence
        env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
        try:
            with open(env_file, 'r') as f:
                env_contents = f.read()

            # Replace or add the CHIMERA_DEVICE_MODEL line
            if re.search(r'^CHIMERA_DEVICE_MODEL=', env_contents, re.MULTILINE):
                env_contents = re.sub(r'^CHIMERA_DEVICE_MODEL=.*$', f'CHIMERA_DEVICE_MODEL={device_model}', env_contents, flags=re.MULTILINE)
            else:
                env_contents += f'\nCHIMERA_DEVICE_MODEL={device_model}'

            with open(env_file, 'w') as f:
                f.write(env_contents)
        except Exception as e:
            return internal_error(e, "Failed to persist device model setting")

        has_pump = device_model == 'chimera-max'
        calibration_mode = 'pump' if has_pump else 'manual'

        return jsonify({
            "success": True,
            "device_id": device_id,
            "device_model": device_model,
            "has_pump": has_pump,
            "calibration_mode": calibration_mode,
            "message": f"Device model updated to {device_model}"
        })

    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/connected', methods=['GET'])
@jwt_required()
def get_connected_chimeras():
    """Get all connected Chimera devices from database"""
    try:
        connected_chimeras = Device.query.filter(
            Device.device_type.in_(['chimera', 'chimera-max']),
            Device.connected == True
        ).all()

        devices_list = []
        for device in connected_chimeras:
            device_data = {
                "device_id": device.id,
                "name": device.name,
                "port": device.serial_port,
                "mac_address": device.mac_address,
                "connected": device.connected,
                "logging": device.logging,
                "active_test_id": device.active_test_id,
                "active_test_name": None
            }

            # Get test name if device is in an active test
            if device.active_test_id:
                from database.models import Test
                test = Test.query.get(device.active_test_id)
                if test:
                    device_data["active_test_name"] = test.name

            devices_list.append(device_data)
        
        return jsonify(devices_list)
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/connect', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def connect_chimera(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found in database"}), 404
        
        if device.device_type != 'chimera':
            return jsonify({"error": "Device is not a chimera"}), 400
        
        if device.connected:
            return jsonify({"error": "Device already connected"}), 400
        
        # Connect to the device (DeviceManager now handles DB updates)
        success = device_manager.connect_chimera(device_id, device.serial_port)
        if not success:
            return jsonify({"error": "Failed to connect to device"}), 500
        
        # Get the handler to return device info
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Handler not found after connection"}), 500
        
        return jsonify({
            "success": True,
            "device_id": device_id,
            "device_name": handler.device_name,
            "mac_address": handler.mac_address,
            "is_logging": handler.is_logging,
            "current_channel": handler.current_channel,
            "seconds_elapsed": handler.seconds_elapsed
        }), 200
        
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/disconnect', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def disconnect_chimera(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found in database"}), 404
        
        if not device.connected:
            return jsonify({"error": "Device not connected"}), 400
        
        # Disconnect device
        success = device_manager.disconnect_device(device_id)
        if success:
            device.connected = False
            device.logging = False
            db.session.commit()
            return jsonify({"success": True}), 200
        
        return jsonify({"error": "Failed to disconnect device"}), 500
        
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/info', methods=['GET'])
@jwt_required()
def get_info(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        info = handler.get_info()
        
        return jsonify(info)
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/start_logging', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def start_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Check if device is already part of an active test
        if device.active_test_id:
            test = Test.query.get(device.active_test_id)
            if test and test.status == 'running':
                return jsonify({
                    "error": f"Cannot start logging. Device is already part of active test '{test.name}'. Please stop the test first."
                }), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data = request.get_json()

        # Get filename from request
        filename = data.get('filename')
        if not filename:
            return jsonify({"error": "filename is required"}), 400

        # Handle test creation/linking
        test_id = data.get('test_id')
        test = None

        if test_id:
            # Use existing test
            test = Test.query.get(test_id)
            if not test:
                return jsonify({"error": "Test not found"}), 404
        else:
            # Create new test automatically
            test_name = data.get('test_name', f"Chimera Log - {device.name} - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
            test = Test(
                name=test_name,
                description=data.get('test_description', f"Auto-created test for Chimera logging on {device.name}"),
                created_by=data.get('created_by', 'system'),
                date_created=datetime.now(),
                status='running',
                date_started=datetime.now()
            )
            db.session.add(test)
            db.session.flush()  # Get the ID without committing
        
        success, message = handler.start_logging(filename)
        if success:
            # Link test to handler and device
            handler.set_test_id(test.id)
            device.logging = True
            device.active_test_id = test.id
            
            # Update test status if it was existing and in setup
            if test.status == 'setup':
                test.status = 'running'
                test.date_started = datetime.now()
            
            db.session.commit()
            
            return jsonify({
                "success": True,
                "message": message,
                "test_id": test.id,
                "test_name": test.name
            })
        else:
            # If logging failed and we created a test, don't save it
            if not test_id:  # Only rollback if we created a new test
                db.session.rollback()
            return jsonify({
                "success": False,
                "message": message
            })
        
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/stop_logging', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def stop_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Check if device is part of an active test
        if device.active_test_id:
            test = Test.query.get(device.active_test_id)
            if test and test.status == 'running':
                return jsonify({
                    "error": f"Cannot stop logging. Device is part of active test '{test.name}'. Please stop the test first."
                }), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        success, message = handler.stop_logging()
        if success:
            device.logging = False

            # Clear any residual test assignment (in case test is not running)
            if device.active_test_id:
                device.active_test_id = None
                handler.set_test_id(None)

            db.session.commit()

            return jsonify({
                "success": True,
                "message": message
            })
        else:
            return jsonify({
                "success": False,
                "message": message
            })

    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/files', methods=['GET'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def get_files(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, result = handler.get_files()

        return jsonify({
            "success": success,
            "memory": result.get("memory"),
            "files": result.get("files", [])
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/download', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator', 'technician'])
def download_file(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        success, lines, message = handler.download_file(filename)
        
        return jsonify({
            "success": success,
            "filename": filename,
            "data": lines if success else None,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/delete_file', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def delete_file(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        filename = data.get('filename')
        
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        
        success, message = handler.delete_file(filename)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/time', methods=['GET'])
@jwt_required()
def get_time(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, dt = handler.get_time()
        
        return jsonify({
            "success": success,
            "datetime": dt
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/time', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_time(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        # Use UTC time - frontend will convert to local time when displaying
        dt = datetime.now(timezone.utc)

        success, message = handler.set_time()

        return jsonify({
            "success": success,
            "message": message,
            "timestamp": int(dt.timestamp()),
            "utc_time": dt.isoformat() + "Z"
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/calibrate', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def calibrate(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data = request.get_json()
        sensor_number = data.get('sensor_number')
        gas_percentage = data.get('gas_percentage')

        if sensor_number is None or gas_percentage is None:
            return jsonify({"error": "sensor_number and gas_percentage are required"}), 400

        # Get device model from config to determine calibration method
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')

        # Use pump-based calibration for chimera-max, manual for standard chimera
        if device_model == 'chimera-max':
            success, message = handler.calibrate_pump(sensor_number, gas_percentage)
            calibration_type = "pump"
        else:
            success, message = handler.calibrate(sensor_number, gas_percentage)
            calibration_type = "manual"

        return jsonify({
            "success": success,
            "message": message,
            "calibration_type": calibration_type
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/timing', methods=['GET'])
@jwt_required()
def get_timing(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, timing, message = handler.get_timing()
        
        return jsonify({
            "success": success,
            "timing": timing,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/timing', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_timing(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        open_time_ms = data.get('open_time_ms')
        flush_time_ms = data.get('flush_time_ms')
        
        if open_time_ms is None or flush_time_ms is None:
            return jsonify({"error": "open_time_ms and flush_time_ms are required"}), 400
        
        success, message = handler.set_all_timing(open_time_ms, flush_time_ms)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/service', methods=['GET'])
@jwt_required()
def get_service(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, service_sequence, message = handler.get_service()
        
        return jsonify({
            "success": success,
            "service_sequence": service_sequence,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/service', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_service(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        service_sequence = data.get('service_sequence')
        
        if not service_sequence:
            return jsonify({"error": "service_sequence is required"}), 400
        
        success, message = handler.set_service(service_sequence)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/past_values', methods=['GET'])
@jwt_required()
def get_past_values(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, past_data, message = handler.get_past_values()
        
        return jsonify({
            "success": success,
            "past_data": past_data,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/sensor_info', methods=['GET'])
@jwt_required()
def get_sensor_info(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, sensor_types, message = handler.get_sensor_info()

        # Current flushing/reading phase, so a freshly opened page can show
        # the progress ring immediately instead of waiting for the next
        # valve event (reading phases can run for many minutes).
        current_phase = None
        if (handler.is_logging and handler.current_status in ('flushing', 'reading')
                and handler.current_status_ts):
            import time
            current_phase = {
                "status": handler.current_status,
                "channel": handler.current_channel,
                "elapsed_ms": int((time.time() - handler.current_status_ts) * 1000)
            }

        return jsonify({
            "success": success,
            "sensor_types": sensor_types,
            "message": message,
            "current_phase": current_phase
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/enable', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def enable_recirculation(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        success, message = handler.enable_recirculation()
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/disable', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def disable_recirculation(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        success, message = handler.disable_recirculation()
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/delay', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_recirculation_delay(device_id):
    """Set the delay between periodic recirculation runs in seconds."""
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data = request.get_json()
        seconds = data.get('seconds')

        if seconds is None:
            return jsonify({"error": "seconds is required"}), 400

        success, message = handler.set_recirculation_delay(seconds)

        return jsonify({
            "success": success,
            "message": message
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/mode', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_recirculation_mode(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data = request.get_json()
        mode = data.get('mode')

        if mode is None:
            return jsonify({"error": "mode is required"}), 400

        success, message = handler.set_recirculate(mode)

        return jsonify({
            "success": success,
            "message": message
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/flag', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def recirculation_flag(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data = request.get_json()
        channel = data.get('channel')
        duration = data.get('duration')
        pump_power = data.get('pump_power')

        if channel is None or duration is None or pump_power is None:
            return jsonify({"error": "channel, duration, and pump_power are required"}), 400

        success, message = handler.recirculate_flag(channel, duration, pump_power)

        return jsonify({
            "success": success,
            "message": message
        })

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/info', methods=['GET'])
@jwt_required()
def get_recirculation_info(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        # Recirculation is only available for chimera-max devices (check global config)
        device_model = current_app.config.get('CHIMERA_DEVICE_MODEL', 'chimera')
        if device_model != 'chimera-max':
            return jsonify({"error": "Recirculation is only available for chimera-max devices"}), 400

        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        success, info = handler.get_recirculation_info()

        if success:
            return jsonify(info)
        else:
            return jsonify({"error": "Failed to get recirculation info"}), 500

    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/name', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def set_name(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        name = data.get('name')
        
        if not name:
            return jsonify({"error": "name is required"}), 400
        
        success = handler.set_name(name)
        
        if success:
            # Update database too
            device.name = name
            db.session.commit()
        
        return jsonify({
            "success": success,
            "name": name if success else None
        })
        
    except Exception as e:
        db.session.rollback()
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/send_command', methods=['POST'])
@jwt_required()
@require_role(['admin', 'operator'])
def send_command(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        data = request.get_json()
        command = data.get('command')
        if not command:
            return jsonify({"error": "command is required"}), 400
        
        response = handler.send_raw_command(command)
        
        return jsonify({
            "command": command,
            "response": response
        })
        
    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/stream', methods=['GET'])
def stream(device_id):
    """SSE endpoint for real-time chimera notifications for a specific device.

    Authenticated via short-lived ?token= (see /api/v1/auth/stream-token)
    because EventSource cannot send Authorization headers.
    """
    auth_error = check_stream_token()
    if auth_error:
        return auth_error
    try:
        # Verify device exists and is connected
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found"}), 404
        
        if device.device_type not in ['chimera', 'chimera-max']:
            return jsonify({"error": "Device is not a chimera"}), 400
        
        # Check both database and device manager state
        if not device.connected:
            return jsonify({"error": "Device not connected in database"}), 400
            
        # Verify device manager has active handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not active"}), 400
        
        # Return SSE stream directly
        print(f"Starting SSE stream for chimera device {device_id}")
        return sse.stream()
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/data_stream', methods=['GET'])
@jwt_required()
def get_data_stream_info(device_id):
    """Get information about how to receive real-time data"""
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        return jsonify({
            "message": "Use /api/v1/chimera/{device_id}/stream for real-time SSE datapoint streaming",
            "format": "datapoint [channel_number] [sensor_data...]",
            "stream_endpoint": f"/api/v1/chimera/{device_id}/stream"
        })
        
    finally:
        db.session.close()


BUNDLED_FIRMWARE_PATH = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    '..', '..', 'firmware', 'chimera', 'firmware.bin'
))


def _load_bundled_firmware():
    """Read the repo-bundled firmware.bin and derive its expected device hash.

    esptool appends a SHA-256 digest as the final 32 bytes of the image, and
    the device's "firmwarehash" command reports exactly that digest - so the
    expected hash IS those 32 bytes, validated here by recomputing
    sha256(image minus digest).

    Returns (data, hash_hex, error_reason); data is None when unavailable.
    """
    if not os.path.isfile(BUNDLED_FIRMWARE_PATH):
        return None, None, 'no_bundled'
    with open(BUNDLED_FIRMWARE_PATH, 'rb') as f:
        data = f.read()
    if len(data) < 33 or data[0] != 0xE9:
        return None, None, 'invalid_bundle'
    appended_digest = data[-32:]
    if hashlib.sha256(data[:-32]).digest() != appended_digest:
        return None, None, 'invalid_bundle'
    return data, appended_digest.hex(), None


def _firmware_update_preflight(device_id):
    """Shared validation for the firmware update routes.

    Returns (handler, error_response); exactly one is None.
    """
    device = Device.query.get(device_id)
    if not device or not device.connected:
        return None, (jsonify({"error": "Device not found or not connected"}), 404)

    if device.device_type not in ['chimera', 'chimera-max']:
        return None, (jsonify({"error": "Device is not a chimera"}), 400)

    handler = device_manager.get_chimera(device_id)
    if not handler:
        return None, (jsonify({"error": "Device handler not found"}), 404)

    if device.active_test_id:
        test = Test.query.get(device.active_test_id)
        if test and test.status == 'running':
            return None, (jsonify({
                "error": "Cannot update firmware while a test is running on this device"
            }), 409)

    if handler.is_logging:
        return None, (jsonify({"error": "Cannot update firmware while the device is logging"}), 409)

    if getattr(handler, 'firmware_update_in_progress', False):
        return None, (jsonify({"error": "A firmware update is already in progress"}), 409)

    return handler, None


@chimera_bp.route('/api/v1/chimera/<int:device_id>/firmware_update', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def firmware_update(device_id):
    """Upload a .bin file and flash it onto the chimera over serial.

    Runs in a background thread; progress is published via SSE as
    'firmware_update_progress' events and the outcome as
    'firmware_update_complete'.
    """
    try:
        handler, error = _firmware_update_preflight(device_id)
        if error:
            return error

        if 'firmware' not in request.files:
            return jsonify({"error": "No firmware file uploaded (expected field 'firmware')"}), 400

        file = request.files['firmware']
        if not file.filename or not file.filename.lower().endswith('.bin'):
            return jsonify({"error": "Firmware must be a .bin file"}), 400

        firmware_data = file.read()
        if len(firmware_data) < 100 * 1024 or len(firmware_data) > 8 * 1024 * 1024:
            return jsonify({"error": "Firmware file size looks wrong (expected 100KB-8MB)"}), 400

        # Every ESP32 app image starts with the 0xE9 magic byte; catches
        # uploads of the wrong file before anything is sent to the device.
        if firmware_data[0] != 0xE9:
            return jsonify({"error": "Not a valid ESP32 firmware image"}), 400

        _launch_firmware_update(handler, device_id, firmware_data)

        return jsonify({
            "success": True,
            "message": "Firmware update started",
            "size": len(firmware_data)
        }), 202

    finally:
        db.session.close()


def _launch_firmware_update(handler, device_id, firmware_data):
    """Start the background flash thread; caller must have run preflight."""
    handler.firmware_update_in_progress = True
    app = current_app._get_current_object()

    def run_update():
        try:
            with app.app_context():
                last_percent = [-1]

                def progress(sent, total):
                    percent = int(sent * 100 / total)
                    if percent == last_percent[0]:
                        return
                    last_percent[0] = percent
                    try:
                        sse.publish({
                            "device_id": device_id,
                            "sent": sent,
                            "total": total,
                            "percent": percent,
                            # 100% only fires after the serial flush, so
                            # from there the device is flashing/rebooting
                            "phase": "verifying" if sent >= total else "transferring"
                        }, type='firmware_update_progress')
                    except Exception:
                        pass

                success, message = handler.update_firmware(firmware_data, progress_cb=progress)
                print(f"[FIRMWARE UPDATE] Device {device_id}: success={success} - {message}")
                try:
                    sse.publish({
                        "device_id": device_id,
                        "success": success,
                        "message": message
                    }, type='firmware_update_complete')
                except Exception:
                    pass
        finally:
            handler.firmware_update_in_progress = False

    threading.Thread(
        target=run_update,
        daemon=True,
        name=f"ChimeraFirmwareUpdate-{device_id}"
    ).start()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/firmware_check', methods=['GET'])
@jwt_required()
def firmware_check(device_id):
    """Compare the repo-bundled firmware.bin against the device's running
    firmware (via the firmwarehash serial command)."""
    try:
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404

        if device.device_type not in ['chimera', 'chimera-max']:
            return jsonify({"error": "Device is not a chimera"}), 400

        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404

        data, bundled_hash, reason = _load_bundled_firmware()
        if data is None:
            return jsonify({"update_available": None, "reason": reason})

        if getattr(handler, 'firmware_update_in_progress', False):
            return jsonify({
                "update_available": None,
                "reason": "update_in_progress",
                "bundled_hash": bundled_hash
            })

        success, device_hash = handler.get_firmware_hash()
        if not success:
            return jsonify({
                "update_available": None,
                "reason": "device_unknown",
                "bundled_hash": bundled_hash,
                "bundled_size": len(data)
            })

        return jsonify({
            "update_available": device_hash != bundled_hash,
            "device_hash": device_hash,
            "bundled_hash": bundled_hash,
            "bundled_size": len(data)
        })

    except Exception as e:
        return internal_error(e)
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/firmware_update_bundled', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def firmware_update_bundled(device_id):
    """Flash the firmware.bin bundled with this software release."""
    try:
        handler, error = _firmware_update_preflight(device_id)
        if error:
            return error

        data, bundled_hash, reason = _load_bundled_firmware()
        if data is None:
            return jsonify({"error": "No valid bundled firmware available", "reason": reason}), 404

        _launch_firmware_update(handler, device_id, data)

        return jsonify({
            "success": True,
            "message": "Firmware update started",
            "size": len(data),
            "bundled_hash": bundled_hash
        }), 202

    finally:
        db.session.close()
