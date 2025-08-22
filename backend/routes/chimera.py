from flask import Blueprint, request, jsonify
from device_manager import DeviceManager
from database.models import *
from datetime import datetime

chimera_bp = Blueprint('chimera', __name__)
device_manager = DeviceManager()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/connect', methods=['POST'])
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
def disconnect_chimera(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device:
            return jsonify({"error": "Device not found in database"}), 404
        
        if not device.connected:
            return jsonify({"error": "Device not connected"}), 400
        
        # Disconnect device
        success = device_manager.disconnect_device('chimera', device_id)
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
def start_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, message = handler.start_logging()
        if success:
            device.logging = True
            db.session.commit()
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/stop_logging', methods=['POST'])
def stop_logging(device_id):
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        # Get handler
        handler = device_manager.get_chimera(device_id)
        if not handler:
            return jsonify({"error": "Device handler not found"}), 404
        
        success, message = handler.stop_logging()
        if success:
            device.logging = False
            db.session.commit()
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/files', methods=['GET'])
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
        
        success, files = handler.get_files()
        
        return jsonify({
            "success": success,
            "files": files
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/download', methods=['POST'])
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
        
        success, dt, message = handler.get_time()
        
        return jsonify({
            "success": success,
            "timestamp": dt.isoformat() if dt else None,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/time', methods=['POST'])
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
        
        data = request.get_json()
        timestamp = data.get('timestamp')
        
        if not timestamp:
            return jsonify({"error": "timestamp is required (ISO format)"}), 400
        
        try:
            dt = datetime.fromisoformat(timestamp)
        except ValueError:
            return jsonify({"error": "Invalid timestamp format"}), 400
        
        success, message = handler.set_time(dt)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/calibrate', methods=['POST'])
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
        
        success, message = handler.set_timing(open_time_ms, flush_time_ms)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/service', methods=['GET'])
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


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/days', methods=['POST'])
def set_recirculation_days(device_id):
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
        days = data.get('days')
        
        if days is None:
            return jsonify({"error": "days is required"}), 400
        
        success, message = handler.set_recirculation_days(days)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/recirculation/time', methods=['POST'])
def set_recirculation_time(device_id):
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
        hour = data.get('hour')
        minute = data.get('minute')
        
        if hour is None or minute is None:
            return jsonify({"error": "hour and minute are required"}), 400
        
        success, message = handler.set_recirculation_time(hour, minute)
        
        return jsonify({
            "success": success,
            "message": message
        })
        
    finally:
        db.session.close()


@chimera_bp.route('/api/v1/chimera/<int:device_id>/name', methods=['POST'])
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


@chimera_bp.route('/api/v1/chimera/<int:device_id>/data_stream', methods=['GET'])
def get_data_stream_info(device_id):
    """Get information about how to receive real-time data"""
    try:
        # Get device from database
        device = Device.query.get(device_id)
        if not device or not device.connected:
            return jsonify({"error": "Device not found or not connected"}), 404
        
        return jsonify({
            "message": "Chimera devices send automatic datapoint messages during logging",
            "format": "datapoint [channel_number] [sensor_data...]",
            "note": "Consider implementing WebSocket or Server-Sent Events for real-time data streaming"
        })
        
    finally:
        db.session.close()