from flask import Blueprint, request, jsonify
from flask_sse import sse
from flask_jwt_extended import jwt_required
from datetime import datetime, timezone
from device_manager import DeviceManager
from database.models import *
from utils.auth import require_role

chimera_bp = Blueprint('chimera', __name__)
device_manager = DeviceManager()


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
        return jsonify({"error": str(e)}), 500
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
        return jsonify({"error": str(e)}), 500
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
        return jsonify({"error": str(e)}), 500
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
        return jsonify({"error": str(e)}), 500
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
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/files', methods=['GET'])
@jwt_required()
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
        
        success, message = handler.calibrate(sensor_number, gas_percentage)
        
        return jsonify({
            "success": success,
            "message": message
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
        
        return jsonify({
            "success": success,
            "sensor_types": sensor_types,
            "message": message
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
        return jsonify({"error": str(e)}), 500
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
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/stream', methods=['GET'])
def stream(device_id):
    """SSE endpoint for real-time chimera notifications for a specific device."""
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